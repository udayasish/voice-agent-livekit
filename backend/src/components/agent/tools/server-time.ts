import { z } from "zod";
import { defineTool } from "./registry.js";

export function createServerTimeTool(clock: () => Date = () => new Date()) {
  return defineTool({ name: "get_server_time", description: "Return the current server time in UTC. This performs no business action.",
    inputSchema: z.object({}).strict(), outputSchema: z.object({ timestamp: z.iso.datetime(), timezone: z.literal("UTC") }).strict(),
    execute: async () => ({ success: true as const, data: { timestamp: clock().toISOString(), timezone: "UTC" as const } }),
  });
}
