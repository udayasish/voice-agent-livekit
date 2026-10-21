/** Keep listening, but avoid repeating the same recognition apology before useful input. */
export class UnusableSpeechRecoveryGate {
  private prompted = false;
  acceptedInput(): void { this.prompted = false; }
  shouldPrompt(): boolean {
    if (this.prompted) return false;
    this.prompted = true; return true;
  }
}

/** Two bounded reminders, armed only after completed question playback. */
export class VoiceRecoveryTimer {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private attempts = 0;
  private closed = false;
  private epoch = 0;
  constructor(private readonly remind: () => void | Promise<void>, private readonly delays: readonly number[] = [8000, 15000]) {}
  activity(): void { this.pause(); this.attempts = 0; }
  pause(): void { this.epoch++; if (this.timer) clearTimeout(this.timer); this.timer = undefined; }
  playbackCompleted(isQuestion: boolean): void {
    this.pause();
    if (this.closed || !isQuestion || this.attempts >= this.delays.length) return;
    const epoch = this.epoch;
    this.timer = setTimeout(() => {
      this.timer = undefined; this.attempts++;
      // The caller owns error reporting and re-arms only after delivered speech.
      void Promise.resolve().then(() => { if (!this.closed && this.epoch === epoch) return this.remind(); }).catch(() => {});
    }, this.delays[this.attempts]);
  }
  close(): void { this.closed = true; this.pause(); }
}

/** A failed or interrupted drain cannot establish readback completion. */
export async function waitForPlayback(source: { waitForPlayout(): Promise<void> }, audioDurationMs: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    await Promise.race([source.waitForPlayout(), new Promise<never>((_, reject) => {
      abort = () => reject(new DOMException("Playback cancelled", "AbortError"));
      signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => reject(new Error("Playback drain timeout")), Math.min(60000, Math.max(2000, audioDurationMs + 2000)));
    })]);
    signal.throwIfAborted();
  } finally { if (timer) clearTimeout(timer); if (abort) signal.removeEventListener("abort", abort); }
}
