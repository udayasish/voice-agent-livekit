import logger from "../../../../../lib/logger.js";
import {
  RayaAuthenticationError,
  RayaProtocolError,
  RayaTimeoutError,
} from "./errors.js";
import { parseSSEStream } from "./sse-parser.js";
import type { RayaSSEEvent, RayaTTSRequest, RayaVoice, RayaVoicesResponse } from "./types.js";

export interface RayaClientOptions {
  baseUrl: string;
  apiKey: string;
  connectTimeoutMs?: number | undefined;
  requestTimeoutMs?: number | undefined;
}

/**
 * Direct HTTP client for Raya BakBak TTS endpoints.
 */
export class RayaClient {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly connectTimeoutMs: number;
  readonly requestTimeoutMs: number;

  constructor(options: RayaClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey.trim();
    this.connectTimeoutMs = options.connectTimeoutMs ?? 3000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15000;
  }

  /**
   * Retrieves available voices from GET /v1/voices.
   */
  async listVoices(options?: { abortSignal?: AbortSignal | undefined }): Promise<RayaVoice[]> {
    if (!this.apiKey) {
      throw new RayaAuthenticationError();
    }

    const url = `${this.baseUrl}/voices`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.connectTimeoutMs);

    if (options?.abortSignal) {
      options.abortSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "X-API-Key": this.apiKey,
          Accept: "application/json",
        },
        signal: controller.signal,
      });

      if (response.status === 401) {
        throw new RayaAuthenticationError();
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new RayaProtocolError(
          `GET /voices returned HTTP ${response.status}: ${errorText || response.statusText}`,
          response.status,
        );
      }

      const body = (await response.json()) as RayaVoicesResponse;
      return body.voices ?? [];
    } catch (err) {
      if (controller.signal.aborted && !options?.abortSignal?.aborted) {
        throw new RayaTimeoutError(`Raya /voices request timed out after ${this.connectTimeoutMs}ms`);
      }
      if (err instanceof RayaAuthenticationError || err instanceof RayaProtocolError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new RayaProtocolError(`Failed to connect to Raya /voices: ${message}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Streams audio chunks via POST /v1/text-to-speech/stream using Server-Sent Events (SSE).
   */
  async *synthesizeStream(
    request: RayaTTSRequest,
    abortSignal?: AbortSignal,
  ): AsyncGenerator<RayaSSEEvent> {
    if (!this.apiKey) {
      throw new RayaAuthenticationError();
    }

    const url = `${this.baseUrl}/text-to-speech/stream`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    if (abortSignal) {
      abortSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "X-API-Key": this.apiKey,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (controller.signal.aborted && !abortSignal?.aborted) {
        throw new RayaTimeoutError(`Raya synthesis stream timed out after ${this.requestTimeoutMs}ms`);
      }
      if (abortSignal?.aborted) {
        return; // Normal cancellation
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new RayaProtocolError(`Failed to initiate synthesis stream: ${message}`);
    }

    clearTimeout(timeoutId);

    if (response.status === 401) {
      throw new RayaAuthenticationError();
    }

    if (!response.ok) {
      logger.error("[agent:tts:raya] HTTP error from Raya streaming API", {
        status: response.status,
        errorCode: "TTS_PROVIDER_HTTP_ERROR",
      });
      await response.body?.cancel();
      throw new RayaProtocolError(
        `POST /text-to-speech/stream returned HTTP ${response.status}`,
        response.status,
      );
    }

    if (!response.body) {
      throw new RayaProtocolError("Raya streaming response body is null");
    }

    yield* parseSSEStream(response.body, controller.signal);
  }
}
