import {
  defineAgent,
  type JobContext,
  type JobProcess,
  WorkerOptions,
  cli,
  type VAD as BaseVAD,
} from "@livekit/agents";
import type * as deepgram from "@livekit/agents-plugin-deepgram";
import { RoomEvent, TrackKind, type Track } from "@livekit/rtc-node";
import { fileURLToPath } from "node:url";
import path from "node:path";
import env from "../lib/env.js";
import logger from "../lib/logger.js";
import { playDeterministicGreeting } from "./greeting.js";
import { logLifecycle, registerShutdownHandlers } from "./lifecycle.js";
import { attachVADToTrack, loadSileroVAD } from "./vad.js";
import { attachSTTToTrack, loadDeepgramSTT } from "./stt.js";
import { loadLLMProvider, ConversationSession } from "./llm.js";
import type { LLMProvider } from "../components/agent/providers/llm/index.js";

interface AgentProcessUserData extends Record<string, unknown> {
  vad?: BaseVAD | undefined;
  stt?: deepgram.STT | null | undefined;
  llm?: LLMProvider | undefined;
}

/**
 * Node.js LiveKit Agent definition.
 * Prewarms Silero VAD model on process initialization.
 * Prewarms Deepgram Nova-3 STT for Assamese real-time transcription.
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

    // Ensure VAD, STT, and LLM are available (prewarmed or lazy fallback)
    const vad = ctx.proc.userData.vad ?? (await loadSileroVAD());
    const stt = ctx.proc.userData.stt ?? (await loadDeepgramSTT());
    const llm = ctx.proc.userData.llm ?? loadLLMProvider();

    // Setup greeting interruption controller (barge-in primitive)
    const greetingAbortController = new AbortController();
    let isGreetingPlaying = false;
    const attachedTracks = new Set<string>();

    const attachAudioPipelines = (track: Track, participantIdentity: string) => {
      const trackId = track.sid || `${participantIdentity}-${track.kind}`;
      if (attachedTracks.has(trackId)) return;
      attachedTracks.add(trackId);

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

          // Interruption / Barge-in handling:
          if (isGreetingPlaying) {
            isGreetingPlaying = false;
            greetingAbortController.abort();
            logLifecycle(
              "interruption_detected",
              `User interrupted agent greeting playback (barge-in detected)`,
              {
                roomName: ctx.room.name,
                participantIdentity,
              },
            );
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
              logLifecycle("stt_final_transcript", `Final transcript: "${userUtterance}"`, {
                roomName: ctx.room.name,
                participantIdentity,
                text: userUtterance,
                language: primaryAlt.language,
                confidence: primaryAlt.confidence,
                latencyMs,
              });

              // Flow: STT text -> LLM provider -> response text
              logLifecycle("llm_generation_started", `LLM generating response for "${userUtterance}"`, {
                roomName: ctx.room.name,
                participantIdentity,
                userText: userUtterance,
              });

              try {
                const llmResult = await session.processUserUtterance(userUtterance);
                logLifecycle("llm_response_completed", `LLM generated response: "${llmResult.text}"`, {
                  roomName: ctx.room.name,
                  participantIdentity,
                  userText: userUtterance,
                  responseText: llmResult.text,
                  ttftMs: llmResult.ttftMs,
                  totalLatencyMs: llmResult.totalLatencyMs,
                });

                // Broadcast transcript and response over WebRTC DataChannel to room (e.g. browser sandbox)
                try {
                  const encoder = new TextEncoder();
                  const payload = JSON.stringify({
                    type: "transcript_turn",
                    userText: userUtterance,
                    responseText: llmResult.text,
                    ttftMs: llmResult.ttftMs,
                    totalLatencyMs: llmResult.totalLatencyMs,
                    timestamp: new Date().toISOString(),
                  });
                  await ctx.room.localParticipant?.publishData(encoder.encode(payload), {
                    reliable: true,
                    topic: "agent_transcript",
                  });
                } catch {
                  // Best-effort data channel broadcast
                }
              } catch (llmErr) {
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
      isGreetingPlaying = true;
      logLifecycle("greeting_started", `Streaming deterministic greeting chime in room '${roomName}'`, {
        roomName,
        participantsCount: ctx.room.remoteParticipants.size,
      });

      await playDeterministicGreeting(ctx, { signal: greetingAbortController.signal });

      if (greetingAbortController.signal.aborted) {
        logLifecycle(
          "greeting_completed",
          `Deterministic greeting was interrupted by user in room '${roomName}' (barge-in successful)`,
          {
            roomName,
          },
        );
      } else {
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
      isGreetingPlaying = false;
    }
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
