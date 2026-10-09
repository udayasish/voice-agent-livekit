import type { AudioFrame } from "@livekit/rtc-node";

/**
 * Word-level alignment and timing returned by STT models.
 */
export interface WordResult {
  word: string;
  confidence: number;
  startTime: number;
  endTime: number;
}

/**
 * Normalized SpeechEvent representing speech recognition output.
 * Emitted during streaming transcription for both interim and final results.
 */
export interface SpeechEvent {
  isFinal: boolean;
  transcript: string;
  confidence: number;
  words: WordResult[];
  language: string;
  startTimeMs?: number | undefined;
  durationMs?: number | undefined;
  latencyMs?: number | undefined;
}

/**
 * Configuration options passed to an STT provider or stream.
 */
export interface STTOptions {
  language: string;
  model: string;
  sampleRate: number;
  numChannels: number;
  punctuate: boolean;
  smartFormat: boolean;
  interimResults: boolean;
  endpointingMs?: number | undefined;
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
}

/**
 * Declared capabilities of an STT provider.
 */
export interface STTCapabilities {
  streaming: boolean;
  interimResults: boolean;
  alignedTranscript?: "word" | "chunk" | false | undefined;
  languages: string[];
  models: string[];
}

/**
 * Base provider interface for Speech-to-Text engines.
 * Adheres to TECH_STACK.md and VOICE_AI_ARCHITECTURE.md abstraction guidelines.
 */
export interface STTProvider {
  readonly label: string;
  readonly capabilities: STTCapabilities;
  transcribe(
    audio: AsyncIterable<AudioFrame> | AsyncIterable<Uint8Array>,
    options?: Partial<STTOptions>,
  ): AsyncIterable<SpeechEvent>;
}
