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
import { attachSTTToTrack, loadDeepgramSTT } from "./stt.js";
import { loadLLMProvider, ConversationSession } from "./llm.js";
import { loadTTSProvider, type TTSAdapter, RayaTTS } from "./tts.js";
import { InterruptionManager } from "../components/agent/index.js";
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

    // Setup audio source and single authoritative interruption coordinator
    let agentAudioSource: AudioSource | null = null;
    const interruptionManager = new InterruptionManager();
    const attachedParticipants = new Set<string>();

    const attachAudioPipelines = (track: Track, participantIdentity: string) => {
      // Ensure only one active audio pipeline (VAD, STT, and ConversationSession) per participant
      if (attachedParticipants.has(participantIdentity)) return;
      attachedParticipants.add(participantIdentity);

      logLifecycle("audio_published", `Attaching Silero VAD to user audio track (${participantIdentity})`, {
        roomName: ctx.room.name,
        participantIdentity,
      });

      // 1. Attach Silero VAD
      const vadSubscription = attachVADToTrack(vad, track, {
        onSpeechStart: () => {
          logLifecycle("speech_started", `User speech detected (START_OF_SPEECH)`, {
            roomName: ctx.room.name,
            participantIdentity,
            speaking: true,
          });

          // Interruption / Barge-in handling via InterruptionManager
          const interruption = interruptionManager.handleUserSpeechStart();
          if (interruption) {
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
          const frame = event.frames[0];
          const bufferedDurationMs = frame
            ? Math.round((frame.samplesPerChannel / frame.sampleRate) * 1000)
            : 0;
          const speechDurationMs =
            event.speechDuration > 0 ? event.speechDuration : bufferedDurationMs;

          logLifecycle("speech_ended", `User finished speaking (END_OF_SPEECH / turn boundary)`, {
            roomName: ctx.room.name,
            participantIdentity,
            speechDurationMs,
            silenceDurationMs: event.silenceDuration,
            speaking: false,
          });
        },
      });

      ctx.addShutdownCallback(async () => {
        vadSubscription.close();
      });

      // Initialize conversational session for this participant's dialogue turns
      const session = new ConversationSession(llm, {
        roomName: ctx.room.name || roomName,
        participantIdentity,
      });

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

        const sttSubscription = attachSTTToTrack(stt, track, {
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
              logLifecycle("stt_interim_transcript", `Interim transcript: "${text}"`, {
                roomName: ctx.room.name,
                participantIdentity,
                text,
                language: primaryAlt.language,
                latencyMs,
              });
            }
          },
          onFinalTranscript: async (event, latencyMs) => {
            const primaryAlt = event.alternatives?.[0];
            const text = primaryAlt?.text;
            if (text && text.trim().length > 0) {
              const userUtterance = text.trim();
              const confidence = primaryAlt.confidence ?? 1.0;

              // Phase 12 Issue B: Confidence gating against low-confidence acoustic noise
              if (confidence < 0.30 && userUtterance.length < 15) {
                logLifecycle(
                  "stt_low_confidence_filtered",
                  `Ignoring low-confidence noise transcript: "${userUtterance}" (confidence: ${confidence.toFixed(2)})`,
                  {
                    roomName: ctx.room.name,
                    participantIdentity,
                    text: userUtterance,
                    confidence,
                  },
                );
                return;
              }

              // Acoustic self-echo filtering:
              // When testing via laptop speakers without headphones, the microphone may capture
              // the agent's recent speech. Discard transcripts that echo the assistant's own utterance.
              const lastAssistantText = session.getState().lastAssistantUtterance?.trim();
              if (lastAssistantText) {
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
                language: primaryAlt.language,
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
                const llmResult = await session.processUserUtterance(userUtterance, {
                  abortSignal: llmSignal,
                });

                // Verify turn is still active before proceeding to broadcast and TTS
                if (!interruptionManager.isTurnActive(turnId)) {
                  logLifecycle("tts_skipped", `Skipping response for superseded turn #${turnId}`, {
                    roomName: ctx.room.name,
                    participantIdentity,
                    turnId,
                  });
                  return;
                }
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
                  isFallback: llmResult.isFallback,
                });

                // Broadcast transcript and response over WebRTC DataChannel to room (e.g. browser sandbox)
                try {
                  const encoder = new TextEncoder();
                  const payload = JSON.stringify({
                    type: "transcript_turn",
                    turnId,
                    userText: userUtterance,
                    responseText: llmResult.text,
                    ttftMs: llmResult.ttftMs,
                    totalLatencyMs: llmResult.totalLatencyMs,
                    slots: llmResult.slots,
                    isFallback: llmResult.isFallback,
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
                  for await (const packet of ttsStream) {
                    if (!interruptionManager.canDeliverFrame(turnId)) {
                      break;
                    }
                    frameCount++;
                    if (agentAudioSource && !agentAudioSource.closed) {
                      await agentAudioSource.captureFrame(packet.frame);
                    }
                  }
                  const ttsDurationMs = Date.now() - ttsStart;

                  if (interruptionManager.isTurnActive(turnId)) {
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
                if (llmSignal.aborted || !interruptionManager.isTurnActive(turnId)) {
                  return; // Turn was superseded or aborted by interruption
                }
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
            }
          },
          onError: (err) => {
            logLifecycle("agent_error", `Deepgram STT stream error: ${err.message}`, {
              roomName: ctx.room.name,
              participantIdentity,
              error: err.message,
            });
          },
        });

        ctx.addShutdownCallback(async () => {
          sttSubscription.close();
        });
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
      attachedParticipants.delete(participant.identity);
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
        attachAudioPipelines(track, participant.identity);
      }
    });

    ctx.room.on(RoomEvent.Disconnected, () => {
      logLifecycle("room_disconnected", `Room '${ctx.room.name}' was disconnected`, {
        roomName: ctx.room.name,
      });
    });

    // Check existing remote participants' audio tracks
    for (const [, participant] of ctx.room.remoteParticipants) {
      for (const [, publication] of participant.trackPublications) {
        if (publication.track && publication.track.kind === TrackKind.KIND_AUDIO) {
          attachAudioPipelines(publication.track, participant.identity);
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

    ctx.addShutdownCallback(async () => {
      interruptionManager.reset();
      if (agentAudioSource && !agentAudioSource.closed) {
        agentAudioSource.clearQueue();
      }
    });
  },
});

export default agent;

// Register process signal handlers for clean shutdown
registerShutdownHandlers(async (signal) => {
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
  logLifecycle("worker_started", "Starting LiveKit Agent worker process", {
    wsURL,
    agentName: env.LIVEKIT_AGENT_NAME || "(all rooms)",
  });

  cli.runApp(
    new WorkerOptions({
      agent: currentFile,
      wsURL,
      apiKey: env.LIVEKIT_API_KEY,
      apiSecret: env.LIVEKIT_API_SECRET,
      agentName: env.LIVEKIT_AGENT_NAME || "",
      requestFunc: async (jobRequest) => {
        await jobRequest.accept("Assamese Voice Assistant", "agent-assistant");
      },
    }),
  );
}
