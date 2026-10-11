import {
  tts,
  type APIConnectOptions,
} from "@livekit/agents";
import type { AudioFrame } from "@livekit/rtc-node";
import crypto from "node:crypto";
import logger from "../../../../../lib/logger.js";
import { AudioFrameBuffer } from "./audio-frame-buffer.js";
import { decodeF32LEBase64ToPCM16 } from "./pcm-f32le.js";
import { splitAssamesePhrases } from "./phrase-segmenter.js";
import type { RayaClient } from "./client.js";
import type { ResolvedRayaTTSConfig } from "./types.js";
import type { RayaTTS } from "./raya-tts.js";

/**
 * LiveKit SynthesizeStream handling incremental token text streaming from an LLM.
 * Segments incoming text deltas on Assamese phrase boundaries and dispatches
 * streaming synthesis requests to Raya BakBak sequentially.
 */
export class RayaSynthesizeStream extends tts.SynthesizeStream {
  readonly label = "raya.bakbak.synthesize_stream";

  private textAccumulator = "";
  private isStreamClosed = false;

  constructor(
    ttsInstance: RayaTTS,
    private readonly client: RayaClient,
    private readonly config: ResolvedRayaTTSConfig,
    connOptions?: APIConnectOptions,
  ) {
    super(ttsInstance, connOptions);
  }

  protected async run(): Promise<void> {
    try {
      for await (const textDelta of this.input) {
        if (this.isStreamClosed || this.abortSignal.aborted || this.abortController.signal.aborted) {
          break;
        }

        if (typeof textDelta !== "string") {
          // FLUSH_SENTINEL encountered: flush any accumulated phrase immediately
          const pending = this.textAccumulator.trim();
          if (pending.length > 0) {
            this.textAccumulator = "";
            await this.synthesizePhrase(pending, false);
          }
          continue;
        }

        this.textAccumulator += textDelta;
        const { phrases, remainder } = splitAssamesePhrases(this.textAccumulator);
        this.textAccumulator = remainder;

        for (const phrase of phrases) {
          if (this.abortSignal.aborted || this.abortController.signal.aborted) {
            break;
          }
          await this.synthesizePhrase(phrase, false);
        }
      }

      // Flush any trailing text segment after input stream completes
      const remaining = this.textAccumulator.trim();
      if (!this.isStreamClosed && !this.abortSignal.aborted && !this.abortController.signal.aborted && remaining.length > 0) {
        await this.synthesizePhrase(remaining, true);
      }

      this.queue.close();
    } catch (error) {
      if (!this.abortSignal.aborted && !this.abortController.signal.aborted) {
        logger.error("[agent:tts:raya] Error in RayaSynthesizeStream", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      this.queue.close();
    }
  }

  private async synthesizePhrase(phrase: string, isLastPhrase: boolean): Promise<void> {
    const requestId = `raya-inc-${crypto.randomUUID().slice(0, 8)}`;
    const segmentId = `raya-seg-${crypto.randomUUID().slice(0, 8)}`;
    const frameBuffer = new AudioFrameBuffer(this.config.sampleRate, 20, 1);
    let heldFrame: AudioFrame | null = null;

    const emitFrame = (frame: AudioFrame, final: boolean) => {
      this.queue.put({
        requestId,
        segmentId,
        frame,
        final,
        deltaText: phrase,
      });
    };

    logger.debug("[agent:tts:raya] Synthesizing incremental phrase", {
      requestId,
      phrase: phrase.slice(0, 40),
      isLastPhrase,
    });

    const sseStream = this.client.synthesizeStream(
      {
        text: phrase,
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
        frameBuffer.clear();
        heldFrame = null;
        break;
      }

      if (event.type === "chunk" && event.data) {
        const pcmSamples = decodeF32LEBase64ToPCM16(event.data);
        const frames = frameBuffer.push(pcmSamples);

        for (const frame of frames) {
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
          emitFrame(lastRemainder, isLastPhrase);
          heldFrame = null;
        } else if (heldFrame) {
          emitFrame(heldFrame, isLastPhrase);
          heldFrame = null;
        }
        break;
      }
    }
  }

  override close(): void {
    this.isStreamClosed = true;
    super.close();
  }
}
