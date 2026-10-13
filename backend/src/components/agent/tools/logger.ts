import logger from "../../../lib/logger.js";
import type { ToolLogger } from "./types.js";

export const toolLogger: ToolLogger = { event: (event, metadata) => {
  const allowed = new Set(["organizationId", "agentId", "sessionId", "callId", "conversationId", "turnId", "invocationId", "toolName", "durationMs", "code"]);
  logger.log(event === "tool_failed" || event === "tool_timeout" ? "warn" : "info", "Agent tool lifecycle", {
    event, ...Object.fromEntries(Object.entries(metadata).filter(([key]) => allowed.has(key))),
  });
} };
