import logger from "../lib/logger.js";

export type AgentLifecycleEvent =
  | "worker_started"
  | "worker_registered"
  | "job_assigned"
  | "room_connecting"
  | "room_connected"
  | "participant_joined"
  | "participant_left"
  | "audio_published"
  | "greeting_started"
  | "greeting_completed"
  | "speech_started"
  | "speech_ended"
  | "interruption_detected"
  | "stt_stream_started"
  | "stt_interim_transcript"
  | "stt_final_transcript"
  | "llm_generation_started"
  | "llm_response_completed"
  | "room_disconnected"
  | "worker_shutdown"
  | "agent_error";

export interface LifecycleMetadata {
  workerId?: string | undefined;
  wsURL?: string | undefined;
  agentName?: string | undefined;
  jobId?: string | undefined;
  roomName?: string | undefined;
  participantIdentity?: string | undefined;
  participantName?: string | undefined;
  participantsCount?: number | undefined;
  durationSeconds?: number | undefined;
  speechDurationMs?: number | undefined;
  silenceDurationMs?: number | undefined;
  speaking?: boolean | undefined;
  probability?: number | undefined;
  text?: string | undefined;
  userText?: string | undefined;
  responseText?: string | undefined;
  ttftMs?: number | undefined;
  totalLatencyMs?: number | undefined;
  latencyMs?: number | undefined;
  confidence?: number | undefined;
  language?: string | undefined;
  error?: string | undefined;
  stack?: string | undefined;
  signal?: string | undefined;
  [key: string]: unknown;
}

/**
 * Structured logger for LiveKit Agent lifecycle events using Winston.
 */
export const logLifecycle = (
  event: AgentLifecycleEvent,
  message: string,
  meta?: LifecycleMetadata,
): void => {
  const payload = {
    lifecycleEvent: event,
    timestamp: new Date().toISOString(),
    ...meta,
  };

  switch (event) {
    case "agent_error":
      logger.error(`[Agent] ${message}`, payload);
      break;
    case "worker_shutdown":
    case "participant_left":
    case "room_disconnected":
      logger.warn(`[Agent] ${message}`, payload);
      break;
    default:
      logger.info(`[Agent] ${message}`, payload);
      break;
  }
};

/**
 * Attaches graceful shutdown listeners to process signals.
 */
export const registerShutdownHandlers = (
  cleanupFn: (signal: string) => Promise<void> | void,
): void => {
  let isShuttingDown = false;

  const handleSignal = async (signal: string) => {
    if (isShuttingDown) {
      logger.warn(`[Agent] Force exit on repeated ${signal}`);
      process.exit(130);
    }
    isShuttingDown = true;
    logLifecycle("worker_shutdown", `Received ${signal}, initiating clean shutdown...`, { signal });

    try {
      await cleanupFn(signal);
      logLifecycle("worker_shutdown", `Clean shutdown completed successfully`, { signal });
      process.exit(0);
    } catch (err) {
      logLifecycle("agent_error", `Error occurred during shutdown: ${err instanceof Error ? err.message : String(err)}`, {
        signal,
        error: err instanceof Error ? err.message : String(err),
      });
      process.exit(1);
    }
  };

  process.once("SIGINT", () => {
    handleSignal("SIGINT").catch(() => process.exit(1));
  });

  process.once("SIGTERM", () => {
    handleSignal("SIGTERM").catch(() => process.exit(1));
  });
};
