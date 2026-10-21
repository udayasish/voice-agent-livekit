/** Bound even providers that ignore AbortSignal; always detach the listener. */
export async function cancellable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      abort = () => reject(signal.reason ?? new DOMException("Cancelled", "AbortError"));
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    })]);
  } finally { if (abort) signal.removeEventListener("abort", abort); }
}

export async function withDeadline<T>(signal: AbortSignal, milliseconds: number, run: (bounded: AbortSignal) => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(new DOMException("Deadline exceeded", "TimeoutError")), milliseconds);
  const bounded = AbortSignal.any([signal, controller.signal]);
  try { return await cancellable(run(bounded), bounded); }
  finally { clearTimeout(timer); controller.abort(); }
}
