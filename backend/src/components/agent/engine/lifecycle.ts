import type { SessionContext } from "./config.js";

export type EngineEvent = "session_started" | "session_reset" | "session_closed" | "turn_started"
  | "turn_completed" | "turn_interrupted" | "provider_failed" | "provider_empty_output" | "storage_failed";
export interface EngineLogger {
  event(event: EngineEvent, context: SessionContext, metadata?: Record<string, string | number | boolean>): void;
}
export const silentEngineLogger: EngineLogger = { event: () => {} };
