export type WordResult = {
  word: string;
  confidence: number;
  startTime: number;
  endTime: number;
};

export type SpeechEvent = {
  isFinal: boolean;
  transcript: string;
  words: WordResult[];
  language: string;
};

export type STTOptions = {
  language: string;
  sampleRate: number;
};

export interface STTProvider {
  transcribe(
    audio: AsyncIterable<Uint8Array>,
    options: STTOptions,
  ): AsyncIterable<SpeechEvent>;
}
