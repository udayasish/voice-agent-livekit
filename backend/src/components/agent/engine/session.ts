import { Agent, Runner, setTracingDisabled, setTraceProcessors, type AgentInputItem } from "@openai/agents";
import { agentConfigSchema, sessionContextSchema, languageSchema, type AgentLanguage, type AgentConfig, type AgentConfigInput, type SessionContext } from "./config.js";
import { snapshot, type BusinessBehavior, type ConversationState, type SessionSnapshot, type SessionState } from "./state.js";
import { buildPrompt, detectLanguage } from "./prompts.js";
import { applyResponsePolicy, normalizeSpokenText, recoveryResponse, replayResponse } from "./response-policy.js";
import { MemorySessionStore, type SessionStore } from "./store.js";
import { silentEngineLogger, type EngineLogger } from "./lifecycle.js";
import { ProviderModel } from "../providers/llm/agents-model.js";
import type { LLMChunk, LLMProvider, LLMResponse } from "../providers/llm/types.js";

// This application owns observability through Winston; never export caller data to SDK tracing.
setTracingDisabled(true);
setTraceProcessors([]);

export interface AgentResponse<T> {
  text: string;
  stream: AsyncIterable<LLMChunk>;
  ttftMs: number;
  totalLatencyMs: number;
  turnId: number;
  isFallback: boolean;
  fallbackReason: "empty_output" | "provider_error" | "repeated_response" | undefined;
  businessState: T;
}
export interface TurnOptions {
  /** Keep reply language independent from a specialized input recognizer. */
  responseLanguage?: AgentLanguage;
  abortSignal?: AbortSignal;
  turnId?: number;
  maxTokens?: number;
  temperature?: number;
}
export class AgentSession<T> {
  readonly config: AgentConfig;
  readonly context: SessionContext;
  private conversation: ConversationState<T>;
  private session: SessionState;
  private active: { turnId: number; controller: AbortController } | undefined;
  private writes: Promise<void> = Promise.resolve();
  private closePromise: Promise<void> | undefined;
  private readonly store: SessionStore;
  private readonly log: EngineLogger;
  private readonly runner = new Runner({ tracingDisabled: true });
  readonly ready: Promise<void>;

