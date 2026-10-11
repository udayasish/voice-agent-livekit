/**
 * Type contracts for TTS (Text-to-Speech) providers and adapters.
 */

export interface TTSAudioMetadata {
  sampleRate: number;
  channels: number;
  durationMs: number;
  inferenceTimeMs: number;
  mode?: string | undefined;
  device?: string | undefined;
}

export interface TTSResult {
  /** Complete RIFF WAV binary buffer */
  wavBuffer: Buffer;
  /** Extracted and aligned 16-bit linear PCM audio samples */
  pcmSamples: Int16Array;
  /** Audio and latency performance metadata */
  metadata: TTSAudioMetadata;
}

export interface TTSOptions {
  /** Target language code (default: 'as' for Assamese) */
  language?: string | undefined;
  /** Speed playback multiplier (must be 1.0 for IndicF5) */
  speed?: number | undefined;
  /** Custom path to reference audio on the TTS service */
  refAudioPath?: string | undefined;
  /** Custom transcript for reference audio */
  refText?: string | undefined;
  /** Request timeout in milliseconds */
  timeoutMs?: number | undefined;
  /** Cancellation abort signal */
  abortSignal?: AbortSignal | undefined;
}

export interface TTSCapabilities {
  /** Whether the underlying engine generates audio in a streaming fashion */
  streaming: boolean;
  /** Word-aligned transcription timestamps */
  alignedTranscript?: boolean | undefined;
  /** Default sample rate in Hz */
  sampleRate: number;
}

export interface TTSProvider {
  /** Provider identifier label */
  readonly label: string;
  /** Capability flags */
  readonly capabilities: TTSCapabilities;
  /** Check if the remote TTS service is ready and responsive */
  checkReady(): Promise<boolean>;
  /** Synthesize input text into 24kHz audio */
  synthesize(text: string, options?: TTSOptions): Promise<TTSResult>;
}
