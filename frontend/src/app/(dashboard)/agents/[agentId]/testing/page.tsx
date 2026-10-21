import Link from "next/link";
import { ArrowLeft, Radio, Headphones, ShieldCheck, Cpu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { VoiceSandbox } from "@/components/voice/voice-sandbox";

export default async function AgentTestingPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center space-x-3">
          <Button variant="ghost" size="icon" asChild className="h-8 w-8">
            <Link href={`/agents/${agentId}`}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                Voice Testing Laboratory
              </h1>
              <Badge variant="outline" className="font-mono text-xs">
                Voice tools
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Realtime WebRTC browser audio stream verification for Agent: {agentId}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/agents/${agentId}`}>Back to Agent Settings</Link>
          </Button>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left: Active Voice Sandbox (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          <VoiceSandbox agentId={agentId} />
        </div>

        {/* Right: Technical Diagnostics & Multi-Tab Instructions (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center space-x-2">
                <Headphones className="h-4 w-4 text-primary" />
                <CardTitle className="text-base font-semibold">
                  Clinic Voice Conversation Test
                </CardTitle>
              </div>
              <CardDescription className="text-xs">
                Choose the configured clinic, then verify doctors, availability and confirmed appointment actions.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-xs leading-relaxed">
              <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                <p className="font-semibold text-foreground">Verification Procedure:</p>
                <ol className="list-decimal pl-4 space-y-1.5 text-muted-foreground">
                  <li>
                    Click <strong className="text-foreground">&quot;Start Voice Session&quot;</strong> in this tab. Allow microphone permission when prompted by your browser.
                  </li>
                  <li>
                    Ask for doctors, then choose an available date and time. Check the tool activity below each reply.
                  </li>
                  <li>
                    Give a test phone number, patient name and age. Confirm the readback, then verify the returned appointment token.
                  </li>
                  <li>
                    In a new session, use the phone number, token and date to check the appointment. Ask to cancel and confirm its readback.
                  </li>
                  <li>
                    Two tabs create separate caller rooms. For a race test, choose the same slot in both and confirm both bookings. A full slot must produce fresh alternatives.
                  </li>
                </ol>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border p-3 space-y-1">
                  <div className="flex items-center space-x-1.5 font-semibold text-foreground">
                    <ShieldCheck className="h-4 w-4 text-emerald-500" />
                    <span>Security Boundary</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Browser never receives root LiveKit API secret. Tokens are cryptographically signed JWTs issued on demand by the Express backend.
                  </p>
                </div>

                <div className="rounded-lg border p-3 space-y-1">
                  <div className="flex items-center space-x-1.5 font-semibold text-foreground">
                    <Cpu className="h-4 w-4 text-blue-500" />
                    <span>Audio Codec & Transport</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    LiveKit carries microphone and assistant audio. The existing latency indicators measure this session; headphones help prevent speaker echo.
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 space-y-1">
                <p className="font-semibold text-amber-700 dark:text-amber-400">
                  Microphone Permission Troubleshooting:
                </p>
                <p className="text-[11px] text-muted-foreground">
                  If the browser reports a microphone permission error, click the padlock/tune icon in the browser address bar next to <code>localhost</code>, toggle &quot;Microphone&quot; to Allow, and click &quot;Start Voice Session&quot; again.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
