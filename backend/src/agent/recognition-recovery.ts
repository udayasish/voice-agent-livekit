import { AudioFrame } from "@livekit/rtc-node";
import type { TranscriptAudioRange } from "./turn-collector.js";

/** Ephemeral mono PCM only; no serialization, files, logs or provider payload storage. */
export class UtteranceAudioBuffer {
  private frames: { frame: AudioFrame; startMs: number; endMs: number }[] = [];
  constructor(private readonly maxMs = 30000) {}
  push(frame: AudioFrame, startMs: number): void {
    if (frame.sampleRate !== 16000 || frame.channels !== 1) return;
    const endMs = startMs + frame.samplesPerChannel / frame.sampleRate * 1000;
    this.frames.push({ frame: new AudioFrame(new Int16Array(frame.data), frame.sampleRate, frame.channels, frame.samplesPerChannel), startMs, endMs });
    while (this.frames.length && endMs - this.frames[0]!.startMs > this.maxMs) this.frames.shift();
  }
  slice(range: TranscriptAudioRange): AudioFrame[] | undefined {
    const frames = this.frames.filter(f => f.endMs > range.startMs && f.startMs < range.endMs);
    if (!frames.length || frames[0]!.startMs > range.startMs || frames.at(-1)!.endMs < range.endMs) return undefined;
    return frames.map(f => f.frame);
  }
  clear(): void { this.frames = []; }
}
