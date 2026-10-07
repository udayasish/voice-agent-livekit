import {
  AudioFrame,
  AudioSource,
  LocalAudioTrack,
  TrackPublishOptions,
  TrackSource,
} from "@livekit/rtc-node";
import type { JobContext } from "@livekit/agents";
import logger from "../lib/logger.js";

export interface GreetingOptions {
  sampleRate?: number;
  frameDurationMs?: number;
  trackName?: string;
  signal?: AbortSignal;
}

/**
 * Note specification for synthesized harmonic chime.
 */
interface NoteSpec {
  frequency: number; // Hz
  durationMs: number; // milliseconds
}

/**
 * Standard pleasant 4-note ascending chord chime:
 * C5 (523.25 Hz) -> E5 (659.25 Hz) -> G5 (783.99 Hz) -> C6 (1046.50 Hz)
 */
const DEFAULT_CHIME_NOTES: readonly NoteSpec[] = [
  { frequency: 523.25, durationMs: 250 },
  { frequency: 659.25, durationMs: 250 },
  { frequency: 783.99, durationMs: 250 },
  { frequency: 1046.5, durationMs: 600 },
] as const;

/**
 * Generate 16-bit linear PCM audio samples representing a harmonic greeting chime.
 * Includes fundamental frequency and a subtle 2nd harmonic with smooth ADSR envelope
 * to produce warm, acoustic, non-clipping tones.
 */
export const synthesizeGreetingPcm = (
  sampleRate = 24000,
  notes: readonly NoteSpec[] = DEFAULT_CHIME_NOTES,
): Int16Array => {
  const totalDurationMs = notes.reduce((sum, n) => sum + n.durationMs, 0);
  const totalSamples = Math.floor((totalDurationMs / 1000) * sampleRate);
  const buffer = new Int16Array(totalSamples);

  let currentSampleOffset = 0;
  const maxAmplitude = 14000; // Safe ceiling below 32767 to avoid clipping

  for (const note of notes) {
    const noteSampleCount = Math.floor((note.durationMs / 1000) * sampleRate);
    const attackSamples = Math.floor(0.015 * sampleRate); // 15ms attack ramp
    const releaseSamples = Math.floor(0.04 * sampleRate); // 40ms release ramp
    const sustainSamples = Math.max(0, noteSampleCount - attackSamples - releaseSamples);

    for (let i = 0; i < noteSampleCount && currentSampleOffset < totalSamples; i++) {
      const t = i / sampleRate;

      // Amplitude envelope (ADSR)
      let envelope = 1.0;
      if (i < attackSamples) {
        // Linear attack
        envelope = i / attackSamples;
      } else if (i < attackSamples + sustainSamples) {
        // Gentle exponential decay during sustain
        const sustainProgress = (i - attackSamples) / sustainSamples;
        envelope = Math.exp(-1.5 * sustainProgress);
      } else {
        // Smooth release fade-out
        const releaseProgress = (i - attackSamples - sustainSamples) / releaseSamples;
        const baseLevel = Math.exp(-1.5);
        envelope = baseLevel * Math.max(0, 1 - releaseProgress);
      }

      // Fundamental sine wave + 2nd harmonic (octave at 25% amplitude)
      const omega = 2 * Math.PI * note.frequency;
      const fundamental = Math.sin(omega * t);
      const harmonic2 = 0.25 * Math.sin(2 * omega * t);
      const sampleValue = (fundamental + harmonic2) * envelope * maxAmplitude;

      // Clamp to signed 16-bit bounds
      const clamped = Math.max(-32768, Math.min(32767, Math.round(sampleValue)));
      buffer[currentSampleOffset++] = clamped;
    }
  }

  return buffer;
};

/**
 * Splits synthesized PCM samples into standard LiveKit AudioFrame chunks.
 * Default chunk is 20ms (480 samples @ 24kHz).
 */
export const generateChimeAudioFrames = (
  sampleRate = 24000,
  frameDurationMs = 20,
): AudioFrame[] => {
  const pcm = synthesizeGreetingPcm(sampleRate);
  const samplesPerFrame = Math.floor((frameDurationMs / 1000) * sampleRate);
  const frames: AudioFrame[] = [];

  for (let offset = 0; offset < pcm.length; offset += samplesPerFrame) {
    const chunkLength = Math.min(samplesPerFrame, pcm.length - offset);
    const chunk = new Int16Array(samplesPerFrame); // Fixed size per frame
    chunk.set(pcm.subarray(offset, offset + chunkLength));

    const frame = new AudioFrame(chunk, sampleRate, 1, samplesPerFrame);
    frames.push(frame);
  }

  return frames;
};

/**
 * Publishes an audio track and streams the deterministic greeting chime into the room.
 */
export const playDeterministicGreeting = async <T = Record<string, unknown>>(
  ctx: JobContext<T>,
  options?: GreetingOptions,
): Promise<void> => {
  const sampleRate = options?.sampleRate ?? 24000;
  const frameDurationMs = options?.frameDurationMs ?? 20;
  const trackName = options?.trackName ?? "agent-mic";

  const localParticipant = ctx.room.localParticipant;
  if (!localParticipant) {
    throw new Error("Local participant not available in JobContext room");
  }

  logger.info("[agent:greeting] Initializing AudioSource and LocalAudioTrack", {
    sampleRate,
    channels: 1,
    trackName,
  });

  const source = new AudioSource(sampleRate, 1);
  const track = LocalAudioTrack.createAudioTrack(trackName, source);

  const publishOptions = new TrackPublishOptions();
  publishOptions.source = TrackSource.SOURCE_MICROPHONE;

  await localParticipant.publishTrack(track, publishOptions);
  logger.info("[agent:greeting] Audio track published successfully to room", {
    room: ctx.room.name,
    trackName,
  });

  const frames = generateChimeAudioFrames(sampleRate, frameDurationMs);
  logger.info("[agent:greeting] Streaming greeting chime frames", {
    totalFrames: frames.length,
    frameDurationMs,
    totalDurationSeconds: (frames.length * frameDurationMs) / 1000,
  });

  for (const frame of frames) {
    if (options?.signal?.aborted) {
      logger.info("[agent:greeting] Greeting streaming aborted by signal (barge-in)", {
        room: ctx.room.name,
      });
      return;
    }
    await source.captureFrame(frame);
    // Realtime frame pacing (20ms interval)
    await new Promise((resolve) => setTimeout(resolve, frameDurationMs));
  }

  logger.info("[agent:greeting] Deterministic greeting streaming completed", {
    room: ctx.room.name,
  });
};
