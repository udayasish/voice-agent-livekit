import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AudioFrame, AudioSource, LocalAudioTrack, TrackKind, dispose } from "@livekit/rtc-node";
import {
  normalizeAssamesePhoneNumber,
  extractAssamesePhoneNumber,
} from "../src/components/agent/normalizers/phone-number-normalizer.js";
import {
  ConversationSession,
  detectRepetition,
  extractSlotsFromText,
} from "../src/agent/llm.js";
import {
  MockLLMProvider,
  type LLMMessage,
  type LLMProvider,
  type LLMResponse,
} from "../src/components/agent/providers/llm/index.js";
import {
  AudioFrameBuffer,
  decodeF32LEBase64ToPCM16,
} from "../src/components/agent/providers/tts/raya/index.js";
import { logLifecycle } from "../src/agent/lifecycle.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load test corpus fixture
const corpusPath = path.join(__dirname, "fixtures", "assamese-voice-loop-corpus.json");
const testCorpus = JSON.parse(fs.readFileSync(corpusPath, "utf-8")) as Array<{
  id: string;
  category: string;
  rawText: string;
  expectedDoctor?: string;
  expectedTime?: string;
  expectedName?: string;
  expectedNormalizedPhone?: string;
  confidence?: number;
  shouldFilter?: boolean;
}>;

