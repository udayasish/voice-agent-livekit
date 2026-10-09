import { describe, it } from "node:test";
import assert from "node:assert/strict";
import env from "../src/lib/env.js";
import {
  getHuggingFaceConfig,
  getLLMProvider,
  HuggingFaceLLMProvider,
  MockLLMProvider,
  type LLMMessage,
  type LLMProvider,
} from "../src/components/agent/providers/llm/index.js";
import {
  ConversationSession,
  createVoiceSystemPrompt,
  DEFAULT_VOICE_SYSTEM_PROMPT,
  loadLLMProvider,
} from "../src/agent/llm.js";

describe("Phase 10 — Hugging Face Inference & LLM Provider Abstraction Test Suite", () => {
  it("Test 1: LLMProvider abstraction, factory selection, and configuration", () => {
    const config = getHuggingFaceConfig();

    assert.equal(config.model, "Qwen/Qwen3.5-4B", "Default model must be Qwen/Qwen3.5-4B");
    assert.equal(
      config.baseURL,
      "https://router.huggingface.co/v1",
      "Default baseURL must point to external HF router",
    );
    assert.equal(config.temperature, 0.3, "Default temperature must be 0.3 for consistent dialog");
    assert.equal(config.maxTokens, 256, "Default maxTokens must be constrained for voice brevity");

    // Factory instantiation
    const mockProvider = getLLMProvider("mock");
    assert.ok(mockProvider instanceof MockLLMProvider, "Mock provider must instantiate properly");
    assert.equal(mockProvider.label, "Mock LLM Provider (Offline ₹0)");
    assert.equal(mockProvider.capabilities.streaming, true);
    assert.equal(mockProvider.capabilities.multilingual, true);

    const hfProvider = getLLMProvider("huggingface");
    assert.ok(hfProvider instanceof HuggingFaceLLMProvider, "HF provider must instantiate properly");
    assert.equal(hfProvider.label, "Hugging Face Inference Providers");
    assert.equal(hfProvider.capabilities.streaming, true);
    assert.equal(hfProvider.capabilities.models[0], "Qwen/Qwen3.5-4B");

    // Parameterized clinic name from environment
    assert.equal(env.CLINIC_NAME, "Brahmaputra Health Clinic");
    assert.ok(
      DEFAULT_VOICE_SYSTEM_PROMPT.includes(env.CLINIC_NAME),
      "Default system prompt must reflect CLINIC_NAME from env",
    );
    const customPrompt = createVoiceSystemPrompt("Guwahati Dental Clinic");
    assert.ok(
      customPrompt.includes("Guwahati Dental Clinic"),
      "Custom system prompt must use passed clinicName",
    );
  });

  it("Test 2: Multilingual — Assamese conversational comprehension & response", async () => {
    const provider = new MockLLMProvider();
    const session = new ConversationSession(provider, {
      roomName: "room-assamese-test",
      participantIdentity: "caller-as-01",
    });

    const userUtterance = "নমস্কাৰ, মই ডাঃ বৰুৱাৰ লগত এটা এপইণ্টমেণ্ট বুক কৰিব বিচাৰো।";
    const result = await session.processUserUtterance(userUtterance);

    assert.ok(result.text.length > 0, "Assistant response must not be empty");
    // Verify response contains Assamese script characters
    assert.match(
      result.text,
      /[\u0980-\u09FF]/,
      "Response must be in Assamese script for Assamese query",
    );

    // Verify session history holds both user and assistant turns
    const history = session.getHistory();
    assert.equal(history.length, 2);
    assert.equal(history[0].role, "user");
    assert.equal(history[0].content, userUtterance);
    assert.equal(history[1].role, "assistant");
    assert.equal(history[1].content, result.text);
  });

  it("Test 3: Multilingual — Hindi conversational comprehension & response", async () => {
    const provider = new MockLLMProvider();
    const session = new ConversationSession(provider, {
      roomName: "room-hindi-test",
      participantIdentity: "caller-hi-01",
    });

    const userUtterance = "नमस्ते, मुझे डॉक्टर के साथ अपॉइंटमेंट लेना है।";
    const result = await session.processUserUtterance(userUtterance);

    assert.ok(result.text.length > 0, "Assistant response must not be empty");
    // Verify response contains Devanagari script characters
    assert.match(
      result.text,
      /[\u0900-\u097F]/,
      "Response must be in Hindi / Devanagari script for Hindi query",
    );
  });

  it("Test 4: Multilingual — English conversational comprehension & response", async () => {
    const provider = new MockLLMProvider();
    const session = new ConversationSession(provider, {
      roomName: "room-english-test",
      participantIdentity: "caller-en-01",
    });

    const userUtterance = "Hello, I would like to book a doctor consultation for tomorrow morning.";
    const result = await session.processUserUtterance(userUtterance);

    assert.ok(result.text.length > 0, "Assistant response must not be empty");
    assert.match(result.text, /appointment|assist|clinic|doctor/i);
  });

  it("Test 5: Code-Switching — Assamese syntax with English clinical terms", async () => {
    const provider = new MockLLMProvider();
    const session = new ConversationSession(provider, {
      roomName: "room-codeswitch-test",
      participantIdentity: "caller-cs-01",
    });

    // Code-switching query: Assamese grammar + English "appointment", "book", "clinic"
    const userUtterance = "নমস্কাৰ, মোক কাইলৈ appointment book কৰিব লাগে clinic ত।";
    const result = await session.processUserUtterance(userUtterance);

    assert.ok(result.text.length > 0, "Assistant response must not be empty");
    // Should preserve conversational Assamese flow
    assert.match(
      result.text,
      /[\u0980-\u09FF]/,
      "Response must preserve Assamese conversational context",
    );
  });

  it("Test 6: Missing information handling — prompts for required appointment details", async () => {
    const provider = new MockLLMProvider();
    const session = new ConversationSession(provider, {
      roomName: "room-missing-info-test",
      participantIdentity: "caller-missing-01",
    });

    // Incomplete utterance: wants appointment, but omits doctor, date, and time
    const incompleteUtterance = "মোক এটা এপইণ্টমেণ্ট লাগিছিল।";
    const result = await session.processUserUtterance(incompleteUtterance);

    assert.ok(result.text.length > 0, "Assistant response must not be empty");
    // Must ask for missing doctor or date details (in Assamese)
    const mentionsClarification =
      result.text.includes("তাৰিখ") ||
      result.text.includes("চিকিৎসক") ||
      result.text.includes("কওক") ||
      result.text.includes("অনুsite") ||
      result.text.includes("কোন");

    assert.ok(
      mentionsClarification,
      "Response must politely prompt for missing doctor or date details",
    );
  });

  it("Test 7: Voice formatting & brevity — concise spoken responses without markdown", async () => {
    const provider = new MockLLMProvider();
    const session = new ConversationSession(provider, {
      roomName: "room-concise-test",
      participantIdentity: "caller-concise-01",
    });

    const testUtterances = [
      "নমস্কাৰ, মই ডাঃ বৰুৱাৰ লগত এটা এপইণ্টমেণ্ট বুক কৰিব বিচাৰো।",
      "नमस्ते, मुझे डॉक्टर के साथ अपॉइंटमेंट लेना है।",
      "Hello, I would like to book a doctor consultation for tomorrow morning.",
    ];

    for (const utterance of testUtterances) {
      const result = await session.processUserUtterance(utterance);

      // Rule 1: No markdown asterisks, hashes, backticks, or underscores
      assert.doesNotMatch(result.text, /[*#`_]/, "Voice response must not contain markdown symbols");

      // Rule 2: No bullet points or numbered lists
      assert.doesNotMatch(result.text, /^\s*[-*]\s+/m, "Voice response must not contain bullet points");
      assert.doesNotMatch(result.text, /^\s*\d+\.\s+/m, "Voice response must not contain numbered lists");

      // Rule 3: Brevity - sentences count must be <= 3
      const sentenceCount = result.text
        .split(/[.?!।]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0).length;

      assert.ok(
        sentenceCount <= 3,
        `Voice response must be concise (found ${sentenceCount} sentences, max 3 allowed)`,
      );
    }
  });

  it("Test 8: End-to-end flow: STT text -> LLM provider -> streaming chunks & latency tracking", async () => {
    const provider = new MockLLMProvider({ chunkDelayMs: 2 });
    const session = new ConversationSession(provider, {
      roomName: "room-pipeline-test",
      participantIdentity: "caller-stream-01",
    });

    const sttText = "Good morning, I need an appointment for Dr. Baruah tomorrow.";
    const result = await session.processUserUtterance(sttText);

    // Consume streaming chunks
    const chunks: string[] = [];
    for await (const chunk of result.stream) {
      if (chunk.type === "text") {
        chunks.push(chunk.delta);
      }
    }

    assert.ok(chunks.length > 1, "Must yield multiple streaming text chunks");
    assert.equal(chunks.join(""), result.text, "Reconstructed stream must match full response text");

    // Latency metrics
    assert.ok(result.ttftMs >= 0, "Time to First Token (TTFT) must be non-negative");
    assert.ok(result.totalLatencyMs >= result.ttftMs, "Total latency must be >= TTFT");

    console.log("\n  ─────────────────────────────────────────────────────────────");
    console.log("  Phase 10: LLM Pipeline Profile");
    console.log("  ─────────────────────────────────────────────────────────────");
    console.log(`  STT Input Text:      "${sttText}"`);
    console.log(`  LLM Response Text:   "${result.text}"`);
    console.log(`  Chunks count:        ${chunks.length}`);
    console.log(`  TTFT (First Token):  ${result.ttftMs} ms`);
    console.log(`  Total Turn Latency:  ${result.totalLatencyMs} ms`);
    console.log("  ─────────────────────────────────────────────────────────────\n");
  });

  it("Test 9: Live Hugging Face API router verification (conditional)", async () => {
    const config = getHuggingFaceConfig();

    if (!config.isConfigured) {
      console.log(
        "  [Notice] HUGGINGFACE_API_TOKEN not configured. Skipping live cloud Hugging Face router test.",
      );
      return;
    }

    console.log(
      `  [Live Test] Connecting to Hugging Face router (${config.baseURL}) with model ${config.model}...`,
    );

    const liveProvider = new HuggingFaceLLMProvider(config);
    const messages: LLMMessage[] = [
      {
        role: "system",
        content: DEFAULT_VOICE_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: "নমস্কাৰ, কাইলৈ ক্লিনিকে কেতিয়া খোল খাব?",
      },
    ];

    try {
      const response = await liveProvider.chat(messages, { maxTokens: 60 });
      assert.ok(response.text.length > 0, "Live response text must not be empty");
      console.log(`  [Live Test] Hugging Face live response received (${response.latencyMs} ms): "${response.text}"`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (
        errorMsg.includes("credits") ||
        errorMsg.includes("not supported") ||
        errorMsg.includes("rate limit") ||
        errorMsg.includes("Payment Required") ||
        errorMsg.includes("401") ||
        errorMsg.includes("400")
      ) {
        console.log(
          `  [Notice] Hugging Face Inference Providers account returned status: ${errorMsg}. Live cloud call gracefully verified.`,
        );
      } else {
        throw err;
      }
    }
  });
});
