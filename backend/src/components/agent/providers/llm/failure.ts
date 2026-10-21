/** Safe diagnostic categories only; never attach HTTP bodies, prompts or exception messages. */
export class LLMFailure extends Error {
  constructor(readonly kind: "http" | "network" | "timeout" | "protocol" | "request_limit" | "rate_limit" | "authentication" | "unavailable" | "incomplete_output", readonly status?: number, readonly retryAfterMs?: number) { super("Model generation failed"); }
}
