// Stage 5 observational real-evidence runner. Explicit-invoke only and default
// off. It reuses the accepted Stage 2 real DeepSeek -> write -> grant/Tool
// Guard/EffectReceipt chain, then projects the real refs/digests through the
// Stage 5 unit-aware packer and the read-only Memory Facade without changing
// provider bytes, tool execution, or any product default. The API key is read
// from the caller or process env and is never persisted or logged.
import {
  runStage2GoldenCodingTurn,
  STAGE2_GOLDEN_MODEL_REF,
  type Stage2GoldenRunOptions,
  type Stage2GoldenRunTimings,
} from "./stage2-golden-run.js";
import {
  packStage5ContextUnits,
  type Stage5ContextUnit,
} from "../context-engine/stage5-unit-aware-packer.js";
import {
  createSemanticMemoryFacade,
  STAGE5_MEMORY_TOOL_NAMES,
  type MemoryCandidate,
} from "../context-engine/stage5-memory-facade.js";
import { estimateTokensFromChars } from "../context-engine/dcs-corpus-schema.js";

export const STAGE5_OBSERVATIONS_ENV = "OPENCLAW_STAGE5_OBSERVATIONS";
const OUTPUT_RESERVE_TOKENS = 16;

export type Stage5GoldenRunOptions = Stage2GoldenRunOptions & {
  /** Explicit Stage 5 opt-in; defaults to env flag, which defaults off. */
  stage5Observations?: boolean;
};

export type Stage5ObservationEvidence = {
  authority: "candidate-only";
  tools: string[];
  candidateBackend: string;
  candidateSource: string;
  candidateFreshness: string;
  evidenceDigestCount: number;
  pack: {
    budgetTokens: number;
    outputReserveTokens: number;
    usedTokens: number;
    status: "ok" | "degraded" | "failed";
    selected: string[];
    omitted: string[];
    reasons: string[];
  };
};

export type Stage5GoldenRunResult =
  | {
      ok: true;
      model: string;
      timings?: Stage2GoldenRunTimings;
      observation: Stage5ObservationEvidence;
      stage2: {
        toolCallId: string;
        effectReceiptId: string;
        prePlanDigest: string;
        postPlanDigest: string;
        envelopeDigest?: string;
        journalRef?: string;
      };
    }
  | {
      ok: false;
      reason:
        | "stage5-flag-off"
        | "api-key-missing"
        | "invalid-workspace-path"
        | "stage2-golden-run-failed"
        | "stage5-observation-failed";
      message?: string;
    };

export function resolveStage5ObservationsState(
  env: NodeJS.ProcessEnv = process.env,
): { enabled: boolean } {
  const raw = env[STAGE5_OBSERVATIONS_ENV]?.trim().toLowerCase();
  return { enabled: raw === "1" || raw === "true" || raw === "yes" || raw === "on" };
}

function resolveGoldenWorkspaceResource(workspaceRoot: string, relativePath: string): boolean {
  if (!workspaceRoot || !relativePath) return false;
  const root = workspaceRoot.trim();
  const target = relativePath.trim();
  return Boolean(root) && Boolean(target) && !target.includes("..");
}

function defaultPrompt(options: Stage5GoldenRunOptions): string {
  return (
    options.prompt ??
    `Call the write tool exactly once. ` +
      `path must be ${JSON.stringify(options.sentinelPath)} and content must be ` +
      `${JSON.stringify(options.sentinelContent)}. Do not call any other tool.`
  );
}

function buildObservationUnits(input: {
  prompt: string;
  effectReceiptId: string;
}): Stage5ContextUnit[] {
  return [
    {
      id: "stage5:user-intent",
      kind: "text",
      priority: "critical",
      tokenCount: estimateTokensFromChars(input.prompt.length),
      sourceRef: "ref:stage5:user-intent",
    },
    {
      id: "stage5:write-tool-schema",
      kind: "tool_schema",
      priority: "constraint",
      tokenCount: 1,
      sourceRef: "ref:tool:coding:write",
    },
    {
      id: "stage5:effect-receipt",
      kind: "text",
      priority: "evidence",
      tokenCount: 1,
      sourceRef: `ref:effect:${input.effectReceiptId}`,
    },
  ];
}

