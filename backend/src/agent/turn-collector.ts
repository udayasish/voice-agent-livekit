export const NORMAL_TURN_PAUSE_MS = 1200;
export const DICTATION_TURN_PAUSE_MS = 3000;

/** Milliseconds on the incoming track's audio timeline, including recognizer replacements. */
export interface TranscriptAudioRange { startMs: number; endMs: number }

export interface TranscriptFragment {
  text: string;
  confidence: number;
  language: string;
  latencyMs: number;
  audioRange?: TranscriptAudioRange;
}

/** Match recognized words to qualified Silero speech, rather than trusting text from silence. */
export class SpeechTranscriptGate {
  private readonly speech: TranscriptAudioRange[] = [];
  private active: TranscriptAudioRange | undefined;
  // The VAD and STT readers attach separately. Allow a small frame/prefix alignment margin.
  private readonly paddingMs = 300;

  speechStarted(audioMs: number, speechDurationMs: number): void {
    this.active = { startMs: Math.max(0, audioMs - speechDurationMs - this.paddingMs), endMs: Infinity };
    this.speech.push(this.active);
    if (this.speech.length > 128) this.speech.shift();
  }
  speechEnded(audioMs: number, silenceDurationMs: number): void {
    if (this.active) this.active.endMs = Math.max(this.active.startMs, audioMs - silenceDurationMs + this.paddingMs);
    this.active = undefined;
  }
  rejection(fragment: TranscriptFragment): "low_confidence" | "missing_timing" | "no_speech" | undefined {
    // Text length cannot make low-confidence recognition trustworthy.
    if (!Number.isFinite(fragment.confidence) || fragment.confidence < 0.30 || fragment.confidence > 1) return "low_confidence";
    const range = fragment.audioRange;
    if (!range || !Number.isFinite(range.startMs) || !Number.isFinite(range.endMs)
      || range.startMs < 0 || range.endMs <= range.startMs) return "missing_timing";
    return this.speech.some(speech => range.startMs < speech.endMs && range.endMs > speech.startMs) ? undefined : "no_speech";
  }
}

/** A finalized STT segment is not necessarily the end of the caller's turn. */
export class TurnCollector {
  private fragments: TranscriptFragment[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private speaking = false;
  private closed = false;
  private qualifiedSpeech = false;
  private awaitingFinal = false;

  constructor(private readonly options: {
    pauseMs: () => number;
    onTurn: (turn: TranscriptFragment) => void | Promise<void>;
    onError: () => void;
    /** Evaluate after the listening interval so asynchronous VAD has time to qualify speech. */
    acceptFragment?: (fragment: TranscriptFragment) => boolean;
    onUnusable?: (reason: "speech_unclear" | "no_transcript") => void | Promise<void>;
    /** One bounded grace window for a recognizer final after qualified speech. */
    finalTranscriptGraceMs?: number;
    onAwaitingFinal?: () => void;
  }) {}

  speechStarted(): void { this.speaking = true; this.qualifiedSpeech = true; this.awaitingFinal = false; this.cancelTimer(); }
  speechEnded(): void { this.speaking = false; this.schedule(); }
  interimReceived(): void { if (this.awaitingFinal) return; this.cancelTimer(); if (!this.speaking) this.schedule(); }
  addFinal(fragment: TranscriptFragment): void {
    if (this.closed || !fragment.text.trim()) return;
    this.fragments.push({ ...fragment, text: fragment.text.trim() });
    this.cancelTimer();
    if (!this.speaking) this.schedule(this.awaitingFinal ? 0 : this.options.pauseMs());
  }
  close(): void { this.closed = true; this.cancelTimer(); this.fragments = []; }
  private cancelTimer(): void { if (this.timer) clearTimeout(this.timer); this.timer = undefined; }
  private schedule(delayMs = this.options.pauseMs()): void {
    if (this.closed || this.speaking || (!this.fragments.length && !this.qualifiedSpeech)) return;
    this.cancelTimer();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.closed || this.speaking) return;
      if (!this.fragments.length && this.qualifiedSpeech && !this.awaitingFinal && (this.options.finalTranscriptGraceMs ?? 0) > 0) {
        this.awaitingFinal = true;
        try { this.options.onAwaitingFinal?.(); } catch { this.options.onError(); }
        this.schedule(this.options.finalTranscriptGraceMs);
        return;
      }
      const hadFragments = this.fragments.length > 0;
      const fragments = this.fragments.filter(fragment => this.options.acceptFragment?.(fragment) ?? true);
      this.fragments = [];
      const qualified = this.qualifiedSpeech; this.qualifiedSpeech = false;
      this.awaitingFinal = false;
      if (!fragments.length) {
        if (qualified && this.options.onUnusable) {
          try { void Promise.resolve(this.options.onUnusable(hadFragments ? "speech_unclear" : "no_transcript")).catch(this.options.onError); }
          catch { this.options.onError(); }
        }
        return;
      }
      const length = fragments.reduce((sum, part) => sum + part.text.length, 0);
      const turn: TranscriptFragment = {
        text: fragments.map(part => part.text).join(" "),
        confidence: fragments.reduce((sum, part) => sum + part.confidence * part.text.length, 0) / length,
        language: fragments.at(-1)?.language ?? "as",
        latencyMs: Math.max(...fragments.map(part => part.latencyMs)),
        ...(fragments.every(part => part.audioRange) ? { audioRange: { startMs: Math.min(...fragments.map(p => p.audioRange!.startMs)),
          endMs: Math.max(...fragments.map(p => p.audioRange!.endMs)) } } : {}),
      };
      try { void Promise.resolve(this.options.onTurn(turn)).catch(this.options.onError); }
      catch { this.options.onError(); }
    }, delayMs);
  }
}
