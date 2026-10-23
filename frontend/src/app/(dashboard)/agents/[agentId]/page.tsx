import { AgentEditor } from "@/components/agents/agent-editor";
export default async function Page({params}:{params:Promise<{agentId:string}>}){const {agentId}=await params;return <AgentEditor agentId={agentId}/>;}
