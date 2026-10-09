import { AudioFrame } from "@livekit/rtc-node";
import logger from "../../../../lib/logger.js";
import type {
  SpeechEvent,
  STTCapabilities,
  STTOptions,
  STTProvider,
} from "./types.js";

/**
 * Fallback STT Provider interface for AI4Bharat IndicConformer ASR.
 *
 * Per docs/VOICE_AI_ARCHITECTURE.md:
 * "Deepgram is the initial STT provider. AI4Bharat IndicConformer remains
 * a fallback option only if the Assamese STT benchmark shows that Deepgram
 * is not sufficient."
 */
export class IndicConformerSTTProvider implements STTProvider {
  readonly label = "AI4Bharat IndicConformer STT (Fallback)";

  readonly capabilities: STTCapabilities = {
    streaming: true,
    interimResults: false,
    alignedTranscript: false,
    languages: ["as", "hi", "bn", "or", "gu", "mr", "ta", "te", "kn", "ml", "pa"],
    models: ["ai4bharat/indic-conformer-asr"],
  };

  private endpointUrl: string;

  constructor(endpointUrl = "http://localhost:8002/asr") {
    this.endpointUrl = endpointUrl;
  }

  async *transcribe(
    audio: AsyncIterable<AudioFrame> | AsyncIterable<Uint8Array>,
    options?: Partial<STTOptions>,
  ): AsyncIterable<SpeechEvent> {
    const language = options?.language ?? "as";
    logger.warn(
      "[stt:indicconformer] Fallback IndicConformer ASR provider invoked. Deepgram Nova-3 is primary.",
      { endpointUrl: this.endpointUrl, language },
    );

    // Consume input chunks
    let totalBytes = 0;
    for await (const chunk of audio) {
      if (chunk instanceof AudioFrame) {
        totalBytes += chunk.data.byteLength;
      } else {
        totalBytes += chunk.byteLength;
      }
    }

    throw new Error(
      `AI4Bharat IndicConformer service at ${this.endpointUrl} is configured as a fallback. ` +
        `Deepgram Nova-3 is the active primary STT provider. ` +
        `IndicConformer will be activated only if Phase 9 benchmark demonstrates Deepgram is insufficient.`,
    );
  }
}
