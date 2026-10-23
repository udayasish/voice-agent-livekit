import { AgentTest } from "@/components/agents/agent-test";
export default async function Page({params}:{params:Promise<{agentId:string}>}){const {agentId}=await params;return <AgentTest agentId={agentId}/>;}
