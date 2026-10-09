/**
 * Standard Speech-to-Text evaluation algorithms:
 * - WER (Word Error Rate via dynamic programming / Wagner-Fischer Levenshtein)
 * - CER (Character Error Rate)
 * - Entity Retention Rate (clinical entity extraction match)
 * - System resource profiler (CPU, Heap, RSS, GPU/VRAM)
 */

export interface WERResult {
  wer: number; // 0.0 to 1.0+ (percentage as decimal)
  werPercentage: string; // "12.5%"
  substitutions: number;
  deletions: number;
  insertions: number;
  wordCount: number;
  referenceWords: string[];
  hypothesisWords: string[];
}

export interface CERResult {
  cer: number; // 0.0 to 1.0+
  cerPercentage: string; // "5.2%"
  substitutions: number;
  deletions: number;
  insertions: number;
  charCount: number;
}

export interface EntityEvaluation {
  matched: number;
  total: number;
  retentionRate: number; // 0.0 to 1.0
  retentionPercentage: string; // "100.0%"
  details: Record<string, { expected: string; matched: boolean }>;
}

export interface SystemResourceSnapshot {
  timestamp: number;
  cpuUserUs: number;
  cpuSystemUs: number;
  heapUsedMb: number;
  heapTotalMb: number;
  rssMb: number;
  gpuVramMb: number; // Local VRAM allocation (0 MB for CPU VAD + Cloud Deepgram)
}

export interface ResourceDelta {
  elapsedMs: number;
  cpuPercent: number;
  heapUsedDeltaMb: number;
  rssDeltaMb: number;
  gpuVramMb: number;
}

/**
 * Normalizes speech text for fair evaluation:
 * - NFKC Unicode decomposition/composition (crucial for Indic scripts, Bengali-Assamese conjuncts)
 * - Removes standard punctuation and Indian Danda (।, ॥)
 * - Normalizes redundant whitespace
 * - Converts Latin script to lowercase
 */
export const normalizeText = (text: string): string => {
  return text
    .normalize("NFKC")
    .replace(/[।॥,.?!;:–—"'()\[\]{}`~*&^%$#@!]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
};

/**
 * Computes Word Error Rate (WER) using Levenshtein distance on tokenized words.
 * Formula: WER = (Substitutions + Deletions + Insertions) / Reference Word Count
 */
export const calculateWER = (reference: string, hypothesis: string): WERResult => {
  const normRef = normalizeText(reference);
  const normHyp = normalizeText(hypothesis);

  const refWords = normRef.length > 0 ? normRef.split(" ") : [];
  const hypWords = normHyp.length > 0 ? normHyp.split(" ") : [];

  const n = refWords.length;
  const m = hypWords.length;

  if (n === 0) {
    const wer = m === 0 ? 0 : 1;
    return {
      wer,
      werPercentage: `${(wer * 100).toFixed(1)}%`,
      substitutions: 0,
      deletions: 0,
      insertions: m,
      wordCount: 0,
      referenceWords: refWords,
      hypothesisWords: hypWords,
    };
  }

  // Cost matrix & operation tracking: [i][j] = { cost, s, d, i }
  type Cell = { cost: number; s: number; d: number; ins: number };
  const dp: Cell[][] = Array.from({ length: n + 1 }, () =>
    Array.from({ length: m + 1 }, () => ({ cost: 0, s: 0, d: 0, ins: 0 })),
  );

  for (let i = 0; i <= n; i++) {
    dp[i]![0] = { cost: i, s: 0, d: i, ins: 0 };
  }
  for (let j = 0; j <= m; j++) {
    dp[0]![j] = { cost: j, s: 0, d: 0, ins: j };
  }

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const match = refWords[i - 1] === hypWords[j - 1];
      const subCost = match ? 0 : 1;

      const substitution: Cell = {
        cost: dp[i - 1]![j - 1]!.cost + subCost,
        s: dp[i - 1]![j - 1]!.s + (match ? 0 : 1),
        d: dp[i - 1]![j - 1]!.d,
        ins: dp[i - 1]![j - 1]!.ins,
      };

      const deletion: Cell = {
        cost: dp[i - 1]![j]!.cost + 1,
        s: dp[i - 1]![j]!.s,
        d: dp[i - 1]![j]!.d + 1,
        ins: dp[i - 1]![j]!.ins,
      };

      const insertion: Cell = {
        cost: dp[i]![j - 1]!.cost + 1,
        s: dp[i]![j - 1]!.s,
        d: dp[i]![j - 1]!.d,
        ins: dp[i]![j - 1]!.ins + 1,
      };

      let min = substitution;
      if (deletion.cost < min.cost) min = deletion;
      if (insertion.cost < min.cost) min = insertion;

      dp[i]![j] = min;
    }
  }

  const finalCell = dp[n]![m]!;
  const wer = Number((finalCell.cost / n).toFixed(4));

  return {
    wer,
    werPercentage: `${(wer * 100).toFixed(1)}%`,
    substitutions: finalCell.s,
    deletions: finalCell.d,
    insertions: finalCell.ins,
    wordCount: n,
    referenceWords: refWords,
    hypothesisWords: hypWords,
  };
};

