/**
 * Type contracts for Raya BakBak Text-to-Speech (TTS) API and streaming events.
 */

export type RayaModel = "standard" | "m1";

export interface RayaVoice {
  id: string;
  name: string;
  language: string;
  model: RayaModel;
}

export interface RayaVoicesResponse {
  voices: RayaVoice[];
  count: number;
}

export interface RayaTTSRequest {
  text: string;
  voice_id: string;
  model: RayaModel;
  language: string;
  codec?: "wav" | "pcm" | "mp3" | "mulaw" | undefined;
  sample_rate: number;
  speed: number;
}

export interface RayaSSEChunkEvent {
  type: "chunk";
  status_code: number;
  done: false;
  /** Base64-encoded PCM F32LE audio chunk */
  data: string;
  /** Generation time for this chunk in seconds */
  step_time?: number | undefined;
}

export interface RayaSSEDoneEvent {
  type: "done";
  status_code: number;
  done: true;
}

export type RayaSSEEvent = RayaSSEChunkEvent | RayaSSEDoneEvent;

export interface RayaTTSConfig {
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
  language?: string | undefined;
  model?: RayaModel | undefined;
  voiceId?: string | undefined;
  sampleRate?: number | undefined;
  speed?: number | undefined;
  connectTimeoutMs?: number | undefined;
  firstChunkTimeoutMs?: number | undefined;
  requestTimeoutMs?: number | undefined;
}

export interface ResolvedRayaTTSConfig {
  apiKey: string;
  baseUrl: string;
  language: string;
  model: RayaModel;
  voiceId: string;
  sampleRate: number;
  speed: number;
  connectTimeoutMs: number;
  firstChunkTimeoutMs: number;
  requestTimeoutMs: number;
}