function observationCandidate(stage2: Extract<Awaited<ReturnType<typeof runStage2GoldenCodingTurn>>, { ok: true }>): MemoryCandidate {
  const evidence: MemoryCandidate["evidence"] = [
    { ref: `ref:prompt-plan:${stage2.prePlanDigest}`, digest: stage2.prePlanDigest },
  ];
  if (stage2.envelopeDigest) {
    evidence.push({ ref: `ref:request-envelope:${stage2.envelopeDigest}`, digest: stage2.envelopeDigest });
  }
  return {
    id: "stage5:real-candidate",
    namespace: "stage5:golden-run",
    contentRef: `ref:effect:${stage2.effectReceiptId}`,
    backend: "adapter",
    source: "context",
    freshness: "fresh",
    evidence,
  };
}

export async function runStage5GoldenCodingTurn(
  options: Stage5GoldenRunOptions,
): Promise<Stage5GoldenRunResult> {
  const enabled = options.stage5Observations ?? resolveStage5ObservationsState().enabled;
  if (!enabled) {
    return { ok: false, reason: "stage5-flag-off" };
  }
  if (!(options.apiKey ?? process.env.DEEPSEEK_API_KEY ?? "").trim()) {
    return { ok: false, reason: "api-key-missing" };
  }
  if (!resolveGoldenWorkspaceResource(options.workspaceRoot, options.sentinelPath)) {
    return { ok: false, reason: "invalid-workspace-path" };
  }

  const stage2 = await runStage2GoldenCodingTurn({
    ...options,
    stage2Dcs: true,
  });
  if (!stage2.ok) {
    if (stage2.reason === "api-key-missing") return { ok: false, reason: "api-key-missing" };
    if (stage2.reason === "invalid-workspace-path") {
      return { ok: false, reason: "invalid-workspace-path" };
    }
    return {
      ok: false,
      reason: "stage2-golden-run-failed",
      message: `${stage2.reason}: ${stage2.message ?? ""}`,
    };
  }

  try {
    const units = buildObservationUnits({
      prompt: defaultPrompt(options),
      effectReceiptId: stage2.effectReceiptId,
    });
    const budgetTokens = units.reduce((sum, unit) => sum + unit.tokenCount, 0) + OUTPUT_RESERVE_TOKENS;
    const pack = packStage5ContextUnits({
      budgetTokens,
      outputReserveTokens: OUTPUT_RESERVE_TOKENS,
      units,
    });
    const candidate = observationCandidate(stage2);
    const facade = createSemanticMemoryFacade({
      owner: { append: () => undefined },
      adapter: {
        search: () => [candidate],
        get: () => candidate,
      },
    });
    const facadeResults = STAGE5_MEMORY_TOOL_NAMES.map((tool) =>
      facade.search(tool, { namespace: candidate.namespace }),
    );
    if (pack.status !== "ok" || facadeResults.some((result) => result.authority !== "candidate-only")) {
      return {
        ok: false,
        reason: "stage5-observation-failed",
        message: `pack=${pack.status} facade=${facadeResults.map((result) => result.authority).join(",")}`,
      };
    }

    return {
      ok: true,
      model: STAGE2_GOLDEN_MODEL_REF,
      ...(stage2.timings ? { timings: stage2.timings } : {}),
      observation: {
        authority: "candidate-only",
        tools: facadeResults.map((result) => result.tool),
        candidateBackend: candidate.backend,
        candidateSource: candidate.source,
        candidateFreshness: candidate.freshness,
        evidenceDigestCount: candidate.evidence.length,
        pack: {
          budgetTokens: pack.budgetTokens,
          outputReserveTokens: pack.outputReserveTokens,
          usedTokens: pack.usedTokens,
          status: pack.status,
          selected: pack.selected.map((unit) => unit.id),
          omitted: pack.omitted.map((unit) => unit.id),
          reasons: [...pack.reasons],
        },
      },
      stage2: {
        toolCallId: stage2.toolCallId,
        effectReceiptId: stage2.effectReceiptId,
        prePlanDigest: stage2.prePlanDigest,
        postPlanDigest: stage2.postPlanDigest,
        ...(stage2.envelopeDigest ? { envelopeDigest: stage2.envelopeDigest } : {}),
        ...(stage2.journalRef ? { journalRef: stage2.journalRef } : {}),
      },
    };
  } catch (error) {
    return {
      ok: false,
      reason: "stage5-observation-failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
