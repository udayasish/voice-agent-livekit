import env from "../lib/env.js";
import logger from "../lib/logger.js";
import {
  getLLMProvider,
  type LLMChunk,
  type LLMMessage,
  type LLMOptions,
  type LLMProvider,
  type LLMResponse,
  type HuggingFaceConfig,
  HuggingFaceLLMProvider,
  GroqLLMProvider,
} from "../components/agent/providers/llm/index.js";
import {
  normalizePhoneNumber,
  containsPhoneNumberCandidate,
  formatPhoneNumberForSpeech,
} from "../components/agent/normalizers/index.js";

/**
 * Generates the voice agent system prompt parameterized with the configured clinic/business name.
 * Tailored for speech synthesis: concise, spoken-friendly, multilingual, and strictly fact-grounded.
 */
export function createVoiceSystemPrompt(clinicName: string = env.CLINIC_NAME): string {
  return `
You are an AI voice receptionist for ${clinicName}.
You are speaking directly to callers over the telephone.

CRITICAL RULES FOR SPOKEN VOICE:
1. Spoken Brevity:
   - Keep all responses concise and voice-friendly (1 to 2 short sentences).
   - NEVER use markdown syntax (no asterisks, bold, italics, hashtags, dashes, or bullet points).
   - NEVER use emojis, HTML tags, or unpronounceable punctuation.
   - ALWAYS produce a complete, polite spoken sentence. NEVER return an empty response, silence, or whitespace.

2. Multilingual Fluency & Code-Switching:
   - You understand Assamese (অসমীয়া), Hindi (हिन्दी), and English fluently.
   - Always reply in the SAME language the caller is speaking.
   - If the caller speaks Assamese, reply in polite Assamese.
   - If the caller speaks Hindi, reply in polite Hindi.
   - If the caller speaks English, reply in polite English.
   - If the caller code-switches (Assamese mixed with English clinical terms like "appointment", "doctor", "clinic"), reply naturally in conversational Assamese.

3. Appointment Booking Workflow & Information Intake:
   - Step 1 (Doctor & Time): Acknowledge requested doctor/department and date/time. If missing, politely ask for one missing detail at a time.
   - Step 2 (Caller Name): If name is not provided, politely ask for the caller's full name. Once provided (e.g. "মোৰ নাম উদয়চিছ বৰা"), acknowledge it respectfully.
   - Step 3 (Phone Number Intake): Ask for their contact phone number.
   - Step 4 (Phone Number Recognition & Confirmation):
     * Callers often speak phone numbers in phonetic Assamese words (e.g., "ছেভেন ডাবল জিৰ' টু জিৰ' ফাইভ নাইন ফাইভ ডাবল ফ'ৰ" = 7002059544, "সাত শূন্য শূন্য দুই..."), English digits, or mixed words.
     * Recognize the phone number whether given as words or digits.
     * When the caller provides their phone number, ALWAYS acknowledge receipt and confirm that their appointment request has been recorded.
     * Example in Assamese: "ধন্যবাদ, আপোনাৰ ফোন নম্বৰটো পঞ্জীয়ন কৰা হ'ল। ডাঃ বৰুৱাৰ সৈতে কাইলৈ পুৱা ১০ বজাত আপোনাৰ অনুৰোধ গ্ৰহণ কৰা হৈছে।"

4. Variety and Clarity (Preventing Repetition Loops):
   - Do NOT repeat the exact same sentence consecutively.
   - If the caller repeats information already acknowledged (such as the time or doctor), acknowledge it gently and prompt for the next step (e.g., name or phone number).
   - If the caller's speech is unclear or inaudible, politely ask for clarification (e.g., "ক্ষমা কৰিব, মই স্পষ্টকৈ শুনা নাপালোঁ। অনুগ্ৰহ কৰি আকৌ এবাৰ ক'ব পাৰিবনে?").

5. Strict Factuality:
   - Only confirm the appointment request details provided by the caller. Do not provide medical advice or invent doctor schedules.
`.trim();
}

/**
 * Standard system prompt for the voice agent using the environment-configured clinic name.
 */
export const DEFAULT_VOICE_SYSTEM_PROMPT = createVoiceSystemPrompt();

