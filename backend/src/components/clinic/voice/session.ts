import { AgentSession, agentConfigSchema, type AgentConfigInput, type EngineLogger, type SessionContext, type SessionStore, type TurnOptions, type RecoveryReason } from "../../agent/engine/index.js";
import { createConfirmationInterpreter, type ConfirmationInterpreter } from "./interpreter.js";
import type { LLMProvider } from "../../agent/providers/llm/types.js";
import type { ToolLogger } from "../../agent/tools/types.js";
import type { ClinicDependencies } from "../index.js";
import { createClinicServices } from "../index.js";
import { ClinicVoiceRuntime } from "./runtime.js";
import { createIntakeInterpreter, type IntakeInterpreter } from "./intake.js";

export class ClinicVoiceSession {
  private constructor(private readonly runtime: ClinicVoiceRuntime, private readonly engine: AgentSession<ReturnType<ClinicVoiceRuntime["snapshot"]>>) {}
  static async create(provider: LLMProvider, context: SessionContext, options: {
    callId: string; conversationId: string; enabledTools: string[]; deps: ClinicDependencies;
    store?: SessionStore; logger?: EngineLogger; toolLogger?: ToolLogger;
    interpreter?: ConfirmationInterpreter;
    intakeInterpreter?: IntakeInterpreter;
    contextLimits?: AgentConfigInput["contextLimits"];
  }) {
    const info = await createClinicServices({ organizationId: context.organizationId, source: "voice", callId: options.callId }, options.deps).resolveClinic();
    if (!info.success) throw new Error("Clinic voice session is unavailable");
    const runtime = new ClinicVoiceRuntime(context, options.callId, options.conversationId, options.deps, info.data.timezone,
      options.interpreter ?? createConfirmationInterpreter(provider, (category, durationMs, turnId) => options.logger?.event("interpretation_completed", context, { category, durationMs, ...(turnId !== undefined ? { turnId } : {}) })),
      options.intakeInterpreter ?? createIntakeInterpreter(provider, (category, durationMs, turnId, details) => options.logger?.event("interpretation_completed", context, { category, durationMs, turnId, stage: "intake", ...details })), options.enabledTools);
    const config = agentConfigSchema.parse({ agentId: context.agentId, name: "Clinic receptionist", businessName: info.data.name,
      languages: ["as", "hi", "en"], defaultLanguage: "as", enabledTools: options.enabledTools,
      ...(options.contextLimits ? { contextLimits: options.contextLimits } : {}),
      modelSettings: { temperature: 0.2, maxTokens: 384 },
      instructions: `Clinic receptionist; no patient login. ONE short sentence and ONE next question, at most 28 words; no repeated requests, specialty or collected details. Critical readbacks are separate. Greet before collecting details. Public reads precede intake. Use reviewed names; a unique doctor match advances to date. Follow verified nextField; keep selected doctor and name/age through selection changes. Ask only missing/disputed details; preserve spelling. A confirmed phone stays confirmed: never ask to dictate or confirm it again unless the caller changes it. resolve_clinic_and_caller takes only {} and uses server state. Rejected/incomplete ages need clarification or individual digits. Availability defaults to selectedDoctor; offer at most three returned options, nextOffset for more. Failed reads keep the task, not a new menu. Details are candidates until readback. When ready and asked to book, CALL book_appointment mode prepare with retained details; never confirm in that turn. Only booked/cancelled results confirm actions. No automatic alternative booking. Existing appointment access requires confirmed phone plus token/date. Unconfigured notifications are not sent. No rescheduling/transfer.`,
    });
    const engine = new AgentSession(config, context, provider, runtime.behavior, {
      ...(options.store ? { store: options.store } : {}), ...(options.logger ? { logger: options.logger } : {}),
      tools: { registry: runtime.registry, callId: options.callId, conversationId: options.conversationId,
        ...(options.toolLogger ? { logger: options.toolLogger } : {}) },
    });
    await engine.ready;
    return new ClinicVoiceSession(runtime, engine);
  }
  get ready() { return this.engine.ready; }
  getHistory() { return this.engine.getHistory(); }
  getSnapshot() { return this.engine.getSnapshot(); }
  getState() { const state = this.engine.getState(); return { ...state, slots: this.runtime.snapshot().slots }; }
  getSlots() { return this.runtime.snapshot().slots; }
  isCollectingPhoneNumber() { return this.runtime.snapshot().collectingPhone; }
  clearHistory() { return this.engine.reset(); }
  close() { return this.engine.close(); }
  notifyInterruption(turnId: number) { return this.engine.notifyInterruption(turnId); }
  notifyPlaybackResult(turnId: number, completed: boolean) { return this.engine.notifyPlaybackResult(turnId, completed); }
  getVoiceDiagnostics() { return { confirmationStage: this.runtime.getConfirmationStage() }; }
  async processRecovery(reason: RecoveryReason, options: TurnOptions = {}) {
    const result = await this.engine.processRecovery(reason, { responseLanguage: this.engine.getState().language, ...options });
    const state = this.runtime.snapshot(); return { ...result, slots: state.slots, selectedDoctor: state.dialogue.selectedDoctor };
  }
  async processUserUtterance(text: string, options: TurnOptions = {}) {
    options.abortSignal?.throwIfAborted();
    const requestedLanguage = /speak.*english|in english|ইংৰাজীত/iu.test(text) ? "en" : /speak.*hindi|in hindi|হিন্দীত/iu.test(text) ? "hi" : /assamese|অসমীয়াত/iu.test(text) ? "as" : this.engine.getState().language;
    const result = await this.engine.processUserUtterance(text, { responseLanguage: requestedLanguage, ...options });
    const state = this.runtime.snapshot();
    return { ...result, slots: state.slots, selectedDoctor: state.dialogue.selectedDoctor };
  }
}
