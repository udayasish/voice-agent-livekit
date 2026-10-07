import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { VADEventType, type VADEvent } from "@livekit/agents";
import { AudioFrame } from "@livekit/rtc-node";
import {
  loadSileroVAD,
  CONSERVATIVE_VAD_OPTIONS,
  ensureAgentsLogger,
} from "../src/agent/vad.js";
import {
  generateSilenceFrames,
  generateSyntheticSpeechFrames,
  generateBackgroundNoiseFrames,
} from "./audio-fixtures.js";

ensureAgentsLogger();

interface TestVADResult {
  startEvents: VADEvent[];
  endEvents: VADEvent[];
  inferenceEvents: VADEvent[];
}

/**
 * Feeds an array of AudioFrames through a Silero VAD instance and collects all emitted events.
 */
const runVADProcessing = async (
  frames: AudioFrame[],
  minSilenceDuration = 600,
  activationThreshold = 0.5,
): Promise<TestVADResult> => {
  const vad = await loadSileroVAD({
    minSilenceDuration,
    activationThreshold,
  });

  const stream = vad.stream();
  const startEvents: VADEvent[] = [];
  const endEvents: VADEvent[] = [];
  const inferenceEvents: VADEvent[] = [];

  const consumerPromise = (async () => {
    for await (const event of stream) {
      if (event.type === VADEventType.START_OF_SPEECH) {
        startEvents.push(event);
      } else if (event.type === VADEventType.END_OF_SPEECH) {
        endEvents.push(event);
      } else if (event.type === VADEventType.INFERENCE_DONE) {
        inferenceEvents.push(event);
      }
    }
  })();

  for (const frame of frames) {
    stream.pushFrame(frame);
    // Yield briefly to ensure event loop schedules inference task
    await new Promise((resolve) => setImmediate(resolve));
  }

  // Grace period to allow remaining inference frames to be processed
  await new Promise((resolve) => setTimeout(resolve, 250));

  stream.close();
  await consumerPromise;

  return { startEvents, endEvents, inferenceEvents };
};

