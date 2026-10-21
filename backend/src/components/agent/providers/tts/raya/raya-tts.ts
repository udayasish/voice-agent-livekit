import {
  tts,
  type APIConnectOptions,
} from "@livekit/agents";
import logger from "../../../../../lib/logger.js";
import { RayaClient } from "./client.js";
import { getRayaConfig } from "./config.js";
import { RayaChunkedStream } from "./raya-chunked-stream.js";
import { RayaSynthesizeStream } from "./raya-synthesize-stream.js";
import { RayaVoiceCatalog } from "./voice-catalog.js";
import type { RayaTTSConfig, ResolvedRayaTTSConfig } from "./types.js";

/**
 * Raya BakBak Text-to-Speech provider implementation for LiveKit Agents SDK.
 * Supports Assamese ('as') and Indian languages via Server-Sent Events streaming.
 */
export class RayaTTS extends tts.TTS {
  readonly label = "raya.bakbak";

  readonly client: RayaClient;
  readonly catalog: RayaVoiceCatalog;
  private readonly resolvedConfig: ResolvedRayaTTSConfig;

  constructor(options?: Partial<RayaTTSConfig>) {
    const config = getRayaConfig(options);
    super(config.sampleRate, 1, { streaming: true });
    this.resolvedConfig = config;
    this.client = new RayaClient({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      connectTimeoutMs: config.connectTimeoutMs,
      requestTimeoutMs: config.requestTimeoutMs,
    });
    this.catalog = new RayaVoiceCatalog(this.client);
  }

  get config(): ResolvedRayaTTSConfig {
    return this.resolvedConfig;
  }

  /**
   * Initializes the provider by verifying connectivity and resolving
   * the Assamese voice ID from the remote voice catalog.
   */
  async initialize(options?: { abortSignal?: AbortSignal | undefined }): Promise<void> {
    if (!this.resolvedConfig.apiKey) {
      logger.warn(
        "[agent:tts:raya] RAYA_API_KEY is not configured; voice catalog resolution skipped",
      );
      return;
    }

    try {
      const voice = await this.catalog.resolveVoice({
        voiceId: this.resolvedConfig.voiceId || undefined,
        language: this.resolvedConfig.language,
        model: this.resolvedConfig.model,
        abortSignal: options?.abortSignal,
      });

      this.resolvedConfig.voiceId = voice.id;
      logger.info("[agent:tts:raya] Successfully verified Raya TTS voice", {
        voiceId: voice.id,
        name: voice.name,
        language: voice.language,
        model: voice.model,
        sampleRate: this.resolvedConfig.sampleRate,
      });
    } catch (err) {
      logger.error("[agent:tts:raya] Failed to resolve Raya voice at startup", { errorCode: "TTS_VOICE_RESOLUTION_FAILED" });
      throw err;
    }
  }

  /**
   * Synthesizes input text into a live ChunkedStream of 20ms AudioFrames.
   */
  synthesize(
    text: string,
    connOptions?: APIConnectOptions,
    abortSignal?: AbortSignal,
  ): tts.ChunkedStream {
    return new RayaChunkedStream(
      text,
      this,
      this.client,
      this.resolvedConfig,
      connOptions,
      abortSignal,
    );
  }

  /**
   * Creates an incremental SynthesizeStream for streaming LLM text increments.
   */
  stream(options?: { connOptions?: APIConnectOptions }): tts.SynthesizeStream {
    return new RayaSynthesizeStream(
      this,
      this.client,
      this.resolvedConfig,
      options?.connOptions,
    );
  }
}
