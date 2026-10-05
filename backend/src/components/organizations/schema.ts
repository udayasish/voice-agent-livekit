import { z } from "zod";

export const organizationIdParamSchema = z.object({
  organizationId: z.string().uuid("Invalid organization ID format").optional(),
  id: z.string().uuid("Invalid organization ID format").optional(),
});

export type OrganizationIdParam = z.infer<typeof organizationIdParamSchema>;
