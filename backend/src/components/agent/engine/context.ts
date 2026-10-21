import type { AgentInputItem, CallModelInputFilter } from "@openai/agents";

/** Keep whole caller turns. Current-run calls/results remain together with their caller. */
export const recentContext: CallModelInputFilter = ({ modelData }) => {
  const users = modelData.input.flatMap((item, index) => "role" in item && item.role === "user" ? [index] : []);
  const start = users.length > 4 ? users[users.length - 4]! : 0;
  return { ...modelData, input: modelData.input.slice(start) as AgentInputItem[] };
};
