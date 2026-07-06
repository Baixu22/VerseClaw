// Structured Synthesis Contract (Area 3 §3.2).
//
// Replaces pure LLM self-judgment in Lead synthesis with a deterministic
// *skeleton* assembled from the worker contracts' existing `outputSchema.sections`.
// Every built-in role already declares sections (planner: Goal/Plan/Risks/
// Acceptance; reviewer: Findings/Evidence/Recommendation; skeptic: Verdict/
// Refutations/Required Fixes — role-contract.ts). The synthesis contract turns
// the Team Result Bundle from "here are N blobs" into "here are N blobs, each
// expected to contain these sections; produce a merged report with this shape".
//
// Design properties:
// - **Purely additive**: when the contract is absent or assembly fails, the
//   Lead synthesizes as today (degrade to current behavior, §3.2 error handling).
// - **Skeleton, not automation**: the Lead still *writes* the synthesis (LLM
//   judgment stays in the loop for content); the contract fixes the *shape*
//   and forces per-worker section coverage — missing sections become explicit
//   "worker did not report X" lines rather than silent omissions.
// - **First load-bearing consumer of `outputSchema.sections`**: makes the
//   sections field measurable via the existing `WorkerQualityScore.schemaCompliance`.
//
// The contract is delivered to the Lead via the team-orchestrate tool's result
// payload (next to `resultPolicy`) and, when the Lead is spawned, appended to
// its orchestration framing (`extraSystemPrompt`).

import type { RoleOutputSchema } from "./role-contract.js";
import { resolveRoleContract } from "./role-registry.js";
import type { RoleRegistryConfigCarrier } from "./role-registry.js";
import type { OrchestratorPlan, OrchestratorWorkerPlan } from "./orchestrator.js";

export type SynthesisWorkerEntry = {
  roleName: string;
  roleInstanceId?: string;
  expectedFormat: RoleOutputSchema["format"];
  expectedSections: string[];
  isVerifier?: boolean;
};

export type SynthesisMergeTemplate = {
  /**
   * Ordered section names the Lead's merged report must contain. Chosen so that
   * per-worker section coverage is forced and conflicts surface explicitly.
   * Stable across plans so two identical runs produce identically-shaped
   * summaries (§3.2: "two identical runs can produce differently-shaped
   * summaries" is the problem this contract fixes).
   */
  sections: string[];
  /**
   * Conflict resolution rule. Always 'surface' — conflicts are listed in the
   * "Conflicts" section, never silently resolved by the Lead. This preserves
   * adversarial-review value (reviewer/skeptic disagreements stay visible).
   */
  conflictRule: "surface";
};

export type SynthesisContract = {
  perWorker: SynthesisWorkerEntry[];
  mergeTemplate: SynthesisMergeTemplate;
};

const DEFAULT_MERGE_SECTIONS = [
  "Summary",
  "Per-role findings",
  "Conflicts",
  "Open items",
  "Verdict",
] as const;

/**
 * Build a synthesis contract for a plan.
 *
 * Looks up each worker's `RoleContract.outputSchema.sections` via the role
 * registry (honoring config overrides). Workers whose contract cannot be
 * resolved still appear in `perWorker` with an empty `expectedSections` array
 * — the Lead marks their sections as gaps rather than silently omitting them.
 *
 * Returns `undefined` when the plan has fewer than 2 workers (no synthesis
 * needed for single-worker router-mode plans) — callers should treat this as
 * "no contract, synthesize as today".
 */
export function buildSynthesisContract(
  plan: OrchestratorPlan,
  cfg?: RoleRegistryConfigCarrier,
): SynthesisContract | undefined {
  const workers = collectSynthesisWorkers(plan);
  if (workers.length < 2) return undefined;

  const perWorker: SynthesisWorkerEntry[] = workers.map((worker) => {
    const contract = resolveRoleContract(worker.roleName, cfg);
    const outputSchema: RoleOutputSchema | undefined = contract?.outputSchema;
    return {
      roleName: worker.roleName,
      roleInstanceId: worker.roleInstanceId,
      expectedFormat: outputSchema?.format ?? "markdown",
      expectedSections: outputSchema?.sections ?? [],
      isVerifier: worker.isVerifier,
    };
  });

  return {
    perWorker,
    mergeTemplate: {
      sections: [...DEFAULT_MERGE_SECTIONS],
      conflictRule: "surface",
    },
  };
}

/**
 * Render the synthesis contract as a prompt fragment suitable for appending to
 * the Lead's `extraSystemPrompt`. Returns an empty string when the contract is
 * absent (degrade to today).
 */
export function renderSynthesisContractPrompt(contract: SynthesisContract | undefined): string {
  if (!contract) return "";
  const lines: string[] = [
    "",
    "## Synthesis Contract",
    "",
    "You are the Lead synthesizing the team's results. Produce a merged report",
    "with exactly these top-level sections (in this order):",
    "",
    ...contract.mergeTemplate.sections.map((section) => `- ${section}`),
    "",
    "Per-worker expected output sections (workers may not have reported every",
    "section — for any missing section, write an explicit",
    '"worker did not report X" line rather than silently omitting it):',
    "",
  ];
  for (const entry of contract.perWorker) {
    const tag = entry.isVerifier ? " (verifier)" : "";
    const sections = entry.expectedSections.length > 0
      ? entry.expectedSections.join(", ")
      : "(no declared sections — accept free-form output)";
    lines.push(`- ${entry.roleName}${tag}: ${sections}`);
  }
  lines.push(
    "",
    `Conflict rule: ${contract.mergeTemplate.conflictRule} — list disagreements`,
    'between workers in the "Conflicts" section; never silently resolve them.',
  );
  return lines.join("\n");
}

type SynthesisWorkerRef = {
  roleName: string;
  roleInstanceId?: string;
  isVerifier?: boolean;
};

function collectSynthesisWorkers(plan: OrchestratorPlan): SynthesisWorkerRef[] {
  const workers: SynthesisWorkerRef[] = plan.workers.map(
    (worker: OrchestratorWorkerPlan) => ({
      roleName: worker.roleName,
    }),
  );
  if (plan.verifierRole && !workers.some((w) => w.roleName === plan.verifierRole)) {
    workers.push({ roleName: plan.verifierRole, isVerifier: true });
  }
  return workers;
}