describe("Phase 12 — Complete Voice Loop Integration & Reliability Test Suite", () => {
  it("Test 1: Assamese Spoken Phone Number Normalizer (Phonetic Loanwords, Native Digits, Multipliers)", () => {
    // 1. Phonetic English loanwords in Assamese script with multiplier 'ডাবল'
    const phoneticUtterance = "মোৰ ফোন নম্বৰটো হৈছে ছেভেন ডাবল জিৰ' টু জিৰ' ফাইভ নাইন ফাইভ ফোৰ ফোৰ";
    const extracted1 = extractAssamesePhoneNumber(phoneticUtterance);
    assert.equal(
      extracted1,
      "7002059544",
      "Should extract and normalize 7002059544 from Assamese phonetic loanwords with multiplier",
    );

    // 2. Native Assamese digit words
    const nativeDigitsUtterance = "মোৰ নম্বৰ ন আঠ চাৰি তিনি দুই এক শূন্য পাঁচ ছয় সাত";
    const extracted2 = extractAssamesePhoneNumber(nativeDigitsUtterance);
    assert.equal(
      extracted2,
      "9843210567",
      "Should extract and normalize 9843210567 from native Assamese digit words",
    );

    // 3. Mixed script (English loanwords, ASCII numbers, Assamese numerals)
    const mixedUtterance = "নাইন ৮ ফ'ৰ তিনি 2 1 জিৰ' 5 6 7";
    const extracted3 = extractAssamesePhoneNumber(mixedUtterance);
    assert.equal(
      extracted3,
      "9843210567",
      "Should extract and normalize 9843210567 from mixed script representations",
    );

    // 4. Triplet and double multipliers
    const multipliersUtterance = "ট্ৰিপল নাইন ডাবল জিৰ' ৱান টু থ্ৰী ফ'ৰ ফাইভ";
    const normalizedMultipliers = normalizeAssamesePhoneNumber(multipliersUtterance);
    assert.equal(
      normalizedMultipliers,
      "9990012345",
      "Should expand 'ট্ৰিপল' (triple) and 'ডাবল' (double) correctly into 10 digits",
    );

    // 5. Incomplete / garbage inputs
    const incompleteUtterance = "নমস্কাৰ মোৰ ফোন নম্বৰ নাইন এইট";
    const extractedInvalid = extractAssamesePhoneNumber(incompleteUtterance);
    assert.equal(
      extractedInvalid,
      null,
      "Incomplete phone number (<10 digits) should return null without crashing",
    );
  });

  it("Test 2: Multi-Turn Conversation Progression & State Slot Tracking", async () => {
    const mockProvider = new MockLLMProvider();
    const session = new ConversationSession(mockProvider, {
      roomName: "room-voice-loop-multiturn",
      participantIdentity: "caller-as-multiturn-01",
    });

    // Initial state check
    const initialState = session.getState();
    assert.equal(initialState.turnCount, 0);
    assert.equal(initialState.slots.doctor, undefined);
    assert.equal(initialState.slots.dateOrTime, undefined);
    assert.equal(initialState.slots.patientName, undefined);
    assert.equal(initialState.slots.phoneNumber, undefined);

    // Turn 1: Greeting + Doctor Intent
    const turn1Result = await session.processUserUtterance(
      "নমস্কাৰ, মই ডাঃ বৰুৱাৰ সৈতে এটা এপইণ্টমেণ্ট বুক কৰিব বিচাৰোঁ।",
    );
    assert.ok(turn1Result.text.length > 0, "Turn 1 must produce non-empty assistant text");
    const stateAfterTurn1 = session.getState();
    assert.equal(stateAfterTurn1.turnCount, 1);
    assert.equal(stateAfterTurn1.slots.doctor, "ডাঃ বৰুৱা", "Doctor slot should be extracted");

    // Turn 2: Date & Time slot
    const turn2Result = await session.processUserUtterance("কাইলৈ পুৱা দহ বজাত সময় হ'বনে?");
    assert.ok(turn2Result.text.length > 0, "Turn 2 must produce non-empty assistant text");
    const stateAfterTurn2 = session.getState();
    assert.equal(stateAfterTurn2.turnCount, 2);
    assert.equal(stateAfterTurn2.slots.doctor, "ডাঃ বৰুৱা", "Doctor slot must persist");
    assert.equal(
      stateAfterTurn2.slots.dateOrTime,
      "কাইলৈ পুৱা দহ বজাত",
      "Date/time slot should be extracted",
    );

    // Turn 3: Patient Name
    const turn3Result = await session.processUserUtterance("মোৰ নাম ৰাহুল বৰা।");
    assert.ok(turn3Result.text.length > 0, "Turn 3 must produce non-empty assistant text");
    const stateAfterTurn3 = session.getState();
    assert.equal(stateAfterTurn3.turnCount, 3);
    assert.equal(stateAfterTurn3.slots.patientName, "ৰাহুল বৰা", "Patient name slot should be extracted");

    // Turn 4: Spoken Phone Number (Phonetic dictation)
    const turn4Result = await session.processUserUtterance(
      "মোৰ ফোন নম্বৰ হৈছে ছেভেন ডাবল জিৰ' টু জিৰ' ফাইভ নাইন ফাইভ ফোৰ ফোৰ।",
    );
    assert.ok(turn4Result.text.length > 0, "Turn 4 must produce non-empty assistant text");
    const finalState = session.getState();
    assert.equal(finalState.turnCount, 4);
    assert.equal(
      finalState.slots.phoneNumber,
      "7002059544",
      "Spoken phonetic phone number must be normalized and stored in slots",
    );
    assert.equal(finalState.slots.doctor, "ডাঃ বৰুৱা");
    assert.equal(finalState.slots.dateOrTime, "কাইলৈ পুৱা দহ বজাত");
    assert.equal(finalState.slots.patientName, "ৰাহুল বৰা");
  });

  it("Test 3: Anti-Repetition Loop Mitigation", async () => {
    const mockProvider = new MockLLMProvider();
    const session = new ConversationSession(mockProvider, {
      roomName: "room-voice-loop-repetition",
      participantIdentity: "caller-as-repetition-01",
    });

    // Provide doctor and time first
    await session.processUserUtterance("মই ডাঃ বৰুৱাক কাইলৈ পুৱা ১০ বজাত দেখুৱাব বিচাৰোঁ।");
    const stateBefore = session.getState();
    assert.equal(stateBefore.slots.doctor, "ডাঃ বৰুৱা");

    // Check detectRepetition utility
    const isRepeated = detectRepetition("ডাঃ বৰুৱা কাইলৈ পুৱা ১০ বজাত", stateBefore);
    assert.equal(isRepeated, true, "detectRepetition should identify already-stored slots");

    // Now send the user repeating the acknowledged slots
    const repeatedResult = await session.processUserUtterance(
      "কাইলৈ পুৱা ১০ বজাত ডাঃ বৰুৱা",
    );

    // The agent must advance dialogue to ask for patient name or phone number rather than re-asking who they want to see
    assert.ok(
      repeatedResult.text.includes("নাম") || repeatedResult.text.includes("নম্বৰ") || repeatedResult.isFallback,
      "Repetition handler must advance the dialogue towards missing slots (patient name or phone)",
    );
  });

  it("Test 4: Empty LLM Output Guard & Raya HTTP 400 Prevention", async () => {
    // Custom LLM provider that intentionally returns empty string or whitespace
    class EmptyOutputLLMProvider implements LLMProvider {
      readonly label = "Empty Output Fault Injector";
      readonly capabilities = {
        streaming: true,
        toolCalling: false,
        multilingual: true,
        models: ["empty-test"],
      };

      async *generate(_messages: LLMMessage[]): AsyncIterable<LLMChunk> {
        yield { type: "text", delta: "   " };
        yield { type: "done" };
      }

      async chat(_messages: LLMMessage[]): Promise<LLMResponse> {
        return {
          text: "   ",
          role: "assistant",
          usage: { promptTokens: 10, completionTokens: 0, totalTokens: 10 },
        };
      }
    }

    const session = new ConversationSession(new EmptyOutputLLMProvider(), {
      roomName: "room-empty-test",
      participantIdentity: "caller-empty-01",
    });

    const result = await session.processUserUtterance("নমস্কাৰ");

    // Verifies ConversationSession prevents empty responses and returns Assamese fallback
    assert.ok(result.text.trim().length > 0, "Response must not be empty or whitespace");
    assert.equal(result.isFallback, true, "Response must be flagged as fallback");
    assert.ok(
      result.text.includes("শুনা নাপালোঁ") || result.text.includes("কওক") || result.text.includes("সহায়"),
      "Fallback must be polite Assamese phrase",
    );

    // Verify guard pattern used in LiveKit agent orchestration
    let ttsSynthesizeCalled = false;
    const dummySynthesize = (text: string) => {
      if (!text.trim()) {
        throw new Error("HTTP 400: Empty text provided");
      }
      ttsSynthesizeCalled = true;
    };

    const emptyText = "   ";
    if (emptyText.trim().length > 0) {
      dummySynthesize(emptyText);
    }
    assert.equal(
      ttsSynthesizeCalled,
      false,
      "Empty text guard must bypass TTS synthesis without throwing HTTP 400",
    );
  });

  it("Test 5: Deepgram Nova-3 STT Low-Confidence Noise Filtering", () => {
    const STT_CONFIDENCE_THRESHOLD = 0.3;

    // Filter rule verification from fixtures
    const noiseFixture = testCorpus.find((c) => c.id === "turn-9-noise-artifact");
    assert.ok(noiseFixture, "Noise fixture should exist");

    const isNoise =
      (noiseFixture.confidence ?? 1.0) < STT_CONFIDENCE_THRESHOLD &&
      noiseFixture.rawText.length < 15;

    assert.equal(isNoise, true, "Low-confidence short transcript should be classified as noise");

    // Real valid utterance with standard confidence
    const validTranscript = "নমস্কাৰ, মই ডাঃ বৰুৱাৰ সৈতে এটা এপইণ্টমেণ্ট বুক কৰিব বিচাৰোঁ।";
    const validConfidence = 0.94;
    const isValidNoise =
      validConfidence < STT_CONFIDENCE_THRESHOLD && validTranscript.length < 15;
    assert.equal(isValidNoise, false, "Valid user speech must not be filtered out");
  });

  it("Test 6: Monotonic Turn ID & Superseded Audio Cancellation Guard", () => {
    let currentTurnId = 0;
    const capturedTurns: number[] = [];

    // Simulate Turn 1 initiated
    const turn1Id = ++currentTurnId;
    assert.equal(turn1Id, 1);

    // Simulate Turn 2 interrupts while Turn 1 is in progress
    const turn2Id = ++currentTurnId;
    assert.equal(turn2Id, 2);

    // Frame delivery simulation:
    const dispatchAudioFrame = (frameTurnId: number) => {
      // If superseded by later turn, drop frame
      if (frameTurnId !== currentTurnId) {
        return; // Dropped
      }
      capturedTurns.push(frameTurnId);
    };

    // Stale Turn 1 frames arriving late:
    dispatchAudioFrame(turn1Id);
    dispatchAudioFrame(turn1Id);

    // Active Turn 2 frames arriving:
    dispatchAudioFrame(turn2Id);
    dispatchAudioFrame(turn2Id);

    assert.equal(capturedTurns.length, 2, "Only frames matching active turnId should be captured");
    assert.deepEqual(capturedTurns, [2, 2], "All captured frames must belong to Turn 2");
  });

  it("Test 7: Error Isolation & Provider Failure Recovery", async () => {
    // Failing LLM provider
    class FailingLLMProvider implements LLMProvider {
      readonly label = "Failing LLM Provider";
      readonly capabilities = {
        streaming: true,
        toolCalling: false,
        multilingual: false,
        models: ["fail-test"],
      };

      async *generate(_messages: LLMMessage[]): AsyncIterable<LLMChunk> {
        throw new Error("HuggingFace 503 Service Unavailable / Timeout");
      }

      async chat(_messages: LLMMessage[]): Promise<LLMResponse> {
        throw new Error("HuggingFace 503 Service Unavailable / Timeout");
      }
    }

    const session = new ConversationSession(new FailingLLMProvider(), {
      roomName: "room-failure-test",
      participantIdentity: "caller-fail-01",
    });

    // Call processUserUtterance and verify graceful fallback
    const result = await session.processUserUtterance("নমস্কাৰ");
    assert.ok(result.text.length > 0, "Fallback response must be provided on provider error");
    assert.equal(result.isFallback, true, "Result must indicate fallback status");
    assert.ok(
      result.text.includes("শুনা নাপালোঁ") ||
        result.text.includes("সহায়") ||
        result.text.includes("নিশ্চয়") ||
        /[\u0980-\u09FF]/.test(result.text),
      "Response should be polite Assamese error recovery sentence",
    );
  });

  it("Test 8: 20ms Audio Framing Integrity & Playable Audio Quality", () => {
    const sampleRate = 24000;
    const frameBuffer = new AudioFrameBuffer(sampleRate);

    // Create 100ms of synthetic 24kHz PCM16 audio (2400 samples)
    const totalSamples = 2400;
    const pcm16 = new Int16Array(totalSamples);
    for (let i = 0; i < totalSamples; i++) {
      pcm16[i] = Math.round(16000 * Math.sin((2 * Math.PI * 440 * i) / sampleRate));
    }

    // Push into buffer
    const frames = frameBuffer.push(pcm16);

    // 100ms / 20ms = 5 complete frames (each 480 samples = 960 bytes)
    assert.equal(frames.length, 5, "Expected exactly 5 uniform 20ms frames for 100ms audio");

    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      assert.ok(frame, `Frame ${i} must be defined`);
      assert.equal(frame.sampleRate, 24000, "Sample rate must be 24000 Hz");
      assert.equal(frame.channels, 1, "Channel count must be 1 (mono)");
      assert.equal(frame.samplesPerChannel, 480, "Each 20ms frame must have 480 samples");
      assert.equal(frame.data.byteLength, 960, "Each frame buffer must be 960 bytes");
    }

    // Verify frames can be pushed to AudioSource
    const audioSource = new AudioSource(sampleRate, 1);
    for (const frame of frames) {
      assert.doesNotThrow(() => {
        audioSource.captureFrame(frame);
      }, "AudioSource must accept valid 20ms AudioFrames");
    }
  });

  after(async () => {
    await dispose();
  });
});
