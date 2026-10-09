"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  ConnectionState as LKConnectionState,
  RemoteTrack,
  RemoteTrackPublication,
  RemoteParticipant,
  Track,
} from "livekit-client";
import { livekitApi, type FetchTokenParams } from "@/services/api/livekit";

export type ConnectionStatus =
  | "idle"
  | "requesting_token"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";

export type RemoteParticipantInfo = {
  identity: string;
  name: string;
  isSpeaking: boolean;
  audioLevel: number;
};

export type ConversationTurn = {
  id: string;
  userText: string;
  responseText: string;
  ttftMs?: number;
  totalLatencyMs?: number;
  timestamp: string;
};

export type UseLiveKitRoomReturn = {
  status: ConnectionStatus;
  roomName: string | null;
  serverUrl: string | null;
  participantIdentity: string | null;
  participantName: string | null;
  isMicEnabled: boolean;
  isMuted: boolean;
  audioLevel: number; // 0.0 to 1.0
  duration: number; // elapsed seconds
  remoteParticipants: RemoteParticipantInfo[];
  conversationTurns: ConversationTurn[];
  error: string | null;
  connect: (params?: FetchTokenParams) => Promise<void>;
  disconnect: () => Promise<void>;
  toggleMute: () => Promise<void>;
  clearConversationTurns: () => void;
};

