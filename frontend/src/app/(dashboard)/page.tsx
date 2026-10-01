import Link from "next/link";
import {
  PhoneCall,
  CalendarCheck,
  Bot,
  Clock,
  ArrowUpRight,
  Plus,
  Play,
  Stethoscope,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function OverviewPage() {
  const kpis = [
    {
      title: "Total Calls (Today)",
      value: "128",
      subtext: "+14% from yesterday",
      icon: PhoneCall,
      color: "text-blue-500",
      bgColor: "bg-blue-500/10",
    },
    {
      title: "Appointments Booked",
      value: "42",
      subtext: "Assamese conversational AI",
      icon: CalendarCheck,
      color: "text-emerald-500",
      bgColor: "bg-emerald-500/10",
    },
    {
      title: "Active Agents",
      value: "1",
      subtext: "Clinic OPD Receptionist",
      icon: Bot,
      color: "text-purple-500",
      bgColor: "bg-purple-500/10",
    },
    {
      title: "Avg Handle Time",
      value: "1m 45s",
      subtext: "Latency: ~620ms",
      icon: Clock,
      color: "text-amber-500",
      bgColor: "bg-amber-500/10",
    },
  ];

  const recentCalls = [
    {
      id: "call-101",
      caller: "+91 98540 12345",
      language: "Assamese (as-IN)",
      doctor: "Dr. Dipankar Sarma",
      outcome: "Appointment Booked",
      duration: "1m 32s",
      time: "10 mins ago",
      status: "success",
    },
    {
      id: "call-102",
      caller: "+91 94350 67890",
      language: "Assamese / Hindi",
      doctor: "Dr. Ananya Baruah",
      outcome: "Slot Inquiry Only",
      duration: "0m 58s",
      time: "24 mins ago",
      status: "secondary",
    },
    {
      id: "call-103",
      caller: "+91 97060 11223",
      language: "Assamese (as-IN)",
      doctor: "Dr. Dipankar Sarma",
      outcome: "Appointment Booked",
      duration: "2m 10s",
      time: "48 mins ago",
      status: "success",
    },
    {
      id: "call-104",
      caller: "+91 88760 99887",
      language: "English / Assamese",
      doctor: "General OPD",
      outcome: "Transferred to Human",
      duration: "3m 15s",
      time: "1 hour ago",
      status: "warning",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header & Quick Action Buttons */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Clinic Voice AI Dashboard
          </h1>
          <p className="text-sm text-muted-foreground">
            Realtime monitoring and agent management for Assamese voice automation.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <Button variant="outline" asChild size="sm">
            <Link href="/clinic">
              <Stethoscope className="mr-1.5 h-4 w-4" />
              <span>Manage Clinic</span>
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/agents">
              <Play className="mr-1.5 h-4 w-4" />
              <span>Voice Agents</span>
            </Link>
          </Button>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <Card key={kpi.title} className="overflow-hidden">
              <CardContent className="p-6">
                <div className="flex items-center justify-between space-y-0">
                  <p className="text-xs font-medium text-muted-foreground">
                    {kpi.title}
                  </p>
                  <div className={`p-2 rounded-lg ${kpi.bgColor}`}>
                    <Icon className={`h-4 w-4 ${kpi.color}`} />
                  </div>
                </div>
                <div className="mt-2">
                  <div className="text-2xl font-bold">{kpi.value}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {kpi.subtext}
                  </p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Main Grid: Recent Calls & Quick Launch */}
      <div className="grid gap-6 md:grid-cols-7">
        {/* Recent Calls Log */}
        <Card className="md:col-span-4 lg:col-span-5">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-base font-semibold">
                Recent Voice Interactions
              </CardTitle>
              <CardDescription className="text-xs">
                Inbound patient phone calls handled by AI
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild className="text-xs">
              <Link href="/calls">
                <span>View all</span>
                <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {recentCalls.map((call) => (
                <div
                  key={call.id}
                  className="flex items-center justify-between p-4 hover:bg-muted/40 transition-colors"
                >
                  <div className="flex items-center space-x-3 truncate">
                    <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                      <PhoneCall className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex flex-col truncate">
                      <span className="text-sm font-medium text-foreground truncate">
                        {call.caller}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {call.doctor} • {call.language}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-3 shrink-0">
                    <Badge
                      variant={
                        call.status === "success"
                          ? "success"
                          : call.status === "warning"
                          ? "warning"
                          : "secondary"
                      }
                      className="text-xs"
                    >
                      {call.outcome}
                    </Badge>
                    <span className="text-xs text-muted-foreground hidden sm:inline-block">
                      {call.duration}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* System & Active Voice Pipeline Overview */}
        <Card className="md:col-span-3 lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">
              Voice Engine Status
            </CardTitle>
            <CardDescription className="text-xs">
              Live components & pipeline health
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between items-center text-xs">
                <span className="text-muted-foreground">Realtime Transport</span>
                <Badge variant="success">LiveKit Ready</Badge>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-muted-foreground">Speech-to-Text</span>
                <Badge variant="outline">Deepgram Nova-3 (as-IN)</Badge>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-muted-foreground">LLM Engine</span>
                <Badge variant="outline">Qwen3.5-4B (HF API)</Badge>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-muted-foreground">Text-to-Speech</span>
                <Badge variant="outline">AI4Bharat IndicF5</Badge>
              </div>
            </div>

            <div className="rounded-lg border p-3 bg-muted/20 space-y-1">
              <div className="text-xs font-medium text-foreground">Assamese Optimization</div>
              <p className="text-[11px] text-muted-foreground leading-normal">
                Configured with bilingual prompt policy for natural Assamese/English clinic code-switching.
              </p>
            </div>

            <Button className="w-full" variant="outline" size="sm" asChild>
              <Link href="/agents">
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                <span>Configure Agent</span>
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
