import logger from "../../../../lib/logger.js";
import { getIndicF5Config, type IndicF5Config, type ResolvedIndicF5Config } from "./config.js";
import type { TTSAudioMetadata, TTSCapabilities, TTSOptions, TTSProvider, TTSResult } from "./types.js";

/**
 * Parses raw RIFF WAV Buffer into aligned 16-bit PCM samples and header metadata.
 */
export function parseWavAudio(buffer: Buffer): {
  pcmSamples: Int16Array;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
} {
  if (buffer.length < 44) {
    throw new Error(`Invalid WAV buffer: expected at least 44 bytes, got ${buffer.length}`);
  }

  const riff = buffer.toString("ascii", 0, 4);
  const wave = buffer.toString("ascii", 8, 12);
  if (riff !== "RIFF" || wave !== "WAVE") {
    throw new Error(`Invalid WAV format: signature mismatch (${riff}/${wave})`);
  }

  // Find 'fmt ' and 'data' chunks (standard WAV header is at offset 12)
  let offset = 12;
  let channels = 1;
  let sampleRate = 24000;
  let bitsPerSample = 16;
  let dataOffset = 44;
  let dataSize = buffer.length - 44;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);

    if (chunkId === "fmt ") {
      channels = buffer.readUInt16LE(offset + 10);
      sampleRate = buffer.readUInt32LE(offset + 12);
      bitsPerSample = buffer.readUInt16LE(offset + 22);
    } else if (chunkId === "data") {
      dataOffset = offset + 8;
      dataSize = Math.min(chunkSize, buffer.length - dataOffset);
      break;
    }

    offset += 8 + chunkSize;
  }

  // Extract PCM samples safely using sample-by-sample LE reading to avoid memory misalignment
  const sampleCount = Math.floor(dataSize / 2);
  const pcmSamples = new Int16Array(sampleCount);

  for (let i = 0; i < sampleCount; i++) {
    pcmSamples[i] = buffer.readInt16LE(dataOffset + i * 2);
  }

  return { pcmSamples, sampleRate, channels, bitsPerSample };
}

/**
 * Direct HTTP client talking to the Python IndicF5 TTS microservice.
 */
export class IndicF5Client implements TTSProvider {
  readonly label = "ai4bharat.indicf5";

  readonly capabilities: TTSCapabilities = {
    streaming: false,
    sampleRate: 24000,
  };

  private config: ResolvedIndicF5Config;

  constructor(options?: Partial<IndicF5Config>) {
    this.config = getIndicF5Config(options);
  }

  /**
   * Queries the service /ready endpoint.
   */
  async checkReady(): Promise<boolean> {
    const url = `${this.config.serviceUrl}/ready`;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Synthesizes text into 24kHz audio via the Python microservice.
   */
  async synthesize(text: string, options?: TTSOptions): Promise<TTSResult> {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error("Text cannot be empty for speech synthesis");
    }

    const startTime = Date.now();
    const url = `${this.config.serviceUrl}/synthesize`;
    const controller = new AbortController();
    const timeoutMs = options?.timeoutMs ?? this.config.timeoutMs;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    if (options?.abortSignal) {
      options.abortSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    const payload = {
      text: trimmed,
      language: options?.language ?? this.config.language,
      speed: 1.0,
      ref_audio_path: options?.refAudioPath,
      ref_text: options?.refText,
    };

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("[tts:client] Failed to connect to Python TTS service", { url, error: msg });
      throw new Error(`TTS service connection error (${url}): ${msg}`);
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      let errorBody = "";
      try {
        errorBody = await response.text();
      } catch {
        // ignore
      }
      logger.error("[tts:client] HTTP error from TTS service", {
        status: response.status,
        body: errorBody,
      });
      throw new Error(`TTS service returned ${response.status}: ${errorBody || response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const wavBuffer = Buffer.from(arrayBuffer);
    const roundTripMs = Date.now() - startTime;

    // Parse WAV audio and headers
    const { pcmSamples, sampleRate, channels } = parseWavAudio(wavBuffer);

    const durationHeader = response.headers.get("x-audio-duration-ms");
    const inferenceHeader = response.headers.get("x-inference-time-ms");
    const modeHeader = response.headers.get("x-tts-mode") ?? undefined;
    const deviceHeader = response.headers.get("x-tts-device") ?? undefined;

    const durationMs = durationHeader ? parseInt(durationHeader, 10) : Math.round((pcmSamples.length / sampleRate) * 1000);
    const inferenceTimeMs = inferenceHeader ? parseInt(inferenceHeader, 10) : roundTripMs;

    const metadata: TTSAudioMetadata = {
      sampleRate,
      channels,
      durationMs,
      inferenceTimeMs,
      mode: modeHeader,
      device: deviceHeader,
    };

    return { wavBuffer, pcmSamples, metadata };
  }
}
