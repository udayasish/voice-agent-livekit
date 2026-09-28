import type { ZodSchema } from "zod";

export type ToolContext = {
  organizationId: string;
  agentId: string;
  callId: string;
  conversationId: string;
};

export type ToolResult =
  | { success: true; data: unknown }
  | { success: false; error: { code: string; message: string } };

export type ToolDefinition<TInput = unknown> = {
  name: string;
  description: string;
  inputSchema: ZodSchema<TInput>;
  execute: (input: TInput, context: ToolContext) => Promise<ToolResult>;
};

export type RegisteredTool = ToolDefinition & {
  phase: number;
};
