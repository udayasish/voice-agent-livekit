"use client";

import { useMemo } from "react";
import {
  Mic,
  MicOff,
  PhoneCall,
  PhoneOff,
  Radio,
  Users,
  AlertCircle,
  Volume2,
  Server,
  Key,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useLiveKitRoom } from "@/hooks/use-livekit-room";

interface VoiceSandboxProps {
  agentId?: string;
  roomNameOverride?: string;
  compact?: boolean;
}

export function VoiceSandbox({ agentId, roomNameOverride, compact = false }: VoiceSandboxProps) {
  const {
    status,
    roomName,
    serverUrl,
    participantIdentity,
    participantName,
    isMicEnabled,
    isMuted,
    audioLevel,
    duration,
    remoteParticipants,
    conversationTurns,
    error,
    connect,
    disconnect,
    toggleMute,
    clearConversationTurns,
  } = useLiveKitRoom();

  const isConnected = status === "connected";
  const isConnecting = status === "connecting" || status === "requesting_token";

  const formattedDuration = useMemo(() => {
    const mins = Math.floor(duration / 60)
      .toString()
      .padStart(2, "0");
    const secs = (duration % 60).toString().padStart(2, "0");
    return `${mins}:${secs}`;
  }, [duration]);

  const handleStartSession = () => {
    connect({
      agentId,
      roomName: roomNameOverride,
    });
  };

  return (
    <Card className={`border-primary/20 transition-all ${isConnected ? "ring-1 ring-emerald-500/30" : ""}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Radio className={`h-4 w-4 ${isConnected ? "text-emerald-500 animate-pulse" : "text-primary"}`} />
            <CardTitle className="text-base font-semibold">LiveKit Audio Sandbox</CardTitle>
          </div>
          <div>
            {isConnected && (
              <Badge variant="success" className="animate-in fade-in">
                <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping inline-block" />
                Connected ({formattedDuration})
              </Badge>
            )}
            {isConnecting && (
              <Badge variant="warning" className="animate-in fade-in">
                Connecting...
              </Badge>
            )}
            {!isConnected && !isConnecting && (
              <Badge variant="secondary">Ready</Badge>
            )}
          </div>
        </div>
        <CardDescription className="text-xs">
          Realtime WebRTC browser audio stream via local LiveKit server.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Error Alert */}
        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex items-start space-x-2">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold">Microphone or Connection Error</p>
              <p>{error}</p>
            </div>
          </div>
        )}

        {/* Realtime Audio Waveform / Visualizer */}
        <div className="rounded-xl border bg-background p-4 text-center space-y-3">
          <div className="flex items-center justify-center">
            {isConnected ? (
              <div className="relative flex items-center justify-center h-16 w-16 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                <Volume2
                  className={`h-8 w-8 text-emerald-600 transition-transform duration-75`}
                  style={{
                    transform: `scale(${1 + audioLevel * 0.4})`,
                  }}
                />
                {audioLevel > 0.05 && (
                  <div
                    className="absolute inset-0 rounded-full border-2 border-emerald-400 opacity-75 animate-ping"
                    style={{ animationDuration: "1s" }}
                  />
                )}
              </div>
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Mic className="h-8 w-8" />
              </div>
            )}
          </div>

          <div className="space-y-1">
            <h4 className="text-sm font-semibold">
              {isConnected
                ? isMuted
                  ? "Microphone Muted"
                  : audioLevel > 0.08
                    ? "Speaking (Streaming to LiveKit)..."
                    : "Microphone Active — Speak to Test"
                : isConnecting
                  ? "Establishing WebRTC Handshake..."
                  : "Audio Standby"}
            </h4>
            <p className="text-xs text-muted-foreground">
              {isConnected
                ? "Microphone track published to LiveKit. Realtime audio is streaming."
                : "Click below to request secure token and connect browser audio."}
            </p>
          </div>

          {/* Audio Volume Bar */}
          {isConnected && (
            <div className="space-y-1 pt-1">
              <div className="flex justify-between text-[11px] text-muted-foreground font-mono">
                <span>Mic Level</span>
                <span>{Math.round(audioLevel * 100)}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-emerald-500 transition-all duration-75"
                  style={{ width: `${Math.max(4, audioLevel * 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center gap-2 pt-2">
            {!isConnected ? (
              <Button
                className="w-full"
                size="sm"
                onClick={handleStartSession}
                disabled={isConnecting}
              >
                <PhoneCall className="h-4 w-4 mr-1.5" />
                <span>{isConnecting ? "Connecting..." : "Start Voice Session"}</span>
              </Button>
            ) : (
              <>
                <Button
                  variant={isMuted ? "destructive" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={toggleMute}
                >
                  {isMuted ? (
                    <>
                      <MicOff className="h-4 w-4 mr-1.5" />
                      <span>Unmute</span>
                    </>
                  ) : (
                    <>
                      <Mic className="h-4 w-4 mr-1.5" />
                      <span>Mute</span>
                    </>
                  )}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="flex-1"
                  onClick={disconnect}
                >
                  <PhoneOff className="h-4 w-4 mr-1.5" />
                  <span>Disconnect</span>
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Live Conversation Feed (Phase 10: STT -> LLM response) */}
        {conversationTurns.length > 0 && (
          <div className="space-y-3 border-t pt-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Radio className="h-3.5 w-3.5 text-primary" />
                Live Conversation (STT &amp; LLM)
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px] text-muted-foreground"
                onClick={clearConversationTurns}
              >
                Clear
              </Button>
            </div>
            <div className="max-h-60 overflow-y-auto space-y-2.5 pr-1 text-xs">
              {conversationTurns.map((turn) => (
                <div key={turn.id} className="space-y-1.5 rounded-lg border bg-muted/30 p-2.5">
                  <div className="flex items-start justify-between text-muted-foreground text-[10px]">
                    <span className="font-semibold text-foreground flex items-center gap-1">
                      <span>👤 You (STT):</span>
                    </span>
                    <span>{new Date(turn.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <p className="font-medium text-foreground pl-3 text-xs leading-relaxed">
                    &quot;{turn.userText}&quot;
                  </p>
                  <div className="border-t border-muted/50 pt-1.5 mt-1.5">
                    <div className="flex items-center justify-between text-[10px] text-primary font-semibold">
                      <span>🤖 Agent (LLM Brain):</span>
                      {turn.totalLatencyMs !== undefined && (
                        <span className="font-mono text-muted-foreground text-[10px]">
                          {turn.totalLatencyMs} ms
                        </span>
                      )}
                    </div>
                    <p className="text-primary/90 pl-3 text-xs font-medium leading-relaxed mt-0.5">
                      &quot;{turn.responseText}&quot;
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Phase 10 Live AI Note */}
        <div className="rounded-lg bg-muted/50 p-2.5 text-[11px] text-muted-foreground space-y-1">
          <p className="font-semibold text-foreground">Phase 10 Multilingual AI Voice Pipeline:</p>
          <p>
            Speak in Assamese, Hindi, or English. Your speech is recognized in real-time by Deepgram Nova-3 and processed by the Qwen3.5-4B LLM conversational brain. (Voice speech synthesis will be added in Phase 11 TTS).
          </p>
        </div>

        {/* Session Diagnostics */}
        {isConnected && !compact && (
          <div className="space-y-2 border-t pt-3 text-xs text-muted-foreground">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Server className="h-3.5 w-3.5" />
                Room Name
              </span>
              <span className="font-mono text-foreground">{roomName}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Key className="h-3.5 w-3.5" />
                Participant
              </span>
              <span className="font-mono text-foreground text-[11px]">
                {participantIdentity?.substring(0, 18)}...
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" />
                Participants in Room
              </span>
              <Badge variant="outline" className="text-[10px]">
                {1 + remoteParticipants.length} ({remoteParticipants.length} remote)
              </Badge>
            </div>

            {/* Remote Participants List */}
            {remoteParticipants.length > 0 && (
              <div className="pt-2 border-t space-y-1">
                <p className="text-[11px] font-semibold text-foreground">Remote Speakers:</p>
                {remoteParticipants.map((p) => (
                  <div key={p.identity} className="flex items-center justify-between bg-muted/40 p-1.5 rounded">
                    <span className="text-[11px] truncate max-w-[160px]">{p.name}</span>
                    <Badge variant={p.isSpeaking ? "success" : "secondary"} className="text-[10px]">
                      {p.isSpeaking ? "Speaking" : "Connected"}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
