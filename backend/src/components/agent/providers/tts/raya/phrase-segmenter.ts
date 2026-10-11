/**
 * Assamese & Indic phrase segmenter for streaming LLM text to TTS.
 *
 * Breaks continuous text tokens into natural, prosodically coherent sentences
 * using Assamese/Devanagari danda ('।'), double danda ('॥'), and Latin punctuation ('?', '!', '.'),
 * with guardrails against false splits in numbers/decimals and common titles/abbreviations.
 */

// Common titles and abbreviations that shouldn't trigger sentence splits
const ABBREVIATIONS = new Set([
  "ডাঃ", // Dr. (Assamese/Bengali)
  "ডা.",
  "শ্রী",
  "শ্রীমতী",
  "নং", // No.
  "তাং", // Date
  "dr.",
  "mr.",
  "mrs.",
  "ms.",
  "prof.",
  "opd.",
]);

export interface PhraseSplitResult {
  phrases: string[];
  remainder: string;
}

/**
 * Splits text into complete Assamese sentences/phrases and returns any unfinished trailing remainder.
 */
export function splitAssamesePhrases(text: string): PhraseSplitResult {
  if (!text || text.trim().length === 0) {
    return { phrases: [], remainder: "" };
  }

  // Regex matching terminal punctuation:
  // - Danda (U+0964) or Double Danda (U+0965)
  // - Question mark '?'
  // - Exclamation '!'
  // - Period '.' NOT immediately followed by a digit (prevents decimal split e.g. 10.5)
  // Followed by whitespace or end of string
  const boundaryRegex = /([।॥?!]|\.(?!\d))(?:\s+|$)/gu;

  const phrases: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = boundaryRegex.exec(text)) !== null) {
    const boundaryEnd = match.index + match[0].length;
    const candidate = text.slice(lastIndex, boundaryEnd).trim();

    // Check if the candidate ends with a known abbreviation before period
    const lowerCandidate = candidate.toLowerCase();
    const isAbbreviation = Array.from(ABBREVIATIONS).some((abbr) =>
      lowerCandidate.endsWith(abbr),
    );

    if (isAbbreviation) {
      // Don't split on abbreviation, continue scanning
      continue;
    }

    if (candidate.length > 0) {
      phrases.push(candidate);
    }
    lastIndex = boundaryEnd;
  }

  const remainder = text.slice(lastIndex);
  return { phrases, remainder };
}
