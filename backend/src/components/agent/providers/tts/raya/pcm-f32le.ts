import { RayaAudioDecodeError } from "./errors.js";

/**
 * Decodes base64-encoded F32LE (Little-Endian Float32) audio chunks and converts
 * normalized float values [-1.0, 1.0] to signed 16-bit linear PCM (Int16Array).
 *
 * Employs asymmetric scaling:
 * - Negative samples: round(sample * 32768)
 * - Positive samples: round(sample * 32767)
 */
export function decodeF32LEBase64ToPCM16(base64Data: string): Int16Array {
  const trimmed = base64Data.trim();
  if (trimmed.length === 0) {
    return new Int16Array(0);
  }

  const rawBuffer = Buffer.from(trimmed, "base64");
  if (rawBuffer.length % 4 !== 0) {
    throw new RayaAudioDecodeError(
      `Invalid F32LE payload: byte length (${rawBuffer.length}) is not a multiple of 4 bytes`,
    );
  }

  const sampleCount = rawBuffer.length / 4;
  const pcm16 = new Int16Array(sampleCount);

  for (let i = 0; i < sampleCount; i++) {
    const floatSample = rawBuffer.readFloatLE(i * 4);

    // Filter NaN or Infinity
    if (!Number.isFinite(floatSample)) {
      pcm16[i] = 0;
      continue;
    }

    // Clamp normalized float to [-1.0, 1.0]
    const clamped = Math.max(-1.0, Math.min(1.0, floatSample));

    // Asymmetric scaling to prevent Int16 overflow (-32768 to 32767)
    const scaled = clamped < 0
      ? Math.round(clamped * 32768)
      : Math.round(clamped * 32767);

    pcm16[i] = Math.max(-32768, Math.min(32767, scaled));
  }

  return pcm16;
}
