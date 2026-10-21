import {
  defineAgent,
  type JobContext,
  type JobProcess,
  WorkerOptions,
  cli,
  type VAD as BaseVAD,
} from "@livekit/agents";
import type * as deepgram from "@livekit/agents-plugin-deepgram";
import { RoomEvent, TrackKind, type Track, AudioSource } from "@livekit/rtc-node";
import { fileURLToPath } from "node:url";
import path from "node:path";
import env from "../lib/env.js";
import logger from "../lib/logger.js";
import { playDeterministicGreeting } from "./greeting.js";
import { logLifecycle, registerShutdownHandlers } from "./lifecycle.js";
import { attachVADToTrack, loadSileroVAD } from "./vad.js";
import { attachSTTToTrack, loadDeepgramSTT, type STTTrackSubscription } from "./stt.js";
import { VoiceRecoveryTimer, UnusableSpeechRecoveryGate, waitForPlayback } from "./voice-recovery.js";
import { normalizePhoneNumber } from "../components/agent/normalizers/index.js";
import type { RecoveryReason } from "../components/agent/engine/index.js";
import { loadLLMProvider } from "./llm.js";
import { createBoundVoiceSession } from "./create-session.js";
import { consumeRuntimeBinding } from "../components/agent/runtime-binding.js";
import { loadTTSProvider, type TTSAdapter, RayaTTS } from "./tts.js";
import { InterruptionManager } from "../components/agent/index.js";
import { RedisSessionStore } from "../components/agent/session-store.js";
import { connectRedis, redis } from "../lib/redis.js";
import { RedisProviderCooldown, setProviderCooldownStore } from "../components/agent/providers/llm/cooldown.js";
import { TurnCollector, SpeechTranscriptGate, NORMAL_TURN_PAUSE_MS, DICTATION_TURN_PAUSE_MS, type TranscriptFragment } from "./turn-collector.js";
import type { LLMProvider } from "../components/agent/providers/llm/index.js";

interface AgentProcessUserData extends Record<string, unknown> {
  vad?: BaseVAD | undefined;
  stt?: deepgram.STT | null | undefined;
  llm?: LLMProvider | undefined;
  tts?: TTSAdapter | undefined;
}

/**
 * Node.js LiveKit Agent definition.
 * Prewarms Silero VAD model on process initialization.
 * Prewarms Deepgram Nova-3 STT for Assamese real-time transcription.
 * Prewarms LLM Provider (Qwen3.5 / Groq).
 * Prewarms active TTS adapter (Raya BakBak / IndicF5).
 * Detects speech start, speech end (turn boundaries), and user interruption (barge-in).
 */
