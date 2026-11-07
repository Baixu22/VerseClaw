/**
 * C5-P: patch-flow default orchestration graduation assessment.
 * Always keeps runtime.coding.patchFlow.default = false from this pack.
 * Retained capability diagnostics obey the approved Patch Flow retirement.
 */
import {
  isCodingPatchFlowDefault,
  PATCH_FLOW_RETIRED,
} from "../context-engine/coding-runtime-flags.js";
import {
  applyPatchProposalsSerial,
  classifyPatchProposalDestructive,
  isHardDestructivePatch,
} from "./patch-flow.js";
import { recommendIsolationMode } from "./isolation-mode-matrix.js";

export type PatchFlowGraduationDecision = {
  ok: true;
  card: "C5-P";
  wave: "C5-P";
  completionClass: string;
  patchFlowDefault: false;
  meetsGate: boolean;
  recommendation: "keep-off" | "consider-default-on";
  defaultsUnchanged: true;
  capabilityReady: boolean;
  residual: string[];
  howToOptIn: string;
  notes: string[];
  checklist: Array<{ id: string; ok: boolean; note: string }>;
};

export type AssessPatchFlowGraduationParams = {
  /** Explicit product soak approval. Default false. */
  productSoakApproved?: boolean;
  /** When true, run a tiny in-memory capability smoke (serial apply + destructive hold). */
  runCapabilitySmoke?: boolean;
  cwdForSmoke?: string;
};

/**
 * Assess retained capability diagnostics while honoring current retirement.
 * Legacy soak approval cannot make a retired execution path eligible.
 */
export async function assessPatchFlowDefaultGraduation(
  params?: AssessPatchFlowGraduationParams,
): Promise<PatchFlowGraduationDecision> {
  const productSoakApproved = params?.productSoakApproved === true;
  const notes: string[] = [];
  let capabilityReady = true;

  if (params?.runCapabilitySmoke !== false) {
    // Lightweight pure checks without disk when cwd missing
    const delClass = classifyPatchProposalDestructive(
      ["*** Begin Patch", "*** Delete File: gone.txt", "*** End Patch"].join("\n"),
    );
    const destructiveHold = isHardDestructivePatch(delClass) && delClass.requiresApproval;
    if (!destructiveHold) {
      capabilityReady = false;
      notes.push("destructive hold surface regression");
    }

    if (params?.cwdForSmoke) {
      const results = await applyPatchProposalsSerial({
        cwd: params.cwdForSmoke,
        proposals: [],
      });
      if (!Array.isArray(results)) {
        capabilityReady = false;
        notes.push("serial apply API unavailable");
      }
    }

    const rec = recommendIsolationMode({
      durationMinutes: 45,
      workerCount: 3,
      writeDensity: 0.6,
      writeSetOverlapRisk: 0.6,
    });
    notes.push(`current isolation recommendation=${rec.mode}`);
  }

  const currentDefault = isCodingPatchFlowDefault();
  if (currentDefault !== false) {
    notes.push("WARNING: patchFlow.default is not false in runtime — red line risk");
  }

  // Graduation gate for default-on is intentionally strict and never auto-applied.
  const meetsGate =
    !PATCH_FLOW_RETIRED && capabilityReady && productSoakApproved && currentDefault === false;
  const recommendation = meetsGate ? "consider-default-on" : "keep-off";

  const residual: string[] = PATCH_FLOW_RETIRED
    ? ["Patch Flow retired by TF-0510; retained diagnostics have no execution opt-in"]
    : ["Default-on requires an explicit product decision"];

  notes.push("C5-P pack never flips patchFlow.default");
  notes.push(`recommendation=${recommendation}`);

  return {
    ok: true,
    card: "C5-P",
    wave: "C5-P",
    completionClass: PATCH_FLOW_RETIRED
      ? "retired"
      : capabilityReady
        ? "done (hard-gates+keep-off)"
        : "done (partial+keep-off)",
    patchFlowDefault: false,
    // Diagnostic success cannot graduate a retired path.
    meetsGate,
    recommendation,
    defaultsUnchanged: true,
    capabilityReady,
    residual,
    howToOptIn: "Patch Flow is retired. Use ordinary coding tools and explicit worktree isolation.",
    notes: [
      ...notes,
      `legacy productSoakApproved=${productSoakApproved}`,
      PATCH_FLOW_RETIRED ? "execution retired" : `default graduation eligible=${meetsGate}`,
    ],
    checklist: [
      {
        id: "capability-ready",
        ok: capabilityReady,
        note: "serial apply + destructive hold surface",
      },
      { id: "default-false", ok: currentDefault === false, note: "patchFlow.default === false" },
      { id: "no-auto-flip", ok: true, note: "pack never writes default true" },
      {
        id: "product-soak",
        ok: productSoakApproved,
        note: "explicit product soak approval",
      },
    ],
  };
}