/**
 * Computes Character Error Rate (CER) using Levenshtein distance on characters.
 * Non-space characters are evaluated for character-level precision.
 */
export const calculateCER = (reference: string, hypothesis: string): CERResult => {
  const normRef = normalizeText(reference).replace(/\s+/g, "");
  const normHyp = normalizeText(hypothesis).replace(/\s+/g, "");

  const n = normRef.length;
  const m = normHyp.length;

  if (n === 0) {
    const cer = m === 0 ? 0 : 1;
    return {
      cer,
      cerPercentage: `${(cer * 100).toFixed(1)}%`,
      substitutions: 0,
      deletions: 0,
      insertions: m,
      charCount: 0,
    };
  }

  type Cell = { cost: number; s: number; d: number; ins: number };
  const dp: Cell[][] = Array.from({ length: n + 1 }, () =>
    Array.from({ length: m + 1 }, () => ({ cost: 0, s: 0, d: 0, ins: 0 })),
  );

  for (let i = 0; i <= n; i++) {
    dp[i]![0] = { cost: i, s: 0, d: i, ins: 0 };
  }
  for (let j = 0; j <= m; j++) {
    dp[0]![j] = { cost: j, s: 0, d: 0, ins: j };
  }

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const match = normRef[i - 1] === normHyp[j - 1];
      const subCost = match ? 0 : 1;

      const substitution: Cell = {
        cost: dp[i - 1]![j - 1]!.cost + subCost,
        s: dp[i - 1]![j - 1]!.s + (match ? 0 : 1),
        d: dp[i - 1]![j - 1]!.d,
        ins: dp[i - 1]![j - 1]!.ins,
      };

      const deletion: Cell = {
        cost: dp[i - 1]![j]!.cost + 1,
        s: dp[i - 1]![j]!.s,
        d: dp[i - 1]![j]!.d + 1,
        ins: dp[i - 1]![j]!.ins,
      };

      const insertion: Cell = {
        cost: dp[i]![j - 1]!.cost + 1,
        s: dp[i]![j - 1]!.s,
        d: dp[i]![j - 1]!.d,
        ins: dp[i]![j - 1]!.ins + 1,
      };

      let min = substitution;
      if (deletion.cost < min.cost) min = deletion;
      if (insertion.cost < min.cost) min = insertion;

      dp[i]![j] = min;
    }
  }

  const finalCell = dp[n]![m]!;
  const cer = Number((finalCell.cost / n).toFixed(4));

  return {
    cer,
    cerPercentage: `${(cer * 100).toFixed(1)}%`,
    substitutions: finalCell.s,
    deletions: finalCell.d,
    insertions: finalCell.ins,
    charCount: n,
  };
};

