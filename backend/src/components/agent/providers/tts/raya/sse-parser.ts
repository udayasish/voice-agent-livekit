import { RayaProtocolError } from "./errors.js";
import type { RayaSSEEvent } from "./types.js";

/**
 * Parses an SSE (Server-Sent Events) HTTP response stream incrementally.
 * Handles split network chunks, arbitrary buffer boundaries, CRLF (\r\n) and LF (\n) delimiters,
 * and yields typed RayaSSEEvent objects.
 */
export async function* parseSSEStream(
  stream: ReadableStream<Uint8Array>,
  abortSignal?: AbortSignal,
): AsyncGenerator<RayaSSEEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      if (abortSignal?.aborted) {
        break;
      }

      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // Match SSE event boundaries (two consecutive newlines)
      const boundaryRegex = /\r?\n\r?\n/;
      let match = boundaryRegex.exec(buffer);

      while (match) {
        const rawEvent = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);

        if (rawEvent.trim().length > 0) {
          const lines = rawEvent.split(/\r?\n/);
          let dataContent = "";

          for (const line of lines) {
            if (line.startsWith("data:")) {
              const dataValue = line.slice(5).trim();
              dataContent = dataContent ? `${dataContent}\n${dataValue}` : dataValue;
            }
          }

          if (dataContent) {
            try {
              const parsed = JSON.parse(dataContent) as RayaSSEEvent;
              yield parsed;
            } catch {
              throw new RayaProtocolError(
                `Failed to parse SSE JSON payload: ${dataContent.slice(0, 100)}`,
              );
            }
          }
        }

        match = boundaryRegex.exec(buffer);
      }
    }

    // Flush any remaining trailing event
    if (!abortSignal?.aborted && buffer.trim().length > 0) {
      const lines = buffer.split(/\r?\n/);
      let dataContent = "";
      for (const line of lines) {
        if (line.startsWith("data:")) {
          const dataValue = line.slice(5).trim();
          dataContent = dataContent ? `${dataContent}\n${dataValue}` : dataValue;
        }
      }
      if (dataContent) {
        try {
          const parsed = JSON.parse(dataContent) as RayaSSEEvent;
          yield parsed;
        } catch {
          // If incomplete at stream termination, ignore trailing whitespace/noise
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Ignore if reader lock already released
    }
  }
}
