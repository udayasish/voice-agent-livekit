import { Settings, Volume2, Mic, Bot, Shield, Save } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export default function SettingsPage() {
  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Platform & Engine Settings
          </h1>
          <p className="text-sm text-muted-foreground">
            Configure default speech models, VAD thresholds, and LLM inference endpoints.
          </p>
        </div>

        <Button size="sm">
          <Save className="h-4 w-4 mr-1.5" />
          <span>Save Preferences</span>
        </Button>
      </div>

      <div className="space-y-6">
        {/* Voice AI Engine Defaults */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center space-x-2">
              <Bot className="h-5 w-5 text-primary" />
              <CardTitle className="text-base font-semibold">AI Speech Defaults</CardTitle>
            </div>
            <CardDescription className="text-xs">
              Default STT, TTS, and LLM configurations used across all voice agents.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">STT Provider (Assamese)</label>
                <Input defaultValue="Deepgram Nova-3 (as-IN)" disabled />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">TTS Provider (Assamese)</label>
                <Input defaultValue="AI4Bharat IndicF5 (FastAPI)" disabled />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">LLM Model</label>
                <Input defaultValue="Qwen/Qwen3.5-4B (Hugging Face Router)" disabled />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Default Speech Rate</label>
                <Input type="number" defaultValue="1.0" step="0.1" min="0.5" max="2.0" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Realtime Audio & Turn Detection */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center space-x-2">
              <Volume2 className="h-5 w-5 text-primary" />
              <CardTitle className="text-base font-semibold">VAD & Interruption (Barge-in)</CardTitle>
            </div>
            <CardDescription className="text-xs">
              Controls sensitivity for user speech interruption detection.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-xs">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <p className="font-semibold text-foreground">Silero VAD Turn Detection</p>
                <p className="text-muted-foreground text-[11px]">
                  Automatically detect when caller begins and ends speaking in Assamese.
                </p>
              </div>
              <Badge variant="success">Enabled</Badge>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-foreground">Barge-in User Interruption</p>
                <p className="text-muted-foreground text-[11px]">
                  Stop agent speech instantly when caller starts talking.
                </p>
              </div>
              <Badge variant="success">Enabled</Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