  constructor(config: AgentConfigInput, context: SessionContext, private readonly provider: LLMProvider,
    private readonly behavior: BusinessBehavior<T>, dependencies: { store?: SessionStore; logger?: EngineLogger } = {}) {
    this.config = agentConfigSchema.parse(config);
    this.context = Object.freeze(sessionContextSchema.parse(context));
    if (this.config.agentId !== this.context.agentId) throw new Error("Agent context does not match configuration");
    this.config = snapshot(this.config) as AgentConfig;
    this.store = dependencies.store ?? new MemorySessionStore();
    this.log = dependencies.logger ?? silentEngineLogger;
    const now = new Date().toISOString();
    this.session = { status: "active", turnCount: 0, activeTurnId: undefined, createdAt: now, updatedAt: now };
    this.conversation = this.initialConversation();
    this.ready = this.persist();
    // Constructor callers may await ready later; failure still closes the session.
    void this.ready.catch(() => {});
    this.log.event("session_started", this.context);
  }
  private initialConversation(): ConversationState<T> {
    return { history: [], language: this.config.defaultLanguage,
      businessState: this.behavior.stateSchema.parse(this.behavior.initialState()),
      lastUserUtterance: undefined, lastAssistantUtterance: undefined, repetitionCount: 0 };
  }
  getState() { return snapshot(this.conversation); }
  getHistory() { return snapshot(this.conversation.history); }
  getSnapshot() { return snapshot({ context: this.context, session: this.session, conversation: this.conversation }); }
  private ensureOpen(): void { if (this.session.status === "closed") throw new Error("Agent session is closed"); }
  private current(turnId: number, signal: AbortSignal): void {
    signal.throwIfAborted();
    this.ensureOpen();
    if (this.session.activeTurnId !== turnId) throw new DOMException("Turn superseded", "AbortError");
  }
  private persist(): Promise<void> {
    this.session.updatedAt = new Date().toISOString();
    const state: SessionSnapshot<T> = structuredClone({ context: this.context, session: this.session, conversation: this.conversation });
    const operation = this.writes.then(async () => {
      if (this.session.status === "closed") return;
      try { await this.store.save(state); }
      catch {
        this.session.status = "closed";
        this.active?.controller.abort();
        this.active = undefined;
        this.session.activeTurnId = undefined;
        this.log.event("storage_failed", this.context);
        try { await this.store.delete(this.context); } catch { /* TTL bounds retention after storage outage. */ }
        this.log.event("session_closed", this.context);
        throw new Error("Agent session storage failed");
      }
    });
    this.writes = operation.catch(() => {});
    return operation;
  }
  async notifyInterruption(turnId: number): Promise<void> {
    if (this.session.status === "closed") return;
    if (this.active?.turnId === turnId) this.active.controller.abort();
    for (const message of this.conversation.history) if (message.turnId === turnId && message.role === "assistant") message.interrupted = true;
    this.log.event("turn_interrupted", this.context, { turnId });
    await this.persist();
  }
  async reset(): Promise<void> {
    this.ensureOpen();
    this.active?.controller.abort();
    this.active = undefined;
    this.session.activeTurnId = undefined;
    // Keep monotonically increasing IDs so late results cannot match a reset session.
    this.conversation = this.initialConversation();
    await this.persist();
    this.log.event("session_reset", this.context);
  }
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.session.status = "closed";
    this.active?.controller.abort();
    this.active = undefined;
    this.session.activeTurnId = undefined;
    this.closePromise = this.writes.then(async () => {
      try { await this.store.delete(this.context); }
      catch { this.log.event("storage_failed", this.context); throw new Error("Agent session cleanup failed"); }
      finally { this.log.event("session_closed", this.context); }
    });
    return this.closePromise;
  }
  async processUserUtterance(userText: string, options: TurnOptions = {}): Promise<AgentResponse<T>> {
    this.ensureOpen();
    const text = userText.trim();
    if (!text) throw new Error("User utterance cannot be empty");
    const responseLanguage = options.responseLanguage === undefined
      ? detectLanguage(text, this.config, this.conversation.language) : languageSchema.parse(options.responseLanguage);
    if (!this.config.languages.includes(responseLanguage)) throw new Error("Response language must be supported");
    options.abortSignal?.throwIfAborted();
    const turnId = options.turnId ?? this.session.turnCount + 1;
    if (!Number.isSafeInteger(turnId) || turnId <= this.session.turnCount) throw new Error("Turn IDs must increase");
    const nextBusiness = this.behavior.stateSchema.parse(this.behavior.update(text, snapshot(this.conversation.businessState)));
    if (this.active) {
      for (const message of this.conversation.history) {
        if (message.role === "assistant" && message.turnId === this.active.turnId) message.interrupted = true;
      }
    }
    this.active?.controller.abort();
    const controller = new AbortController();
    this.active = { turnId, controller };
    const abort = () => controller.abort();
    options.abortSignal?.addEventListener("abort", abort, { once: true });
    const signal = controller.signal;
    this.session.turnCount = turnId;
    this.session.activeTurnId = turnId;
    this.conversation.language = responseLanguage;
    this.conversation.repetitionCount = text === this.conversation.lastUserUtterance ? this.conversation.repetitionCount + 1 : 0;
    this.conversation.lastUserUtterance = text;
    this.conversation.businessState = nextBusiness;
    this.conversation.history.push({ role: "user", content: text, turnId, interrupted: false });
    const turnState = structuredClone(this.conversation);
    const started = Date.now();
    let firstToken: number | undefined;
    let isFallback = false;
    let fallbackReason: AgentResponse<T>["fallbackReason"];
    this.log.event("turn_started", this.context, { turnId });
    try {
      await this.ready;
      await this.persist();
      this.current(turnId, signal);
      const model = new ProviderModel(this.provider, () => { firstToken ??= Date.now(); });
      const settings = this.config.modelSettings;
      const agent = new Agent<SessionContext>({ name: this.config.name, model,
        instructions: buildPrompt(this.config, turnState.language, this.behavior.promptContext(snapshot(nextBusiness))),
        modelSettings: { temperature: options.temperature ?? settings.temperature,
          maxTokens: options.maxTokens ?? settings.maxTokens,
          providerData: { model: settings.model } }, tools: [],
      });
      const input: AgentInputItem[] = turnState.history.filter(m => !m.interrupted).map(m => m.role === "user"
        ? { role: "user", content: m.content }
        : { role: "assistant", status: "completed", content: [{ type: "output_text", text: m.content }] });
      let generated = "";
      try {
        // A text-only turn may safely retry once; no business action can run in Phase 14.
        for (let attempt = 1; attempt <= 2; attempt++) {
          this.current(turnId, signal);
          const result = await this.runner.run(agent, input, { context: this.context, signal, maxTurns: 1 });
          generated = result.finalOutput ?? "";
          if (normalizeSpokenText(generated)) break;
          this.log.event("provider_empty_output", this.context, { turnId, attempt, finishReason: model.finishReason ?? "unknown",
            completionTokens: model.usage?.completionTokens ?? 0 });
        }
        isFallback = !normalizeSpokenText(generated);
        if (isFallback) fallbackReason = "empty_output";
      } catch {
        this.current(turnId, signal);
        isFallback = true;
        fallbackReason = "provider_error";
        this.log.event("provider_failed", this.context, { turnId });
      }
      this.current(turnId, signal);
      let finalText = applyResponsePolicy(generated, this.config, turnState.language);
      if (isFallback) finalText = recoveryResponse(this.config, turnState.language, turnState.lastAssistantUtterance);
      const repeated = finalText === turnState.lastAssistantUtterance;
      if (this.behavior.response) finalText = applyResponsePolicy(this.behavior.response({
        text: finalText, userText: text, language: turnState.language, state: snapshot(nextBusiness), isFallback, repeated,
        previousResponse: turnState.lastAssistantUtterance,
      }), this.config, turnState.language);
      if (finalText === turnState.lastAssistantUtterance) {
        finalText = recoveryResponse(this.config, turnState.language, turnState.lastAssistantUtterance);
        isFallback = true; fallbackReason ??= "repeated_response";
      }
      this.current(turnId, signal);
      const completedBusiness = this.behavior.onResponse
        ? this.behavior.stateSchema.parse(this.behavior.onResponse(finalText, snapshot(nextBusiness))) : nextBusiness;
      this.conversation.businessState = completedBusiness;
      this.conversation.history.push({ role: "assistant", content: finalText, turnId, interrupted: false });
      this.conversation.lastAssistantUtterance = finalText;
      await this.persist();
      this.current(turnId, signal);
      const totalLatencyMs = Date.now() - started;
      const ttftMs = (firstToken ?? Date.now()) - started;
      this.log.event("turn_completed", this.context, { turnId, ttftMs, totalLatencyMs, isFallback, fallbackReason: fallbackReason ?? "none" });
      return { text: finalText, stream: replayResponse(finalText), turnId, ttftMs, totalLatencyMs, isFallback, fallbackReason,
        businessState: structuredClone(completedBusiness) };
    } finally {
      options.abortSignal?.removeEventListener("abort", abort);
      if (signal.aborted && this.session.status !== "closed") {
        const reply = this.conversation.history.find(m => m.turnId === turnId && m.role === "assistant");
        if (reply && !reply.interrupted) { reply.interrupted = true; await this.persist(); }
      }
      if (this.active?.turnId === turnId) this.active = undefined;
    }
  }
  async chat(text: string, options: TurnOptions = {}): Promise<LLMResponse> {
    const result = await this.processUserUtterance(text, options);
    return { text: result.text, role: "assistant", latencyMs: result.totalLatencyMs };
  }
}
