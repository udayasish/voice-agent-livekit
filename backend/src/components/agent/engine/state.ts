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
/** Server-owned domain behavior. State is validated after every transition. */
export interface BusinessBehavior<T> {
  stateSchema: z.ZodType<T>;
  initialState(): T;
  update(text: string, state: DeepReadonly<T>): T;
  promptContext(state: DeepReadonly<T>): string;
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