/**
 * Evaluates whether key business/clinical entities are preserved in the hypothesis text.
 * Checks for exact normalized substring inclusion or individual entity token presence.
 */
export const evaluateEntityMatch = (
  referenceEntities: Record<string, string>,
  hypothesis: string,
): EntityEvaluation => {
  const normHyp = normalizeText(hypothesis);
  const total = Object.keys(referenceEntities).length;
  if (total === 0) {
    return {
      matched: 0,
      total: 0,
      retentionRate: 1.0,
      retentionPercentage: "100.0%",
      details: {},
    };
  }

  let matched = 0;
  const details: Record<string, { expected: string; matched: boolean }> = {};

  for (const [key, rawExpected] of Object.entries(referenceEntities)) {
    const normExpected = normalizeText(rawExpected);
    let isMatched = false;

    if (normExpected.length === 0) {
      isMatched = true;
    } else if (normHyp.includes(normExpected)) {
      // Substring match
      isMatched = true;
    } else {
      // Token-level check: if multi-word entity, check if all tokens appear
      const expectedTokens = normExpected.split(" ");
      const allTokensPresent = expectedTokens.every((token) => normHyp.includes(token));
      if (allTokensPresent) {
        isMatched = true;
      } else {
        // Approximate similarity check for minor spelling variations (e.g., বৰা vs বরা)
        const hypTokens = normHyp.split(" ");
        const partialMatches = expectedTokens.filter((eTok) =>
          hypTokens.some((hTok) => {
            const cer = calculateCER(eTok, hTok).cer;
            return cer <= 0.25; // 75%+ character similarity
          }),
        );
        isMatched = partialMatches.length >= Math.ceil(expectedTokens.length * 0.75);
      }
    }

    if (isMatched) matched++;
    details[key] = { expected: rawExpected, matched: isMatched };
  }

  const retentionRate = Number((matched / total).toFixed(4));

  return {
    matched,
    total,
    retentionRate,
    retentionPercentage: `${(retentionRate * 100).toFixed(1)}%`,
    details,
  };
};

/**
 * Captures a point-in-time system resource snapshot.
 */
export const takeResourceSnapshot = (): SystemResourceSnapshot => {
  const cpu = process.cpuUsage();
  const mem = process.memoryUsage();

  return {
    timestamp: performance.now(),
    cpuUserUs: cpu.user,
    cpuSystemUs: cpu.system,
    heapUsedMb: Number((mem.heapUsed / (1024 * 1024)).toFixed(2)),
    heapTotalMb: Number((mem.heapTotal / (1024 * 1024)).toFixed(2)),
    rssMb: Number((mem.rss / (1024 * 1024)).toFixed(2)),
    gpuVramMb: 0, // Deepgram runs on cloud API; local node processes and Silero execute strictly on CPU
  };
};

/**
 * Calculates CPU and memory delta across a benchmark interval.
 */
export const computeResourceDelta = (
  start: SystemResourceSnapshot,
  end: SystemResourceSnapshot,
): ResourceDelta => {
  const elapsedMs = Math.max(1, end.timestamp - start.timestamp);
  const totalCpuUs = (end.cpuUserUs - start.cpuUserUs) + (end.cpuSystemUs - start.cpuSystemUs);
  // CPU % = (totalCpuUs in ms / elapsedMs) * 100
  const cpuPercent = Number(((totalCpuUs / 1000 / elapsedMs) * 100).toFixed(2));

  return {
    elapsedMs: Math.round(elapsedMs),
    cpuPercent,
    heapUsedDeltaMb: Number((end.heapUsedMb - start.heapUsedMb).toFixed(2)),
    rssDeltaMb: Number((end.rssMb - start.rssMb).toFixed(2)),
    gpuVramMb: 0,
  };
};
