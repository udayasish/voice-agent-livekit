import { stt } from "@livekit/agents";
import type * as deepgram from "@livekit/agents-plugin-deepgram";
import { AudioStream, type AudioFrame, type Track } from "@livekit/rtc-node";
import logger from "../lib/logger.js";
import {
  createLiveKitDeepgramSTT,
  ensureAgentsLogger,
  getDeepgramConfig,
  type DeepgramConfig,
  type ResolvedDeepgramConfig,
} from "../components/agent/providers/stt/index.js";

export interface STTCallbacks {
  onSpeechStart?: (event: stt.SpeechEvent) => void | Promise<void>;
  onInterimTranscript?: (event: stt.SpeechEvent, latencyMs: number) => void | Promise<void>;
  onFinalTranscript?: (event: stt.SpeechEvent, latencyMs: number) => void | Promise<void>;
  onSpeechEnd?: (event: stt.SpeechEvent) => void | Promise<void>;
  onError?: (error: Error) => void | Promise<void>;
  onInputModeChanged?: (mode: STTInputMode, language: string) => void;
}

/** Continue draining speech events while a final transcript runs LLM/TTS work. */
export function dispatchTranscriptCallback(run: () => void | Promise<void>, onError: () => void): void {
  try { void Promise.resolve(run()).catch(onError); }
  catch { onError(); }
}

export type STTInputMode = "conversation" | "english-digits";
export type STTRecognitionOptions = Pick<deepgram.STTOptions, "language" | "numerals" | "smartFormat" | "punctuate">;
/** Minimal SDK surface, also used by offline stream-lifecycle tests. */
export interface ManagedSTTStream extends AsyncIterable<stt.SpeechEvent> {
  updateOptions(options: Partial<deepgram.STTOptions>): void;
  pushFrame(frame: AudioFrame): void;
  close(): void;
  readonly terminalError?: Error | undefined;
}
export interface STTTrackSubscription {
  readonly stream: ManagedSTTStream;
  readonly inputMode: STTInputMode;
  setInputMode(mode: STTInputMode): void;
  close(): void;
}

/**
 * Loads and initializes Deepgram Nova-3 STT for the LiveKit Agent worker.
 * Returns null if DEEPGRAM_API_KEY is not configured (preserving ₹0 local development).
 */
