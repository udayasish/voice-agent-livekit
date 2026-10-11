import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AudioFrame } from "@livekit/rtc-node";
import { initializeLogger } from "@livekit/agents";
import {
  IndicF5Client,
  parseWavAudio,
  getIndicF5Config,
} from "../src/components/agent/providers/tts/index.js";
import { IndicF5TTS, loadTTSProvider } from "../src/agent/tts.js";

// Initialize LiveKit internal logger for standalone test environment
try {
  initializeLogger({});
} catch {
  // Ignore if already initialized
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to create a synthetic 24kHz 16-bit PCM WAV buffer for offline unit tests
function createSyntheticWav(sampleRate = 24000, durationSec = 1.0): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const sampleCount = Math.floor(sampleRate * durationSec);
  const dataSize = sampleCount * (bitsPerSample / 8);
  const riffSize = 36 + dataSize;

  const buffer = Buffer.alloc(44 + dataSize);
  // RIFF header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(riffSize, 4);
  buffer.write("WAVE", 8);

  // fmt subchunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // data subchunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Fill sine wave audio samples
  for (let i = 0; i < sampleCount; i++) {
    const t = i / sampleRate;
    const sample = Math.round(14000 * Math.sin(2 * Math.PI * 440 * t));
    buffer.writeInt16LE(sample, 44 + i * 2);
  }

  return buffer;
}

