import { AgentSession, agentConfigSchema, type SessionStore } from "../components/agent/engine/index.js";
import { z } from "zod";
import { ConversationSession, engineLogger, type ConversationSlots } from "./llm.js";
import { ClinicVoiceSession } from "../components/clinic/voice/session.js";
import type { RuntimeBinding } from "../components/agent/runtime-binding.js";
import type { LLMProvider } from "../components/agent/providers/llm/types.js";
import { db, transactionWithHooks } from "../lib/db/db.js";
import logger from "../lib/logger.js";
import { toolLogger } from "../components/agent/tools/logger.js";

/** Composition root only: database dependencies never enter the reusable engine. */
export async function createBoundVoiceSession(provider: LLMProvider, binding: RuntimeBinding, store: SessionStore) {
  const context = { organizationId: binding.organizationId, agentId: binding.agentId, sessionId: binding.sessionId };
  if (binding.profile.business === "clinic") return ClinicVoiceSession.create(provider, context, {
    callId: binding.callId, conversationId: binding.conversationId, enabledTools: binding.profile.enabledTools,
    deps: { db, transaction: transactionWithHooks, logger }, store, logger: engineLogger, toolLogger,
    ...(binding.profile.contextLimits ? { contextLimits: binding.profile.contextLimits } : {}),
  });
  if (binding.profile.business === "clinic-demo") return new ConversationSession(provider, {
    context, store, roomName: binding.roomName, participantIdentity: binding.participantIdentity,
  });
  const emptyState = z.object({}).strict();
  const engine = new AgentSession(agentConfigSchema.parse({ agentId: context.agentId, name: "Voice assistant", businessName: "Voice sandbox",
    ...(binding.profile.contextLimits ? { contextLimits: binding.profile.contextLimits } : {}),
    instructions: "Help with general conversation. No business tools are enabled; do not claim business actions or availability.", languages: ["as", "hi", "en"] }),
  context, provider, { stateSchema: emptyState, initialState: () => ({}), update: () => ({}), promptContext: () => "" }, { store, logger: engineLogger });
  const slots: ConversationSlots = {};
  return { ready: engine.ready, getState: () => ({ ...engine.getState(), slots }), getSlots: () => slots, getSnapshot: () => engine.getSnapshot(),
    isCollectingPhoneNumber: () => false, close: () => engine.close(), notifyInterruption: (id: number) => engine.notifyInterruption(id),
    notifyPlaybackResult: (id: number, completed: boolean) => engine.notifyPlaybackResult(id, completed),
    processRecovery: async (reason: import("../components/agent/engine/state.js").RecoveryReason, options: Parameters<typeof engine.processRecovery>[1]) => ({ ...await engine.processRecovery(reason, options), slots }),
    processUserUtterance: async (text: string, options: Parameters<typeof engine.processUserUtterance>[1]) => ({ ...await engine.processUserUtterance(text, options), slots }),
  };
}
