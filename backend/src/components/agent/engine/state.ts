import type { z } from "zod";
import type { AgentLanguage, SessionContext } from "./config.js";
import type { ToolInvocation } from "../tools/types.js";

export type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export function snapshot<T>(value: T): DeepReadonly<T> {
  const copy: T = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (item !== null && typeof item === "object") {
      Object.values(item).forEach(freeze);
      Object.freeze(item);
    }
  };
  freeze(copy);
  return copy as DeepReadonly<T>;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  turnId: number;
  interrupted: boolean;
}
export interface ConversationState<T> {
  memory?: { coveredTurn: number; notes: Array<{ text: string; sourceTurn: number }> };
  contextBoundary?: number;
  history: ConversationMessage[];
  toolHistory: Array<ToolInvocation & { turnId: number; interrupted: boolean }>;
  language: AgentLanguage;
  businessState: T;
  lastUserUtterance: string | undefined;
  lastAssistantUtterance: string | undefined;
  repetitionCount: number;
}
export interface SessionState {
  status: "active" | "closed";
  turnCount: number;
  activeTurnId: number | undefined;
  createdAt: string;
  updatedAt: string;
}
export interface SessionSnapshot<T> {
  context: SessionContext;
  session: SessionState;
  conversation: ConversationState<T>;
}
export type ReplySource = "model" | "verified_tool" | "recovery";
export type RecoveryReason = "speech_unclear" | "no_transcript" | "no_input" | "provider_failure";
export interface TurnPreparationContext {
  turnId: number;
  signal: AbortSignal;
  language: AgentLanguage;
  history: DeepReadonly<ConversationMessage[]>;
}
export interface PreparedTurn {
  failureCategory?: string;
  initialToolCall?: { name: string; arguments: unknown };
  allowedTools?: readonly string[];
  reply?: { text: string; source: ReplySource };
}
export interface BusinessResponseInput<T> {
  text: string; userText: string; language: AgentLanguage; state: DeepReadonly<T>;
  isFallback: boolean; repeated: boolean; previousResponse: string | undefined;
}
/** Server-owned domain behavior. State is validated after every transition. */
export interface BusinessBehavior<T> {
  /** Domain acknowledgements/readbacks may intentionally repeat a verified result. */
  allowRepeatedResponses?: boolean;
  onTurn?(text: string, turnId: number, context?: TurnPreparationContext): void | PreparedTurn | Promise<void | PreparedTurn>;
  contextBoundary?(): number;
  /** Optional safe source projection for background notes; omit private domain data. */
  memoryInput?(history: DeepReadonly<ConversationMessage[]>): ConversationMessage[];
  preparedReply?(language: AgentLanguage): { text: string; source: ReplySource } | undefined;
  onRecovery?(reason: RecoveryReason, turnId: number): void;
  onPlaybackResult?(turnId: number, completed: boolean): void;
  onInterruption?(turnId: number): void;
  onReset?(): void;
  onClose?(): void;
  stateSchema: z.ZodType<T>;
  initialState(): T;
  update(text: string, state: DeepReadonly<T>): T;
  promptContext(state: DeepReadonly<T>): string;
  verifiedContext?(state: DeepReadonly<T>): string;
  /** Optional richer policy, preserving the legacy string response hook. */
  respond?(input: BusinessResponseInput<T>): { text: string; source: ReplySource };
  /** Record server-approved dialogue context after the final reply, before persisting it. */
  onResponse?(text: string, state: DeepReadonly<T>): T;
  response?(input: {
    text: string;
    userText: string;
    language: AgentLanguage;
    state: DeepReadonly<T>;
    isFallback: boolean;
    repeated: boolean;
    previousResponse: string | undefined;
  }): string;
}