export async function loadDeepgramSTT(
  opts?: Partial<DeepgramConfig>,
): Promise<deepgram.STT | null> {
  ensureAgentsLogger();
  const config = getDeepgramConfig(opts);

  if (!config.isConfigured) {
    logger.info(
      "[agent:stt] DEEPGRAM_API_KEY not configured. Real-time cloud STT will be disabled for local session.",
    );
    return null;
  }

  try {
    const sttInstance = createLiveKitDeepgramSTT(config);
    logger.info("[agent:stt] Deepgram Nova-3 STT initialized successfully", {
      model: config.model,
      language: config.language,
      sampleRate: config.sampleRate,
    });
    return sttInstance;
  } catch (err) {
    logger.error("[agent:stt] Failed to initialize Deepgram STT", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Attaches a Deepgram STT stream to an incoming WebRTC audio track.
 * Subscribes to 16kHz mono audio frames, feeds the Deepgram WebSocket pipeline,
 * tracks latency metrics, and dispatches typed callbacks.
 */
export function attachSTTToTrack(
  sttInstance: deepgram.STT,
  track: Track,
  callbacks: STTCallbacks,
  abortSignal?: AbortSignal,
): STTTrackSubscription {
  return attachSTTToAudio(sttInstance, new AudioStream(track, 16000, 1), callbacks, abortSignal);
}

/** Own one continuous audio reader while replacing only this participant's recognizer. */
export function attachSTTToAudio(
  provider: { stream(): ManagedSTTStream },
  audio: Pick<AudioStream, "getReader">,
  callbacks: STTCallbacks,
  abortSignal?: AbortSignal,
  baseline: Pick<ResolvedDeepgramConfig, "language" | "smartFormat" | "punctuate"> = getDeepgramConfig(),
): STTTrackSubscription {
  ensureAgentsLogger();
  const reader = audio.getReader();
  let isClosed = false;
  let inputMode: STTInputMode = "conversation";
  const createStream = (mode: STTInputMode): ManagedSTTStream => {
    const stream = provider.stream();
    try {
      // Configure a new stream before its scheduled SDK connection starts. Never
      // mutate the prewarmed/shared provider or reuse events from an old socket.
      stream.updateOptions(mode === "english-digits"
        ? { language: "en-IN", numerals: true, smartFormat: false, punctuate: false }
        : { ...baseline, numerals: false });
      return stream;
    } catch (error) { stream.close(); throw error; }
  };
  let current: ManagedSTTStream;
  try { current = createStream(inputMode); }
  catch (error) { void reader.cancel().catch(() => {}); reader.releaseLock(); throw error; }

  const close = () => {
    if (isClosed) return;
    isClosed = true;
    abortSignal?.removeEventListener("abort", close);
    try { current.close(); } catch { logger.warn("[agent:stt] Stream cleanup failed"); }
    void reader.cancel().catch(() => logger.warn("[agent:stt] Audio cleanup failed"));
  };
  const reportError = async () => {
    logger.error("[agent:stt] Recognition stream failed");
    try { await callbacks.onError?.(new Error("Speech recognition failed")); } catch { /* Already logged. */ }
  };
  const consume = async (stream: ManagedSTTStream) => {
    let utteranceStartTime: number | null = null;
    try {
      for await (const event of stream) {
        if (isClosed || stream !== current) break;
        if (event.type === stt.SpeechEventType.START_OF_SPEECH) utteranceStartTime = Date.now();
        if (event.type === stt.SpeechEventType.INTERIM_TRANSCRIPT || event.type === stt.SpeechEventType.FINAL_TRANSCRIPT) {
          utteranceStartTime ??= Date.now();
        }
        const latencyMs = utteranceStartTime === null ? 0 : Date.now() - utteranceStartTime;
        try {
          switch (event.type) {
            case stt.SpeechEventType.START_OF_SPEECH: await callbacks.onSpeechStart?.(event); break;
            case stt.SpeechEventType.INTERIM_TRANSCRIPT: await callbacks.onInterimTranscript?.(event, latencyMs); break;
            case stt.SpeechEventType.FINAL_TRANSCRIPT:
              dispatchTranscriptCallback(() => callbacks.onFinalTranscript?.(event, latencyMs), () => {
                logger.error("[agent:stt] Error in final-transcript callback");
              });
              break;
            case stt.SpeechEventType.END_OF_SPEECH:
              await callbacks.onSpeechEnd?.(event); utteranceStartTime = null; break;
          }
        } catch { logger.error("[agent:stt] Speech-event callback failed"); }
      }
      if (!isClosed && stream === current && stream.terminalError) await reportError();
    } catch {
      if (!isClosed && stream === current) await reportError();
    } finally {
      // Closing a superseded stream must not cancel its replacement/audio reader.
      if (stream === current) close();
    }
  };
  void consume(current);
  if (abortSignal?.aborted) close();
  else abortSignal?.addEventListener("abort", close, { once: true });

  void (async () => {
    try {
      while (!isClosed) {
        const frame = await reader.read();
        if (frame.done || isClosed) break;
        // A single reader owns the track: queued new audio goes to the new
        // recognizer even while that recognizer is establishing its socket.
        current.pushFrame(frame.value);
      }
    } catch { if (!isClosed) await reportError(); }
    finally { close(); reader.releaseLock(); }
  })();

  return {
    get stream() { return current; },
    get inputMode() { return inputMode; },
    setInputMode(mode) {
      if (isClosed || mode === inputMode) return;
      const next = createStream(mode);
      const previous = current;
      current = next;
      inputMode = mode;
      void consume(next);
      try { previous.close(); } catch { logger.warn("[agent:stt] Replaced stream cleanup failed"); }
      callbacks.onInputModeChanged?.(mode, mode === "english-digits" ? "en-IN" : baseline.language);
    },
    close,
  };
}