test("Phase 11 — AI4Bharat IndicF5 TTS & LiveKit Custom Adapter Test Suite", async (t) => {
  await t.test("Test 1: WAV parser accurately extracts 24kHz 16-bit mono PCM samples", () => {
    const wavBuffer = createSyntheticWav(24000, 0.5); // 0.5s = 12,000 samples
    const parsed = parseWavAudio(wavBuffer);

    assert.equal(parsed.sampleRate, 24000, "Sample rate must be 24,000 Hz");
    assert.equal(parsed.channels, 1, "Channel count must be 1 (mono)");
    assert.equal(parsed.bitsPerSample, 16, "Bit depth must be 16-bit");
    assert.equal(parsed.pcmSamples.length, 12000, "Sample count must equal 12,000");
    assert.ok(parsed.pcmSamples instanceof Int16Array, "pcmSamples must be an Int16Array");
  });

  await t.test("Test 2: WAV parser rejects corrupted and truncated buffers", () => {
    assert.throws(() => parseWavAudio(Buffer.alloc(20)), /Invalid WAV buffer/);
    const badSig = Buffer.alloc(44);
    badSig.write("TEST", 0);
    badSig.write("WAVE", 8);
    assert.throws(() => parseWavAudio(badSig), /Invalid WAV format/);
  });

  await t.test("Test 3: IndicF5 configuration resolver & client defaults", () => {
    const config = getIndicF5Config({
      serviceUrl: "http://localhost:8001/",
      sampleRate: 24000,
    });
    assert.equal(config.serviceUrl, "http://localhost:8001", "Trailing slash stripped");
    assert.equal(config.sampleRate, 24000);
    assert.equal(config.language, "as");

    const client = new IndicF5Client(config);
    assert.equal(client.label, "ai4bharat.indicf5");
    assert.equal(client.capabilities.sampleRate, 24000);
    assert.equal(client.capabilities.streaming, false);
  });

  await t.test("Test 4: IndicF5TTS LiveKit class inheritance and audio framing", async () => {
    const ttsInstance = loadTTSProvider({ sampleRate: 24000 });
    assert.equal(ttsInstance.label, "ai4bharat.indicf5");
    assert.equal(ttsInstance.sampleRate, 24000);
    assert.equal(ttsInstance.numChannels, 1);
    assert.equal(ttsInstance.capabilities.streaming, false);

    // Mock client synthesis to test 20ms frame slicing without running live server
    const syntheticWav = createSyntheticWav(24000, 0.1); // 0.1s = 2,400 samples (5 frames of 480)
    // @ts-expect-error Mock private client for isolated adapter test
    ttsInstance.client.synthesize = async () => {
      const parsed = parseWavAudio(syntheticWav);
      return {
        wavBuffer: syntheticWav,
        pcmSamples: parsed.pcmSamples,
        metadata: {
          sampleRate: 24000,
          channels: 1,
          durationMs: 100,
          inferenceTimeMs: 15,
          mode: "synthetic",
        },
      };
    };

    const stream = ttsInstance.synthesize("নমস্কাৰ");
    const frames: AudioFrame[] = [];
    let sawFinal = false;

    for await (const packet of stream) {
      frames.push(packet.frame);
      assert.equal(packet.frame.sampleRate, 24000);
      assert.equal(packet.frame.channels, 1);
      assert.equal(packet.frame.samplesPerChannel, 480, "Each frame must be exactly 20ms (480 samples)");
      if (packet.final) {
        sawFinal = true;
      }
    }

    assert.equal(frames.length, 5, "0.1s @ 24kHz should produce exactly 5 frames of 20ms");
    assert.equal(sawFinal, true, "Final packet must flag final=true");
  });

  await t.test("Test 5: Audio framing zero-pads tail remainder when samples not multiple of 480", async () => {
    const ttsInstance = loadTTSProvider({ sampleRate: 24000 });
    // 500 samples: 1 frame of 480 + 1 remainder frame of 20 samples zero-padded to 480
    const sampleRate = 24000;
    const durationSec = 500 / sampleRate;
    const wavBuffer = createSyntheticWav(sampleRate, durationSec);

    // @ts-expect-error Mock private client
    ttsInstance.client.synthesize = async () => {
      const parsed = parseWavAudio(wavBuffer);
      return {
        wavBuffer,
        pcmSamples: parsed.pcmSamples,
        metadata: {
          sampleRate: 24000,
          channels: 1,
          durationMs: 21,
          inferenceTimeMs: 10,
        },
      };
    };

    const stream = ttsInstance.synthesize("টেষ্ট");
    const frames: AudioFrame[] = [];
    for await (const packet of stream) {
      frames.push(packet.frame);
      assert.equal(packet.frame.samplesPerChannel, 480, "Remainder frame must be padded to 480 samples");
    }

    assert.equal(frames.length, 2, "500 samples should produce 2 uniform 20ms frames");
  });

  await t.test("Test 6: AbortSignal immediately cancels synthesis queue", async () => {
    const ttsInstance = loadTTSProvider();
    const abortController = new AbortController();

    // @ts-expect-error Mock private client with delay
    ttsInstance.client.synthesize = async (_text: string, options?: { abortSignal?: AbortSignal }) => {
      if (options?.abortSignal?.aborted) {
        throw new Error("Aborted");
      }
      return {
        wavBuffer: createSyntheticWav(24000, 0.5),
        pcmSamples: new Int16Array(12000),
        metadata: { sampleRate: 24000, channels: 1, durationMs: 500, inferenceTimeMs: 10 },
      };
    };

    abortController.abort();
    const stream = ttsInstance.synthesize("বাতিল কৰক", undefined, abortController.signal);

    const received: AudioFrame[] = [];
    for await (const packet of stream) {
      received.push(packet.frame);
    }

    assert.equal(received.length, 0, "Aborted stream should not emit any frames");
  });

  await t.test("Test 7: Assamese evaluation corpus integrity", () => {
    const corpusPath = path.resolve(__dirname, "fixtures/assamese-tts-corpus.json");
    assert.ok(fs.existsSync(corpusPath), "Corpus fixture file must exist");

    const corpus = JSON.parse(fs.readFileSync(corpusPath, "utf-8")) as Array<{
      id: string;
      category: string;
      text: string;
    }>;

    assert.equal(corpus.length, 5, "Corpus must have 5 evaluation categories");
    for (const item of corpus) {
      assert.ok(item.id.length > 0);
      assert.ok(item.category.length > 0);
      assert.ok(item.text.length > 0);
      // Verify text contains Assamese characters (Unicode range 0x0980 to 0x09FF)
      const hasAssamese = /[\u0980-\u09FF]/.test(item.text);
      assert.ok(hasAssamese, `Corpus item '${item.id}' must contain Assamese script`);
    }
  });

  await t.test("Test 8: StreamAdapter compatibility for sentence-level streaming", async () => {
    const ttsInstance = loadTTSProvider();
    const streamWrapper = ttsInstance.stream();
    assert.ok(streamWrapper, "StreamAdapter must instantiate a SynthesizeStream");
    await streamWrapper.close();
  });
});
