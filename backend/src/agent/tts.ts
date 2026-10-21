import {
  tts,
  type APIConnectOptions,
} from "@livekit/agents";
import { AudioFrame } from "@livekit/rtc-node";
import crypto from "node:crypto";
import env from "../lib/env.js";
import logger from "../lib/logger.js";
import {
  IndicF5Client,
  getIndicF5Config,
  type IndicF5Config,
  type ResolvedIndicF5Config,
  RayaTTS,
  RayaChunkedStream,
  RayaSynthesizeStream,
  type RayaTTSConfig,
} from "../components/agent/providers/tts/index.js";

export { RayaTTS, RayaChunkedStream, RayaSynthesizeStream };
export type { RayaTTSConfig };

/**
 * LiveKit ChunkedStream delivering 24kHz AudioFrame packets from IndicF5 synthesis.
 */
export class IndicF5ChunkedStream extends tts.ChunkedStream {
  readonly label = "ai4bharat.indicf5.stream";

  private client: IndicF5Client;
  private ttsInstance: IndicF5TTS;

  constructor(
    text: string,
    ttsInstance: IndicF5TTS,
    client: IndicF5Client,
    connOptions?: APIConnectOptions,
    abortSignal?: AbortSignal,
  ) {
    super(text, ttsInstance, connOptions, abortSignal);
    this.ttsInstance = ttsInstance;
    this.client = client;
    if (abortSignal?.aborted) {
      this.abortController.abort();
    }
  }

  protected async run(): Promise<void> {
    const requestId = `tts-req-${crypto.randomUUID().slice(0, 8)}`;
    const segmentId = `tts-seg-${crypto.randomUUID().slice(0, 8)}`;
    const startTime = Date.now();

    try {
      if (this.abortSignal.aborted || this.abortController.signal.aborted) {
        this.queue.close();
        return;
      }

      logger.debug("[agent:tts] Initiating IndicF5 synthesis", {
        requestId,
      });

      // Execute synthesis via HTTP client
      const result = await this.client.synthesize(this.inputText, {
        abortSignal: this.abortSignal,
      });

      const pcmSamples = result.pcmSamples;
      const sampleRate = result.metadata.sampleRate;
      const samplesPerFrame = Math.floor((20 / 1000) * sampleRate); // 480 samples @ 24kHz

      const ttfaMs = Date.now() - startTime;
      logger.info("[agent:tts] IndicF5 synthesis completed, streaming audio frames", {
        requestId,
        ttfaMs,
        inferenceTimeMs: result.metadata.inferenceTimeMs,
        durationMs: result.metadata.durationMs,
        totalSamples: pcmSamples.length,
        mode: result.metadata.mode,
      });

      // Slice PCM audio into uniform 20ms AudioFrames with tail remainder padding
      for (let offset = 0; offset < pcmSamples.length; offset += samplesPerFrame) {
        if (this.abortSignal.aborted || this.abortController.signal.aborted) {
          logger.debug("[agent:tts] Audio frame playback interrupted/aborted", { requestId });
          break;
        }

        const remaining = pcmSamples.length - offset;
        const chunkLength = Math.min(samplesPerFrame, remaining);
        const frameBuffer = new Int16Array(samplesPerFrame); // Fixed size per frame
        frameBuffer.set(pcmSamples.subarray(offset, offset + chunkLength));

        const isLastChunk = offset + samplesPerFrame >= pcmSamples.length;
        const frame = new AudioFrame(frameBuffer, sampleRate, 1, samplesPerFrame);

        this.queue.put({
          requestId,
          segmentId,
          frame,
          final: isLastChunk,
          deltaText: this.inputText,
        });
      }

      this.queue.close();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error("[agent:tts] Error during synthesis stream", {
        requestId,
        errorCode: "TTS_STREAM_FAILED",
      });
      this.queue.close();
      throw err;
    }
  }
}

/**
 * AI4Bharat IndicF5 TTS provider implementation for LiveKit Agents SDK.
 */
export class IndicF5TTS extends tts.TTS {
  readonly label = "ai4bharat.indicf5";

  private client: IndicF5Client;
  private resolvedConfig: ResolvedIndicF5Config;

  constructor(options?: Partial<IndicF5Config>) {
    const config = getIndicF5Config(options);
    super(config.sampleRate, 1, { streaming: false });
    this.resolvedConfig = config;
    this.client = new IndicF5Client(config);
  }

  get config(): ResolvedIndicF5Config {
    return this.resolvedConfig;
  }

  /**
   * Synthesizes input text into a ChunkedStream.
   */
  synthesize(
    text: string,
    connOptions?: APIConnectOptions,
    abortSignal?: AbortSignal,
  ): tts.ChunkedStream {
    return new IndicF5ChunkedStream(text, this, this.client, connOptions, abortSignal);
  }

  /**
   * Adapts the non-streaming IndicF5 engine into a streamable TTS interface
   * using LiveKit's built-in StreamAdapter and sentence tokenization.
   */
  stream(options?: { connOptions?: APIConnectOptions }): tts.SynthesizeStream {
    return new tts.StreamAdapter(this).stream(options);
  }
}

export type TTSAdapter = RayaTTS | IndicF5TTS;

export interface TTSFactoryOptions {
  provider?: "raya" | "indicf5" | undefined;
  raya?: Partial<RayaTTSConfig> | undefined;
  indicf5?: Partial<IndicF5Config> | undefined;
  // Backward compatibility with IndicF5 options passed directly
  serviceUrl?: string | undefined;
  sampleRate?: number | undefined;
  language?: string | undefined;
  timeoutMs?: number | undefined;
}

/**
 * Factory helper to instantiate the active TTS provider (Raya BakBak by default,
 * or IndicF5 when explicitly configured).
 */
export function loadTTSProvider(options?: Partial<IndicF5Config> | TTSFactoryOptions): TTSAdapter {
  const factoryOpts = options as TTSFactoryOptions | undefined;
  const selectedProvider = factoryOpts?.provider ?? (factoryOpts?.serviceUrl ? "indicf5" : env.TTS_PROVIDER);

  if (selectedProvider === "indicf5") {
    logger.info("[agent:tts] Initializing IndicF5 TTS adapter (benchmark fallback)", {
      serviceUrl: factoryOpts?.indicf5?.serviceUrl ?? factoryOpts?.serviceUrl ?? env.TTS_SERVICE_URL ?? "http://localhost:8001",
      sampleRate: factoryOpts?.indicf5?.sampleRate ?? factoryOpts?.sampleRate ?? 24000,
    });
    return new IndicF5TTS(factoryOpts?.indicf5 ?? (options as Partial<IndicF5Config>));
  }

  const rayaOptions: Partial<RayaTTSConfig> = {
    ...factoryOpts?.raya,
    ...(factoryOpts?.sampleRate ? { sampleRate: factoryOpts.sampleRate } : {}),
    ...(factoryOpts?.language ? { language: factoryOpts.language } : {}),
    ...(factoryOpts?.timeoutMs ? { requestTimeoutMs: factoryOpts.timeoutMs } : {}),
  };

  logger.info("[agent:tts] Initializing Raya BakBak TTS adapter", {
    language: rayaOptions.language ?? env.RAYA_TTS_LANGUAGE,
    model: rayaOptions.model ?? env.RAYA_TTS_MODEL,
    sampleRate: rayaOptions.sampleRate ?? env.RAYA_TTS_SAMPLE_RATE,
  });

  return new RayaTTS(rayaOptions);
}
