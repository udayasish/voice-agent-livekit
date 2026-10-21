import { z } from "zod";
import { BadRequestError, ConflictError } from "../../../lib/errors.js";
import type { ToolDefinition, ToolContext, ToolResult } from "./types.js";

export const toolNameSchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/u);
export const invalidJsonArgument = "__invalid_tool_json__";
const resultFailureSchema = z.object({ success: z.literal(false), error: z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/u), message: z.string().min(1).max(300),
}).strict() }).strict();
const json = z.json();
const definitions = new WeakSet<RegisteredTool>();
export const toolFailure = (code: string, message: string): ToolResult<never> => ({ success: false, error: { code, message } });

export interface RegisteredTool {
  readonly name: string; readonly description: string; readonly parameters: Readonly<Record<string, unknown>>;
  readonly strict: boolean;
  validate(input: unknown): unknown;
  invokeValidated(input: unknown, context: ToolContext): Promise<ToolResult>;
  projectValidated(result: ToolResult, input: unknown): ToolResult;
}
/** Capture typed handlers before erasing types in a heterogeneous registry. */
export function defineTool<I, O>(definition: ToolDefinition<I, O>): RegisteredTool {
  const name = toolNameSchema.parse(definition.name);
  const description = z.string().trim().min(1).max(1000).parse(definition.description);
  if (!(definition.inputSchema instanceof z.ZodObject)) throw new BadRequestError("Tool input must be an object schema", "INVALID_TOOL_DEFINITION");
  const inputSchema = definition.inputSchema.strict();
  const reserved = new Set(["organizationId", "agentId", "sessionId", "callId", "conversationId", "turnId", "invocationId", "signal", invalidJsonArgument]);
  if (Object.keys(inputSchema.shape).some(key => reserved.has(key))) throw new BadRequestError("Tool context cannot be supplied in arguments", "INVALID_TOOL_DEFINITION");
  const outputSchema = definition.outputSchema;
  const execute = definition.execute;
  if (Boolean(definition.projectOutput) !== Boolean(definition.modelOutputSchema)) throw new BadRequestError("Projection requires a schema", "INVALID_TOOL_DEFINITION");
  if (typeof execute !== "function" || !(outputSchema instanceof z.ZodType)) throw new BadRequestError("Invalid tool handler or output schema", "INVALID_TOOL_DEFINITION");
  const parameters = z.toJSONSchema(inputSchema, { io: "input" });
  // Provider strict mode requires every object property to be required. Optional
  // Zod inputs still use our strict validation, but need non-strict wire mode.
  const supportsStrict = (value: unknown): boolean => {
    if (!value || typeof value !== "object") return true;
    if ("type" in value && value.type === "object") {
      const schema = value as Record<string, unknown>;
      const properties = schema["properties"];
      const required = schema["required"];
      if (schema["additionalProperties"] !== false || !properties || typeof properties !== "object"
        || Object.keys(properties).some(key => !Array.isArray(required) || !required.includes(key))) return false;
    }
    return Object.values(value).every(supportsStrict);
  };
  const strict = supportsStrict(parameters);
  const freeze = (value: unknown): void => {
    if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  };
  freeze(parameters);
  const registered: RegisteredTool = Object.freeze({ name, description, parameters, strict,
    projectValidated: (result: ToolResult, input: unknown): ToolResult => {
      if (!result.success || !definition.projectOutput || !definition.modelOutputSchema) return structuredClone(result);
      const data = definition.modelOutputSchema.parse(definition.projectOutput(result.data as O, input as I));
      return { success: true, data: json.parse(data) };
    },
    validate: (input: unknown) => inputSchema.parse(json.parse(input)),
    invokeValidated: async (input: unknown, context: ToolContext): Promise<ToolResult> => {
      // Only the executor passes the value returned by validate, including transformations.
      const result: unknown = await execute(input as I, context);
      if (!result || typeof result !== "object" || !("success" in result)) return toolFailure("INVALID_TOOL_OUTPUT", "The tool returned an invalid result.");
      if (result.success === false) {
        const parsed = resultFailureSchema.safeParse(result);
        return parsed.success ? parsed.data : toolFailure("INVALID_TOOL_OUTPUT", "The tool returned an invalid result.");
      }
      if (result.success !== true || !("data" in result) || Object.keys(result).some(key => key !== "success" && key !== "data")) return toolFailure("INVALID_TOOL_OUTPUT", "The tool returned an invalid result.");
      try {
        const parsed = outputSchema.safeParse(result.data);
        if (!parsed.success || !json.safeParse(parsed.data).success) return toolFailure("INVALID_TOOL_OUTPUT", "The tool returned an invalid result.");
        return { success: true, data: structuredClone(parsed.data) };
      } catch { return toolFailure("INVALID_TOOL_OUTPUT", "The tool returned an invalid result."); }
    },
  });
  definitions.add(registered);
  return registered;
}
export class ToolRegistry {
  readonly #entries = new Map<string, RegisteredTool>();
  constructor(tools: readonly RegisteredTool[]) {
    for (const tool of tools) {
      toolNameSchema.parse(tool.name);
      if (!definitions.has(tool)) throw new BadRequestError("Use defineTool to register a validated definition", "INVALID_TOOL_DEFINITION");
      if (this.#entries.has(tool.name)) throw new ConflictError("Duplicate tool name", "DUPLICATE_TOOL_NAME");
      this.#entries.set(tool.name, tool);
    }
    Object.freeze(this);
  }
  get(name: string): RegisteredTool | undefined { return this.#entries.get(name); }
  enabled(names: readonly string[]): readonly RegisteredTool[] {
    if (new Set(names).size !== names.length) throw new BadRequestError("Duplicate enabled tool", "INVALID_TOOL_CONFIGURATION");
    return Object.freeze(names.map(name => {
      const tool = this.get(name);
      if (!tool) throw new BadRequestError("Enabled tool is not registered", "INVALID_TOOL_CONFIGURATION");
      return tool;
    }));
  }
}
