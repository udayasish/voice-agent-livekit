import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AgentSession } from "../src/components/agent/engine/index.js";
import { ToolRegistry, createServerTimeTool, toolLogger } from "../src/components/agent/tools/index.js";
import { ScriptedProvider } from "./helpers/scripted-provider.js";

const provider = new ScriptedProvider((messages, call) => {
  if (call === 1) return [{ type: "tool_call", toolCall: { id: "clock_1", name: "get_server_time", arguments: "{}" } }, { type: "done" }];
  const result = z.object({ success: z.literal(true), data: z.object({ timestamp: z.string(), timezone: z.literal("UTC") }) })
    .parse(JSON.parse(messages.find(message => message.role === "tool")?.content ?? "null"));
  return [{ type: "text", delta: `The server time is ${result.data.timestamp} (${result.data.timezone}).` }, { type: "done" }];
});
const session = new AgentSession({ agentId: "tool-smoke", name: "Tool test", businessName: "Offline demo",
  instructions: "Use get_server_time for the current server time.", languages: ["en"], defaultLanguage: "en", enabledTools: ["get_server_time"] },
{ organizationId: randomUUID(), agentId: "tool-smoke", sessionId: randomUUID() }, provider,
{ stateSchema: z.object({}).strict(), initialState: () => ({}), update: () => ({}), promptContext: () => "" },
{ tools: { registry: new ToolRegistry([createServerTimeTool()]), callId: randomUUID(), conversationId: randomUUID(), logger: toolLogger } });
try {
  const result = await session.processUserUtterance("What is the current server time?");
  if (result.isFallback || session.getState().toolHistory.length !== 1) throw new Error("Tool smoke test failed");
  console.log(result.text);
} finally { await session.close(); }
