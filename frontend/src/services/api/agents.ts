import { apiRequest } from "./client";
import type { AgentFormValues } from "../../components/agents/schema";
export interface AgentSummary { id:string;name:string;isActive:boolean;languages:Array<"as"|"hi"|"en">;defaultLanguage:"as"|"hi"|"en";version:number;createdAt:string;updatedAt:string }
export type AgentDetail=AgentSummary & AgentFormValues & {business:"clinic"|"generic";appointmentsEnabled:boolean;timezone:string;legacyKey:string|null};
export interface AgentOptions { timezone:string;business:string;appointmentsEnabled:boolean;languages:string[];permissions:{canEdit:boolean;canTest:boolean};tools:Array<{name:string;requires:string[];requiresDoctorDiscovery:boolean}>;defaults:AgentFormValues }
export interface AgentPage {items:AgentSummary[];pagination:{page:number;pageSize:number;total:number;totalPages:number}}
function request<T>(org:string,path:string,options:RequestInit={}) {return apiRequest<T>(`/api/v1/agents${path}`,{...options,headers:{"x-organization-id":org}});}
export const agentsApi={
  list:(org:string,page=1,signal?:AbortSignal)=>request<AgentPage>(org,`?page=${page}&pageSize=20`,{signal}),
  options:(org:string,signal?:AbortSignal)=>request<AgentOptions>(org,"/options",{signal}),
  get:(org:string,id:string,signal?:AbortSignal)=>request<AgentDetail>(org,`/${encodeURIComponent(id)}`,{signal}),
  create:(org:string,value:AgentFormValues)=>request<AgentDetail>(org,"",{method:"POST",body:JSON.stringify(value)}),
  update:(org:string,id:string,version:number,value:AgentFormValues)=>request<AgentDetail>(org,`/${id}`,{method:"PATCH",body:JSON.stringify({...value,expectedVersion:version})}),
};
