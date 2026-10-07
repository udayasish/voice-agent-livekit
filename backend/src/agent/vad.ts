import {
  initializeLogger,
  VADEventType,
  type VAD as BaseVAD,
  type VADEvent,
  type VADStream,
} from "@livekit/agents";
import { VAD as SileroVAD } from "@livekit/agents-plugin-silero";
import { AudioStream, type Track } from "@livekit/rtc-node";
import logger from "../lib/logger.js";

export type SileroVADOptions = NonNullable<Parameters<typeof SileroVAD.load>[0]>;

/**
 * Conservative baseline parameters for Silero Voice Activity Detection (VAD).
 *
 * Rationale:
 * - activationThreshold (0.5): Confidence score threshold in [0.0, 1.0].
 *   0.5 eliminates room acoustics and breathing false-positives while consistently triggering on voiced speech.
 * - minSpeechDuration (100ms): Requires at least 100ms of sustained speech above threshold,
 *   filtering out short transients like keyboard clicks, mic pops, or throat clearing.
 * - minSilenceDuration (600ms): Silence duration required to conclude a conversational turn.
 *   600ms allows natural mid-utterance breathing/thinking pauses without prematurely cutting off the user.
 * - prefixPaddingDuration (300ms): Audio prepended before the start of speech to ensure initial consonants
 *   (e.g., plosives /p/, /t/, /k/) are not lost when frames are forwarded to STT.
 * - maxBufferedSpeech (60000ms): 60 seconds buffer ceiling to safeguard agent memory against runaway speech.
 * - sampleRate (16000Hz): Native 16 kHz sample rate expected by the Silero ONNX model.
 * - forceCPU (true): Deterministic CPU-only ONNX inference for ₹0 local development without GPU dependencies.
 */
export const CONSERVATIVE_VAD_OPTIONS: Readonly<SileroVADOptions> = {
  activationThreshold: 0.5,
  minSpeechDuration: 100,
  minSilenceDuration: 600,
  prefixPaddingDuration: 300,
  maxBufferedSpeech: 60000,
  sampleRate: 16000,
  forceCPU: true,
} as const;

/**
 * Initializes LiveKit logging if not already configured.
 * Prevents "logger not initialized" errors when VADStream is instantiated outside cli.runApp.
 */
export const ensureAgentsLogger = (): void => {
  try {
    initializeLogger({ pretty: false, level: "info" });
  } catch {
    // Already initialized or ignored
  }
};

/**
 * Loads and initializes the Silero ONNX neural model on CPU.
 * Recommended to call within worker process prewarm to eliminate inference cold-starts.
 */
export const loadSileroVAD = async (
  opts?: Partial<SileroVADOptions>,
): Promise<SileroVAD> => {
  ensureAgentsLogger();
  const mergedOptions: SileroVADOptions = {
    ...CONSERVATIVE_VAD_OPTIONS,
    ...opts,
  };

  logger.info("[agent:vad] Loading Silero VAD neural model with conservative settings", {
    activationThreshold: mergedOptions.activationThreshold,
    minSpeechDuration: mergedOptions.minSpeechDuration,
    minSilenceDuration: mergedOptions.minSilenceDuration,
    prefixPaddingDuration: mergedOptions.prefixPaddingDuration,
    sampleRate: mergedOptions.sampleRate,
    forceCPU: mergedOptions.forceCPU,
  });

  const vad = (await SileroVAD.load(mergedOptions)) as SileroVAD;
  return vad;
};

export interface VADCallbacks {
  onSpeechStart?: (event: VADEvent) => void | Promise<void>;
  onSpeechEnd?: (event: VADEvent) => void | Promise<void>;
  onInferenceDone?: (event: VADEvent) => void | Promise<void>;
}

export interface VADTrackSubscription {
  stream: VADStream;
  close: () => void;
}

/**
 * Attaches a Silero VAD stream to an incoming WebRTC audio track.
 * Subscribes to audio frames, feeds the VAD pipeline, and dispatches
 * typed speech events (start, end/turn boundary, inference).
 */
export const attachVADToTrack = (
  vad: BaseVAD,
  track: Track,
  callbacks: VADCallbacks,
  abortSignal?: AbortSignal,
): VADTrackSubscription => {
  ensureAgentsLogger();

  // Create 16kHz mono audio stream from WebRTC track
  const audioStream = new AudioStream(track, 16000, 1);
  const vadStream = vad.stream();

  // Pipe remote audio stream into VAD engine
  vadStream.updateInputStream(audioStream as unknown as Parameters<typeof vadStream.updateInputStream>[0]);

  let isClosed = false;

  const close = () => {
    if (isClosed) return;
    isClosed = true;
    try {
      vadStream.close();
    } catch (err) {
      logger.warn("[agent:vad] Error closing VAD stream", {
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

  // Consume VAD events in background loop
  (async () => {
    try {
      for await (const event of vadStream) {
        if (isClosed || abortSignal?.aborted) {
          break;
        }

        switch (event.type) {
          case VADEventType.START_OF_SPEECH:
            try {
              await callbacks.onSpeechStart?.(event);
            } catch (err) {
              logger.error("[agent:vad] Error in onSpeechStart callback", {
                error: err instanceof Error ? err.message : String(err),
              });
            }
            break;

          case VADEventType.END_OF_SPEECH:
            try {
              await callbacks.onSpeechEnd?.(event);
            } catch (err) {
              logger.error("[agent:vad] Error in onSpeechEnd callback", {
                error: err instanceof Error ? err.message : String(err),
              });
            }
            break;

          case VADEventType.INFERENCE_DONE:
            try {
              await callbacks.onInferenceDone?.(event);
            } catch (err) {
              logger.error("[agent:vad] Error in onInferenceDone callback", {
                error: err instanceof Error ? err.message : String(err),
              });
            }
            break;

          default:
            break;
        }
      }
    } catch (err) {
      if (!isClosed && !abortSignal?.aborted) {
        logger.error("[agent:vad] Unhandled error in VAD stream processing loop", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      close();
    }
  })();

  return {
    stream: vadStream,
    close,
  };
};