export function useLiveKitRoom(): UseLiveKitRoomReturn {
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [roomName, setRoomName] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [participantIdentity, setParticipantIdentity] = useState<string | null>(null);
  const [participantName, setParticipantName] = useState<string | null>(null);
  const [isMicEnabled, setIsMicEnabled] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [remoteParticipants, setRemoteParticipants] = useState<RemoteParticipantInfo[]>([]);
  const [conversationTurns, setConversationTurns] = useState<ConversationTurn[]>([]);
  const [error, setError] = useState<string | null>(null);

  const clearConversationTurns = useCallback(() => {
    setConversationTurns([]);
  }, []);

  const roomRef = useRef<Room | null>(null);
  const durationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const meterAnimationRef = useRef<number | null>(null);
  const attachedAudioElements = useRef<Map<string, HTMLAudioElement>>(new Map());

  // Clean up Web Audio meter
  const stopAudioMeter = useCallback(() => {
    if (meterAnimationRef.current) {
      cancelAnimationFrame(meterAnimationRef.current);
      meterAnimationRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setAudioLevel(0);
  }, []);

  // Start Web Audio meter for smooth real-time volume bar visualization
  const startAudioMeter = useCallback((mediaStreamTrack: MediaStreamTrack) => {
    try {
      stopAudioMeter();
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.4;
      analyserRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(new MediaStream([mediaStreamTrack]));
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const updateMeter = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i] ?? 0;
        }
        const average = sum / dataArray.length;
        // Normalize 0-255 to 0.0-1.0
        const normalized = Math.min(1, Math.max(0, average / 128));
        setAudioLevel(normalized);

        meterAnimationRef.current = requestAnimationFrame(updateMeter);
      };

      updateMeter();
    } catch {
      // Non-fatal: visualizer fallback
    }
  }, [stopAudioMeter]);

  // Update remote participants state
  const syncRemoteParticipants = useCallback((room: Room) => {
    const list: RemoteParticipantInfo[] = [];
    room.remoteParticipants.forEach((participant) => {
      list.push({
        identity: participant.identity,
        name: participant.name || participant.identity,
        isSpeaking: participant.isSpeaking,
        audioLevel: participant.audioLevel,
      });
    });
    setRemoteParticipants(list);
  }, []);

  // Disconnect function
  const disconnect = useCallback(async () => {
    stopAudioMeter();

    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }

    // Detach all audio elements
    attachedAudioElements.current.forEach((el) => {
      el.pause();
      el.remove();
    });
    attachedAudioElements.current.clear();

    if (roomRef.current) {
      const room = roomRef.current;
      roomRef.current = null;
      try {
        await room.disconnect();
      } catch {
        // Ignored during teardown
      }
    }

    setStatus("disconnected");
    setIsMicEnabled(false);
    setIsMuted(false);
    setAudioLevel(0);
    setRemoteParticipants([]);
  }, [stopAudioMeter]);

  // Connect function
  const connect = useCallback(
    async (params?: FetchTokenParams) => {
      setError(null);
      await disconnect();

      try {
        // Step 1: Request token from secure backend endpoint
        setStatus("requesting_token");
        const tokenData = await livekitApi.getToken(params);

        setRoomName(tokenData.roomName);
        setServerUrl(tokenData.url);
        setParticipantIdentity(tokenData.participantIdentity);
        setParticipantName(tokenData.participantName);

        // Step 2: Initialize LiveKit Room instance
        setStatus("connecting");
        const room = new Room({
          adaptiveStream: true,
          dynacast: true,
        });
        roomRef.current = room;

        // Step 3: Wire up room events
        room.on(RoomEvent.Connected, () => {
          setStatus("connected");
          setDuration(0);
          durationTimerRef.current = setInterval(() => {
            setDuration((prev) => prev + 1);
          }, 1000);
          syncRemoteParticipants(room);
        });

        room.on(RoomEvent.Disconnected, () => {
          setStatus("disconnected");
          setIsMicEnabled(false);
          setIsMuted(false);
          stopAudioMeter();
          if (durationTimerRef.current) {
            clearInterval(durationTimerRef.current);
            durationTimerRef.current = null;
          }
        });

        room.on(RoomEvent.Reconnecting, () => {
          setStatus("reconnecting");
        });

        room.on(RoomEvent.Reconnected, () => {
          setStatus("connected");
        });

        room.on(RoomEvent.ParticipantConnected, () => {
          syncRemoteParticipants(room);
        });

        room.on(RoomEvent.ParticipantDisconnected, () => {
          syncRemoteParticipants(room);
        });

        room.on(RoomEvent.ActiveSpeakersChanged, () => {
          syncRemoteParticipants(room);
        });

        // Remote audio subscription handler
        room.on(
          RoomEvent.TrackSubscribed,
          (track: RemoteTrack, _publication: RemoteTrackPublication, participant: RemoteParticipant) => {
            if (track.kind === Track.Kind.Audio) {
              const audioElement = track.attach();
              audioElement.setAttribute("data-participant", participant.identity);
              document.body.appendChild(audioElement);
              attachedAudioElements.current.set(`${participant.identity}-${track.sid}`, audioElement);
            }
          },
        );

        room.on(
          RoomEvent.TrackUnsubscribed,
          (track: RemoteTrack, _publication: RemoteTrackPublication, participant: RemoteParticipant) => {
            const key = `${participant.identity}-${track.sid}`;
            const el = attachedAudioElements.current.get(key);
            if (el) {
              track.detach(el);
              el.remove();
              attachedAudioElements.current.delete(key);
            }
          },
        );

        // Listen for agent transcripts and LLM responses published over WebRTC DataChannel
        room.on(
          RoomEvent.DataReceived,
          (payload: Uint8Array, _participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
            if (topic === "agent_transcript" || !topic) {
              try {
                const text = new TextDecoder().decode(payload);
                const data = JSON.parse(text);
                if (data.type === "transcript_turn") {
                  setConversationTurns((prev) => [
                    ...prev,
                    {
                      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                      userText: data.userText,
                      responseText: data.responseText,
                      ttftMs: data.ttftMs,
                      totalLatencyMs: data.totalLatencyMs,
                      timestamp: data.timestamp || new Date().toISOString(),
                    },
                  ]);
                }
              } catch {
                // Ignore non-JSON or unhandled data packets
              }
            }
          },
        );

        // Step 4: Connect to LiveKit server with token
        await room.connect(tokenData.url, tokenData.token);

        // Step 5: Acquire microphone and publish audio track
        try {
          await room.localParticipant.setMicrophoneEnabled(true);
          setIsMicEnabled(true);
          setIsMuted(false);

          // Find local audio track for volume meter
          const audioPublication = Array.from(room.localParticipant.audioTrackPublications.values())[0];
          const localAudioTrack = audioPublication?.audioTrack;
          if (localAudioTrack?.mediaStreamTrack) {
            startAudioMeter(localAudioTrack.mediaStreamTrack);
          }
        } catch (micErr: unknown) {
          const micError = micErr as Error;
          if (micError.name === "NotAllowedError" || micError.message.includes("Permission denied")) {
            setError("Microphone permission denied. Please allow microphone access in your browser to test voice.");
          } else if (micError.name === "NotFoundError") {
            setError("No microphone found. Please connect an audio input device.");
          } else {
            setError(`Microphone error: ${micError.message || "Failed to access microphone"}`);
          }
        }
      } catch (err: unknown) {
        const error = err as Error;
        setStatus("error");
        setError(error.message || "Failed to establish LiveKit connection");
        await disconnect();
      }
    },
    [disconnect, startAudioMeter, stopAudioMeter, syncRemoteParticipants],
  );

  // Toggle Mute / Unmute
  const toggleMute = useCallback(async () => {
    if (!roomRef.current || roomRef.current.state !== LKConnectionState.Connected) {
      return;
    }

    try {
      const nextMuteState = !isMuted;
      await roomRef.current.localParticipant.setMicrophoneEnabled(!nextMuteState);
      setIsMuted(nextMuteState);
      setIsMicEnabled(!nextMuteState);
      if (nextMuteState) {
        setAudioLevel(0);
      }
    } catch (err: unknown) {
      const error = err as Error;
      setError(`Failed to toggle microphone: ${error.message}`);
    }
  }, [isMuted]);

  // Teardown on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
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
  };
}
