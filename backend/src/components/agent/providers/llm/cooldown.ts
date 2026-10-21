/** Shared transport-level cooldown; no credentials are stored in keys or values. */
export interface CooldownStore { remaining(scope: string): Promise<number>; extend(scope: string, milliseconds: number): Promise<void>; }
let shared: CooldownStore | undefined;
export function setProviderCooldownStore(store: CooldownStore | undefined) { shared = store; }
const local = new Map<string, number>();
export async function providerCooldown(scope: string, delay?: number): Promise<number> {
  if (delay !== undefined) {
    delay = Math.max(1, Math.ceil(delay));
    local.set(scope, Math.max(local.get(scope) ?? 0, Date.now() + delay));
    await shared?.extend(scope, Math.max(1, delay));
  }
  return Math.max(0, (local.get(scope) ?? 0) - Date.now(), await shared?.remaining(scope) ?? 0);
}
export class RedisProviderCooldown implements CooldownStore {
  constructor(private readonly client: { pTTL(key: string): Promise<number>; eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown> }) {}
  private key(scope: string) { return `provider-cooldown:${scope}`; }
  async remaining(scope: string) { return Math.max(0, await this.client.pTTL(this.key(scope))); }
  async extend(scope: string, milliseconds: number) {
    await this.client.eval("local t=redis.call('PTTL',KEYS[1]); if t<tonumber(ARGV[1]) then redis.call('PSETEX',KEYS[1],ARGV[1],'1') end; return 1", { keys: [this.key(scope)], arguments: [String(milliseconds)] });
  }
}
