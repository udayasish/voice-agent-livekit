import { randomUUID } from "node:crypto";
import env from "../lib/env.js";
import logger from "../lib/logger.js";
import { getLLMProvider, HuggingFaceLLMProvider, GroqLLMProvider,
  type LLMProvider, type HuggingFaceConfig } from "../components/agent/providers/llm/index.js";
import { AgentSession, buildPrompt, type SessionContext, type SessionStore, type EngineLogger,
  type TurnOptions } from "../components/agent/engine/index.js";
import { clinicDemoBehavior, createClinicDemoConfig, type ClinicDemoState } from "../components/agent/business/clinic-demo.js";

export { extractSlotsFromText, detectRepetition, type ConversationSlots } from "../components/agent/business/clinic-demo.js";
export function createVoiceSystemPrompt(clinicName = env.CLINIC_NAME): string {
  return buildPrompt(createClinicDemoConfig(clinicName), "as");
}
export const DEFAULT_VOICE_SYSTEM_PROMPT = createVoiceSystemPrompt();
export const engineLogger: EngineLogger = {
  event: (event, context, metadata) => {
    const level = event === "provider_failed" || event === "provider_empty_output" || event === "storage_failed" ? "warn" : "info";
    logger.log(level, "Agent engine lifecycle", { event, ...context, ...metadata });
  },
};

/** Compatibility adapter for the clinic sandbox. Orchestration lives in AgentSession. */
export class ConversationSession {
  private readonly engine: AgentSession<ClinicDemoState>;
  readonly roomName: string;
  readonly participantIdentity: string;
  constructor(provider: LLMProvider, options: {
    roomName: string; participantIdentity: string; systemPrompt?: string | undefined; clinicName?: string | undefined;
    context?: SessionContext; store?: SessionStore;
  }) {
    this.roomName = options.roomName;
    this.participantIdentity = options.participantIdentity;
    const context = options.context ?? { organizationId: "offline-demo", agentId: "clinic-demo", sessionId: randomUUID() };
    const config = createClinicDemoConfig(options.clinicName ?? env.CLINIC_NAME, context.agentId);
    if (options.systemPrompt) config.instructions = options.systemPrompt;
    this.engine = new AgentSession(config, context, provider, clinicDemoBehavior,
      { ...(options.store ? { store: options.store } : {}), logger: engineLogger });
  }
  get ready() { return this.engine.ready; }
  getHistory() { return this.engine.getHistory(); }
  getSnapshot() { return this.engine.getSnapshot(); }
  getState() {
    const state = this.engine.getState();
    return { slots: state.businessState.slots, turnCount: this.engine.getSnapshot().session.turnCount,
      lastUserUtterance: state.lastUserUtterance, lastAssistantUtterance: state.lastAssistantUtterance,
      repetitionCount: state.repetitionCount };
  }
  getSlots() { return this.engine.getState().businessState.slots; }
  isCollectingPhoneNumber() { return this.engine.getState().businessState.lastQuestion === "phoneNumber"; }
  clearHistory() { return this.engine.reset(); }
  close() { return this.engine.close(); }
  notifyInterruption(turnId: number) { return this.engine.notifyInterruption(turnId); }
  notifyPlaybackResult(turnId: number, completed: boolean) { return this.engine.notifyPlaybackResult(turnId, completed); }
  async processRecovery(reason: import("../components/agent/engine/state.js").RecoveryReason, options: TurnOptions = {}) {
    const result = await this.engine.processRecovery(reason, options); return { ...result, slots: result.businessState.slots };
  }
  async processUserUtterance(text: string, options: TurnOptions = {}) {
    const result = await this.engine.processUserUtterance(text, {
      ...(this.isCollectingPhoneNumber() ? { responseLanguage: this.engine.getState().language } : {}), ...options,
    });
    return { ...result, slots: result.businessState.slots };
  }
  chat(text: string, options: TurnOptions = {}) { return this.engine.chat(text, options); }
}
export function loadLLMProvider(options?: Partial<HuggingFaceConfig>): LLMProvider {
  const provider = getLLMProvider(undefined, options);
  if ((provider instanceof GroqLLMProvider || provider instanceof HuggingFaceLLMProvider) && !provider.isConfigured) {
    logger.info("LLM credentials unavailable; using offline provider");
    return getLLMProvider("mock");
  }
  logger.info("LLM provider initialized", { label: provider.label });
  return provider;
}
