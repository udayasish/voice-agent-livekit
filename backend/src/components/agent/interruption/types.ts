/**
 * Voice conversational phases for the agent worker.
 */
export type AgentVoicePhase =
  | "idle"
  | "greeting"
  | "listening"
  | "thinking"
  | "speaking";

/**
 * Structured telemetry event emitted upon confirmed speech interruption.
 */
export interface InterruptionEvent {
  turnId: number;
  phase: AgentVoicePhase;
  playbackDurationMs: number;
  interruptionCount: number;
  timestamp: string;
}
