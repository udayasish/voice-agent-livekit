"use client";
import Link from "next/link";
import {useAuthStore} from "@/store/auth-store";
import {buttonVariants} from "@/components/ui/button";
export default function Page(){const org=useAuthStore(s=>s.activeOrganization);return <div className="space-y-5"><h1 className="text-2xl font-semibold">Dashboard</h1>{org?<><p>Welcome to {org.name}. Manage your agents and test a voice conversation.</p><div className="flex gap-3"><Link href="/agents" className={buttonVariants()}>Open Agents</Link>{org.role!=="member"&&<Link href="/agents/new" className={buttonVariants({variant:"outline"})}>Create Agent</Link>}</div></>:<p>No organization is available for this account.</p>}</div>;}
