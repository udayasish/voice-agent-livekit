import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AudioFrame } from "@livekit/rtc-node";
import { initializeLogger } from "@livekit/agents";
import {
  getRayaConfig,
  RayaConfigurationError,
  RayaAuthenticationError,
  RayaVoiceNotFoundError,
  RayaProtocolError,
  RayaAudioDecodeError,
  decodeF32LEBase64ToPCM16,
  AudioFrameBuffer,
  parseSSEStream,
  splitAssamesePhrases,
  RayaVoiceCatalog,
  RayaClient,
  RayaTTS,
  RayaChunkedStream,
  type RayaVoice,
} from "../src/components/agent/providers/tts/raya/index.js";
import { IndicF5TTS, loadTTSProvider } from "../src/agent/tts.js";

// Ensure LiveKit logger is initialized for unit testing
try {
  initializeLogger({});
} catch {
  // Ignore if already initialized
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Creates a base64-encoded F32LE audio chunk containing synthetic sine wave float samples.
 */
function createSyntheticF32LEChunk(sampleCount = 480, frequency = 440, sampleRate = 24000): string {
  const buffer = Buffer.alloc(sampleCount * 4);
  for (let i = 0; i < sampleCount; i++) {
    const t = i / sampleRate;
    const sample = 0.5 * Math.sin(2 * Math.PI * frequency * t); // Float [-0.5, 0.5]
    buffer.writeFloatLE(sample, i * 4);
  }
  return buffer.toString("base64");
}

/**
 * Helper to create a ReadableStream from string SSE events.
 */
function createSSEStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]));
        index++;
      } else {
        controller.close();
      }
    },
  });
}

