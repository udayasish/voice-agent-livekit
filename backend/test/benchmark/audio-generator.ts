import { AudioFrame } from "@livekit/rtc-node";
import type { BenchmarkAudioProps } from "./dataset.js";

/**
 * Procedurally generates human-like speech PCM frames for a benchmark specification.
 * Combines fundamental pitch, voice harmonics, and 4Hz syllabic rhythm envelope.
 */
export const generateBenchmarkFrames = (spec: BenchmarkAudioProps): AudioFrame[] => {
  const sampleRate = spec.sampleRate ?? 16000;
  const frameDurationMs = 20; // 20ms frames standard for WebRTC / LiveKit
  const fundamental = spec.fundamentalFreq;
  const baseAmplitude = 18000; // ~ -5.2 dBFS peak

  const samplesPerFrame = Math.floor((frameDurationMs / 1000) * sampleRate);
  const totalSamples = Math.floor((spec.durationMs / 1000) * sampleRate);
  const buffer = new Int16Array(totalSamples);

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;

    // 4Hz syllabic rhythm envelope
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

  let frames: AudioFrame[] = [];
  for (let offset = 0; offset < buffer.length; offset += samplesPerFrame) {
    if (offset + samplesPerFrame <= buffer.length) {
      const chunk = new Int16Array(samplesPerFrame);
      chunk.set(buffer.subarray(offset, offset + samplesPerFrame));
      frames.push(new AudioFrame(chunk, sampleRate, 1, samplesPerFrame));
    }
  }

  // Inject background noise if configured
  if (spec.noiseType && spec.noiseType !== "none") {
    frames = injectBackgroundNoise(frames, spec.noiseType, spec.snrDb ?? 15);
  }

  // If phone quality is requested at 8000 Hz, apply telephony downsampling / bandpass
  if (spec.sampleRate === 8000) {
    frames = simulatePhoneQualityAudio(frames);
  }

  return frames;
};

/**
 * Mixes realistic background noise into audio frames at a target Signal-to-Noise Ratio (SNR in dB).
 *
 * Supported noise types:
 * - "chatter": Multi-talker clinical background chatter (asynchronous voice harmonics)
 * - "hum": 50Hz AC mains power hum with 100Hz and 150Hz harmonic undertones
 * - "white": Broad-spectrum white acoustic hiss
 */
export const injectBackgroundNoise = (
  speechFrames: AudioFrame[],
  noiseType: "hum" | "chatter" | "white",
  snrDb = 15,
): AudioFrame[] => {
  if (speechFrames.length === 0) return [];

  const sampleRate = speechFrames[0]!.sampleRate;
  const channels = speechFrames[0]!.channels;
  const samplesPerFrame = speechFrames[0]!.samplesPerChannel;

  // Calculate Speech RMS power
  let totalSquareSum = 0;
  let totalSamples = 0;

  for (const frame of speechFrames) {
    const data = frame.data;
    for (let i = 0; i < data.length; i++) {
      const val = data[i]!;
      totalSquareSum += val * val;
      totalSamples++;
    }
  }

  const speechRms = Math.sqrt(totalSquareSum / Math.max(1, totalSamples));
  // SNR (dB) = 20 * log10(speechRms / noiseRms) => noiseRms = speechRms / (10^(snrDb / 20))
  const targetNoiseRms = speechRms / Math.pow(10, snrDb / 20);

  // Deterministic PRNG for repeatability
  let seed = 12345;
  const nextRandom = (): number => {
    seed = (seed * 9301 + 49297) % 233280;
    return (seed / 233280) * 2 - 1; // Range [-1.0, 1.0]
  };

  const corruptedFrames: AudioFrame[] = [];
  let sampleIndex = 0;

  for (const frame of speechFrames) {
    const inputData = frame.data;
    const outputData = new Int16Array(samplesPerFrame);

    for (let i = 0; i < samplesPerFrame; i++) {
      const t = sampleIndex / sampleRate;
      let rawNoise = 0;

      if (noiseType === "hum") {
        // 50Hz electrical mains hum + 100Hz/150Hz harmonics + mild white hiss
        const hum50 = Math.sin(2 * Math.PI * 50 * t);
        const hum100 = 0.5 * Math.sin(2 * Math.PI * 100 * t);
        const hum150 = 0.25 * Math.sin(2 * Math.PI * 150 * t);
        const hiss = 0.15 * nextRandom();
        rawNoise = (hum50 + hum100 + hum150 + hiss) * 0.55;
      } else if (noiseType === "chatter") {
        // Multi-talker clinic chatter: overlapping voice-band tones modulated at low rhythms
        const talker1 = Math.sin(2 * Math.PI * 220 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3.2 * t));
        const talker2 = Math.sin(2 * Math.PI * 310 * t) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 2.7 * t));
        const talker3 = Math.sin(2 * Math.PI * 440 * t) * (0.4 + 0.6 * Math.sin(2 * Math.PI * 4.1 * t));
        const roomReverb = 0.2 * nextRandom();
        rawNoise = (talker1 + talker2 + talker3 + roomReverb) * 0.45;
      } else {
        // White noise
        rawNoise = nextRandom();
      }

      const scaledNoise = rawNoise * targetNoiseRms * 1.414; // Peak from RMS
      const speechVal = inputData[i]!;
      const mixedVal = Math.round(speechVal + scaledNoise);

      outputData[i] = Math.max(-32768, Math.min(32767, mixedVal));
      sampleIndex++;
    }

    corruptedFrames.push(new AudioFrame(outputData, sampleRate, channels, samplesPerFrame));
  }

  return corruptedFrames;
};

