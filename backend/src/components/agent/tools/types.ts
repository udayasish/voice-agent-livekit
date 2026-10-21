import type { z } from "zod";
import type { SessionContext } from "../engine/config.js";
import type { ToolRegistry } from "./registry.js";

export type ToolResult<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string } };
/** Server-owned context. Never assembled from model arguments. */
export type ToolContext = Readonly<SessionContext & {
  callId: string; conversationId: string; turnId: number; invocationId: string; signal: AbortSignal;
}>;
export type ToolDefinition<I, O> = {
  name: string; description: string; inputSchema: z.ZodType<I>; outputSchema: z.ZodType<O>;
  execute(input: I, context: ToolContext): Promise<ToolResult<O>>;
  modelOutputSchema?: z.ZodType;
  projectOutput?: (output: O, input: I) => unknown;
};
export type ToolEvent = "tool_started" | "tool_completed" | "tool_rejected" | "tool_failed" | "tool_cancelled" | "tool_timeout";
export interface ToolLogger { event(event: ToolEvent, metadata: Readonly<Record<string, string | number | boolean>>): void; }
export interface ToolInvocation { name: string; invocationId: string; arguments: string; result: ToolResult; modelResult?: ToolResult; }
export interface ToolRuntime {
  registry: ToolRegistry;
  callId: string;
  conversationId: string;
  logger?: ToolLogger;
  limits?: { maxCalls?: number; timeoutMs?: number };
}
