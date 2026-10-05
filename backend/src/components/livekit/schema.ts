import { z } from "zod";

export const createTokenSchema = z.object({
  roomName: z
    .string()
    .min(1, "Room name cannot be empty")
    .max(100, "Room name cannot exceed 100 characters")
    .optional(),
  participantName: z
    .string()
    .min(1, "Participant name cannot be empty")
    .max(100, "Participant name cannot exceed 100 characters")
    .optional(),
  agentId: z
    .string()
    .min(1, "Agent ID cannot be empty")
    .max(100, "Agent ID cannot exceed 100 characters")
    .optional(),
});

export type CreateTokenInput = z.infer<typeof createTokenSchema>;
