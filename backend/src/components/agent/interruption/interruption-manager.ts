import type { AgentVoicePhase, InterruptionEvent } from "./types.js";

/**
 * Single authoritative interruption coordinator managing conversational turn phases,
 * AbortController lifecycles, and frame delivery gating for LiveKit voice agents.
 */
export class InterruptionManager {
  private phase: AgentVoicePhase = "idle";
  private activeTurnId = 0;
  private interruptionCount = 0;
  private playbackStartTime = 0;

  private greetingController: AbortController | null = null;
  private llmController: AbortController | null = null;
  private ttsController: AbortController | null = null;
  private invalidatedTurnIds = new Set<number>();

  /**
   * Starts greeting phase, creates internal greeting controller, returns its signal.
   */
  startGreeting(): AbortSignal {
    if (this.greetingController && !this.greetingController.signal.aborted) {
      this.greetingController.abort();
    }
    this.greetingController = new AbortController();
    this.phase = "greeting";
    this.playbackStartTime = Date.now();
    return this.greetingController.signal;
  }

  /**
   * Normal completion of greeting. Cleans up greeting controller without aborting.
   */
  finishGreeting(): void {
    if (this.phase === "greeting") {
      this.phase = "listening";
      this.greetingController = null;
    }
  }

  /**
   * Monotonically increments active turn ID, invalidating any previous turn.
   */
  beginTurn(): number {
    this.activeTurnId++;
    return this.activeTurnId;
  }

  /**
   * Starts thinking phase (LLM inference) for a turn, returns LLM abort signal.
   */
  startThinking(turnId: number): AbortSignal {
    if (this.llmController && !this.llmController.signal.aborted) {
      this.llmController.abort();
    }

    if (turnId !== this.activeTurnId) {
      return AbortSignal.abort();
    }

    this.llmController = new AbortController();
    this.phase = "thinking";
    return this.llmController.signal;
  }

  /**
   * Normal completion of thinking phase.
   */
  finishThinking(turnId: number): void {
    if (turnId === this.activeTurnId && this.phase === "thinking") {
      this.phase = "listening";
      this.llmController = null;
    }
  }

  /**
   * Starts speaking phase (TTS playback) for a turn, returns TTS abort signal.
   */
  startSpeaking(turnId: number): AbortSignal {
    if (this.ttsController && !this.ttsController.signal.aborted) {
      this.ttsController.abort();
    }

    if (turnId !== this.activeTurnId) {
      return AbortSignal.abort();
    }

    this.ttsController = new AbortController();
    this.phase = "speaking";
    this.playbackStartTime = Date.now();
    return this.ttsController.signal;
  }

  /**
   * Normal completion of speaking phase.
   */
  finishSpeaking(turnId: number): void {
    if (turnId === this.activeTurnId && this.phase === "speaking") {
      this.phase = "listening";
      this.ttsController = null;
    }
  }

  /**
   * Handles VAD speech start. If greeting, thinking, or speaking, immediately
   * aborts the corresponding controller, transitions to 'listening', and returns InterruptionEvent.
   * If already 'listening' or 'idle', returns null.
   */
  handleUserSpeechStart(): InterruptionEvent | null {
    if (this.phase === "greeting") {
      const priorPhase = this.phase;
      this.greetingController?.abort();
      this.greetingController = null;
      this.phase = "listening";
      this.interruptionCount++;
      const duration = Date.now() - this.playbackStartTime;

      return {
        turnId: this.activeTurnId,
        phase: priorPhase,
        playbackDurationMs: Math.max(0, duration),
        interruptionCount: this.interruptionCount,
        timestamp: new Date().toISOString(),
      };
    }

    if (this.phase === "thinking") {
      const priorPhase = this.phase;
      this.invalidatedTurnIds.add(this.activeTurnId);
      this.llmController?.abort();
      this.llmController = null;
      this.phase = "listening";
      this.interruptionCount++;

      return {
        turnId: this.activeTurnId,
        phase: priorPhase,
        playbackDurationMs: 0,
        interruptionCount: this.interruptionCount,
        timestamp: new Date().toISOString(),
      };
    }

    if (this.phase === "speaking") {
      const priorPhase = this.phase;
      this.invalidatedTurnIds.add(this.activeTurnId);
      this.ttsController?.abort();
      this.ttsController = null;
      this.phase = "listening";
      this.interruptionCount++;
      const duration = Date.now() - this.playbackStartTime;

      return {
        turnId: this.activeTurnId,
        phase: priorPhase,
        playbackDurationMs: Math.max(0, duration),
        interruptionCount: this.interruptionCount,
        timestamp: new Date().toISOString(),
      };
    }

    return null;
  }

  /**
   * Frame delivery guard: true ONLY if turnId === activeTurnId AND phase === 'speaking' AND not aborted.
   */
  canDeliverFrame(turnId: number): boolean {
    return (
      turnId === this.activeTurnId &&
      !this.invalidatedTurnIds.has(turnId) &&
      this.phase === "speaking" &&
      this.ttsController !== null &&
      !this.ttsController.signal.aborted
    );
  }

  /**
   * Verifies if turnId is still the active, non-superseded turn.
   */
  isTurnActive(turnId: number): boolean {
    if (turnId !== this.activeTurnId) return false;
    if (this.invalidatedTurnIds.has(turnId)) return false;
    if (this.phase === "thinking" && this.llmController?.signal.aborted) return false;
    if (this.phase === "speaking" && this.ttsController?.signal.aborted) return false;
    return true;
  }

  /**
   * Returns current active turn ID.
   */
  getActiveTurnId(): number {
    return this.activeTurnId;
  }

  /**
   * Returns current voice phase.
   */
  getPhase(): AgentVoicePhase {
    return this.phase;
  }

  /**
   * Total number of confirmed interruptions during the session.
   */
  getInterruptionCount(): number {
    return this.interruptionCount;
  }

  /**
   * Full session reset on disconnect or worker shutdown.
   */
  reset(): void {
    if (this.greetingController && !this.greetingController.signal.aborted) {
      this.greetingController.abort();
    }
    if (this.llmController && !this.llmController.signal.aborted) {
      this.llmController.abort();
    }
    if (this.ttsController && !this.ttsController.signal.aborted) {
      this.ttsController.abort();
    }

    this.greetingController = null;
    this.llmController = null;
    this.ttsController = null;
    this.phase = "idle";
    this.playbackStartTime = 0;
    this.invalidatedTurnIds.clear();
  }
}
