"use client";
import {useState} from "react";
import Link from "next/link";
import {useAuthStore} from "@/store/auth-store";
import {agentsApi} from "@/services/api/agents";
import {useAgentRequest} from "@/hooks/use-agents";
import {Button,buttonVariants} from "@/components/ui/button";
export function AgentList(){const org=useAuthStore(s=>s.activeOrganization);const[page,setPage]=useState(1);
 const r=useAgentRequest(org?`${org.id}:${page}`:"",signal=>agentsApi.list(org!.id,page,signal));
 if(!org)return <p>Select an organization to see its agents.</p>;
 return <div className="space-y-5"><div className="flex justify-between"><h1 className="text-2xl font-semibold">Agents</h1>{org.role!=="member"&&<Link className={buttonVariants()} href="/agents/new">Create Agent</Link>}</div>
 {r.loading?<p role="status">Loading agents…</p>:r.error?<div role="alert">{r.error} <Button onClick={r.retry}>Retry</Button></div>:<>
 {!r.data?.items.length&&<p>No agents yet.</p>}<div className="grid gap-4 md:grid-cols-2">{r.data?.items.map(a=><article className="rounded-lg border bg-card p-5 space-y-3" key={a.id}><h2 className="font-semibold">{a.name}</h2><p>{a.isActive?"Active":"Inactive"} · {a.languages.join(", ")}</p><div className="flex gap-3"><Link href={`/agents/${a.id}`} className={buttonVariants({variant:"outline"})}>Settings</Link><Link href={`/agents/${a.id}/testing`} className={buttonVariants()}>Test Voice</Link></div></article>)}</div>
 <div className="flex gap-3 items-center"><Button variant="outline" disabled={page===1} onClick={()=>setPage(p=>p-1)}>Previous</Button><span>Page {page}</span><Button variant="outline" disabled={!r.data||page>=r.data.pagination.totalPages} onClick={()=>setPage(p=>p+1)}>Next</Button></div></>}
 </div>;}
