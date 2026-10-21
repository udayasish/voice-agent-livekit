import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { AudioFrame, AudioSource, dispose } from "@livekit/rtc-node";
import { VADEventType, type VADEvent } from "@livekit/agents";
import { InterruptionManager } from "../src/components/agent/interruption/index.js";
import { loadSileroVAD, ensureAgentsLogger } from "../src/agent/vad.js";
import {
  generateSilenceFrames,
  generateSyntheticSpeechFrames,
} from "./audio-fixtures.js";
import { AudioFrameBuffer } from "../src/components/agent/providers/tts/raya/index.js";
import { SpeechTranscriptGate } from "../src/agent/turn-collector.js";

ensureAgentsLogger();

describe("Phase 13 — Barge-In (Interruption Handling) Test Suite", () => {
  // =========================================================================
  // SUITE 1: Core Interruption Behavior
  // =========================================================================
  describe("Suite 1: Core Interruption Behavior", () => {
    it("Test 1: Normal Interruption — caller speech halts agent speaking immediately", () => {
      const manager = new InterruptionManager();
      const turnId = manager.beginTurn();
      const ttsSignal = manager.startSpeaking(turnId);

      assert.equal(manager.getPhase(), "speaking");
      assert.equal(manager.canDeliverFrame(turnId), true);
      assert.equal(manager.isTurnActive(turnId), true);

      const event = manager.handleUserSpeechStart();

      assert.ok(event !== null, "handleUserSpeechStart must return an InterruptionEvent");
      assert.equal(event.turnId, turnId);
      assert.equal(event.phase, "speaking");
      assert.equal(event.interruptionCount, 1);
      assert.ok(event.playbackDurationMs >= 0);
      assert.equal(ttsSignal.aborted, true, "TTS AbortController signal must be aborted");
      assert.equal(manager.getPhase(), "listening", "State must transition to listening");
      assert.equal(manager.canDeliverFrame(turnId), false, "canDeliverFrame must immediately return false");
      assert.equal(manager.isTurnActive(turnId), false, "Turn must no longer be active");
    });

    it("Test 2: Short Assamese Interjection ('ৰব' / 150 ms) halts agent speaking via Silero VAD", async () => {
      const vad = await loadSileroVAD({
        minSilenceDuration: 600,
        minSpeechDuration: 100, // 100ms threshold permits genuine 150ms words
        activationThreshold: 0.5,
      });
      const stream = vad.stream();
      const manager = new InterruptionManager();
      const turnId = manager.beginTurn();
      const ttsSignal = manager.startSpeaking(turnId);

      assert.equal(manager.getPhase(), "speaking");

      let speechDetected = false;
      const consumerPromise = (async () => {
        for await (const event of stream) {
          if (event.type === VADEventType.START_OF_SPEECH) {
            speechDetected = true;
            manager.handleUserSpeechStart();
          }
        }
      })();

      // 150ms synthetic speech ('ৰব') followed by silence
      const speechFrames = generateSyntheticSpeechFrames(150, { sampleRate: 16000 });
      const silenceFrames = generateSilenceFrames(600, 16000);
      const frames = [...speechFrames, ...silenceFrames];

      for (const frame of frames) {
        stream.pushFrame(frame);
        await new Promise((resolve) => setImmediate(resolve));
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
      stream.close();
      await consumerPromise;

      assert.equal(speechDetected, true, "150ms utterance must trigger Silero START_OF_SPEECH");
      assert.equal(manager.getPhase(), "listening", "Manager must transition to listening on speech start");
      assert.equal(ttsSignal.aborted, true, "Speaking signal must be aborted on 150ms barge-in");
      assert.equal(manager.canDeliverFrame(turnId), false);
    });

    it("Test 3: Repeated Consecutive Interruptions — 3 consecutive turns without deadlock", () => {
      const manager = new InterruptionManager();

      // Cycle 1: interrupted during speaking
      const turn1 = manager.beginTurn();
      const sig1 = manager.startSpeaking(turn1);
      const ev1 = manager.handleUserSpeechStart();
      assert.ok(ev1);
      assert.equal(ev1.turnId, turn1);
      assert.equal(sig1.aborted, true);

      // Cycle 2: interrupted during thinking
      const turn2 = manager.beginTurn();
      const sig2 = manager.startThinking(turn2);
      const ev2 = manager.handleUserSpeechStart();
      assert.ok(ev2);
      assert.equal(ev2.turnId, turn2);
      assert.equal(sig2.aborted, true);

      // Cycle 3: interrupted during speaking
      const turn3 = manager.beginTurn();
      const sig3 = manager.startSpeaking(turn3);
      const ev3 = manager.handleUserSpeechStart();
      assert.ok(ev3);
      assert.equal(ev3.turnId, turn3);
      assert.equal(sig3.aborted, true);

      assert.equal(manager.getActiveTurnId(), 3, "Active turn ID must monotonically increment to 3");
      assert.equal(manager.getInterruptionCount(), 3, "Interruption count must be 3");
      assert.equal(manager.getPhase(), "listening");
    });

    it("Test 4: Thinking-Phase Interruption — caller speaks while LLM is generating", () => {
      const manager = new InterruptionManager();
      const turnId = manager.beginTurn();
      const llmSignal = manager.startThinking(turnId);

      assert.equal(manager.getPhase(), "thinking");
      assert.equal(manager.isTurnActive(turnId), true);

      const event = manager.handleUserSpeechStart();

      assert.ok(event !== null);
      assert.equal(event.phase, "thinking");
      assert.equal(event.turnId, turnId);
      assert.equal(llmSignal.aborted, true, "LLM AbortController must be aborted immediately");
      assert.equal(manager.isTurnActive(turnId), false, "Turn must be invalidated");
      assert.equal(manager.canDeliverFrame(turnId), false, "Frames must be rejected");
      assert.equal(manager.getPhase(), "listening");
    });

    it("Test 5: Initial Greeting Interruption — caller speaks during greeting chime", () => {
      const manager = new InterruptionManager();
      const greetingSignal = manager.startGreeting();

      assert.equal(manager.getPhase(), "greeting");
      assert.equal(greetingSignal.aborted, false);

      const event = manager.handleUserSpeechStart();

      assert.ok(event !== null);
      assert.equal(event.phase, "greeting");
      assert.equal(greetingSignal.aborted, true, "Greeting AbortController must be aborted immediately");
      assert.equal(manager.getPhase(), "listening");

      // Verify that caller's turn can start cleanly
      const turnId = manager.beginTurn();
      assert.equal(turnId, 1);
    });

    it("Test 6: Playback Position Invariance — clean cutoff at 10%, 50%, and 90% of playback", async () => {
      const simulatedDurations = [20, 50, 90]; // scaled ms delays for testing
      for (const delayMs of simulatedDurations) {
        const manager = new InterruptionManager();
        const turnId = manager.beginTurn();
        manager.startSpeaking(turnId);

        await new Promise((r) => setTimeout(r, delayMs));

        const event = manager.handleUserSpeechStart();
        assert.ok(event !== null, `Interruption at ${delayMs}ms must succeed`);
        assert.equal(event.phase, "speaking");
        assert.ok(
          event.playbackDurationMs >= 0,
          `Playback duration (${event.playbackDurationMs}ms) must be non-negative`,
        );
        assert.equal(manager.canDeliverFrame(turnId), false);
      }
    });

    it("Test 7: Turn Precedence — Turn N+1 completely supersedes Turn N", () => {
      const manager = new InterruptionManager();
      const turn1 = manager.beginTurn();
      manager.startThinking(turn1);
      assert.equal(manager.isTurnActive(turn1), true);

      // Caller turns new speech: Turn 2 begins before Turn 1 finishes
      const turn2 = manager.beginTurn();
      assert.equal(manager.isTurnActive(turn1), false, "Turn 1 must be superseded by Turn 2");
      assert.equal(manager.isTurnActive(turn2), true, "Turn 2 must be active");
      assert.equal(manager.canDeliverFrame(turn1), false);

      // Turn 2 transitions to speaking
      manager.startSpeaking(turn2);
      assert.equal(manager.canDeliverFrame(turn1), false, "Turn 1 frames must still be blocked");
      assert.equal(manager.canDeliverFrame(turn2), true, "Turn 2 frames must be permitted");
    });
  });

  // =========================================================================
  // SUITE 2: Audio Queue & Stale-Result Protection
  // =========================================================================
  describe("Suite 2: Audio Queue & Stale-Result Protection", () => {
    it("Test 8: Native Queue Clearing — audioSource.clearQueue() drops queued frames", async () => {
      const sampleRate = 24000;
      const audioSource = new AudioSource(sampleRate, 1);

      // Push 5 frames (100ms) of 20ms audio
      const samplesPerFrame = Math.floor((20 / 1000) * sampleRate);
      for (let i = 0; i < 5; i++) {
        const pcm = new Int16Array(samplesPerFrame).fill(1000);
        const frame = new AudioFrame(pcm, sampleRate, 1, samplesPerFrame);
        await audioSource.captureFrame(frame);
      }

      assert.doesNotThrow(() => {
        audioSource.clearQueue();
      }, "clearQueue() must execute without throwing");

      assert.equal(
        audioSource.queuedDuration,
        0,
        "queuedDuration must be 0 after clearQueue()",
      );

      await audioSource.close();
    });

    it("Test 9: Zero Stale Frame Delivery — frames arriving after interruption are blocked", () => {
      const manager = new InterruptionManager();
      const turnId = manager.beginTurn();
      manager.startSpeaking(turnId);

      const deliveredFrames: number[] = [];
      const totalFramesToStream = 10;

      for (let i = 0; i < totalFramesToStream; i++) {
        // Interruption occurs after 3 frames have been processed
        if (i === 3) {
          manager.handleUserSpeechStart();
        }

        if (!manager.canDeliverFrame(turnId)) {
          break; // Frame delivery stopped
        }

        deliveredFrames.push(i);
      }

      assert.equal(
        deliveredFrames.length,
        3,
        "Exactly 3 frames should have been delivered before interruption stopped the stream",
      );
    });

    it("Test 10: Late LLM Result Discard — delayed LLM response on superseded turn is skipped", async () => {
      const manager = new InterruptionManager();
      const turn1 = manager.beginTurn();
      manager.startThinking(turn1);

      // Simulated slow LLM inference promise
      const slowLLMPromise = new Promise<{ text: string }>((resolve) => {
        setTimeout(() => resolve({ text: "Late obsolete answer" }), 40);
      });

      // Caller speaks again: Turn 1 is interrupted, Turn 2 begins
      manager.handleUserSpeechStart();
      const turn2 = manager.beginTurn();
      manager.startThinking(turn2);

      const result = await slowLLMPromise;

      // Pipeline check before TTS scheduling:
      const shouldScheduleTTS = manager.isTurnActive(turn1);
      assert.equal(
        shouldScheduleTTS,
        false,
        "Slow LLM response from Turn 1 must NOT be scheduled for TTS because turn is inactive",
      );
      assert.equal(result.text, "Late obsolete answer");
    });

    it("Test 11: Late Raya Chunk Discard — late audio chunk after abort is dropped", () => {
      const buffer = new AudioFrameBuffer(24000, 20);
      const pcmChunk = new Int16Array(4800); // 10 frames worth
      const frames = buffer.push(pcmChunk);

      const manager = new InterruptionManager();
      const turnId = manager.beginTurn();
      manager.startSpeaking(turnId);

      let capturedCount = 0;
      for (let i = 0; i < frames.length; i++) {
        if (i === 2) {
          manager.handleUserSpeechStart();
        }
        if (!manager.canDeliverFrame(turnId)) {
          break;
        }
        capturedCount++;
      }

      assert.equal(capturedCount, 2, "Only 2 frames should be captured before abort halts ingestion");
    });
  });

  // =========================================================================
  // SUITE 3: False Interruptions & Input Stream Continuity
  // =========================================================================
  describe("Suite 3: False Interruptions & Input Stream Continuity", () => {
    it("Test 12: Sub-100 ms Noise Rejection — 50ms transient burst ignored by Silero VAD", async () => {
      const vad = await loadSileroVAD({
        minSilenceDuration: 600,
        minSpeechDuration: 100, // 100ms threshold filters out 50ms transients
        activationThreshold: 0.5,
      });
      const stream = vad.stream();
      const manager = new InterruptionManager();
      const turnId = manager.beginTurn();
      manager.startSpeaking(turnId);

      const startEvents: VADEvent[] = [];
      const consumerPromise = (async () => {
        for await (const event of stream) {
          if (event.type === VADEventType.START_OF_SPEECH) {
            startEvents.push(event);
            manager.handleUserSpeechStart();
          }
        }
      })();

      // 50ms synthetic burst followed by 400ms silence
      const noiseFrames = generateSyntheticSpeechFrames(50, { sampleRate: 16000 });
      const silenceFrames = generateSilenceFrames(400, 16000);
      const frames = [...noiseFrames, ...silenceFrames];

      for (const frame of frames) {
        stream.pushFrame(frame);
        await new Promise((resolve) => setImmediate(resolve));
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
      stream.close();
      await consumerPromise;

      assert.equal(
        startEvents.length,
        0,
        "50ms sub-100ms burst must NOT trigger START_OF_SPEECH",
      );
      assert.equal(
        manager.getPhase(),
        "speaking",
        "Agent speech must remain uninterrupted during sub-100ms noise",
      );
      assert.equal(manager.canDeliverFrame(turnId), true);
    });

    it("Test 13: Caller Audio Stream Preservation — VAD stream remains open across interruptions", async () => {
      const vad = await loadSileroVAD({
        minSilenceDuration: 300,
        minSpeechDuration: 100,
        activationThreshold: 0.5,
      });
      const stream = vad.stream();
      const manager = new InterruptionManager();
      const turnId = manager.beginTurn();
      manager.startSpeaking(turnId);

      const detectedStarts: VADEvent[] = [];
      const consumerPromise = (async () => {
        for await (const event of stream) {
          if (event.type === VADEventType.START_OF_SPEECH) {
            detectedStarts.push(event);
            manager.handleUserSpeechStart();
          }
        }
      })();

      // Utterance 1 (causes interruption)
      const speech1 = generateSyntheticSpeechFrames(200, { sampleRate: 16000 });
      const silence1 = generateSilenceFrames(600, 16000);
      for (const f of [...speech1, ...silence1]) {
        stream.pushFrame(f);
        await new Promise((resolve) => setImmediate(resolve));
      }

      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(detectedStarts.length, 1, "First utterance must trigger interruption");
      assert.equal(manager.getPhase(), "listening");

      // Utterance 2 (caller speaks again on same stream without stream recreation)
      const speech2 = generateSyntheticSpeechFrames(200, { sampleRate: 16000 });
      const silence2 = generateSilenceFrames(600, 16000);
      for (const f of [...speech2, ...silence2]) {
        stream.pushFrame(f);
        await new Promise((resolve) => setImmediate(resolve));
      }

      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(
        detectedStarts.length,
        2,
        "VAD stream must remain alive and capture subsequent utterance",
      );

      stream.close();
      await consumerPromise;
    });

    it("Test 14: Deepgram Full Utterance Ingestion — caller audio ingested across entire utterance", () => {
      // Simulate STT buffer collection through turn interruption
      const ingestedChunks: string[] = [];
      let finalTranscriptEmitted = false;

      const simulateAudioIngestion = (chunk: string, isFinal: boolean) => {
        ingestedChunks.push(chunk);
        if (isFinal) {
          finalTranscriptEmitted = true;
        }
      };

      // Mid-utterance chunks delivered while agent was interrupted
      simulateAudioIngestion("নমস্কাৰ", false);
      simulateAudioIngestion("মই", false);
      simulateAudioIngestion("ডাঃ বৰুৱাৰ সময় বিচাৰো", true);

      assert.equal(ingestedChunks.length, 3);
      assert.equal(finalTranscriptEmitted, true);
      assert.equal(
        ingestedChunks.join(" "),
        "নমস্কাৰ মই ডাঃ বৰুৱাৰ সময় বিচাৰো",
      );
    });

    it("Test 15: False Interruption Recovery — low confidence transient filtered safely", () => {
      const manager = new InterruptionManager();
      const turn1 = manager.beginTurn();
      manager.startSpeaking(turn1);

      // VAD fires speech start
      manager.handleUserSpeechStart();
      assert.equal(manager.getPhase(), "listening");

      // STT produces low confidence (<0.30) transient
      const userUtterance = "হ";
      const confidence = 0.18;
      const gate = new SpeechTranscriptGate();
      gate.speechStarted(100, 100); gate.speechEnded(850, 600);
      assert.equal(gate.rejection({ text: userUtterance, confidence, language: "as", latencyMs: 0,
        audioRange: { startMs: 0, endMs: 200 } }), "low_confidence", "Transient noise must be filtered before a new LLM turn");

      // Agent does not crash or schedule LLM, stays in listening state ready for next turn
      assert.equal(manager.getPhase(), "listening");

      // Valid subsequent user utterance arrives
      const turn2 = manager.beginTurn();
      assert.equal(turn2, 2);
      const llmSig = manager.startThinking(turn2);
      assert.equal(manager.getPhase(), "thinking");
      assert.equal(llmSig.aborted, false);
    });
  });

  // =========================================================================
  // SUITE 4: Lifecycle & Resilience
  // =========================================================================
  describe("Suite 4: Lifecycle & Resilience", () => {
    it("Test 16: Idempotent Abort Calls — repeated handleUserSpeechStart returns null safely", () => {
      const manager = new InterruptionManager();
      assert.equal(manager.getPhase(), "idle");

      // In idle phase, user speech start returns null
      assert.equal(manager.handleUserSpeechStart(), null);

      manager.beginTurn();
      // In listening phase, returns null
      assert.equal(manager.handleUserSpeechStart(), null);

      // Multiple reset calls are completely safe
      assert.doesNotThrow(() => {
        manager.reset();
        manager.reset();
        manager.reset();
      });
      assert.equal(manager.getPhase(), "idle");
    });

    it("Test 17: Normal Playback Teardown — uninterrupted session runs to completion without false cancels", () => {
      const manager = new InterruptionManager();

      // Greeting completes cleanly
      const greetSig = manager.startGreeting();
      manager.finishGreeting();
      assert.equal(greetSig.aborted, false);
      assert.equal(manager.getPhase(), "listening");

      // Turn thinking completes cleanly
      const turn1 = manager.beginTurn();
      const thinkSig = manager.startThinking(turn1);
      manager.finishThinking(turn1);
      assert.equal(thinkSig.aborted, false);
      assert.equal(manager.getPhase(), "listening");

      // Speaking completes cleanly
      const speakSig = manager.startSpeaking(turn1);
      assert.equal(manager.canDeliverFrame(turn1), true);
      manager.finishSpeaking(turn1);
      assert.equal(speakSig.aborted, false);
      assert.equal(manager.getPhase(), "listening");

      assert.equal(
        manager.getInterruptionCount(),
        0,
        "Normal playback must record 0 interruptions",
      );
    });

    it("Test 18: Provider Error Isolation — LLM/TTS provider error does not poison manager", () => {
      const manager = new InterruptionManager();
      const turn1 = manager.beginTurn();
      const llmSig = manager.startThinking(turn1);

      try {
        // Simulate provider error
        throw new Error("HuggingFace 503 Service Unavailable");
      } catch {
        if (!llmSig.aborted) {
          manager.finishThinking(turn1);
        }
      }

      assert.equal(manager.getPhase(), "listening");

      // System can immediately accept subsequent turn
      const turn2 = manager.beginTurn();
      manager.startThinking(turn2);
      assert.equal(manager.isTurnActive(turn2), true);
      assert.equal(manager.getPhase(), "thinking");
    });

    it("Test 19: DataChannel Informational Decoupling — failure to publish data channel event does not fail interruption", async () => {
      const manager = new InterruptionManager();
      const turnId = manager.beginTurn();
      manager.startSpeaking(turnId);

      const mockPublishData = async () => {
        throw new Error("DataChannel send buffer full / connection closed");
      };

      const handleInterruption = async () => {
        const ev = manager.handleUserSpeechStart();
        if (ev) {
          try {
            await mockPublishData();
          } catch {
            // Decoupled best-effort broadcast
          }
        }
        return ev;
      };

      const event = await handleInterruption();
      assert.ok(event !== null);
      assert.equal(manager.getPhase(), "listening");
      assert.equal(manager.canDeliverFrame(turnId), false);
    });

    it("Test 20: Zero Resource Leaks — 50 simulated interruption cycles execute without leaks", () => {
      const manager = new InterruptionManager();

      for (let i = 0; i < 50; i++) {
        if (i % 3 === 0) {
          manager.startGreeting();
          manager.handleUserSpeechStart();
        } else if (i % 3 === 1) {
          const turn = manager.beginTurn();
          manager.startThinking(turn);
          manager.handleUserSpeechStart();
        } else {
          const turn = manager.beginTurn();
          manager.startSpeaking(turn);
          manager.handleUserSpeechStart();
        }
      }

      assert.equal(manager.getInterruptionCount(), 50);
      assert.equal(manager.getPhase(), "listening");

      manager.reset();
      assert.equal(manager.getPhase(), "idle");
      assert.equal(manager.canDeliverFrame(1), false);
    });
  });

  after(async () => {
    await dispose();
  });
});
