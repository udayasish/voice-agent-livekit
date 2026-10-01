import { BarChart3, TrendingUp, Clock, CheckCircle2, PhoneMissed } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function AnalyticsPage() {
  const metrics = [
    { title: "Booking Success Rate", value: "92.4%", sub: "+3.2% this week", icon: CheckCircle2, color: "text-emerald-500" },
    { title: "Average Latency", value: "640ms", sub: "VAD to first TTS frame", icon: Clock, color: "text-blue-500" },
    { title: "Voice Interruption (Barge-in)", value: "18.1%", sub: "Handled seamlessly", icon: TrendingUp, color: "text-purple-500" },
    { title: "Human Transfer Rate", value: "4.8%", sub: "Complex clinic queries", icon: PhoneMissed, color: "text-amber-500" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Voice AI Analytics
        </h1>
        <p className="text-sm text-muted-foreground">
          Operational metrics, language recognition accuracy, and booking conversion performance.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((m) => {
          const Icon = m.icon;
          return (
            <Card key={m.title}>
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{m.title}</span>
                  <Icon className={`h-4 w-4 ${m.color}`} />
                </div>
                <div className="mt-2">
                  <div className="text-2xl font-bold">{m.value}</div>
                  <p className="text-xs text-muted-foreground mt-0.5">{m.sub}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Language Distribution</CardTitle>
          <CardDescription className="text-xs">
            Detected speech breakdown across all incoming patient calls
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between text-xs font-medium">
              <span>Assamese (Primary)</span>
              <span>74%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary rounded-full" style={{ width: "74%" }} />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-xs font-medium">
              <span>Assamese / English (Code-mixed)</span>
              <span>18%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full" style={{ width: "18%" }} />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-xs font-medium">
              <span>Hindi / Other</span>
              <span>8%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-amber-500 rounded-full" style={{ width: "8%" }} />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