test("Phase 11 Migration — Raya BakBak TTS & LiveKit Custom Adapter Test Suite", async (t) => {
  await t.test("Test 1: Configuration validator & boundary enforcement", () => {
    // Valid config
    const valid = getRayaConfig({
      apiKey: "raya_test_key_123",
      sampleRate: 24000,
      speed: 1.0,
      model: "standard",
    });
    assert.equal(valid.apiKey, "raya_test_key_123");
    assert.equal(valid.sampleRate, 24000);
    assert.equal(valid.model, "standard");
    assert.equal(valid.language, "as");

    // Invalid sample rate
    assert.throws(
      () => getRayaConfig({ sampleRate: 48000 }),
      RayaConfigurationError,
      "Must reject unsupported sample rates",
    );

    // Invalid speed
    assert.throws(
      () => getRayaConfig({ speed: 2.5 }),
      RayaConfigurationError,
      "Must reject speed > 1.5",
    );
    assert.throws(
      () => getRayaConfig({ speed: 0.2 }),
      RayaConfigurationError,
      "Must reject speed < 0.5",
    );

    // Invalid model
    // @ts-expect-error Test invalid runtime model
    assert.throws(() => getRayaConfig({ model: "ultra_turbo" }), RayaConfigurationError);
  });

  await t.test("Test 2: Voice catalog resolution & Assamese language isolation", async () => {
    const mockVoices: RayaVoice[] = [
      { id: "voice_hi_01", name: "Kavita", language: "hi", model: "standard" },
      { id: "voice_as_01", name: "Kavya", language: "as", model: "standard" },
      { id: "voice_as_m1", name: "Ranjit", language: "as", model: "m1" },
    ];

    let apiCallCount = 0;
    const mockClient = {
      async listVoices(): Promise<RayaVoice[]> {
        apiCallCount++;
        return mockVoices;
      },
    };

    const catalog = new RayaVoiceCatalog(mockClient);

    // Auto-resolve Assamese standard voice
    const resolved = await catalog.resolveVoice({ language: "as", model: "standard" });
    assert.equal(resolved.id, "voice_as_01");
    assert.equal(resolved.name, "Kavya");
    assert.equal(apiCallCount, 1);

    // Auto-resolve Assamese m1 voice (must use cache, no second API call)
    const resolvedM1 = await catalog.resolveVoice({ language: "as", model: "m1" });
    assert.equal(resolvedM1.id, "voice_as_m1");
    assert.equal(apiCallCount, 1, "Must utilize memory cache");

    // Explicit voice match
    const explicit = await catalog.resolveVoice({ voiceId: "voice_as_01", language: "as", model: "standard" });
    assert.equal(explicit.id, "voice_as_01");

    // Rejects model mismatch (voice_as_01 is standard, not m1)
    await assert.rejects(
      async () => catalog.resolveVoice({ voiceId: "voice_as_01", language: "as", model: "m1" }),
      RayaVoiceNotFoundError,
    );

    // Rejects language mismatch (will never fall back to Hindi for Assamese)
    await assert.rejects(
      async () => catalog.resolveVoice({ language: "bn", model: "standard" }),
      RayaVoiceNotFoundError,
    );
  });

  await t.test("Test 3: Float32LE base64 decoding & Int16 asymmetric conversion", () => {
    // 1. Zero sample
    const zeroBuf = Buffer.alloc(4);
    zeroBuf.writeFloatLE(0.0, 0);
    const zeroPcm = decodeF32LEBase64ToPCM16(zeroBuf.toString("base64"));
    assert.equal(zeroPcm.length, 1);
    assert.equal(zeroPcm[0], 0);

    // 2. Positive 0.5 -> 0.5 * 32767 = 16384
    const posBuf = Buffer.alloc(4);
    posBuf.writeFloatLE(0.5, 0);
    const posPcm = decodeF32LEBase64ToPCM16(posBuf.toString("base64"));
    assert.equal(posPcm[0], Math.round(0.5 * 32767));

    // 3. Negative -0.5 -> -0.5 * 32768 = -16384
    const negBuf = Buffer.alloc(4);
    negBuf.writeFloatLE(-0.5, 0);
    const negPcm = decodeF32LEBase64ToPCM16(negBuf.toString("base64"));
    assert.equal(negPcm[0], Math.round(-0.5 * 32768));

    // 4. Positive saturation (> 1.0 clamped to 32767)
    const satPosBuf = Buffer.alloc(4);
    satPosBuf.writeFloatLE(1.5, 0);
    const satPosPcm = decodeF32LEBase64ToPCM16(satPosBuf.toString("base64"));
    assert.equal(satPosPcm[0], 32767);

    // 5. Negative saturation (< -1.0 clamped to -32768)
    const satNegBuf = Buffer.alloc(4);
    satNegBuf.writeFloatLE(-2.0, 0);
    const satNegPcm = decodeF32LEBase64ToPCM16(satNegBuf.toString("base64"));
    assert.equal(satNegPcm[0], -32768);

    // 6. Non-finite values safely become 0
    const nanBuf = Buffer.alloc(4);
    nanBuf.writeFloatLE(NaN, 0);
    const nanPcm = decodeF32LEBase64ToPCM16(nanBuf.toString("base64"));
    assert.equal(nanPcm[0], 0);

    // 7. Empty string returns empty Int16Array
    assert.equal(decodeF32LEBase64ToPCM16("").length, 0);
  });

  await t.test("Test 4: F32LE decoder rejects misaligned payloads", () => {
    // 3 bytes (not a multiple of 4)
    const badBuf = Buffer.from([1, 2, 3]);
    assert.throws(
      () => decodeF32LEBase64ToPCM16(badBuf.toString("base64")),
      RayaAudioDecodeError,
    );
  });

  await t.test("Test 5: AudioFrameBuffer 480-sample slicing & residual sample accumulation", () => {
    const buffer = new AudioFrameBuffer(24000, 20, 1);
    assert.equal(buffer.samplesPerFrame, 480);

    // Push 300 samples (not enough for 1 frame yet)
    const chunk1 = new Int16Array(300);
    chunk1.fill(100);
    const frames1 = buffer.push(chunk1);
    assert.equal(frames1.length, 0, "No frame should be emitted before 480 samples");
    assert.equal(buffer.pendingSamples, 300);

    // Push 300 more samples (total 600 samples -> 1 frame of 480 + 120 residual)
    const chunk2 = new Int16Array(300);
    chunk2.fill(200);
    const frames2 = buffer.push(chunk2);
    assert.equal(frames2.length, 1, "1 full 20ms frame must be emitted");
    assert.equal(frames2[0]?.samplesPerChannel, 480);
    assert.equal(frames2[0]?.sampleRate, 24000);
    assert.equal(buffer.pendingSamples, 120);

    // Push 360 more samples (120 + 360 = 480 -> exactly 1 frame, 0 residual)
    const chunk3 = new Int16Array(360);
    const frames3 = buffer.push(chunk3);
    assert.equal(frames3.length, 1);
    assert.equal(buffer.pendingSamples, 0);
  });

  await t.test("Test 6: AudioFrameBuffer zero-pads tail remainder frame on flush", () => {
    const buffer = new AudioFrameBuffer(24000, 20, 1);

    // Push 500 samples -> 1 frame of 480 + 20 remainder
    const chunk = new Int16Array(500);
    chunk.fill(5000);
    const emitted = buffer.push(chunk);
    assert.equal(emitted.length, 1);
    assert.equal(buffer.pendingSamples, 20);

    // Flush remainder: must pad the 20 samples to full 480
    const finalFrame = buffer.flush();
    assert.ok(finalFrame !== null);
    assert.equal(finalFrame.samplesPerChannel, 480, "Flush frame must be padded to 480 samples");
    assert.equal(buffer.pendingSamples, 0);

    // Second flush should return null
    assert.equal(buffer.flush(), null);
  });

  await t.test("Test 7: SSE stream parser handles split chunks and boundary CRLF", async () => {
    // Split event across multiple TCP chunks deliberately
    const chunks = [
      'event: chunk\ndata: {"type":"chunk","status_code":206,"done":false,"data":"',
      createSyntheticF32LEChunk(240),
      '","step_time":0.05}\r\n\r\n',
      'event: done\r\ndata: {"type":"done","status_code":200,"done":true}\r\n\r\n',
    ];

    const stream = createSSEStream(chunks);
    const events = [];

    for await (const event of parseSSEStream(stream)) {
      events.push(event);
    }

    assert.equal(events.length, 2, "Must assemble both split SSE events");
    assert.equal(events[0]?.type, "chunk");
    assert.equal(events[1]?.type, "done");
  });

  await t.test("Test 8: SSE stream parser rejects malformed JSON payloads", async () => {
    const badStream = createSSEStream(["data: {invalid_json}\n\n"]);
    await assert.rejects(
      async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _ev of parseSSEStream(badStream)) {
          // should throw
        }
      },
      RayaProtocolError,
    );
  });

  await t.test("Test 9: RayaChunkedStream LiveKit integration & TTFA tracking", async () => {
    const ttsInstance = new RayaTTS({
      apiKey: "raya_mock_key",
      sampleRate: 24000,
      language: "as",
      model: "standard",
    });

    const f32Chunk1 = createSyntheticF32LEChunk(480);
    const f32Chunk2 = createSyntheticF32LEChunk(480);

    // Mock client.synthesizeStream to return SSE chunks
    // @ts-expect-error Mock private client for isolated adapter test
    ttsInstance.client.synthesizeStream = async function* () {
      yield {
        type: "chunk" as const,
        status_code: 206,
        done: false as const,
        data: f32Chunk1,
        step_time: 0.05,
      };
      yield {
        type: "chunk" as const,
        status_code: 206,
        done: false as const,
        data: f32Chunk2,
        step_time: 0.05,
      };
      yield {
        type: "done" as const,
        status_code: 200,
        done: true as const,
      };
    };

    const stream = ttsInstance.synthesize("নমস্কাৰ, আপোনাক কেনেকৈ সহায় কৰিব পাৰোঁ?");
    const frames: AudioFrame[] = [];
    let sawFinal = false;

    for await (const packet of stream) {
      frames.push(packet.frame);
      assert.equal(packet.frame.sampleRate, 24000);
      assert.equal(packet.frame.samplesPerChannel, 480);
      if (packet.final) {
        sawFinal = true;
      }
    }

    assert.equal(frames.length, 2, "Must emit 2 frames from two 480-sample chunks");
    assert.equal(sawFinal, true, "Final packet must flag final=true");
  });

  await t.test("Test 10: AbortSignal immediately cancels synthesis stream (barge-in)", async () => {
    const ttsInstance = new RayaTTS({
      apiKey: "raya_mock_key",
      sampleRate: 24000,
    });

    const abortController = new AbortController();

    // @ts-expect-error Mock client synthesizeStream with delayed chunks
    ttsInstance.client.synthesizeStream = async function* (_req: unknown, signal?: AbortSignal) {
      if (signal?.aborted) return;
      yield {
        type: "chunk" as const,
        status_code: 206,
        done: false as const,
        data: createSyntheticF32LEChunk(480),
      };
    };

    // Pre-abort to test zero-frame cancellation
    abortController.abort();

    const stream = ttsInstance.synthesize("বাতিল কৰক", undefined, abortController.signal);
    const receivedFrames: AudioFrame[] = [];

    for await (const packet of stream) {
      receivedFrames.push(packet.frame);
    }

    assert.equal(receivedFrames.length, 0, "Aborted stream must emit 0 frames");
  });

  await t.test("Test 11: Assamese phrase segmenter splits on danda, punctuation, and guards abbreviations", () => {
    // 1. Basic danda splitting
    const res1 = splitAssamesePhrases("নমস্কাৰ। আপোনাক স্বাগতম। কাইলৈ আহিব");
    assert.deepEqual(res1.phrases, ["নমস্কাৰ।", "আপোনাক স্বাগতম।"]);
    assert.equal(res1.remainder, "কাইলৈ আহিব");

    // 2. Question mark and exclamation
    const res2 = splitAssamesePhrases("আপুনি সময় বিচাৰিব নেকি? হয়!");
    assert.deepEqual(res2.phrases, ["আপুনি সময় বিচাৰিব নেকি?", "হয়!"]);
    assert.equal(res2.remainder, "");

    // 3. Decimal guardrail: 10.5 or 3.5 should NOT be split
    const res3 = splitAssamesePhrases("১০.৫ বজাত উপস্থিত থাকিব লাগিব।");
    assert.deepEqual(res3.phrases, ["১০.৫ বজাত উপস্থিত থাকিব লাগিব।"]);

    // 4. Doctor title abbreviation guardrail (ডাঃ / Dr.)
    const res4 = splitAssamesePhrases("ডাঃ বৰুৱাৰ সৈতে কাইলৈ কথা পাতক।");
    assert.deepEqual(res4.phrases, ["ডাঃ বৰুৱাৰ সৈতে কাইলৈ কথা পাতক।"]);
  });

  await t.test("Test 12: TTS factory supports both Raya BakBak and IndicF5 fallback", () => {
    // Default provider is Raya BakBak
    const rayaProvider = loadTTSProvider({ provider: "raya" });
    assert.equal(rayaProvider.label, "raya.bakbak");
    assert.equal(rayaProvider.capabilities.streaming, true);

    // IndicF5 fallback provider
    const indicProvider = loadTTSProvider({ provider: "indicf5" });
    assert.equal(indicProvider.label, "ai4bharat.indicf5");
    assert.equal(indicProvider.capabilities.streaming, false);
    assert.ok(indicProvider instanceof IndicF5TTS);
  });
});
