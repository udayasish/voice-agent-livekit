import {
  tts,
  type APIConnectOptions,
} from "@livekit/agents";
import type { AudioFrame } from "@livekit/rtc-node";
import crypto from "node:crypto";
import logger from "../../../../../lib/logger.js";
import { AudioFrameBuffer } from "./audio-frame-buffer.js";
import { decodeF32LEBase64ToPCM16 } from "./pcm-f32le.js";
import type { RayaClient } from "./client.js";
import type { ResolvedRayaTTSConfig } from "./types.js";
import type { RayaTTS } from "./raya-tts.js";

/**
 * LiveKit ChunkedStream delivering 20ms uniform AudioFrames from Raya BakBak SSE stream.
 */
export class RayaChunkedStream extends tts.ChunkedStream {
  readonly label = "raya.bakbak.chunked_stream";

  constructor(
    text: string,
    ttsInstance: RayaTTS,
    private readonly client: RayaClient,
    private readonly config: ResolvedRayaTTSConfig,
    connOptions?: APIConnectOptions,
    abortSignal?: AbortSignal,
  ) {
    super(text, ttsInstance, connOptions, abortSignal);
    if (abortSignal?.aborted) {
      this.abortController.abort();
    }
  }

  protected async run(): Promise<void> {
    const requestId = `raya-req-${crypto.randomUUID().slice(0, 8)}`;
    const segmentId = `raya-seg-${crypto.randomUUID().slice(0, 8)}`;
    const startTime = Date.now();
    let ttfaRecorded = false;
    let ttfaMs = 0;
    let totalFrames = 0;
    let heldFrame: AudioFrame | null = null;

    const frameBuffer = new AudioFrameBuffer(this.config.sampleRate, 20, 1);

    const emitFrame = (frame: AudioFrame, final: boolean) => {
      totalFrames++;
      this.queue.put({
        requestId,
        segmentId,
        frame,
        final,
        deltaText: this.inputText,
      });
    };

    try {
      if (this.abortSignal.aborted || this.abortController.signal.aborted) {
        this.queue.close();
        return;
      }

      logger.debug("[agent:tts:raya] Initiating BakBak streaming synthesis", {
        requestId,
        voiceId: this.config.voiceId,
        model: this.config.model,
        language: this.config.language,
      });

      const sseStream = this.client.synthesizeStream(
        {
          text: this.inputText,
          voice_id: this.config.voiceId,
          model: this.config.model,
          language: this.config.language,
          sample_rate: this.config.sampleRate,
          speed: this.config.speed,
        },
        this.abortSignal,
      );

      for await (const event of sseStream) {
        if (this.abortSignal.aborted || this.abortController.signal.aborted) {
          logger.debug("[agent:tts:raya] Streaming synthesis aborted mid-stream (barge-in)", { requestId });
          frameBuffer.clear();
          heldFrame = null;
          break;
        }

        if (event.type === "chunk" && event.data) {
          const pcmSamples = decodeF32LEBase64ToPCM16(event.data);
          const frames = frameBuffer.push(pcmSamples);

          for (const frame of frames) {
            if (!ttfaRecorded) {
              ttfaRecorded = true;
              ttfaMs = Date.now() - startTime;
              logger.info("[agent:tts:raya] First playable audio frame received (TTFA)", {
                requestId,
                ttfaMs,
                voiceId: this.config.voiceId,
                model: this.config.model,
              });
            }

            if (heldFrame) {
              emitFrame(heldFrame, false);
            }
            heldFrame = frame;
          }
        } else if (event.type === "done") {
          const lastRemainder = frameBuffer.flush();
          if (lastRemainder) {
            if (heldFrame) {
              emitFrame(heldFrame, false);
            }
            emitFrame(lastRemainder, true);
            heldFrame = null;
          } else if (heldFrame) {
            emitFrame(heldFrame, true);
            heldFrame = null;
          }
          break;
        }
      }

      const totalDurationMs = Date.now() - startTime;
      const audioDurationMs = totalFrames * 20;
      const rtf = audioDurationMs > 0 ? Number((totalDurationMs / audioDurationMs).toFixed(3)) : 0;

      logger.info("[agent:tts:raya] Synthesis stream completed", {
        requestId,
        totalFrames,
        audioDurationMs,
        totalDurationMs,
        ttfaMs,
        rtf,
      });

      this.queue.close();
    } catch (error) {
      if (!this.abortSignal.aborted && !this.abortController.signal.aborted) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error("[agent:tts:raya] Error in RayaChunkedStream", {
          requestId,
          errorCode: "TTS_STREAM_FAILED",
        });
        this.queue.close();
        throw err;
      }
      this.queue.close();
    }
  }
}
