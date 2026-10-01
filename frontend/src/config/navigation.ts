import {
  LayoutDashboard,
  Bot,
  PhoneCall,
  MessageSquare,
  Stethoscope,
  Phone,
  BarChart3,
  Building2,
  Settings,
} from "lucide-react";
import type { NavSection } from "@/types/navigation";

export const navigationConfig: NavSection[] = [
  {
    title: "General",
    items: [
      {
        title: "Overview",
        href: "/",
        icon: LayoutDashboard,
        exact: true,
        description: "Dashboard KPIs and realtime activity",
      },
      {
        title: "AI Agents",
        href: "/agents",
        icon: Bot,
        badge: "Assamese",
        description: "Configure voice prompts, tools & LLMs",
      },
      {
        title: "Calls",
        href: "/calls",
        icon: PhoneCall,
        description: "Call logs, outcomes & duration",
      },
      {
        title: "Conversations",
        href: "/conversations",
        icon: MessageSquare,
        description: "Transcripts and tool execution logs",
      },
    ],
  },
  {
    title: "Business Domain",
    items: [
      {
        title: "Clinic & OPD",
        href: "/clinic",
        icon: Stethoscope,
        badge: "MVP",
        description: "Doctors, schedules & appointment queue",
      },
    ],
  },
  {
    title: "Telephony & Analytics",
    items: [
      {
        title: "Phone & SIP",
        href: "/phone",
        icon: Phone,
        description: "Phone numbers and SIP trunks",
      },
      {
        title: "Analytics",
        href: "/analytics",
        icon: BarChart3,
        description: "Call volume, latency & success rates",
      },
    ],
  },
  {
    title: "Settings",
    items: [
      {
        title: "Organization",
        href: "/organization",
        icon: Building2,
        description: "Organization details and staff access",
      },
      {
        title: "Platform Settings",
        href: "/settings",
        icon: Settings,
        description: "Speech, STT, and voice defaults",
      },
    ],
  },
];