const agent = defineAgent<AgentProcessUserData>({
  prewarm: async (proc: JobProcess<AgentProcessUserData>) => {
    logger.info("[agent:prewarm] Prewarming Silero VAD neural model on CPU...");
    proc.userData.vad = await loadSileroVAD();
    logger.info("[agent:prewarm] Silero VAD prewarmed successfully on worker process");

    logger.info("[agent:prewarm] Initializing Deepgram Nova-3 STT for Assamese...");
    proc.userData.stt = await loadDeepgramSTT();
    if (proc.userData.stt) {
      logger.info("[agent:prewarm] Deepgram Nova-3 STT prewarmed successfully");
    }

    logger.info("[agent:prewarm] Initializing LLM provider (Qwen3.5-4B)...");
    proc.userData.llm = loadLLMProvider();
    logger.info("[agent:prewarm] LLM provider initialized successfully");

    logger.info(`[agent:prewarm] Initializing TTS provider (${env.TTS_PROVIDER})...`);
    proc.userData.tts = loadTTSProvider();
    if (proc.userData.tts instanceof RayaTTS) {
      await proc.userData.tts.initialize().catch((err) => {
        logger.warn("[agent:prewarm] Raya TTS initialization notice", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
    logger.info(`[agent:prewarm] TTS provider (${proc.userData.tts.label}) initialized successfully`);
  },
  entry: async (ctx: JobContext<AgentProcessUserData>) => {
    const targetRoomName = ctx.job?.room?.name ?? ctx.room.name ?? "unnamed-room";
    const jobId = ctx.job?.id;

    logLifecycle("job_assigned", `Worker assigned job for room: ${targetRoomName}`, {
      jobId,
      roomName: targetRoomName,
    });

    // Step 1: Connect to the room
    logLifecycle("room_connecting", `Connecting to room: ${targetRoomName}...`, {
      jobId,
      roomName: targetRoomName,
    });

    await ctx.connect();

    const roomName = ctx.room.name || targetRoomName;
    const localIdentity = ctx.room.localParticipant?.identity ?? "agent-assistant";
    const initialParticipantsCount = ctx.room.remoteParticipants.size;

    logLifecycle(
      "room_connected",
      `Agent connected to room '${roomName}' as participant '${localIdentity}' with ${initialParticipantsCount} existing remote participant(s)`,
      {
        jobId,
        roomName,
        participantIdentity: localIdentity,
        participantsCount: initialParticipantsCount,
      },
    );

    // Ensure VAD, STT, LLM, and TTS are available (prewarmed or lazy fallback)
    const vad = ctx.proc.userData.vad ?? (await loadSileroVAD());
    const stt = ctx.proc.userData.stt ?? (await loadDeepgramSTT());
    const llm = ctx.proc.userData.llm ?? loadLLMProvider();
    const tts = ctx.proc.userData.tts ?? loadTTSProvider();
    if (!redis.isOpen) await connectRedis();
    if (!redis.isReady) throw new Error("Redis is required for active agent sessions");
    setProviderCooldownStore(new RedisProviderCooldown(redis));
    const sessionStore = new RedisSessionStore(redis);

    // Setup audio source and single authoritative interruption coordinator
    let agentAudioSource: AudioSource | null = null;
    const interruptionManager = new InterruptionManager();
    let roomClosing = false;
    const participantSessions = new Map<string, { session: Awaited<ReturnType<typeof createBoundVoiceSession>>; subscriptions: Array<() => void> }>();
    const attaching = new Set<string>();
    const detachParticipant = async (identity: string) => {
      const resources = participantSessions.get(identity);
      participantSessions.delete(identity);
      let subscriptionFailed = false;
      for (const close of resources?.subscriptions ?? []) {
        try { close(); } catch { subscriptionFailed = true; }
      }
      await resources?.session.close();
      if (subscriptionFailed) throw new Error("Agent subscription cleanup failed");
    };
    const closeSessions = async () => {
      roomClosing = true;
      interruptionManager.reset();
      if (agentAudioSource && !agentAudioSource.closed) agentAudioSource.clearQueue();
      await Promise.all([...participantSessions.keys()].map(detachParticipant));
    };
    const lifecycleFailure = () => logLifecycle("agent_error", "Agent session lifecycle failed", { roomName });
    ctx.addShutdownCallback(closeSessions);

    const attachAudioPipelines = async (track: Track, participantIdentity: string) => {
      // Ensure only one active audio pipeline (VAD, STT, and ConversationSession) per participant
      if (roomClosing || participantSessions.has(participantIdentity) || attaching.has(participantIdentity)) return;
      const participant = ctx.room.remoteParticipants.get(participantIdentity);
      if (!participant) return;
      attaching.add(participantIdentity);
      let session: Awaited<ReturnType<typeof createBoundVoiceSession>>;
      try {
        const binding = await consumeRuntimeBinding(redis, participant.metadata, roomName, participantIdentity);
        session = await createBoundVoiceSession(llm, binding, sessionStore);
      } finally { attaching.delete(participantIdentity); }
      if (roomClosing || !ctx.room.remoteParticipants.has(participantIdentity)) { await session.close(); return; }
      const resources = { session, subscriptions: [] as Array<() => void> };
      participantSessions.set(participantIdentity, resources);
      try {
        await session.ready;
        if (participantSessions.get(participantIdentity) !== resources) return;

        logLifecycle("audio_published", `Attaching Silero VAD to user audio track (${participantIdentity})`, {
          roomName: ctx.room.name,
          participantIdentity,
        });

        let sttSubscription: STTTrackSubscription | undefined;
        let recoveryController: AbortController | undefined;
        let lastSpeechRange: { startMs: number; endMs: number } | undefined;
        let speechGeneration = 0;
        let deliveredAudioThrough = -1;
        let vadReady = false, sttReady = false, listeningReady = false;
        const reportListeningReady = () => {
          if (listeningReady || !vadReady || !sttReady || participantSessions.get(participantIdentity) !== resources) return;
          listeningReady = true;
          logLifecycle("listening_ready", "Audio readers are ready", { roomName, participantIdentity });
          void ctx.room.localParticipant?.publishData(new TextEncoder().encode(JSON.stringify({ type: "voice_status", category: "listening_ready" })),
            { reliable: true, topic: "agent_transcript", destination_identities: [participantIdentity] }).catch(() => {});
        };
        const publishStatus = (category: string) => {
          logLifecycle("voice_recovery", "Voice recovery status", { roomName, participantIdentity, category });
          void ctx.room.localParticipant?.publishData(new TextEncoder().encode(JSON.stringify({ type: "voice_status", category,
            inputMode: sttSubscription?.inputMode ?? "conversation", timestamp: new Date().toISOString() })), { reliable: true, topic: "agent_transcript" }).catch(() => {});
        };
        const reminders = new VoiceRecoveryTimer(() => handleUserTurn({ text: "", confidence: 0, language: "as", latencyMs: 0 }, "no_input"));
        resources.subscriptions.push(() => { reminders.close(); recoveryController?.abort(); });
        const handleUserTurn = async (turn: TranscriptFragment, recovery?: RecoveryReason) => {
          if (participantSessions.get(participantIdentity) !== resources) return;
          reminders.pause();
          const userUtterance = turn.text;
          const { confidence, latencyMs } = turn;
          // Acoustic self-echo filtering:
          // When testing via laptop speakers without headphones, the microphone may capture
          // the agent's recent speech. Discard transcripts that echo the assistant's own utterance.
          const lastAssistantText = session.getState().lastAssistantUtterance?.trim();
          if (!recovery && lastAssistantText) {
            const u = userUtterance.toLowerCase();
            const a = lastAssistantText.toLowerCase();
            const isEcho =
              (u.length >= 10 && u === a) ||
              (a.includes(u) && (u.length >= a.length * 0.6 || u.length >= 20)) ||
              (u.includes(a) && a.length >= 15);

            if (isEcho) {
              logLifecycle(
                "stt_echo_filtered",
                `Ignoring acoustic echo of agent's own speech: "${userUtterance}"`,
                {
                  roomName: ctx.room.name,
                  participantIdentity,
                  userUtterance,
                  lastAssistantText,
                },
              );
              return;
            }
          }

          const turnId = interruptionManager.beginTurn();

          logLifecycle("stt_final_transcript", `Final transcript: "${userUtterance}"`, {
            roomName: ctx.room.name,
            participantIdentity,
            text: userUtterance,
            language: turn.language,
            confidence,
            latencyMs,
            turnId,
          });

          // Flow: STT text -> LLM provider -> response text
          logLifecycle("llm_generation_started", `LLM generating response for "${userUtterance}"`, {
            roomName: ctx.room.name,
            participantIdentity,
            userText: userUtterance,
            turnId,
          });

          const llmSignal = interruptionManager.startThinking(turnId);

          try {
            const llmResult = recovery
              ? await session.processRecovery(recovery, { abortSignal: llmSignal, turnId })
              : await session.processUserUtterance(userUtterance, { abortSignal: llmSignal, turnId });

            // Verify turn is still active before proceeding to broadcast and TTS
            if (!interruptionManager.isTurnActive(turnId)) {
              logLifecycle("tts_skipped", `Skipping response for superseded turn #${turnId}`, {
                roomName: ctx.room.name,
                participantIdentity,
                turnId,
              });
              return;
            }
            // Critical confirmations use the trusted reply language even when
            // the experimental multi baseline does not support that language.
            const confirmationStage = "getVoiceDiagnostics" in session ? session.getVoiceDiagnostics().confirmationStage : "none";
            const language = session.getSnapshot().conversation.language;
            const collectingPhone = session.isCollectingPhoneNumber();
            sttSubscription?.setInputMode(collectingPhone ? "english-digits" : "conversation",
              collectingPhone || confirmationStage === "phone" || confirmationStage === "action" ? language : undefined);
            interruptionManager.finishThinking(turnId);

            logLifecycle("llm_response_completed", `LLM generated response: "${llmResult.text}"`, {
              roomName: ctx.room.name,
              participantIdentity,
              userText: userUtterance,
              responseText: llmResult.text,
              ttftMs: llmResult.ttftMs,
              totalLatencyMs: llmResult.totalLatencyMs,
              turnId,
              slots: llmResult.slots,
              hasDoctor: Boolean(llmResult.slots.doctor),
              hasDateOrTime: Boolean(llmResult.slots.dateOrTime),
              hasPatientName: Boolean(llmResult.slots.patientName),
              hasPhoneNumber: Boolean(llmResult.slots.phoneNumber),
              responseRepeated: llmResult.text === lastAssistantText,
              fallbackReason: llmResult.fallbackReason ?? "none",
              isFallback: llmResult.isFallback,
              replySource: llmResult.replySource,
            });

            // Broadcast transcript and response over WebRTC DataChannel to room (e.g. browser sandbox)
            try {
              const encoder = new TextEncoder();
              const payload = JSON.stringify({
                type: "transcript_turn",
                failureCategory: llmResult.failureCategory,
                providerTtftMs: llmResult.providerTtftMs,
                turnId,
                userText: userUtterance,
                responseText: llmResult.text,
                ttftMs: llmResult.providerTtftMs,
                totalLatencyMs: llmResult.totalLatencyMs,
                slots: llmResult.slots,
                recoveryCategory: recovery ?? (llmResult.fallbackReason === "provider_error" ? "provider_failure" : undefined),
                inputMode: sttSubscription?.inputMode ?? "conversation",
                confirmationStage: "getVoiceDiagnostics" in session ? session.getVoiceDiagnostics().confirmationStage : "none",
                selectedDoctor: "selectedDoctor" in llmResult ? llmResult.selectedDoctor : undefined,
                tools: session.getSnapshot().conversation.toolHistory.filter(call => call.turnId === turnId && !call.interrupted)
                  .map(call => ({ name: call.name, success: call.result.success, ...(!call.result.success ? { code: call.result.error.code } : {}),
                    ...(call.result.success && call.result.data && typeof call.result.data === "object" && "outcome" in call.result.data && typeof call.result.data.outcome === "string"
                      ? { outcome: call.result.data.outcome } : {}),
                    ...(call.result.success && call.result.data && typeof call.result.data === "object" && "resultCount" in call.result.data && Number.isInteger(call.result.data.resultCount)
                      ? { resultCount: call.result.data.resultCount } : {}) })),
                fallbackReason: llmResult.fallbackReason,
                isFallback: llmResult.isFallback,
                replySource: llmResult.replySource,
                timestamp: new Date().toISOString(),
              });
              await ctx.room.localParticipant?.publishData(encoder.encode(payload), {
                reliable: true,
                topic: "agent_transcript",
              });
            } catch {
              // Best-effort data channel broadcast
            }

            // Phase 12 Issue A: Mandatory non-empty text guard before every TTS call
            const speechText = llmResult.text.trim();
            if (!speechText) {
              logLifecycle("tts_skipped", "Skipping TTS synthesis: empty response text", {
                roomName: ctx.room.name,
                participantIdentity,
                turnId,
              });
              return;
            }

            // Synthesize response audio using configured TTS adapter (Raya BakBak / IndicF5)
            try {
              if (!interruptionManager.isTurnActive(turnId)) {
                return;
              }

              logLifecycle("tts_synthesis_started", `Synthesizing speech with ${tts.label} for: "${speechText.slice(0, 40)}"`, {
                roomName: ctx.room.name,
                participantIdentity,
                text: speechText,
                provider: tts.label,
                turnId,
              });

              const ttsSignal = interruptionManager.startSpeaking(turnId);
              const ttsStart = Date.now();
              const ttsStream = tts.synthesize(speechText, undefined, ttsSignal);
              let frameCount = 0;
              let audioDurationMs = 0;
              for await (const packet of ttsStream) {
                if (!interruptionManager.canDeliverFrame(turnId)) {
                  break;
                }
                if (!agentAudioSource || agentAudioSource.closed) throw new Error("Assistant audio is unavailable");
                await agentAudioSource.captureFrame(packet.frame);
                frameCount++;
                audioDurationMs += packet.frame.samplesPerChannel / packet.frame.sampleRate * 1000;
              }
              const ttsDurationMs = Date.now() - ttsStart;
              if (frameCount === 0) {
                await session.notifyInterruption(turnId);
                logLifecycle("tts_skipped", "No assistant audio was delivered", { roomName, participantIdentity, turnId });
                return;
              }

              if (interruptionManager.isTurnActive(turnId)) {
                if (!agentAudioSource) throw new Error("Assistant audio is unavailable");
                await waitForPlayback(agentAudioSource, audioDurationMs, ttsSignal);
                if (!interruptionManager.isTurnActive(turnId)) return;
                await session.notifyPlaybackResult(turnId, true);
                logLifecycle("playback_completed", "Readback playback completed", { roomName, participantIdentity, turnId });
                reminders.playbackCompleted(/[?？]|কওক|ক'ব|দিব|please|tell|provide|say|बताएं/iu.test(speechText));
                interruptionManager.finishSpeaking(turnId);
                logLifecycle(
                  "tts_synthesis_completed",
                  `${tts.label} speech synthesis completed (${frameCount} frames in ${ttsDurationMs}ms)`,
                  {
                    roomName: ctx.room.name,
                    participantIdentity,
                    frameCount,
                    ttsDurationMs,
                    provider: tts.label,
                    turnId,
                  },
                );
              }
            } catch (ttsErr) {
              // A prepared readback cannot authorize an action if speech delivery failed.
              await session.notifyInterruption(turnId);
              publishStatus("playback_failure");
              if (!interruptionManager.isTurnActive(turnId)) {
                return; // Aborted cleanly
              }
              logLifecycle(
                "agent_error",
                `${tts.label} TTS synthesis error: ${ttsErr instanceof Error ? ttsErr.message : String(ttsErr)}`,
                {
                  roomName: ctx.room.name,
                  participantIdentity,
                  error: ttsErr instanceof Error ? ttsErr.message : String(ttsErr),
                  turnId,
                },
              );
            } finally {
              if (
                interruptionManager.getActiveTurnId() === turnId &&
                interruptionManager.getPhase() === "speaking"
              ) {
                interruptionManager.finishSpeaking(turnId);
              }
            }
          } catch (llmErr) {
            if (session.getSnapshot().session.status === "closed") {
              interruptionManager.reset();
              if (agentAudioSource && !agentAudioSource.closed) agentAudioSource.clearQueue();
              await detachParticipant(participantIdentity).catch(lifecycleFailure);
            }
            if (llmSignal.aborted || !interruptionManager.isTurnActive(turnId)) {
              return; // Turn was superseded or aborted by interruption
            }
            publishStatus("provider_failure");
            logLifecycle(
              "agent_error",
              `LLM generation error: ${llmErr instanceof Error ? llmErr.message : String(llmErr)}`,
              {
                roomName: ctx.room.name,
                participantIdentity,
                error: llmErr instanceof Error ? llmErr.message : String(llmErr),
              },
            );
          }
        };
        const transcriptGate = new SpeechTranscriptGate();
        const recoverRecognition = async (range = lastSpeechRange): Promise<TranscriptFragment | "cancelled" | undefined> => {
          if (!range || !sttSubscription || !session.isCollectingPhoneNumber()) return undefined;
          recoveryController?.abort(); const controller = new AbortController(); recoveryController = controller;
          const generation = speechGeneration;
          const historyLength = session.getSnapshot().conversation.history.length;
          publishStatus("recognition_recovery");
          try {
            const result = await sttSubscription.recoverSpeech(range, controller.signal);
            if (generation !== speechGeneration || controller.signal.aborted || session.getSnapshot().session.status === "closed"
              || session.getSnapshot().conversation.history.length !== historyLength) return "cancelled";
            return result && !transcriptGate.rejection(result) ? result : undefined;
          } catch { return controller.signal.aborted ? "cancelled" : undefined; }
        };
        const unusableRecovery = new UnusableSpeechRecoveryGate();
        const turnCollector = new TurnCollector({
          pauseMs: () => session.isCollectingPhoneNumber() ? DICTATION_TURN_PAUSE_MS : NORMAL_TURN_PAUSE_MS,
          finalTranscriptGraceMs: 1500,
          onAwaitingFinal: () => {
            logLifecycle("stt_final_wait", "Waiting for a delayed recognition final", { roomName, participantIdentity });
            sttSubscription?.requestFinalTranscript();
          },
          onTurn: async turn => {
            // A late final from the original socket must not repeat an utterance
            // already handled through replay or explicit recognition recovery.
            if (turn.audioRange && turn.audioRange.endMs <= deliveredAudioThrough) return;
            deliveredAudioThrough = Math.max(deliveredAudioThrough, (lastSpeechRange?.endMs ?? turn.audioRange?.endMs ?? -301) + 300);
            reminders.activity();
            const capture = normalizePhoneNumber(turn.text);
            if (session.isCollectingPhoneNumber() && (capture.unrecognizedTokens.length > 0 || capture.digitCount > 10)) {
              const restored = await recoverRecognition(turn.audioRange ?? lastSpeechRange);
              if (restored === "cancelled") return;
              if (restored) {
                const second = normalizePhoneNumber(restored.text);
                // Two different digit interpretations cannot authorize a choice.
                if (capture.digitCount && second.digitCount && capture.digits !== second.digits) {
                  publishStatus("recognition_conflict");
                  await handleUserTurn({ ...turn, text: "" }, "speech_unclear"); return;
                }
                unusableRecovery.acceptedInput(); await handleUserTurn(restored); return;
              }
              await handleUserTurn({ ...turn, text: "" }, "speech_unclear"); return;
            }
            sttSubscription?.discardRecoveryAudio();
            unusableRecovery.acceptedInput();
            await handleUserTurn(turn);
          },
          onUnusable: async reason => {
            deliveredAudioThrough = Math.max(deliveredAudioThrough, (lastSpeechRange?.endMs ?? -301) + 300);
            const restored = await recoverRecognition();
            if (restored === "cancelled") return;
            if (restored) { unusableRecovery.acceptedInput(); await handleUserTurn(restored); return; }
            publishStatus(reason);
            if (!unusableRecovery.shouldPrompt()) return;
            await handleUserTurn({ text: "", confidence: 0, language: "as", latencyMs: 0 }, reason);
          },
          onError: lifecycleFailure,
          acceptFragment: fragment => {
            const reason = transcriptGate.rejection(fragment);
            if (!reason) return true;
            logLifecycle(reason === "low_confidence" ? "stt_low_confidence_filtered" : "stt_unvoiced_filtered",
              "Recognition result rejected before model input", {
                roomName, participantIdentity, confidence: fragment.confidence, rejectionReason: reason,
                audioStartMs: fragment.audioRange?.startMs, audioEndMs: fragment.audioRange?.endMs,
              });
            return false;
          },
        });
        resources.subscriptions.push(() => turnCollector.close());

        // 1. Attach Silero VAD
        const vadSubscription = attachVADToTrack(vad, track, {
          onInferenceDone: () => { if (!vadReady) { vadReady = true; reportListeningReady(); } },
          onSpeechStart: event => {
            reminders.activity(); recoveryController?.abort(); speechGeneration++;
            const startMs = Math.max(0, event.samplesIndex / 16 - event.speechDuration);
            lastSpeechRange = { startMs, endMs: event.samplesIndex / 16 };
            transcriptGate.speechStarted(event.samplesIndex / 16, event.speechDuration);
            turnCollector.speechStarted();
            logLifecycle("speech_started", `User speech detected (START_OF_SPEECH)`, {
              roomName: ctx.room.name,
              participantIdentity,
              speaking: true,
            });

            // Interruption / Barge-in handling via InterruptionManager
            const interruption = interruptionManager.handleUserSpeechStart();
            if (interruption) {
              for (const [identity, active] of participantSessions) {
                void active.session.notifyInterruption(interruption.turnId).catch(() => {
                  void detachParticipant(identity).catch(lifecycleFailure);
                });
              }
              // Discard already queued native WebRTC audio frames immediately
              if (agentAudioSource && !agentAudioSource.closed) {
                agentAudioSource.clearQueue();
              }

              logLifecycle(
                "interruption_detected",
                `User interrupted agent playback/generation (${interruption.phase} barge-in detected)`,
                {
                  roomName: ctx.room.name,
                  participantIdentity,
                  turnId: interruption.turnId,
                  playbackDurationMs: interruption.playbackDurationMs,
                  interruptionCount: interruption.interruptionCount,
                  phase: interruption.phase,
                },
              );

              // Informational DataChannel broadcast to frontend clients
              try {
                const payload = JSON.stringify({
                  type: "agent_interrupted",
                  turnId: interruption.turnId,
                  phase: interruption.phase,
                  timestamp: interruption.timestamp,
                });
                ctx.room.localParticipant
                  ?.publishData(new TextEncoder().encode(payload), {
                    reliable: true,
                    topic: "agent_transcript",
                  })
                  .catch(() => {});
              } catch {
                // Best-effort
              }
            }
          },
          onSpeechEnd: (event) => {
            if (lastSpeechRange) lastSpeechRange.endMs = Math.max(lastSpeechRange.startMs, event.samplesIndex / 16 - event.silenceDuration);
            transcriptGate.speechEnded(event.samplesIndex / 16, event.silenceDuration);
            turnCollector.speechEnded();
            const frame = event.frames[0];
            const bufferedDurationMs = frame
              ? Math.round((frame.samplesPerChannel / frame.sampleRate) * 1000)
              : 0;
            const speechDurationMs =
              event.speechDuration > 0 ? event.speechDuration : bufferedDurationMs;

            logLifecycle("speech_ended", `User speech paused (END_OF_SPEECH)`, {
              roomName: ctx.room.name,
              participantIdentity,
              speechDurationMs,
              silenceDurationMs: event.silenceDuration,
              speaking: false,
            });
          },
        });

        resources.subscriptions.push(() => vadSubscription.close());

        // 2. Attach Deepgram Nova-3 STT (if configured)
        if (stt) {
          logLifecycle(
            "audio_published",
            `Attaching Deepgram Nova-3 STT (Assamese) to user audio track (${participantIdentity})`,
            {
              roomName: ctx.room.name,
              participantIdentity,
            },
          );

          sttSubscription = attachSTTToTrack(stt, track, {
            onAudioReady: () => { sttReady = true; reportListeningReady(); },
            onInputModeChanged: (inputMode, language) => {
              publishStatus("input_mode_changed");
              logLifecycle("stt_input_mode_changed", "Recognition input mode changed", {
                roomName: ctx.room.name, participantIdentity, inputMode, language,
              });
            },
            onSpeechStart: () => {
              logLifecycle("stt_stream_started", `Deepgram STT streaming started for ${participantIdentity}`, {
                roomName: ctx.room.name,
                participantIdentity,
              });
            },
            onInterimTranscript: (event, latencyMs) => {
              const primaryAlt = event.alternatives?.[0];
              const text = primaryAlt?.text;
              if (text && text.trim().length > 0) {
                turnCollector.interimReceived();
                logLifecycle("stt_interim_transcript", `Interim transcript: "${text}"`, {
                  roomName: ctx.room.name,
                  participantIdentity,
                  text,
                  language: primaryAlt.language,
                  latencyMs,
                });
              }
            },
            onFinalTranscript: (event, latencyMs, audioRange) => {
              const alternative = event.alternatives?.[0];
              const text = alternative?.text?.trim();
              if (!alternative || !text) return;
              const confidence = alternative.confidence ?? 0;
              turnCollector.addFinal({ text, confidence, language: alternative.language ?? "as", latencyMs,
                ...(audioRange ? { audioRange } : {}) });
            },
            onError: (err) => {
              reminders.pause(); publishStatus("recognition_failure");
              logLifecycle("agent_error", `Deepgram STT stream error: ${err.message}`, {
                roomName: ctx.room.name,
                participantIdentity,
                error: err.message,
              });
            },
          });

          const subscription = sttSubscription;
          resources.subscriptions.push(() => subscription.close());
        }
      } catch {
        if (participantSessions.get(participantIdentity) === resources) await detachParticipant(participantIdentity);
        throw new Error("Unable to initialize agent audio pipeline");
      }
    };

    // Register room lifecycle listeners
    ctx.room.on(RoomEvent.ParticipantConnected, (participant) => {
      logLifecycle(
        "participant_joined",
        `Remote participant connected: ${participant.identity} (${participant.name || "unnamed"})`,
        {
          roomName: ctx.room.name,
          participantIdentity: participant.identity,
          participantName: participant.name,
          participantsCount: ctx.room.remoteParticipants.size,
        },
      );
    });

    ctx.room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      interruptionManager.reset();
      if (agentAudioSource && !agentAudioSource.closed) agentAudioSource.clearQueue();
      void detachParticipant(participant.identity).catch(lifecycleFailure);
      logLifecycle(
        "participant_left",
        `Remote participant disconnected: ${participant.identity}`,
        {
          roomName: ctx.room.name,
          participantIdentity: participant.identity,
          participantsCount: ctx.room.remoteParticipants.size,
        },
      );
    });

    ctx.room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
      if (track.kind === TrackKind.KIND_AUDIO) {
        void attachAudioPipelines(track, participant.identity).catch(lifecycleFailure);
      }
    });

    ctx.room.on(RoomEvent.Disconnected, () => {
      void closeSessions().catch(lifecycleFailure);
      logLifecycle("room_disconnected", `Room '${ctx.room.name}' was disconnected`, {
        roomName: ctx.room.name,
      });
    });

    // Check existing remote participants' audio tracks
    for (const [, participant] of ctx.room.remoteParticipants) {
      for (const [, publication] of participant.trackPublications) {
        if (publication.track && publication.track.kind === TrackKind.KIND_AUDIO) {
          void attachAudioPipelines(publication.track, participant.identity).catch(lifecycleFailure);
        }
      }
    }

    // Step 2: Ensure a remote participant is present before streaming greeting
    if (ctx.room.remoteParticipants.size === 0) {
      logLifecycle(
        "greeting_started",
        `Waiting for remote user participant to join room '${roomName}'...`,
        { roomName },
      );
      await ctx.waitForParticipant();
    }

    // Step 3: Stream deterministic harmonic greeting chime with barge-in support
    try {
      const greetingSignal = interruptionManager.startGreeting();
      logLifecycle("greeting_started", `Streaming deterministic greeting chime in room '${roomName}'`, {
        roomName,
        participantsCount: ctx.room.remoteParticipants.size,
      });

      const greetingResult = await playDeterministicGreeting(ctx, { signal: greetingSignal });
      agentAudioSource = greetingResult.source;

      if (greetingSignal.aborted) {
        if (agentAudioSource && !agentAudioSource.closed) {
          agentAudioSource.clearQueue();
        }
        logLifecycle(
          "greeting_completed",
          `Deterministic greeting was interrupted by user in room '${roomName}' (barge-in successful)`,
          {
            roomName,
          },
        );
      } else {
        interruptionManager.finishGreeting();
        logLifecycle(
          "greeting_completed",
          `Deterministic greeting successfully streamed to room '${roomName}'`,
          {
            roomName,
          },
        );
      }
    } catch (error) {
      logLifecycle(
        "agent_error",
        `Failed to play deterministic greeting: ${error instanceof Error ? error.message : String(error)}`,
        {
          roomName,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    } finally {
      interruptionManager.finishGreeting();
    }

  },
});

export default agent;

// Register process signal handlers for clean shutdown
registerShutdownHandlers(async (signal) => {
  if (redis.isOpen) await redis.quit();
  logLifecycle("worker_shutdown", `Agent worker process cleanly terminated on ${signal}`, { signal });
});

// Run CLI worker if invoked directly
const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : "";

if (
  invokedFile &&
  (invokedFile === currentFile ||
    invokedFile.endsWith("src\\agent\\index.ts") ||
    invokedFile.endsWith("src/agent/index.ts") ||
    invokedFile.endsWith("dist\\agent\\index.js") ||
    invokedFile.endsWith("dist/agent/index.js"))
) {
  const wsURL = env.LIVEKIT_URL.replace(/^http/, "ws");
  // The LiveKit SDK defaults to a 10-second child-process initialization window.
  // On Windows, importing this TypeScript worker in a fresh tsx process can use
  // nearly all of that window before its local VAD prewarm even begins.
  const initializeProcessTimeoutMs = 60_000;
  const localDevMode = process.argv.slice(2).includes("dev");
  logLifecycle("worker_started", "Starting LiveKit Agent worker process", {
    wsURL,
    agentName: env.LIVEKIT_AGENT_NAME || "(all rooms)",
    initializeProcessTimeoutMs,
    idleProcesses: localDevMode ? 1 : undefined,
  });

  cli.runApp(
    new WorkerOptions({
      agent: currentFile,
      wsURL,
      apiKey: env.LIVEKIT_API_KEY,
      apiSecret: env.LIVEKIT_API_SECRET,
      agentName: env.LIVEKIT_AGENT_NAME || "",
      initializeProcessTimeout: initializeProcessTimeoutMs,
      // Warm one local job process before the first browser call in dev mode.
      // Production keeps the SDK's own idle-process default.
      ...(localDevMode ? { numIdleProcesses: 1 } : {}),
      requestFunc: async (jobRequest) => {
        await jobRequest.accept("Assamese Voice Assistant", "agent-assistant");
      },
    }),
  );
}
