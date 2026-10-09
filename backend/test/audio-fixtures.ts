import { AudioFrame } from "@livekit/rtc-node";
import { ASSAMESE_SAMPLES } from "./fixtures/assamese-samples.js";

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

/**
 * Packages an array of AudioFrames into a standard RIFF/WAV format Buffer (16-bit linear PCM mono).
 */
export const createWavBufferFromFrames = (
  frames: AudioFrame[],
  sampleRate = 16000,
): Buffer => {
  const totalSamples = frames.reduce((acc, f) => acc + f.samplesPerChannel, 0);
  const dataByteLength = totalSamples * 2;
  const buffer = Buffer.alloc(44 + dataByteLength);

  // RIFF header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataByteLength, 4);
  buffer.write("WAVE", 8);

  // "fmt " chunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // subchunk size (16 for PCM)
  buffer.writeUInt16LE(1, 20); // audio format (1 = linear PCM)
  buffer.writeUInt16LE(1, 22); // num channels (1 = mono)
  buffer.writeUInt32LE(sampleRate, 24); // sample rate
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate (sampleRate * numChannels * 2)
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample

  // "data" chunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataByteLength, 40);

  let offset = 44;
  for (const frame of frames) {
    const frameBuffer = Buffer.from(
      frame.data.buffer,
      frame.data.byteOffset,
      frame.data.byteLength,
    );
    frameBuffer.copy(buffer, offset);
    offset += frame.data.byteLength;
  }

  return buffer;
};

/**
 * Parses a standard 16-bit linear PCM mono WAV buffer into 20ms AudioFrames.
 */
export const createFramesFromWavBuffer = (
  wavBuffer: Buffer,
  frameDurationMs = 20,
): AudioFrame[] => {
  if (
    wavBuffer.toString("utf8", 0, 4) !== "RIFF" ||
    wavBuffer.toString("utf8", 8, 12) !== "WAVE"
  ) {
    throw new Error("Invalid WAV format: Missing RIFF/WAVE header");
  }

  const sampleRate = wavBuffer.readUInt32LE(24);
  const channels = wavBuffer.readUInt16LE(22);

  let pos = 12;
  while (pos < wavBuffer.length - 8) {
    const chunkHeader = wavBuffer.toString("utf8", pos, pos + 4);
    const chunkSize = wavBuffer.readUInt32LE(pos + 4);
    if (chunkHeader === "data") {
      const dataOffset = pos + 8;
      const rawData = wavBuffer.subarray(dataOffset, dataOffset + chunkSize);
      const samplesPerFrame = Math.floor((frameDurationMs / 1000) * sampleRate);
      const totalSamples = Math.floor(rawData.byteLength / 2);
      const int16 = new Int16Array(
        rawData.buffer,
        rawData.byteOffset,
        totalSamples,
      );

      const frames: AudioFrame[] = [];
      for (let offset = 0; offset < totalSamples; offset += samplesPerFrame) {
        if (offset + samplesPerFrame <= totalSamples) {
          const chunk = new Int16Array(samplesPerFrame);
          chunk.set(int16.subarray(offset, offset + samplesPerFrame));
          frames.push(new AudioFrame(chunk, sampleRate, channels, samplesPerFrame));
        }
      }
      return frames;
    }
    pos += 8 + chunkSize;
  }

  throw new Error("Invalid WAV format: No 'data' chunk found");
};

/**
 * Procedurally generates speech frames tailored for an Assamese benchmark sample.
 */
export const generateAssameseSpeechFrames = (
  sampleKey: string,
  sampleRate = 16000,
): AudioFrame[] => {
  const sample = ASSAMESE_SAMPLES[sampleKey];
  const durationMs = sample?.durationMs ?? 2000;
  const fundamental = sample?.fundamentalFreq ?? 180;

  return generateSyntheticSpeechFrames(durationMs, {
    sampleRate,
    fundamentalFreq: fundamental,
    amplitude: 18000,
  });
};
