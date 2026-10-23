import { randomUUID } from "node:crypto";
import { z } from "zod";
import { snapshotSchema } from "./configuration/schema.js";

export const bindingSchema = z.object({
  schemaVersion: z.literal(2),
  organizationId: z.uuid(), userId: z.uuid(), agentId: z.string().min(1), sessionId: z.uuid(),
  callId: z.uuid(), conversationId: z.uuid(), roomName: z.string().min(1), participantIdentity: z.string().min(1),
  profile: snapshotSchema,
}).strict().refine(b => b.organizationId === b.profile.organizationId && b.agentId === b.profile.agentId);
export type RuntimeBinding = z.infer<typeof bindingSchema>;
export interface BindingStore {
  set(key: string, value: string, options: { EX: number }): Promise<unknown>;
  getDel(key: string): Promise<string | null>;
  del(key: string): Promise<unknown>;
}
export const bindingKey = (id: string) => `voice-runtime:${z.uuid().parse(id)}`;
export async function issueRuntimeBinding(store: BindingStore, value: RuntimeBinding): Promise<string> {
  const id = randomUUID();
  await store.set(bindingKey(id), JSON.stringify(bindingSchema.parse(value)), { EX: 900 });
  return id;
}
/** One-use server record. Participant metadata carries no identity or permission claims. */
export async function consumeRuntimeBinding(store: BindingStore, metadata: string, room: string, participant: string): Promise<RuntimeBinding> {
  const { runtimeBindingId } = z.object({ runtimeBindingId: z.uuid() }).strict().parse(JSON.parse(metadata));
  const raw = await store.getDel(bindingKey(runtimeBindingId));
  if (!raw) throw new Error("Voice runtime binding unavailable");
  const binding = bindingSchema.parse(JSON.parse(raw));
  if (binding.roomName !== room || binding.participantIdentity !== participant) throw new Error("Voice runtime binding mismatch");
  return binding;
}
