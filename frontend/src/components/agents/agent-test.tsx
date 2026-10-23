"use client";
import Link from "next/link";
import {useAuthStore} from "@/store/auth-store";
import {useAgentRequest} from "@/hooks/use-agents";
import {agentsApi} from "@/services/api/agents";
import {VoiceSandbox} from "@/components/voice/voice-sandbox";
import {Button,buttonVariants} from "@/components/ui/button";
export function AgentTest({agentId}:{agentId:string}){const org=useAuthStore(s=>s.activeOrganization);const r=useAgentRequest(org?`${org.id}:${agentId}`:'',s=>agentsApi.get(org!.id,agentId,s));
 if(!org)return <p>Select an organization.</p>;if(r.loading)return <p role="status">Loading agent…</p>;if(r.error)return <div role="alert">{r.error}<Button onClick={r.retry}>Retry</Button></div>;
 return r.data?<div className="space-y-4 max-w-3xl"><h1 className="text-2xl font-semibold">Test {r.data.name}</h1><Link className={buttonVariants({variant:'outline'})} href={`/agents/${r.data.id}`}>Agent settings</Link><p>Uses saved settings. Start, allow the microphone, and wait until the agent is listening.</p>{r.data.isActive?<VoiceSandbox key={`${org.id}:${r.data.id}`} agentId={r.data.id}/>:<p>This agent is inactive. An owner or admin can activate it.</p>}</div>:null;
}
