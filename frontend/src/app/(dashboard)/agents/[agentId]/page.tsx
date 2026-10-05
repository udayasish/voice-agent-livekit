import Link from "next/link";
import { ArrowLeft, Save, Bot, Wrench, Terminal, Mic, Radio } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { VoiceSandbox } from "@/components/voice/voice-sandbox";

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;

  const tools = [
    {
      name: "get_doctors",
      description: "Lookup all doctors, their specialties, and OPD days",
      enabled: true,
    },
    {
      name: "get_available_slots",
      description: "Get real-time available appointment slots for a doctor on a specific date",
      enabled: true,
    },
    {
      name: "book_appointment",
      description: "Atomically reserve a token and book slot with advisory locks",
      enabled: true,
    },
    {
      name: "cancel_appointment",
      description: "Cancel an existing appointment and release the slot",
      enabled: true,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center space-x-3">
          <Button variant="ghost" size="icon" asChild className="h-8 w-8">
            <Link href="/agents">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                OPD Appointment Voice Agent
              </h1>
              <Badge variant="success">Active</Badge>
            </div>
            <p className="text-xs text-muted-foreground">ID: {agentId}</p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/agents/${agentId}/testing`}>
              <Radio className="h-4 w-4 mr-1.5 text-primary" />
              <span>Voice Testing Lab</span>
            </Link>
          </Button>
          <Button size="sm">
            <Save className="h-4 w-4 mr-1.5" />
            <span>Save Changes</span>
          </Button>
        </div>
      </div>

      {/* Configuration Grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: Prompt & Engine Config */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center space-x-2">
                <Terminal className="h-4 w-4 text-primary" />
                <CardTitle className="text-base font-semibold">
                  System Instructions (Prompt)
                </CardTitle>
              </div>
              <CardDescription className="text-xs">
                Governs personality, language policy, and clinic appointment rules.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <textarea
                className="w-full min-h-[220px] rounded-md border border-input bg-transparent p-3 text-xs font-mono shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                defaultValue={`You are the friendly, professional AI voice receptionist at Brahmaputra Health Clinic.
Your primary language is Assamese. You speak natural, polite conversational Assamese.
When callers use English or Hindi words (like "appointment", "doctor", "fever", "cardiology"), acknowledge smoothly in Assamese.

CRITICAL RULES:
1. Always call get_doctors to check current doctors and specializations.
2. Never invent doctor names or availability.
3. Once the patient selects a slot, call book_appointment.
4. Only confirm the booking after the tool returns success.`}
              />
            </CardContent>
          </Card>

          {/* Tools Grid */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center space-x-2">
                <Wrench className="h-4 w-4 text-primary" />
                <CardTitle className="text-base font-semibold">
                  Enabled Business Tools
                </CardTitle>
              </div>
              <CardDescription className="text-xs">
                Tools available to the LLM for transactional operations. Direct DB access is strictly forbidden.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {tools.map((tool) => (
                <div
                  key={tool.name}
                  className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/30 transition-colors"
                >
                  <div className="space-y-0.5">
                    <span className="font-mono text-xs font-semibold text-primary">
                      {tool.name}()
                    </span>
                    <p className="text-[11px] text-muted-foreground">{tool.description}</p>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    Enabled
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Right: Realtime Voice Testing Sandbox */}
        <div className="space-y-6">
          <VoiceSandbox agentId={agentId} />

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Voice Pipeline Spec</CardTitle>
              <CardDescription className="text-xs">
                Pipeline target specifications across development phases.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <div className="flex justify-between">
                <span>VAD Turn Detection</span>
                <span className="font-medium text-foreground">Silero VAD (Phase 7)</span>
              </div>
              <div className="flex justify-between">
                <span>Assamese STT Model</span>
                <span className="font-medium text-foreground">Nova-3 as-IN (Phase 8)</span>
              </div>
              <div className="flex justify-between">
                <span>Assamese TTS Model</span>
                <span className="font-medium text-foreground">IndicF5 (Phase 11)</span>
              </div>
              <div className="flex justify-between">
                <span>Realtime Media Transport</span>
                <Badge variant="success" className="text-[10px]">
                  LiveKit WebRTC (Active)
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
