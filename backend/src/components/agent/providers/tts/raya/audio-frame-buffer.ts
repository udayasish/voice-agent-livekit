import { AudioFrame } from "@livekit/rtc-node";

/**
 * Accumulates PCM audio samples across arbitrary network chunks and yields
 * uniform 20ms LiveKit AudioFrames (e.g. 480 samples @ 24kHz mono).
 *
 * Remaining samples are carried over to the next chunk.
 * Upon stream completion, flush() zero-pads any remaining samples to guarantee
 * consistent WebRTC frame timing and clock pacing without jitter.
 */
export class AudioFrameBuffer {
  private residualSamples: Int16Array = new Int16Array(0);
  readonly samplesPerFrame: number;

  constructor(
    public readonly sampleRate = 24000,
    public readonly frameDurationMs = 20,
    public readonly channels = 1,
  ) {
    this.samplesPerFrame = Math.floor((frameDurationMs / 1000) * sampleRate);
  }

  get pendingSamples(): number {
    return this.residualSamples.length;
  }

  /**
   * Pushes newly decoded PCM16 samples, combines with any residual samples,
   * and yields all complete 20ms AudioFrames.
   */
  push(samples: Int16Array): AudioFrame[] {
    if (samples.length === 0) {
      return [];
    }

    const totalSamples = this.residualSamples.length + samples.length;
    const combined = new Int16Array(totalSamples);
    combined.set(this.residualSamples, 0);
    combined.set(samples, this.residualSamples.length);

    const frames: AudioFrame[] = [];
    let offset = 0;

    while (offset + this.samplesPerFrame <= totalSamples) {
      const frameBuffer = new Int16Array(this.samplesPerFrame);
      frameBuffer.set(combined.subarray(offset, offset + this.samplesPerFrame));
      frames.push(new AudioFrame(frameBuffer, this.sampleRate, this.channels, this.samplesPerFrame));
      offset += this.samplesPerFrame;
    }

    this.residualSamples = combined.subarray(offset);
    return frames;
  }

  /**
   * Flushes remaining samples upon end of synthesis, zero-padding the tail remainder
   * to full 20ms frame length. Returns null if no residual samples exist.
   */
  flush(): AudioFrame | null {
    if (this.residualSamples.length === 0) {
      return null;
    }

    const frameBuffer = new Int16Array(this.samplesPerFrame);
    frameBuffer.set(this.residualSamples); // Trailing elements remain 0
    this.residualSamples = new Int16Array(0);

    return new AudioFrame(frameBuffer, this.sampleRate, this.channels, this.samplesPerFrame);
  }

  /**
   * Clears all pending residual samples (e.g. on stream abort / barge-in).
   */
  clear(): void {
    this.residualSamples = new Int16Array(0);
  }
}
