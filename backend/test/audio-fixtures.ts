import { AudioFrame } from "@livekit/rtc-node";

export interface SyntheticSpeechOptions {
  fundamentalFreq?: number; // Voice pitch in Hz (e.g. 180 Hz)
  amplitude?: number; // 0 to 32767 (default: 16000, ~ -6 dBFS)
  sampleRate?: number;
  frameDurationMs?: number; // Chunk size in ms (default: 20ms)
}

export interface SyntheticNoiseOptions {
  amplitude?: number; // 0 to 32767 (default: 500, ~ -36 dBFS ambient room hum)
  sampleRate?: number;
  frameDurationMs?: number;
}

/**
 * Generate 20ms AudioFrames of silence (all zeros).
 */
export const generateSilenceFrames = (
  durationMs: number,
  sampleRate = 16000,
  frameDurationMs = 20,
): AudioFrame[] => {
  const samplesPerFrame = Math.floor((frameDurationMs / 1000) * sampleRate);
  const totalFrames = Math.floor(durationMs / frameDurationMs);
  const frames: AudioFrame[] = [];

  for (let i = 0; i < totalFrames; i++) {
    const chunk = new Int16Array(samplesPerFrame); // Zero-filled
    frames.push(new AudioFrame(chunk, sampleRate, 1, samplesPerFrame));
  }

  return frames;
};

/**
 * Generate synthetic human-like speech audio frames.
 * Combines a fundamental voice frequency (e.g., 180Hz) with voice harmonics (360Hz, 720Hz, 1440Hz),
 * low-frequency pitch modulation, and syllable rhythm (4Hz syllable modulation)
 * to reliably trigger neural Voice Activity Detectors.
 */
export const generateSyntheticSpeechFrames = (
  durationMs: number,
  options: SyntheticSpeechOptions = {},
): AudioFrame[] => {
  const sampleRate = options.sampleRate ?? 16000;
  const frameDurationMs = options.frameDurationMs ?? 20;
  const fundamental = options.fundamentalFreq ?? 180;
  const baseAmplitude = options.amplitude ?? 16000;

  const samplesPerFrame = Math.floor((frameDurationMs / 1000) * sampleRate);
  const totalSamples = Math.floor((durationMs / 1000) * sampleRate);
  const buffer = new Int16Array(totalSamples);

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;

    // 4Hz syllabic rhythm envelope (mimicking natural speech cadences)
    const syllableEnvelope = 0.5 + 0.5 * Math.sin(2 * Math.PI * 4 * t);

    // Fundamental + Formant harmonics (1st, 2nd, 3rd, 4th harmonics)
    const f1 = Math.sin(2 * Math.PI * fundamental * t);
    const f2 = 0.6 * Math.sin(2 * Math.PI * (fundamental * 2) * t);
    const f3 = 0.4 * Math.sin(2 * Math.PI * (fundamental * 3) * t);
    const f4 = 0.2 * Math.sin(2 * Math.PI * (fundamental * 4) * t);

    const voiceSignal = (f1 + f2 + f3 + f4) * 0.45;
    const sampleVal = voiceSignal * syllableEnvelope * baseAmplitude;

    buffer[i] = Math.max(-32768, Math.min(32767, Math.round(sampleVal)));
  }

  const frames: AudioFrame[] = [];
  for (let offset = 0; offset < buffer.length; offset += samplesPerFrame) {
    if (offset + samplesPerFrame <= buffer.length) {
      const chunk = new Int16Array(samplesPerFrame);
      chunk.set(buffer.subarray(offset, offset + samplesPerFrame));
      frames.push(new AudioFrame(chunk, sampleRate, 1, samplesPerFrame));
    }
  }

  return frames;
};

/**
 * Generate low-amplitude background noise frames (50Hz electrical hum + Gaussian noise).
 * Stays below activation threshold to test VAD noise rejection.
 */
export const generateBackgroundNoiseFrames = (
  durationMs: number,
  options: SyntheticNoiseOptions = {},
): AudioFrame[] => {
  const sampleRate = options.sampleRate ?? 16000;
  const frameDurationMs = options.frameDurationMs ?? 20;
  const noiseAmp = options.amplitude ?? 500; // ~ -36 dBFS

  const samplesPerFrame = Math.floor((frameDurationMs / 1000) * sampleRate);
  const totalFrames = Math.floor(durationMs / frameDurationMs);
  const frames: AudioFrame[] = [];

  let seed = 42;
  const pseudoRandom = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return (seed / 233280) * 2 - 1;
  };

  for (let f = 0; f < totalFrames; f++) {
    const chunk = new Int16Array(samplesPerFrame);
    for (let i = 0; i < samplesPerFrame; i++) {
      const t = (f * samplesPerFrame + i) / sampleRate;
      // 50Hz hum + random noise
      const hum = Math.sin(2 * Math.PI * 50 * t);
      const white = pseudoRandom();
      const sampleVal = (hum * 0.4 + white * 0.6) * noiseAmp;
      chunk[i] = Math.max(-32768, Math.min(32767, Math.round(sampleVal)));
    }
    frames.push(new AudioFrame(chunk, sampleRate, 1, samplesPerFrame));
  }

  return frames;
};

export type AudioSegmentSpec =
  | { type: "speech"; durationMs: number; amplitude?: number }
  | { type: "silence"; durationMs: number }
  | { type: "noise"; durationMs: number; amplitude?: number };

/**
 * Concatenates specified audio segments sequentially into a stream of frames.
 */
export const generateSequenceFrames = (
  segments: AudioSegmentSpec[],
  sampleRate = 16000,
  frameDurationMs = 20,
): AudioFrame[] => {
  const result: AudioFrame[] = [];

  for (const seg of segments) {
    if (seg.type === "speech") {
      result.push(
        ...generateSyntheticSpeechFrames(seg.durationMs, {
          sampleRate,
          frameDurationMs,
          amplitude: seg.amplitude,
        }),
      );
    } else if (seg.type === "silence") {
      result.push(...generateSilenceFrames(seg.durationMs, sampleRate, frameDurationMs));
    } else if (seg.type === "noise") {
      result.push(
        ...generateBackgroundNoiseFrames(seg.durationMs, {
          sampleRate,
          frameDurationMs,
          amplitude: seg.amplitude,
        }),
      );
    }
  }

  return result;
};
