/**
 * C6-H: corpus source adapter for long-chat curve evidence.
 * Supports synthetic (default), recorded fixture, and optional live-path loading.
 * Never claims live traffic without an explicit corpus file; never flips assembler flags.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  runLongChatCurve,
  type LongChatCurveOptions,
  type LongChatCurveReport,
} from "./coding-long-chat-curve.js";

export type C6hCorpusKind = "synthetic" | "recorded" | "live";

export type C6hCorpusTurn = {
  turn: number;
  rawChars: number;
  /** Optional pre-compressed payload length for recorded/live honesty. */
  compressedChars?: number;
  label?: string;
};

export type C6hCorpusManifest = {
  kind: C6hCorpusKind;
  sessionId?: string;
  source?: string;
  targetCumulativeChars?: number;
  turns: C6hCorpusTurn[];
  notes?: string[];
};

export type C6hCorpusRunResult = {
  kind: C6hCorpusKind;
  live64k: boolean;
  recorded64k: boolean;
  synthetic64k: boolean;
  sourcePath: string | null;
  report: LongChatCurveReport;
  notes: string[];
};

const DEFAULT_RECORDED_REL = path.join(
  "openclaw_runtime",
  "src",
  "context-engine",
  "fixtures",
  "c6h-recorded-64k.json",
);

/**
 * Load a corpus manifest from JSON. Invalid files throw.
 */
export function loadC6hCorpusManifest(filePath: string): C6hCorpusManifest {
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as C6hCorpusManifest;
  if (!raw || !Array.isArray(raw.turns) || raw.turns.length === 0) {
    throw new Error(`C6-H corpus invalid or empty: ${filePath}`);
  }
  if (raw.kind !== "synthetic" && raw.kind !== "recorded" && raw.kind !== "live") {
    throw new Error(`C6-H corpus kind invalid: ${String((raw as { kind?: string }).kind)}`);
  }
  return raw;
}

/**
 * Resolve corpus path: explicit path > env DCS_C6H_CORPUS_PATH > recorded fixture > null (synthetic).
 */
export function resolveC6hCorpusPath(params?: {
  explicitPath?: string;
  repoRoot?: string;
  env?: NodeJS.ProcessEnv;
}): { path: string | null; kindHint: C6hCorpusKind | "synthetic-default" } {
  const env = params?.env ?? process.env;
  const explicit = params?.explicitPath?.trim() || env.DCS_C6H_CORPUS_PATH?.trim() || "";
  if (explicit) {
    return {
      path: explicit,
      kindHint: env.DCS_C6H_CORPUS_KIND === "live" ? "live" : "recorded",
    };
  }
  if (params?.repoRoot) {
    const fixture = path.join(params.repoRoot, DEFAULT_RECORDED_REL);
    if (existsSync(fixture)) {
      return { path: fixture, kindHint: "recorded" };
    }
  }
  return { path: null, kindHint: "synthetic-default" };
}

/**
 * Run curve from a corpus manifest by mapping turn sizes into LongChatCurveOptions.
 * When turns vary, uses average tool output size and turn count for deterministic pressure.
 */
export function runLongChatCurveFromCorpus(
  manifest: C6hCorpusManifest,
  options?: Omit<LongChatCurveOptions, "turns" | "toolOutputCharsPerTurn" | "targetCumulativeChars">,
): LongChatCurveReport {
  const cumulative = manifest.turns.reduce((s, t) => s + t.rawChars, 0);
  const turns = manifest.turns.length;
  const avg = Math.max(1, Math.round(cumulative / turns));
  return runLongChatCurve({
    ...options,
    turns,
    toolOutputCharsPerTurn: avg,
    targetCumulativeChars: manifest.targetCumulativeChars ?? cumulative,
  });
}

/**
 * Primary C6-H runner: honest corpus classification + curve report.
 * live64k is true only when kind === "live" AND cumulative raw >= 64K.
 */
export function runC6hCorpusEvidence(params?: {
  repoRoot?: string;
  corpusPath?: string;
  preferRecordedFixture?: boolean;
  env?: NodeJS.ProcessEnv;
  curveOptions?: LongChatCurveOptions;
}): C6hCorpusRunResult {
  const preferRecorded = params?.preferRecordedFixture !== false;
  const resolved = resolveC6hCorpusPath({
    explicitPath: params?.corpusPath,
    repoRoot: preferRecorded ? params?.repoRoot : undefined,
    env: params?.env,
  });

  const notes: string[] = [];

  if (!resolved.path) {
    const report = runLongChatCurve(params?.curveOptions);
    notes.push("no corpus path; synthetic curve only");
    notes.push("assembler production flags remain unflipped");
    return {
      kind: "synthetic",
      live64k: false,
      recorded64k: false,
      synthetic64k: report.cumulativeRawChars >= 64_000,
      sourcePath: null,
      report,
      notes,
    };
  }

  const manifest = loadC6hCorpusManifest(resolved.path);
  // Env kindHint can force live classification only when file itself claims live or env says live
  // and file is not synthetic.
  let kind: C6hCorpusKind = manifest.kind;
  if (resolved.kindHint === "live" && manifest.kind !== "synthetic") {
    kind = "live";
  }
  const report = runLongChatCurveFromCorpus(manifest, params?.curveOptions);
  const ge64k = report.cumulativeRawChars >= 64_000;
  notes.push(`corpus loaded from ${resolved.path}`);
  notes.push(`corpus kind=${kind} (manifest.kind=${manifest.kind})`);
  if (kind !== "live") {
    notes.push("not live traffic; do not claim production 64K corpus");
  }
  if (manifest.notes?.length) notes.push(...manifest.notes);
  notes.push("assembler production flags remain unflipped");

  return {
    kind,
    live64k: kind === "live" && ge64k,
    recorded64k: kind === "recorded" && ge64k,
    synthetic64k: kind === "synthetic" && ge64k,
    sourcePath: resolved.path,
    report,
    notes,
  };
}
