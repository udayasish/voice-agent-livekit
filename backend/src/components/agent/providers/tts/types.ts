export type AudioChunk = {
  data: Uint8Array;
  sampleRate: number;
  channels: number;
};

export type TTSOptions = {
  language: string;
  voiceId?: string;
  rate?: number;
};

export interface TTSProvider {
  synthesize(
    text: AsyncIterable<string>,
    options: TTSOptions,
  ): AsyncIterable<AudioChunk>;
}
