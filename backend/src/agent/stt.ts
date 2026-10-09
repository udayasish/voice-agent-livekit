import { stt } from "@livekit/agents";
import type * as deepgram from "@livekit/agents-plugin-deepgram";
import { AudioStream, type Track } from "@livekit/rtc-node";
import logger from "../lib/logger.js";
import {
  createLiveKitDeepgramSTT,
  ensureAgentsLogger,
  getDeepgramConfig,
  type DeepgramConfig,
} from "../components/agent/providers/stt/index.js";

export interface STTCallbacks {
  onSpeechStart?: (event: stt.SpeechEvent) => void | Promise<void>;
  onInterimTranscript?: (event: stt.SpeechEvent, latencyMs: number) => void | Promise<void>;
  onFinalTranscript?: (event: stt.SpeechEvent, latencyMs: number) => void | Promise<void>;
  onSpeechEnd?: (event: stt.SpeechEvent) => void | Promise<void>;
  onError?: (error: Error) => void | Promise<void>;
}

export interface STTTrackSubscription {
  stream: stt.SpeechStream;
  close: () => void;
}

/**
 * Loads and initializes Deepgram Nova-3 STT for the LiveKit Agent worker.
 * Returns null if DEEPGRAM_API_KEY is not configured (preserving ₹0 local development).
 */
export async function loadDeepgramSTT(
  opts?: Partial<DeepgramConfig>,
): Promise<deepgram.STT | null> {
  ensureAgentsLogger();
  const config = getDeepgramConfig(opts);

  if (!config.isConfigured) {
    logger.info(
      "[agent:stt] DEEPGRAM_API_KEY not configured. Real-time cloud STT will be disabled for local session.",
    );
    return null;
  }

  try {
    const sttInstance = createLiveKitDeepgramSTT(config);
    logger.info("[agent:stt] Deepgram Nova-3 STT initialized successfully", {
      model: config.model,
      language: config.language,
      sampleRate: config.sampleRate,
    });
    return sttInstance;
  } catch (err) {
    logger.error("[agent:stt] Failed to initialize Deepgram STT", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Attaches a Deepgram STT stream to an incoming WebRTC audio track.
 * Subscribes to 16kHz mono audio frames, feeds the Deepgram WebSocket pipeline,
 * tracks latency metrics, and dispatches typed callbacks.
 */
export function attachSTTToTrack(
  sttInstance: deepgram.STT,
  track: Track,
  callbacks: STTCallbacks,
  abortSignal?: AbortSignal,
): STTTrackSubscription {
  ensureAgentsLogger();

  // Create 16kHz mono audio stream from WebRTC track
  const audioStream = new AudioStream(track, 16000, 1);
  const sttStream = sttInstance.stream();

  // Pipe audio stream into STT engine
  sttStream.updateInputStream(
    audioStream as unknown as Parameters<typeof sttStream.updateInputStream>[0],
  );

  let isClosed = false;
  let utteranceStartTime: number | null = null;

  const close = () => {
    if (isClosed) return;
    isClosed = true;
    try {
      sttStream.close();
    } catch (err) {
      logger.warn("[agent:stt] Error closing STT stream", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  if (abortSignal) {
    if (abortSignal.aborted) {
      close();
    } else {
      abortSignal.addEventListener("abort", close, { once: true });
    }
  }

  // Consume STT events in background loop
  (async () => {
    try {
      for await (const event of sttStream) {
        if (isClosed || abortSignal?.aborted) {
          break;
        }

        switch (event.type) {
          case stt.SpeechEventType.START_OF_SPEECH: {
            utteranceStartTime = Date.now();
            try {
              await callbacks.onSpeechStart?.(event);
            } catch (err) {
              logger.error("[agent:stt] Error in onSpeechStart callback", {
                error: err instanceof Error ? err.message : String(err),
              });
            }
            break;
          }

          case stt.SpeechEventType.INTERIM_TRANSCRIPT: {
            if (utteranceStartTime === null) {
              utteranceStartTime = Date.now();
            }
            const latencyMs = Date.now() - utteranceStartTime;
            try {
              await callbacks.onInterimTranscript?.(event, latencyMs);
            } catch (err) {
              logger.error("[agent:stt] Error in onInterimTranscript callback", {
                error: err instanceof Error ? err.message : String(err),
              });
            }
            break;
          }

          case stt.SpeechEventType.FINAL_TRANSCRIPT: {
            if (utteranceStartTime === null) {
              utteranceStartTime = Date.now();
            }
            const latencyMs = Date.now() - utteranceStartTime;
            try {
              await callbacks.onFinalTranscript?.(event, latencyMs);
            } catch (err) {
              logger.error("[agent:stt] Error in onFinalTranscript callback", {
                error: err instanceof Error ? err.message : String(err),
              });
            }
            break;
          }

          case stt.SpeechEventType.END_OF_SPEECH: {
            try {
              await callbacks.onSpeechEnd?.(event);
            } catch (err) {
              logger.error("[agent:stt] Error in onSpeechEnd callback", {
                error: err instanceof Error ? err.message : String(err),
              });
            }
            utteranceStartTime = null;
            break;
          }

          default:
            break;
        }
      }
    } catch (err) {
      if (!isClosed && !abortSignal?.aborted) {
        const error = err instanceof Error ? err : new Error(String(err));
        logger.error("[agent:stt] Unhandled error in STT stream processing loop", {
          error: error.message,
        });
        try {
          await callbacks.onError?.(error);
        } catch {
          // ignore
        }
      }
    } finally {
      close();
    }
  })();

  return {
    stream: sttStream,
    close,
  };
}
