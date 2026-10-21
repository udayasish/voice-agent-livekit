import { tool } from "@openai/agents";
import { ToolExecutor, toolExecutionContextSchema } from "./executor.js";
import type { ToolRegistry } from "./registry.js";
import type { SessionContext } from "../engine/config.js";
import type { ToolResult } from "./types.js";

export function sdkTools(registry: ToolRegistry, enabled: readonly string[], executor: ToolExecutor) {
  type Parameters = { type: "object"; properties: Record<string, Record<string, unknown>>; required: string[]; additionalProperties: false };
  return registry.enabled(enabled).map(definition => {
    const adapted = tool<Parameters, SessionContext, ToolResult>({
    name: definition.name, description: definition.description,
    parameters: definition.parameters as Parameters, strict: true,
    execute: (input, run, details) => {
      executor.signal.throwIfAborted();
      const trusted = toolExecutionContextSchema.safeParse(run?.context);
      if (!trusted.success || Object.entries(executor.context).some(([key, value]) => trusted.data[key as keyof typeof trusted.data] !== value)) {
        return executor.invalidContext(definition.name);
      }
      const id = details?.toolCall?.callId ?? "invalid";
      return executor.execute(definition.name, input, id).then(result => executor.modelResult(id, result));
    },
    errorFunction: () => {
      executor.signal.throwIfAborted();
      return JSON.stringify(executor.invalidInput(definition.name));
    },
    });
    // SDK's factory type couples strict:false to additionalProperties:true.
    // Keep our closed JSON schema and set only the public wire-mode metadata;
    // all execution validation remains in the executor in either mode.
    return Object.freeze({ ...adapted, strict: definition.strict });
  });
}
