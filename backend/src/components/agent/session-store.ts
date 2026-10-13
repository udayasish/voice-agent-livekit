import type { SessionContext } from "./engine/config.js";
import type { SessionSnapshot } from "./engine/state.js";
import { SESSION_TTL_SECONDS, sessionKey, type SessionStore } from "./engine/store.js";

export interface SessionRedisClient {
  set(key: string, value: string, options: { EX: number }): Promise<unknown>;
  del(key: string): Promise<unknown>;
}
export class RedisSessionStore implements SessionStore {
  constructor(private readonly client: SessionRedisClient) {}
  async save(state: SessionSnapshot<unknown>): Promise<void> {
    await this.client.set(sessionKey(state.context), JSON.stringify(state), { EX: SESSION_TTL_SECONDS });
  }
  async delete(context: SessionContext): Promise<void> { await this.client.del(sessionKey(context)); }
}
