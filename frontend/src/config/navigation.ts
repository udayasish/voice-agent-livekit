import { LayoutDashboard, Bot } from "lucide-react";
import type { NavSection } from "@/types/navigation";
export const navigationConfig:NavSection[]=[{items:[{title:"Dashboard",href:"/",icon:LayoutDashboard,exact:true},{title:"Agents",href:"/agents",icon:Bot}]}];
