import logger from "../../../../../lib/logger.js";
import { RayaVoiceNotFoundError } from "./errors.js";
import type { RayaModel, RayaVoice } from "./types.js";

export interface VoiceCatalogClient {
  listVoices(options?: { abortSignal?: AbortSignal | undefined }): Promise<RayaVoice[]>;
}

/**
 * Manages voice discovery, validation, and in-memory caching for Raya BakBak voices.
 */
export class RayaVoiceCatalog {
  private cachedVoices: RayaVoice[] | null = null;

  constructor(private readonly client: VoiceCatalogClient) {}

  /**
   * Retrieves all available voices, using cache when available.
   */
  async getVoices(options?: { abortSignal?: AbortSignal | undefined }): Promise<RayaVoice[]> {
    if (!this.cachedVoices) {
      this.cachedVoices = await this.client.listVoices(options);
      logger.info("[agent:tts:raya] Cached Raya voice catalog", {
        totalVoices: this.cachedVoices.length,
      });
    }
    return this.cachedVoices;
  }

  /**
   * Invalidates cached voices.
   */
  clearCache(): void {
    this.cachedVoices = null;
  }

  /**
   * Resolves a voice matching the specified ID or discovers an appropriate voice for the language and model.
   * Never falls back across languages (e.g. will not substitute Hindi or English for Assamese).
   */
  async resolveVoice(options: {
    voiceId?: string | undefined;
    language?: string | undefined;
    model?: RayaModel | undefined;
    abortSignal?: AbortSignal | undefined;
  }): Promise<RayaVoice> {
    const language = options.language ?? "as";
    const model = options.model ?? "standard";
    const voices = await this.getVoices({ abortSignal: options.abortSignal });

    if (options.voiceId && options.voiceId.trim().length > 0) {
      const explicitId = options.voiceId.trim();
      const match = voices.find(
        (v) => v.id === explicitId && v.model === model && v.language.toLowerCase() === language.toLowerCase(),
      );

      if (!match) {
        throw new RayaVoiceNotFoundError(explicitId, model, language);
      }

      return match;
    }

    // Auto-discover voice for language and model
    const candidates = voices.filter(
      (v) => v.language.toLowerCase() === language.toLowerCase() && v.model === model,
    );

    if (candidates.length === 0) {
      throw new RayaVoiceNotFoundError(`(any-${language})`, model, language);
    }

    const selected = candidates[0]!;
    logger.info("[agent:tts:raya] Auto-resolved voice from catalog", {
      voiceId: selected.id,
      name: selected.name,
      language: selected.language,
      model: selected.model,
    });

    return selected;
  }
}
