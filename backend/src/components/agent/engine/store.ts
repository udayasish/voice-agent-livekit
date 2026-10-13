import type { SessionContext } from "./config.js";
import type { SessionSnapshot } from "./state.js";

export const SESSION_TTL_SECONDS = 30 * 60;
export function sessionKey(context: SessionContext): string {
  return `agent-session:${encodeURIComponent(context.organizationId)}:${encodeURIComponent(context.sessionId)}`;
}
export interface SessionStore {
  save(state: SessionSnapshot<unknown>): Promise<void>;
  delete(context: SessionContext): Promise<void>;
}
export class MemorySessionStore implements SessionStore {
  private entries = new Map<string, { state: SessionSnapshot<unknown>; expiresAt: number }>();
  constructor(private readonly now: () => number = Date.now) {}
  async save(state: SessionSnapshot<unknown>): Promise<void> {
    this.entries.set(sessionKey(state.context), {
      state: structuredClone(state), expiresAt: this.now() + SESSION_TTL_SECONDS * 1000,
    });
  }
  async delete(context: SessionContext): Promise<void> { this.entries.delete(sessionKey(context)); }
  get(context: SessionContext): SessionSnapshot<unknown> | undefined {
    const key = sessionKey(context);
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= this.now()) { this.entries.delete(key); return undefined; }
    return structuredClone(entry.state);
  }
}
