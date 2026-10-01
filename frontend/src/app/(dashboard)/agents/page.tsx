import Link from "next/link";
import { Bot, Plus, ArrowRight, Settings, Radio } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function AgentsPage() {
  const agents = [
    {
      id: "agent-clinic-opd-01",
      name: "OPD Appointment Voice Agent",
      description: "Handles patient phone inquiries, doctor availability lookup, token booking, and cancellations.",
      language: "Assamese (as-IN) + English",
      status: "active",
      model: "Qwen3.5-4B (HF Cloud)",
      voice: "IndicF5 (Assamese Female)",
      callsHandled: 342,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Voice AI Agents
          </h1>
          <p className="text-sm text-muted-foreground">
            Configure system prompts, voice speed, speech recognition, and domain tools.
          </p>
        </div>

        <Button asChild size="sm">
          <Link href="/agents/new">
            <Plus className="mr-1.5 h-4 w-4" />
            <span>Create Agent</span>
          </Link>
        </Button>
      </div>

      {/* Agents Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {agents.map((agent) => (
          <Card key={agent.id} className="flex flex-col justify-between hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Bot className="h-5 w-5" />
                </div>
                <Badge variant={agent.status === "active" ? "success" : "secondary"}>
                  <Radio className="mr-1 h-2.5 w-2.5 animate-pulse" />
                  {agent.status === "active" ? "Active" : "Inactive"}
                </Badge>
              </div>
              <CardTitle className="text-base font-semibold mt-3">
                {agent.name}
              </CardTitle>
              <CardDescription className="text-xs line-clamp-2">
                {agent.description}
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-2.5 text-xs text-muted-foreground">
              <div className="flex justify-between border-t pt-2.5">
                <span>Primary Language</span>
                <span className="font-medium text-foreground">{agent.language}</span>
              </div>
              <div className="flex justify-between">
                <span>LLM Engine</span>
                <span className="font-medium text-foreground">{agent.model}</span>
              </div>
              <div className="flex justify-between">
                <span>TTS Voice</span>
                <span className="font-medium text-foreground">{agent.voice}</span>
              </div>
              <div className="flex justify-between">
                <span>Lifetime Calls</span>
                <span className="font-medium text-foreground">{agent.callsHandled} calls</span>
              </div>
            </CardContent>

            <CardFooter className="border-t pt-3 flex justify-between gap-2 bg-muted/10">
              <Button variant="outline" size="sm" asChild className="w-full text-xs">
                <Link href={`/agents/${agent.id}`}>
                  <Settings className="mr-1.5 h-3.5 w-3.5" />
                  <span>Configure</span>
                </Link>
              </Button>
              <Button size="sm" asChild className="w-full text-xs">
                <Link href={`/agents/${agent.id}`}>
                  <span>Testing</span>
                  <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Link>
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}