/**
 * Simulates 8 kHz band-limited telephony audio (G.711 / PSTN standard).
 * Applies a telephone bandpass simulation (300 Hz - 3400 Hz) and resamples to 8000 Hz.
 */
export const simulatePhoneQualityAudio = (speechFrames: AudioFrame[]): AudioFrame[] => {
  if (speechFrames.length === 0) return [];

  const sourceRate = speechFrames[0]!.sampleRate;
  const targetRate = 8000;
  const downsampleRatio = sourceRate / targetRate; // Typically 2.0 (16000 -> 8000)
  const targetSamplesPerFrame = 160; // 20ms @ 8000Hz

  // Flatten input frames to single Int16 buffer
  const totalInputSamples = speechFrames.reduce((acc, f) => acc + f.samplesPerChannel, 0);
  const inputBuffer = new Int16Array(totalInputSamples);
  let writeOffset = 0;
  for (const frame of speechFrames) {
    inputBuffer.set(frame.data, writeOffset);
    writeOffset += frame.samplesPerChannel;
  }

  const totalOutputSamples = Math.floor(totalInputSamples / downsampleRatio);
  const outputBuffer = new Int16Array(totalOutputSamples);

  // Bandpass filter simulation (telephony line: 300Hz high-pass, 3400Hz low-pass)
  // + downsampling by averaging window
  for (let o = 0; o < totalOutputSamples; o++) {
    const srcIndex = Math.floor(o * downsampleRatio);
    let sample = 0;

    if (downsampleRatio === 2 && srcIndex + 1 < totalInputSamples) {
      // 2-sample moving average anti-aliasing
      sample = Math.round((inputBuffer[srcIndex]! + inputBuffer[srcIndex + 1]!) / 2);
    } else {
      sample = inputBuffer[srcIndex] ?? 0;
    }

    // Telephony bandpass attenuation: simulate slightly muted high frequencies
    // and slight telephone line compression (mu-law-like harmonic distortion)
    const normalized = sample / 32768;
    const compressed = Math.sign(normalized) * Math.log(1 + 255 * Math.abs(normalized)) / Math.log(1 + 255);
    outputBuffer[o] = Math.max(-32768, Math.min(32767, Math.round(compressed * 32767)));
  }

  // Package into 20ms @ 8kHz frames (160 samples per frame)
  const resultFrames: AudioFrame[] = [];
  for (let offset = 0; offset < totalOutputSamples; offset += targetSamplesPerFrame) {
    if (offset + targetSamplesPerFrame <= totalOutputSamples) {
      const chunk = new Int16Array(targetSamplesPerFrame);
      chunk.set(outputBuffer.subarray(offset, offset + targetSamplesPerFrame));
      resultFrames.push(new AudioFrame(chunk, targetRate, 1, targetSamplesPerFrame));
    }
  }

  return resultFrames;
};
