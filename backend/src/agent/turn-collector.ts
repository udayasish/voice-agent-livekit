export const NORMAL_TURN_PAUSE_MS = 1200;
export const DICTATION_TURN_PAUSE_MS = 3000;

export interface TranscriptFragment {
  text: string;
  confidence: number;
  language: string;
  latencyMs: number;
}

/** A finalized STT segment is not necessarily the end of the caller's turn. */
export class TurnCollector {
  private fragments: TranscriptFragment[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private speaking = false;
  private closed = false;

  constructor(private readonly options: {
    pauseMs: () => number;
    onTurn: (turn: TranscriptFragment) => void | Promise<void>;
    onError: () => void;
  }) {}

  speechStarted(): void { this.speaking = true; this.cancelTimer(); }
  speechEnded(): void { this.speaking = false; this.schedule(); }
  interimReceived(): void { this.cancelTimer(); if (!this.speaking) this.schedule(); }
  addFinal(fragment: TranscriptFragment): void {
    if (this.closed || !fragment.text.trim()) return;
    this.fragments.push({ ...fragment, text: fragment.text.trim() });
    this.cancelTimer();
    if (!this.speaking) this.schedule();
  }
  close(): void { this.closed = true; this.cancelTimer(); this.fragments = []; }
  private cancelTimer(): void { if (this.timer) clearTimeout(this.timer); this.timer = undefined; }
  private schedule(): void {
    if (this.closed || this.speaking || !this.fragments.length) return;
    this.cancelTimer();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.closed || this.speaking) return;
      const fragments = this.fragments;
      this.fragments = [];
      const length = fragments.reduce((sum, part) => sum + part.text.length, 0);
      const turn: TranscriptFragment = {
        text: fragments.map(part => part.text).join(" "),
        confidence: fragments.reduce((sum, part) => sum + part.confidence * part.text.length, 0) / length,
        language: fragments.at(-1)?.language ?? "as",
        latencyMs: Math.max(...fragments.map(part => part.latencyMs)),
      };
      try { void Promise.resolve(this.options.onTurn(turn)).catch(this.options.onError); }
      catch { this.options.onError(); }
    }, this.options.pauseMs());
  }
}
