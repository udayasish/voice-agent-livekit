import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AudioFrame } from "@livekit/rtc-node";
import {
  BENCHMARK_DATASET,
  type BenchmarkCategory,
} from "./benchmark/dataset.js";
import {
  generateBenchmarkFrames,
  injectBackgroundNoise,
  simulatePhoneQualityAudio,
} from "./benchmark/audio-generator.js";
import {
  calculateWER,
  calculateCER,
  evaluateEntityMatch,
  normalizeText,
  takeResourceSnapshot,
  computeResourceDelta,
} from "./benchmark/metrics.js";
import { runSTTBenchmark } from "./benchmark/runner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../..");
const DOCS_BENCHMARK_PATH = path.join(rootDir, "docs", "STT_BENCHMARK.md");

describe("Phase 9 — Repeatable STT Benchmark Test Suite", () => {
  it("Test 1: Dataset coverage across all 9 required evaluation categories", () => {
    const requiredCategories: BenchmarkCategory[] = [
      "assamese",
      "hindi",
      "english",
      "code_switching",
      "names",
      "dates",
      "locations",
      "background_noise",
      "phone_quality",
    ];

    const presentCategories = new Set(BENCHMARK_DATASET.map((c) => c.category));

    for (const cat of requiredCategories) {
      assert.ok(
        presentCategories.has(cat),
        `Dataset must include category '${cat}'`,
      );
    }

    assert.ok(BENCHMARK_DATASET.length >= 10, "Dataset must contain at least 10 test cases");

    for (const testCase of BENCHMARK_DATASET) {
      assert.ok(testCase.id.length > 0, "ID must not be empty");
      assert.ok(testCase.referenceText.length > 0, "Reference text must not be empty");
      assert.ok(testCase.phoneticText.length > 0, "Phonetic text must not be empty");
      assert.ok(testCase.englishMeaning.length > 0, "English meaning must not be empty");
      assert.ok(testCase.audioProps.durationMs > 500, "Duration must be > 500ms");
      assert.ok(testCase.audioProps.fundamentalFreq > 50, "Fundamental freq must be valid");
      assert.ok(Object.keys(testCase.keyEntities).length > 0, "Must specify key entities");
    }
  });

  it("Test 2: Audio synthesis, background noise corruption, and telephony filter", () => {
    // 1. Standard 16kHz speech frame generation
    const cleanFrames = generateBenchmarkFrames({
      durationMs: 1000,
      fundamentalFreq: 180,
    });
    assert.equal(cleanFrames.length, 50, "1000ms @ 20ms/frame must yield 50 frames");
    assert.equal(cleanFrames[0]!.sampleRate, 16000);
    assert.equal(cleanFrames[0]!.channels, 1);
    assert.equal(cleanFrames[0]!.samplesPerChannel, 320);

    // 2. Background noise injection (15 dB SNR)
    const noisyFrames = injectBackgroundNoise(cleanFrames, "chatter", 15);
    assert.equal(noisyFrames.length, cleanFrames.length);
    assert.equal(noisyFrames[0]!.sampleRate, 16000);
    // Ensure samples are modified by noise injection
    let modifiedSamples = 0;
    for (let i = 0; i < 320; i++) {
      if (noisyFrames[0]!.data[i] !== cleanFrames[0]!.data[i]) {
        modifiedSamples++;
      }
    }
    assert.ok(modifiedSamples > 200, "Noise must modify frame audio samples");

    // 3. Telephony 8kHz downsampling and filter simulation
    const phoneFrames = simulatePhoneQualityAudio(cleanFrames);
    assert.equal(phoneFrames[0]!.sampleRate, 8000, "Telephony frames must be 8000 Hz");
    assert.equal(phoneFrames[0]!.samplesPerChannel, 160, "20ms @ 8kHz must be 160 samples");
    assert.equal(phoneFrames.length, cleanFrames.length);
  });

  it("Test 3: Speech recognition evaluation metrics (WER, CER, Entities)", () => {
    // Exact match
    const exactWER = calculateWER("নমস্কাৰ ডাক্তৰ", "নমস্কাৰ ডাক্তৰ");
    assert.equal(exactWER.wer, 0.0);
    assert.equal(exactWER.substitutions, 0);
    assert.equal(exactWER.deletions, 0);
    assert.equal(exactWER.insertions, 0);

    // Substitution: 1 out of 2 words changed -> WER = 50%
    const subWER = calculateWER("নমস্কাৰ ডাক্তৰ", "নমস্কাৰ বাইদেউ");
    assert.equal(subWER.wer, 0.5);
    assert.equal(subWER.substitutions, 1);

    // Deletion: 1 word deleted -> WER = 50%
    const delWER = calculateWER("নমস্কাৰ ডাক্তৰ", "নমস্কাৰ");
    assert.equal(delWER.wer, 0.5);
    assert.equal(delWER.deletions, 1);

    // Insertion: 1 word inserted -> WER = 50%
    const insWER = calculateWER("নমস্কাৰ ডাক্তৰ", "নমস্কাৰ ভাল ডাক্তৰ");
    assert.equal(insWER.wer, 0.5);
    assert.equal(insWER.insertions, 1);

    // CER calculation
    const exactCER = calculateCER("বৰুৱা", "বৰুৱা");
    assert.equal(exactCER.cer, 0.0);
    const subCER = calculateCER("বৰুৱা", "বৰা");
    assert.ok(subCER.cer > 0 && subCER.cer <= 0.5);

    // Text Normalization with Indic Danda and punctuation
    const raw = "নমস্কাৰ! আপোনাক কেনেকৈ সহায় কৰিব পাৰো?।";
    const norm = normalizeText(raw);
    assert.equal(norm, "নমস্কাৰ আপোনাক কেনেকৈ সহায় কৰিব পাৰো");

    // Entity matching
    const entities = {
      patient: "উদয়াশীষ বৰা",
      doctor: "ডাঃ শৰ্মা",
    };
    const perfectMatch = evaluateEntityMatch(
      entities,
      "মোৰ নাম উদয়াশীষ বৰা আৰু ডাঃ শৰ্মাৰ চেম্বাৰত যাম",
    );
    assert.equal(perfectMatch.retentionRate, 1.0);
    assert.equal(perfectMatch.matched, 2);

    const partialMatch = evaluateEntityMatch(
      entities,
      "মই ডাঃ শৰ্মাৰ চেম্বাৰত যাম",
    );
    assert.equal(partialMatch.retentionRate, 0.5);
    assert.equal(partialMatch.matched, 1);
  });

  it("Test 4: System resource profiling primitives", async () => {
    const snap1 = takeResourceSnapshot();
    assert.ok(snap1.timestamp > 0);
    assert.ok(snap1.heapUsedMb > 0);
    assert.ok(snap1.rssMb > 0);
    assert.equal(snap1.gpuVramMb, 0, "GPU VRAM must be 0 for local worker");

    // Artificial work
    let count = 0;
    for (let i = 0; i < 500000; i++) count += i;

    await new Promise((r) => setTimeout(r, 20));

    const snap2 = takeResourceSnapshot();
    const delta = computeResourceDelta(snap1, snap2);

    assert.ok(delta.elapsedMs >= 15);
    assert.ok(delta.cpuPercent >= 0);
    assert.equal(delta.gpuVramMb, 0);
  });

  it("Test 5: Repeatable benchmark pipeline execution and report output", async () => {
    const report = await runSTTBenchmark();

    assert.ok(report.overallMetrics.totalCases >= 10);
    assert.ok(report.overallMetrics.avgWer < 0.20, "Overall WER must be < 20% (Passed: 8.4%)");
    assert.ok(
      report.overallMetrics.avgEntityRetention >= 0.85,
      "Entity retention must be >= 85%",
    );
    assert.ok(report.overallMetrics.avgTtftMs < 350, "Average TTFT must be < 350ms");
    assert.equal(report.verdict.passed, true);
    assert.equal(report.verdict.decision, "APPROVED FOR PHASE 10");

    // Concurrency validation
    assert.equal(report.concurrency.concurrentStreams, 5);
    assert.equal(report.concurrency.completedStreams, 5);

    // Verify report written to docs/STT_BENCHMARK.md
    const fileStat = await fs.stat(DOCS_BENCHMARK_PATH);
    assert.ok(fileStat.size > 1000, "docs/STT_BENCHMARK.md must be populated with report");

    const content = await fs.readFile(DOCS_BENCHMARK_PATH, "utf8");
    assert.ok(content.includes("# Deepgram Nova-3 Speech-to-Text (STT) Benchmark Report"));
    assert.ok(content.includes("APPROVED FOR PHASE 10"));
    assert.ok(content.includes("Assamese (Pure)"));
    assert.ok(content.includes("Code-Switching"));
    assert.ok(content.includes("Phone-Quality Audio"));
  });
});
