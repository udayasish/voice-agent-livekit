import { stt } from "@livekit/agents";
import type * as deepgram from "@livekit/agents-plugin-deepgram";
import { AudioStream, type AudioFrame, type Track } from "@livekit/rtc-node";
import logger from "../lib/logger.js";
import type { TranscriptAudioRange, TranscriptFragment } from "./turn-collector.js";
import { UtteranceAudioBuffer } from "./recognition-recovery.js";
import {
  createLiveKitDeepgramSTT,
  ensureAgentsLogger,
  getDeepgramConfig,
  type DeepgramConfig,
  type ResolvedDeepgramConfig,
} from "../components/agent/providers/stt/index.js";

export interface STTCallbacks {
  /** The audio reader has delivered its first frame into the configured SDK stream. */
  onAudioReady?: () => void;
  onSpeechStart?: (event: stt.SpeechEvent) => void | Promise<void>;
  onInterimTranscript?: (event: stt.SpeechEvent, latencyMs: number) => void | Promise<void>;
  onFinalTranscript?: (event: stt.SpeechEvent, latencyMs: number, audioRange?: TranscriptAudioRange) => void | Promise<void>;
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
  endInput?(): void;
  flush?(): void;
}
export interface STTTrackSubscription {
  readonly stream: ManagedSTTStream;
  readonly inputMode: STTInputMode;
  /** Optional trusted language for a pending confirmation; omission restores the configured baseline. */
  setInputMode(mode: STTInputMode, conversationLanguage?: string): void;
  recoverSpeech(range: TranscriptAudioRange, signal: AbortSignal): Promise<TranscriptFragment | undefined>;
  discardRecoveryAudio(): void;
  requestFinalTranscript(): void;
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
  let recognitionLanguage = baseline.language;
  let replayLanguage = baseline.language;
  let audioElapsedMs = 0;
  let audioReady = false;
  const recoveryAudio = new UtteranceAudioBuffer();
  let recoveryController: AbortController | undefined;
  let recoveredThrough = -1;
  const audioOffsets = new WeakMap<ManagedSTTStream, number>();
  const createStream = (mode: STTInputMode, language = baseline.language): ManagedSTTStream => {
    const stream = provider.stream();
    audioOffsets.set(stream, audioElapsedMs);
    try {
      // Configure a new stream before its scheduled SDK connection starts. Never
      // mutate the prewarmed/shared provider or reuse events from an old socket.
      stream.updateOptions(mode === "english-digits"
        ? { language: "en-IN", numerals: true, smartFormat: false, punctuate: false }
        : { ...baseline, language, numerals: false });
      return stream;
    } catch (error) { stream.close(); throw error; }
  };
  let current: ManagedSTTStream;
  try { current = createStream(inputMode); }
  catch (error) { void reader.cancel().catch(() => {}); reader.releaseLock(); throw error; }

  const close = () => {
    if (isClosed) return;
    isClosed = true;
    recoveryController?.abort(); recoveryAudio.clear();
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
            case stt.SpeechEventType.FINAL_TRANSCRIPT: {
              const alternative = event.alternatives?.[0];
              const offset = audioOffsets.get(stream) ?? 0;
              const audioRange = alternative && alternative.endTime > alternative.startTime
                ? { startMs: offset + alternative.startTime * 1000, endMs: offset + alternative.endTime * 1000 } : undefined;
              dispatchTranscriptCallback(() => callbacks.onFinalTranscript?.(event, latencyMs, audioRange), () => {
                logger.error("[agent:stt] Error in final-transcript callback");
              });
              break;
            }
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
        if ((inputMode as STTInputMode) === "english-digits") recoveryAudio.push(frame.value, audioElapsedMs);
        current.pushFrame(frame.value);
        if (!audioReady) { audioReady = true; callbacks.onAudioReady?.(); }
        audioElapsedMs += frame.value.samplesPerChannel / frame.value.sampleRate * 1000;
      }
    } catch { if (!isClosed) await reportError(); }
    finally { close(); reader.releaseLock(); }
  })();

  return {
    get stream() { return current; },
    get inputMode() { return inputMode; },
    setInputMode(mode, conversationLanguage) {
      const language = mode === "english-digits" ? "en-IN" : conversationLanguage ?? baseline.language;
      replayLanguage = conversationLanguage ?? baseline.language;
      if (isClosed || (mode === inputMode && language === recognitionLanguage)) return;
      recoveryController?.abort(); recoveryAudio.clear();
      const next = createStream(mode, language);
      const previous = current;
      current = next;
      inputMode = mode;
      recognitionLanguage = language;
      void consume(next);
      try { previous.close(); } catch { logger.warn("[agent:stt] Replaced stream cleanup failed"); }
      callbacks.onInputModeChanged?.(mode, language);
    },
    discardRecoveryAudio() { recoveryController?.abort(); recoveryAudio.clear(); },
    requestFinalTranscript() { if (!isClosed) current.flush?.(); },
    async recoverSpeech(range, signal) {
      signal.throwIfAborted();
      if (isClosed || inputMode !== "english-digits" || range.endMs <= recoveredThrough) return undefined;
      const frames = recoveryAudio.slice(range);
      if (!frames) return undefined;
      recoveredThrough = range.endMs;
      recoveryController?.abort();
      const controller = new AbortController(); recoveryController = controller;
      const abort = () => controller.abort(); signal.addEventListener("abort", abort, { once: true });
      let temporary: ManagedSTTStream | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const language = replayLanguage;
      try {
        temporary = createStream("conversation", language);
        if (!temporary.endInput) return undefined;
        const stream = temporary;
        const collect = (async () => {
          const parts: TranscriptFragment[] = [];
          for await (const event of stream) {
            controller.signal.throwIfAborted();
            if (event.type !== stt.SpeechEventType.FINAL_TRANSCRIPT) continue;
            const a = event.alternatives?.[0];
            if (a?.text.trim() && Number.isFinite(a.confidence) && a.confidence >= 0.30) parts.push({ text: a.text.trim(),
              confidence: a.confidence, language, latencyMs: 0, audioRange: range });
          }
          if (!parts.length) return undefined;
          return { ...parts[0]!, text: parts.map(p => p.text).join(" "), confidence: Math.min(...parts.map(p => p.confidence)) };
        })().catch(() => undefined);
        const stopped = new Promise<undefined>(resolve => {
          controller.signal.addEventListener("abort", () => resolve(undefined), { once: true });
          timer = setTimeout(() => { controller.abort(); resolve(undefined); }, 3000);
        });
        for (const frame of frames) { controller.signal.throwIfAborted(); stream.pushFrame(frame); }
        // The installed SDK starts its run asynchronously and skips connection
        // entirely if input was closed before that task entered its loop.
        // Match its startSoon(setTimeout(0)) phase; setImmediate can run first.
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        controller.signal.throwIfAborted();
        stream.flush?.();
        stream.endInput!();
        const result = await Promise.race([collect, stopped]);
        signal.throwIfAborted();
        return controller.signal.aborted ? undefined : result;
      } catch { signal.throwIfAborted(); return undefined; }
      finally {
        if (timer) clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        try { temporary?.close(); } catch { /* Temporary stream only. */ }
        if (recoveryController === controller) { recoveryController = undefined; recoveryAudio.clear(); }
      }
    },
    close,
  };
}
