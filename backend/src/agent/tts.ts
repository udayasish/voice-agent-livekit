import {
  tts,
  type APIConnectOptions,
} from "@livekit/agents";
import { AudioFrame } from "@livekit/rtc-node";
import crypto from "node:crypto";
import logger from "../lib/logger.js";
import {
  IndicF5Client,
  getIndicF5Config,
  type IndicF5Config,
  type ResolvedIndicF5Config,
} from "../components/agent/providers/tts/index.js";

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
        text: this.inputText.slice(0, 50),
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
        error: err.message,
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

/**
 * Factory helper to instantiate and prewarm the IndicF5 TTS provider.
 */
export function loadTTSProvider(options?: Partial<IndicF5Config>): IndicF5TTS {
  logger.info("[agent:tts] Initializing IndicF5 TTS adapter", {
    serviceUrl: options?.serviceUrl ?? process.env.TTS_SERVICE_URL ?? "http://localhost:8001",
    sampleRate: options?.sampleRate ?? 24000,
  });
  return new IndicF5TTS(options);
}