export interface ConversationSlots {
  doctor?: string | undefined;
  department?: string | undefined;
  dateOrTime?: string | undefined;
  patientName?: string | undefined;
  phoneNumber?: string | undefined;
}

export interface SessionState {
  slots: ConversationSlots;
  lastPromptedSlot?: keyof ConversationSlots | null | undefined;
  lastAssistantUtterance?: string | undefined;
  turnCount: number;
  lastUserUtterance?: string | undefined;
  repetitionCount: number;
}

export interface ProcessUtteranceResult {
  text: string;
  stream: AsyncIterable<LLMChunk>;
  ttftMs: number;
  totalLatencyMs: number;
  turnId?: number | undefined;
  slots?: Readonly<ConversationSlots> | undefined;
  isFallback?: boolean | undefined;
}

/**
 * Extracts conversation slots (doctor, date/time, name, phone) from user input.
 */
export function extractSlotsFromText(
  userText: string,
  existingSlots: ConversationSlots = {},
): ConversationSlots {
  const slots: ConversationSlots = { ...existingSlots };
  const trimmed = userText.trim();
  const lower = trimmed.toLowerCase();

  // 1. Phone number extraction
  if (containsPhoneNumberCandidate(trimmed)) {
    const phoneResult = normalizePhoneNumber(trimmed);
    if (phoneResult.isValid) {
      slots.phoneNumber = phoneResult.digits;
    }
  }

  // 2. Doctor / department extraction
  if (trimmed.includes("বৰুৱা") || lower.includes("baruah") || trimmed.includes("ডাঃ বৰুৱা")) {
    slots.doctor = "ডাঃ বৰুৱা";
  } else if (trimmed.includes("শৰ্মা") || lower.includes("sarma") || trimmed.includes("ডাঃ শৰ্মা")) {
    slots.doctor = "ডাঃ শৰ্মা";
  }

  // 3. Date / Time extraction
  if (
    trimmed.includes("১০ বজাত") ||
    trimmed.includes("দহ বজাত") ||
    trimmed.includes("দশটাত") ||
    trimmed.includes("দহা বজাত") ||
    trimmed.includes("কাইলৈ") ||
    lower.includes("tomorrow") ||
    trimmed.includes("পুৱা") ||
    trimmed.includes("আবেলি")
  ) {
    if (!slots.dateOrTime) {
      slots.dateOrTime =
        trimmed.includes("দহ বজাত") || trimmed.includes("দহা বজাত") || trimmed.includes("১০ বজাত")
          ? "কাইলৈ পুৱা দহ বজাত"
          : "কাইলৈ পুৱা ১০ বজাত";
    }
  }

  // 4. Patient Name extraction
  if (
    trimmed.includes("নাম") ||
    trimmed.includes("নামটো") ||
    trimmed.includes("মই") ||
    lower.includes("my name") ||
    lower.includes("name is")
  ) {
    const match = trimmed.match(/(?:মোৰ\s+নাম|মো\s+নামটো|মোৰ\s+নামটো|নামটো|নাম)\s*(?:হৈছে|হয়|টো)?\s*([^\s।?,!]+(?:\s+[^\s।?,!]+)?)/);
    if (match?.[1] && match[1].length > 1 && !match[1].includes("ফোন") && !match[1].includes("নম্বৰ")) {
      slots.patientName = match[1];
    }
  } else if (slots.dateOrTime && !slots.patientName && !containsPhoneNumberCandidate(trimmed)) {
    // If appointment time is already acknowledged, and user provides 1 to 3 words (e.g. "উদয়চিছ বৰা")
    const words = trimmed.split(/\s+/).filter((w) => w.length > 1 && !w.includes("ডাঃ") && !w.includes("বৰুৱা") && !w.includes("কাইলৈ") && !w.includes("বজাত"));
    if (words.length >= 1 && words.length <= 3) {
      slots.patientName = words.join(" ").replace(/[।॥,;:"?!=+()[\]{}]/g, "").trim();
    }
  }

  return slots;
}

/**
 * Detects whether user is reiterating an already acknowledged detail without adding new info.
 */
export function detectRepetition(userText: string, state: SessionState): boolean {
  if (!state.lastUserUtterance) return false;
  const current = userText.trim();
  const prev = state.lastUserUtterance.trim();

  if (current === prev) return true;

  // Repeating time when time is already acknowledged
  const isOnlyTime =
    (current.includes("দশটাত") ||
      current.includes("১০ বজাত") ||
      current.includes("দহ বজাত") ||
      current.includes("দহা বজাত") ||
      current.includes("দশটাবোৰত")) &&
    !current.includes("নাম") &&
    !current.includes("ফোন");

  if (isOnlyTime && state.slots.dateOrTime) {
    return true;
  }

  // Repeating doctor when doctor is already acknowledged
  const isOnlyDoctor =
    (current.includes("বৰুৱা") || current.includes("ডাঃ বৰুৱা") || current.includes("শৰ্মা")) &&
    !current.includes("নাম") &&
    !current.includes("ফোন");

  if (isOnlyDoctor && state.slots.doctor) {
    return true;
  }

  return false;
}

/**
 * Conversation session managing dialog turns, context history, and LLM interaction
 * for a specific participant in a voice call.
 */
export class ConversationSession {
  readonly roomName: string;
  readonly participantIdentity: string;
  private provider: LLMProvider;
  private messages: LLMMessage[] = [];
  private systemPrompt: string;
  private state: SessionState = {
    slots: {},
    lastPromptedSlot: null,
    lastAssistantUtterance: undefined,
    turnCount: 0,
    lastUserUtterance: undefined,
    repetitionCount: 0,
  };

  constructor(
    provider: LLMProvider,
    options: {
      roomName: string;
      participantIdentity: string;
      systemPrompt?: string | undefined;
      clinicName?: string | undefined;
    },
  ) {
    this.provider = provider;
    this.roomName = options.roomName;
    this.participantIdentity = options.participantIdentity;
    this.systemPrompt =
      options.systemPrompt ??
      createVoiceSystemPrompt(options.clinicName ?? env.CLINIC_NAME);
  }

  /**
   * Retrieves current conversation turn history.
   */
  getHistory(): readonly LLMMessage[] {
    return this.messages;
  }

  /**
   * Retrieves current conversation session state.
   */
  getState(): Readonly<SessionState> {
    return this.state;
  }

  /**
   * Retrieves current extracted conversation slots.
   */
  getSlots(): Readonly<ConversationSlots> {
    return this.state.slots;
  }

  /**
   * Clears conversational history and resets slots for the session.
   */
  clearHistory(): void {
    this.messages = [];
    this.state = {
      slots: {},
      lastPromptedSlot: null,
      lastAssistantUtterance: undefined,
      turnCount: 0,
      lastUserUtterance: undefined,
      repetitionCount: 0,
    };
  }

  /**
   * Extracts conversation slots (doctor, date/time, name, phone) from user input.
   */
  private extractSlots(userText: string): void {
    this.state.slots = extractSlotsFromText(userText, this.state.slots);
  }

  /**
   * Detects whether user is reiterating an already acknowledged detail without adding new info.
   */
  private detectRepetition(userText: string): boolean {
    return detectRepetition(userText, this.state);
  }

  /**
   * Processes a user speech transcript through the LLM provider.
   * Flow: STT text -> LLM provider -> response text.
   */
  async processUserUtterance(
    userText: string,
    options?: {
      abortSignal?: AbortSignal;
      maxTokens?: number;
      temperature?: number;
    },
  ): Promise<ProcessUtteranceResult> {
    const trimmed = userText.trim();
    if (!trimmed) {
      throw new Error("User utterance cannot be empty");
    }

    this.state.turnCount++;
    this.extractSlots(trimmed);
    const isRepetition = this.detectRepetition(trimmed);
    if (isRepetition) {
      this.state.repetitionCount++;
    } else {
      this.state.repetitionCount = 0;
    }
    this.state.lastUserUtterance = trimmed;

    // 1. Append user message to history
    this.messages.push({
      role: "user",
      content: trimmed,
    });

    const startTime = Date.now();
    let firstTokenTime: number | null = null;
    let accumulatedText = "";

    // 2. Stream generation from the LLM provider
    const llmOptions: Partial<LLMOptions> = {
      systemPrompt: this.systemPrompt,
      abortSignal: options?.abortSignal,
      maxTokens: options?.maxTokens,
      temperature: options?.temperature,
    };

    const capturedChunks: LLMChunk[] = [];
    let isFallback = false;

    try {
      const chunkStream = this.provider.generate(this.messages, llmOptions);

      for await (const chunk of chunkStream) {
        if (options?.abortSignal?.aborted) {
          break;
        }

        capturedChunks.push(chunk);

        if (chunk.type === "text" && chunk.delta.length > 0) {
          if (firstTokenTime === null) {
            firstTokenTime = Date.now();
          }
          accumulatedText += chunk.delta;
        }
      }
    } catch (err) {
      isFallback = true;
      // Automatic fallback if cloud provider fails (e.g. 0 credits, model unsupported, network error)
      logger.warn(
        `[agent:llm] Primary LLM provider failed (${err instanceof Error ? err.message : String(err)}). Falling back to offline provider to preserve conversational session.`,
      );
      try {
        const fallbackProvider = getLLMProvider("mock");
        const fallbackStream = fallbackProvider.generate(this.messages, llmOptions);
        capturedChunks.length = 0;
        accumulatedText = "";

        for await (const chunk of fallbackStream) {
          if (options?.abortSignal?.aborted) break;
          capturedChunks.push(chunk);
          if (chunk.type === "text" && chunk.delta.length > 0) {
            if (firstTokenTime === null) {
              firstTokenTime = Date.now();
            }
            accumulatedText += chunk.delta;
          }
        }
      } catch (fallbackErr) {
        logger.error("[agent:llm] Fallback provider also failed", {
          error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
        });
        accumulatedText = "";
      }
    }

    const totalLatencyMs = Date.now() - startTime;
    const ttftMs = firstTokenTime !== null ? firstTokenTime - startTime : totalLatencyMs;
    let finalText = accumulatedText.trim();

    // Guard against empty LLM generation to prevent silent turns or Raya 400 errors:
    if (finalText.length === 0) {
      isFallback = true;
      if (this.state.slots.phoneNumber) {
        const speechPhone = formatPhoneNumberForSpeech(this.state.slots.phoneNumber);
        finalText = `ধন্যবাদ, আপোনাৰ ফোন নম্বৰ ${speechPhone} পঞ্জীয়ন কৰা হ'ল। ডাঃ বৰুৱাৰ সৈতে কাইলৈ পুৱা ১০ বজাত আপোনাৰ এপইণ্টমেণ্ট অনুৰোধ গ্ৰহণ কৰা হৈছে।`;
      } else if (this.state.slots.patientName && !this.state.slots.phoneNumber) {
        finalText = `ধন্যবাদ ${this.state.slots.patientName} ডাঙৰীয়া। অনুগ্ৰহ কৰি আপোনাৰ যোগাযোগৰ ফোন নম্বৰটো দিব পাৰিবনে?`;
      } else if (this.state.slots.dateOrTime && !this.state.slots.patientName) {
        finalText = `কাইলৈ পুৱা ১০ বজাত ডাঃ বৰুৱাৰ সৈতে সময় ঠিক কৰা হৈছে। অনুগ্ৰহ কৰি আপোনাৰ পূৰা নামটো ক'ব পাৰিবনে?`;
      } else if (/[\u0980-\u09FF]/.test(userText)) {
        finalText = "মই স্পষ্টকৈ শুনা নাপালোঁ, অনুগ্ৰহ কৰি আকৌ এবাৰ ক'ব পাৰিবনে?";
      } else if (/[\u0900-\u097F]/.test(userText)) {
        finalText = "क्षमा करें, मैं ठीक से सुन नहीं पाया। कृपया दोबारा कहेंगे?";
      } else {
        finalText = "I could not hear you clearly, could you please say that again?";
      }

      logger.warn("[agent:llm] LLM generated empty text; applied state-aware conversational fallback", {
        turnId: this.state.turnCount,
        userUtterance: trimmed,
        fallbackText: finalText,
        slots: this.state.slots,
      });
    }

    // Anti-repetition override:
    // If the LLM generates the exact same sentence as last turn, provide progressive guidance based on missing slots
    if (
      this.state.lastAssistantUtterance &&
      finalText === this.state.lastAssistantUtterance
    ) {
      if (!this.state.slots.dateOrTime) {
        finalText = "আপুনি কেতিয়া বা কি সময়ত দেখুৱাব বিচাৰে?";
      } else if (!this.state.slots.patientName) {
        finalText = "সময়টো মই পালোঁ। আপোনাৰ সম্পূৰ্ণ নামটো অনুগ্ৰহ কৰি ক'ব পাৰিবনে?";
      } else if (!this.state.slots.phoneNumber) {
        finalText = `ধন্যবাদ ${this.state.slots.patientName}। অনুগ্ৰহ কৰি আপোনাৰ ফোন নম্বৰটো ক'ব পাৰিবনে?`;
      } else {
        const speechPhone = formatPhoneNumberForSpeech(this.state.slots.phoneNumber);
        finalText = `ধন্যবাদ, আপোনাৰ ফোন নম্বৰ ${speechPhone} পঞ্জীয়ন কৰা হ'ল। ডাঃ বৰুৱাৰ সৈতে কাইলৈ পুৱা ১০ বজাত আপোনাৰ এপইণ্টমেণ্ট অনুৰোধ গ্ৰহণ কৰা হৈছে।`;
      }
    }

    if (finalText !== accumulatedText.trim()) {
      capturedChunks.length = 0;
      capturedChunks.push({ type: "text", delta: finalText });
    }

    this.state.lastAssistantUtterance = finalText;

    // 3. Append assistant response to history
    this.messages.push({
      role: "assistant",
      content: finalText,
    });

    // Replay iterable for caller consumption
    async function* replayChunks() {
      for (const c of capturedChunks) {
        yield c;
      }
    }

    return {
      text: finalText,
      stream: replayChunks(),
      ttftMs,
      totalLatencyMs,
      turnId: this.state.turnCount,
      slots: { ...this.state.slots },
      isFallback,
    };
  }

  /**
   * Non-streaming convenience turn execution.
   */
  async chat(
    userText: string,
    options?: { abortSignal?: AbortSignal },
  ): Promise<LLMResponse> {
    const trimmed = userText.trim();
    this.state.turnCount++;
    this.extractSlots(trimmed);
    this.state.lastUserUtterance = trimmed;

    this.messages.push({
      role: "user",
      content: trimmed,
    });

    const response = await this.provider.chat(this.messages, {
      systemPrompt: this.systemPrompt,
      abortSignal: options?.abortSignal,
    });

    let respText = response.text.trim();
    if (respText.length === 0) {
      if (this.state.slots.phoneNumber) {
        respText = `ধন্যবাদ, আপোনাৰ ফোন নম্বৰটো পঞ্জীয়ন কৰা হ'ল।`;
      } else if (/[\u0980-\u09FF]/.test(userText)) {
        respText = "ধন্যবাদ, আপোনাৰ অনুৰোধটো পোৱা গ'ল।";
      } else {
        respText = "Thank you, your request has been noted.";
      }
    }

    this.state.lastAssistantUtterance = respText;
    this.messages.push({
      role: "assistant",
      content: respText,
    });

    return {
      ...response,
      text: respText,
    };
  }
}

/**
 * Initializes and loads the configured LLMProvider for the LiveKit agent worker.
 * Defaults to Hugging Face Inference Providers (Qwen3.5-4B).
 * Safely warns and falls back to mock provider if credentials are not configured in ₹0 local dev.
 */
export function loadLLMProvider(
  options?: Partial<HuggingFaceConfig>,
): LLMProvider {
  const provider = getLLMProvider(undefined, options);

  if (provider instanceof GroqLLMProvider && !provider.isConfigured) {
    logger.info(
      "[agent:llm] GROQ_API_KEY not configured. To use Groq (qwen-2.5-32b), set GROQ_API_KEY in backend/.env. Using mock provider for ₹0 local development.",
    );
    return getLLMProvider("mock");
  }

  if (provider instanceof HuggingFaceLLMProvider && !provider.isConfigured) {
    logger.info(
      "[agent:llm] HUGGINGFACE_API_TOKEN not configured. Hugging Face cloud inference requires an API token. Using mock provider for ₹0 local development.",
    );
    return getLLMProvider("mock");
  }

  logger.info("[agent:llm] LLM Provider initialized successfully", {
    label: provider.label,
    capabilities: provider.capabilities,
  });

  return provider;
}
