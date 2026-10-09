import { initializeLogger, stt } from "@livekit/agents";
import * as deepgram from "@livekit/agents-plugin-deepgram";
import { AudioFrame } from "@livekit/rtc-node";
import logger from "../../../../lib/logger.js";
import { getDeepgramConfig, type DeepgramConfig, type ResolvedDeepgramConfig } from "./config.js";
import type {
  SpeechEvent,
  STTCapabilities,
  STTOptions,
  STTProvider,
  WordResult,
} from "./types.js";

/**
 * Initializes LiveKit Agents logger if not already initialized.
 * Prevents "logger not initialized" TypeError when instantiated outside cli.runApp.
 */
export const ensureAgentsLogger = (): void => {
  try {
    initializeLogger({ pretty: false, level: "info" });
  } catch {
    // Already initialized or ignored
  }
};

/**
 * Factory creating a native LiveKit STT instance backed by Deepgram Nova-3.
 * Can be passed directly to LiveKit Agent voice sessions or attached to tracks.
 */
export function createLiveKitDeepgramSTT(
  options?: Partial<DeepgramConfig>,
): deepgram.STT {
  ensureAgentsLogger();
  const config = getDeepgramConfig(options);

  if (!config.apiKey || config.apiKey.trim().length === 0) {
    throw new Error(
      "Deepgram API key is required. Set DEEPGRAM_API_KEY in .env or pass apiKey option.",
    );
  }

  logger.info("[stt:deepgram] Initializing Deepgram Nova-3 STT", {
    model: config.model,
    language: config.language,
    sampleRate: config.sampleRate,
    interimResults: config.interimResults,
    endpointingMs: config.endpointingMs,
  });

  return new deepgram.STT({
    apiKey: config.apiKey,
    model: config.model,
    language: config.language,
    baseUrl: config.baseUrl,
    punctuate: config.punctuate,
    smartFormat: config.smartFormat,
    interimResults: config.interimResults,
    endpointing: config.endpointingMs,
    sampleRate: config.sampleRate,
    numChannels: config.numChannels,
  });
}

/**
 * Deepgram Nova-3 STT Provider implementation.
 * Satisfies the project STTProvider interface from TECH_STACK.md.
 */
export class DeepgramSTTProvider implements STTProvider {
  readonly label = "Deepgram Nova-3 STT";

  readonly capabilities: STTCapabilities = {
    streaming: true,
    interimResults: true,
    alignedTranscript: "word",
    languages: ["as", "as-IN", "hi", "en"],
    models: ["nova-3", "nova-2"],
  };

  private defaultOptions: ResolvedDeepgramConfig;

  constructor(options?: Partial<DeepgramConfig>) {
    this.defaultOptions = getDeepgramConfig(options);
  }

  /**
   * Transcribes an incoming stream of audio (AudioFrame or PCM buffer) into SpeechEvents.
   */
  async *transcribe(
    audio: AsyncIterable<AudioFrame> | AsyncIterable<Uint8Array>,
    options?: Partial<STTOptions>,
  ): AsyncIterable<SpeechEvent> {
    const mergedConfig = getDeepgramConfig({
      apiKey: options?.apiKey ?? this.defaultOptions.apiKey,
      model: options?.model ?? this.defaultOptions.model,
      language: options?.language ?? this.defaultOptions.language,
      baseUrl: options?.baseUrl ?? this.defaultOptions.baseUrl,
      punctuate: options?.punctuate ?? this.defaultOptions.punctuate,
      smartFormat: options?.smartFormat ?? this.defaultOptions.smartFormat,
      interimResults: options?.interimResults ?? this.defaultOptions.interimResults,
      endpointingMs: options?.endpointingMs ?? this.defaultOptions.endpointingMs,
      sampleRate: options?.sampleRate ?? this.defaultOptions.sampleRate,
      numChannels: options?.numChannels ?? this.defaultOptions.numChannels,
    });

    const lkSTT = createLiveKitDeepgramSTT(mergedConfig);
    const stream = lkSTT.stream();
    const streamStartTime = Date.now();

    // Pump input audio into stream in background task
    const inputPumper = (async () => {
      try {
        for await (const chunk of audio) {
          if (chunk instanceof AudioFrame) {
            stream.pushFrame(chunk);
          } else {
            // Convert Uint8Array PCM to AudioFrame (assuming 16-bit linear PCM mono)
            const sampleRate = mergedConfig.sampleRate;
            const samples = chunk.byteLength / 2;
            const int16Data = new Int16Array(
              chunk.buffer,
              chunk.byteOffset,
              samples,
            );
            const frame = new AudioFrame(int16Data, sampleRate, 1, samples);
            stream.pushFrame(frame);
          }
        }
      } catch (err) {
        logger.error("[stt:deepgram] Error pumping audio to Deepgram stream", {
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        try {
          stream.flush();
          stream.endInput();
        } catch {
          // Stream may already be closed
        }
      }
    })();

    // Consume speech events from stream and yield normalized SpeechEvents
    try {
      for await (const event of stream) {
        if (
          event.type === stt.SpeechEventType.INTERIM_TRANSCRIPT ||
          event.type === stt.SpeechEventType.FINAL_TRANSCRIPT
        ) {
          const primaryAlt = event.alternatives?.[0];
          if (primaryAlt && primaryAlt.text.trim().length > 0) {
            const isFinal = event.type === stt.SpeechEventType.FINAL_TRANSCRIPT;
            const now = Date.now();
            const latencyMs = now - streamStartTime;

            const words: WordResult[] = (primaryAlt.words ?? []).map((w) => {
              const text =
                typeof w === "string"
                  ? w
                  : typeof w === "object" && w && "text" in w
                    ? String((w as { text?: unknown }).text ?? "")
                    : String(w);
              const confidence =
                typeof w === "object" && w && "confidence" in w
                  ? Number((w as { confidence?: unknown }).confidence ?? 1.0)
                  : 1.0;
              const startTime =
                typeof w === "object" && w && "startTime" in w
                  ? Number((w as { startTime?: unknown }).startTime ?? 0)
                  : 0;
              const endTime =
                typeof w === "object" && w && "endTime" in w
                  ? Number((w as { endTime?: unknown }).endTime ?? 0)
                  : 0;
              return {
                word: text,
                confidence,
                startTime,
                endTime,
              };
            });

            const speechEvent: SpeechEvent = {
              isFinal,
              transcript: primaryAlt.text,
              confidence: primaryAlt.confidence ?? 1.0,
              words,
              language: primaryAlt.language ?? mergedConfig.language,
              startTimeMs: primaryAlt.startTime !== undefined ? Math.round(primaryAlt.startTime * 1000) : undefined,
              durationMs:
                primaryAlt.endTime !== undefined && primaryAlt.startTime !== undefined
                  ? Math.round((primaryAlt.endTime - primaryAlt.startTime) * 1000)
                  : undefined,
              latencyMs,
            };

            yield speechEvent;
          }
        }
      }
    } finally {
      await inputPumper.catch(() => {});
      stream.close();
    }
  }
}
