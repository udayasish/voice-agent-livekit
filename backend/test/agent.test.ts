import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import {
  synthesizeGreetingPcm,
  generateChimeAudioFrames,
} from "../src/agent/greeting.js";
import { AudioSource, LocalAudioTrack, TrackKind, dispose } from "@livekit/rtc-node";
import agent from "../src/agent/index.js";
import { logLifecycle } from "../src/agent/lifecycle.js";

describe("Phase 6 — Node LiveKit Agent Integration Tests", () => {
  it("synthesizes valid linear PCM audio samples for greeting chime", () => {
    const sampleRate = 24000;
    const pcm = synthesizeGreetingPcm(sampleRate);

    assert.ok(pcm instanceof Int16Array, "Expected Int16Array buffer");
    assert.ok(pcm.length > 0, "Expected non-empty PCM samples");

    // Total chime duration is ~1350ms (250+250+250+600) -> ~32400 samples
    const expectedMinSamples = Math.floor(1.3 * sampleRate);
    assert.ok(
      pcm.length >= expectedMinSamples,
      `Expected at least ${expectedMinSamples} samples, got ${pcm.length}`,
    );

    // Verify samples are within valid range and not silent
    let maxAbs = 0;
    let nonZeroCount = 0;
    for (let i = 0; i < pcm.length; i++) {
      const s = pcm[i] ?? 0;
      const abs = Math.abs(s);
      if (abs > maxAbs) maxAbs = abs;
      if (abs > 100) nonZeroCount++;
    }

    assert.ok(nonZeroCount > 1000, "Audio must not be silent");
    assert.ok(maxAbs <= 32767, "Audio must not exceed 16-bit signed integer bounds");
    assert.ok(maxAbs > 5000, "Audio amplitude should be clearly audible");
  });

  it("generates correct 20ms LiveKit AudioFrames at 24kHz", () => {
    const sampleRate = 24000;
    const frameDurationMs = 20;
    const expectedSamplesPerFrame = (frameDurationMs / 1000) * sampleRate; // 480

    const frames = generateChimeAudioFrames(sampleRate, frameDurationMs);

    assert.ok(Array.isArray(frames), "Expected array of frames");
    assert.ok(frames.length > 50, `Expected over 50 frames, got ${frames.length}`);

    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      assert.ok(frame, `Frame at index ${i} should be defined`);
      assert.equal(frame.sampleRate, sampleRate, "Sample rate must match 24000");
      assert.equal(frame.channels, 1, "Channel count must be 1 (mono)");
      assert.equal(
        frame.samplesPerChannel,
        expectedSamplesPerFrame,
        `Samples per frame must be ${expectedSamplesPerFrame}`,
      );
    }
  });

  it("creates LocalAudioTrack from AudioSource in @livekit/rtc-node", () => {
    const sampleRate = 24000;
    const source = new AudioSource(sampleRate, 1);
    const track = LocalAudioTrack.createAudioTrack("agent-test-track", source);

    assert.ok(track, "Track should be created");
    assert.equal(track.kind, TrackKind.KIND_AUDIO, "Track kind must be audio");
  });

  it("logs agent lifecycle events without throwing", () => {
    assert.doesNotThrow(() => {
      logLifecycle("worker_started", "Worker initialized for test", {
        workerId: "test-worker-1",
        wsURL: "ws://127.0.0.1:7880",
      });
      logLifecycle("job_assigned", "Test job assigned", {
        jobId: "job-123",
        roomName: "room-test",
      });
      logLifecycle("greeting_completed", "Greeting finished", {
        roomName: "room-test",
      });
    });
  });

  it("exports a valid defineAgent instance with entry function", () => {
    assert.ok(agent, "Agent must be defined");
    assert.equal(typeof agent.entry, "function", "Agent must export an entry function");
  });

  after(async () => {
    await dispose();
  });
});