describe("Phase 7 — Silero Voice Activity Detection (VAD) Test Suite", () => {
  it("verifies initial conservative baseline parameters are documented and valid", () => {
    assert.equal(CONSERVATIVE_VAD_OPTIONS.activationThreshold, 0.5);
    assert.equal(CONSERVATIVE_VAD_OPTIONS.minSpeechDuration, 100);
    assert.equal(CONSERVATIVE_VAD_OPTIONS.minSilenceDuration, 600);
    assert.equal(CONSERVATIVE_VAD_OPTIONS.prefixPaddingDuration, 300);
    assert.equal(CONSERVATIVE_VAD_OPTIONS.maxBufferedSpeech, 60000);
    assert.equal(CONSERVATIVE_VAD_OPTIONS.sampleRate, 16000);
    assert.equal(CONSERVATIVE_VAD_OPTIONS.forceCPU, true);
  });

  it("Test 1: Short speech detection (START_OF_SPEECH and END_OF_SPEECH)", async () => {
    // 400ms speech followed by 800ms silence
    const speechFrames = generateSyntheticSpeechFrames(400);
    const silenceFrames = generateSilenceFrames(800);
    const frames = [...speechFrames, ...silenceFrames];

    const result = await runVADProcessing(frames, 600, 0.5);

    assert.equal(
      result.startEvents.length,
      1,
      `Expected exactly 1 START_OF_SPEECH event, got ${result.startEvents.length}`,
    );
    assert.equal(
      result.endEvents.length,
      1,
      `Expected exactly 1 END_OF_SPEECH event, got ${result.endEvents.length}`,
    );

    const startEvent = result.startEvents[0];
    const endEvent = result.endEvents[0];

    assert.ok(startEvent, "Start event must exist");
    assert.ok(endEvent, "End event must exist");
    assert.equal(startEvent.speaking, true, "Start event speaking flag should be true");
    assert.equal(endEvent.speaking, false, "End event speaking flag should be false");
    assert.ok(endEvent.frames.length > 0, "End event must include captured speech frames");
    assert.ok(
      (endEvent.frames[0]?.samplesPerChannel ?? 0) > 0,
      "End event frames must contain valid audio samples",
    );
    assert.ok(
      endEvent.silenceDuration >= 500,
      `Silence duration should be >= 500ms, got ${endEvent.silenceDuration}`,
    );
  });

  it("Test 2: Long speech detection (sustained utterance before turn boundary)", async () => {
    // 3000ms sustained speech followed by 800ms silence
    const speechFrames = generateSyntheticSpeechFrames(3000);
    const silenceFrames = generateSilenceFrames(800);
    const frames = [...speechFrames, ...silenceFrames];

    const result = await runVADProcessing(frames, 600, 0.5);

    assert.equal(
      result.startEvents.length,
      1,
      `Expected exactly 1 START_OF_SPEECH for long utterance, got ${result.startEvents.length}`,
    );
    assert.equal(
      result.endEvents.length,
      1,
      `Expected exactly 1 END_OF_SPEECH at turn conclusion, got ${result.endEvents.length}`,
    );

    const startEvent = result.startEvents[0];
    const endEvent = result.endEvents[0];
    assert.ok(startEvent, "Start event must exist");
    assert.ok(endEvent, "End event must exist");
    assert.equal(startEvent.speaking, true, "Start event speaking flag should be true");
    assert.equal(endEvent.speaking, false, "End event speaking flag should be false");
    assert.ok(endEvent.frames.length > 0, "End event must include captured speech frames");
    assert.ok(
      (endEvent.frames[0]?.samplesPerChannel ?? 0) > 0,
      "End event frames must contain captured speech buffer",
    );
    assert.ok(
      endEvent.silenceDuration >= 500,
      `Silence duration should be >= 500ms, got ${endEvent.silenceDuration}`,
    );
  });

  it("Test 3: Pauses — distinguishes mid-utterance breathing pause from turn boundary", async () => {
    // 500ms speech + 250ms short pause (< 600ms threshold) + 500ms speech + 800ms silence (> 600ms)
    const speechChunk1 = generateSyntheticSpeechFrames(500);
    const midPause = generateSilenceFrames(250);
    const speechChunk2 = generateSyntheticSpeechFrames(500);
    const finalSilence = generateSilenceFrames(800);

    const frames = [...speechChunk1, ...midPause, ...speechChunk2, ...finalSilence];

    const result = await runVADProcessing(frames, 600, 0.5);

    // Because the 250ms pause is below the 600ms minSilenceDuration threshold,
    // the VAD must NOT conclude the turn during the pause.
    assert.equal(
      result.startEvents.length,
      1,
      `Speech should start once across the punctuated utterance, got ${result.startEvents.length}`,
    );
    assert.equal(
      result.endEvents.length,
      1,
      `Turn boundary should trigger only after prolonged final silence, got ${result.endEvents.length}`,
    );

    const startEvent = result.startEvents[0];
    const endEvent = result.endEvents[0];
    assert.ok(startEvent, "Start event must exist");
    assert.ok(endEvent, "End event must exist");
    assert.equal(startEvent.speaking, true, "Start event speaking flag should be true");
    assert.equal(endEvent.speaking, false, "End event speaking flag should be false");
    assert.ok(endEvent.frames.length > 0, "End event must include captured speech frames");
    assert.ok(
      (endEvent.frames[0]?.samplesPerChannel ?? 0) > 0,
      "End event frames must contain speech audio across both segments",
    );
  });

  it("Test 4: Background noise rejection (no false speech triggers)", async () => {
    // 1000ms ambient 50Hz hum and gentle hiss (~ -36 dBFS)
    const noiseFrames = generateBackgroundNoiseFrames(1000);

    const result = await runVADProcessing(noiseFrames, 600, 0.5);

    assert.equal(
      result.startEvents.length,
      0,
      `Background noise must not trigger START_OF_SPEECH, got ${result.startEvents.length}`,
    );
    assert.equal(
      result.endEvents.length,
      0,
      `Background noise must not trigger END_OF_SPEECH, got ${result.endEvents.length}`,
    );

    // Verify all inference probabilities remained below activation threshold (0.5)
    for (const inf of result.inferenceEvents) {
      assert.ok(
        inf.probability < 0.5,
        `Noise probability should be < 0.5, got ${inf.probability}`,
      );
    }
  });

  it("Test 5: User interruption (barge-in immediately halts agent audio playback)", async () => {
    const vad = await loadSileroVAD();
    const stream = vad.stream();

    const abortController = new AbortController();
    let playbackCompleted = false;
    let framesStreamed = 0;
    const maxFrames = 50; // 50 * 20ms = 1000ms scheduled greeting

    // Simulate active agent greeting audio stream
    const playbackTask = (async () => {
      for (let i = 0; i < maxFrames; i++) {
        if (abortController.signal.aborted) {
          return;
        }
        framesStreamed++;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      playbackCompleted = true;
    })();

    let bargeInDetected = false;

    // Listen for user speech to trigger barge-in abort
    const vadConsumer = (async () => {
      for await (const event of stream) {
        if (event.type === VADEventType.START_OF_SPEECH) {
          bargeInDetected = true;
          abortController.abort(); // Interruption primitive: abort active playback
        }
      }
    })();

    // Simulate incoming user speech frames after agent begins speaking
    const speechFrames = generateSyntheticSpeechFrames(400);
    for (const frame of speechFrames) {
      stream.pushFrame(frame);
      await new Promise((resolve) => setImmediate(resolve));
    }

    await playbackTask;
    stream.close();
    await vadConsumer;

    assert.equal(bargeInDetected, true, "Barge-in should be detected upon speech start");
    assert.equal(abortController.signal.aborted, true, "AbortController must be signaled on interruption");
    assert.equal(playbackCompleted, false, "Agent audio playback must NOT complete naturally");
    assert.ok(
      framesStreamed < maxFrames,
      `Audio playback should be halted prematurely (< ${maxFrames} frames), halted at ${framesStreamed}`,
    );
  });
});
