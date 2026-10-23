/**
 * C5-P: patch-flow default orchestration graduation assessment.
 * Always keeps runtime.coding.patchFlow.default = false from this pack.
 * Product may consider default-on only after explicit soak + approval (out of band).
 */
import { isCodingPatchFlowDefault } from "../context-engine/coding-runtime-flags.js";
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
 * Assess whether patch-flow may become a default orchestration path.
 * Hard rule: packaging recommendation is keep-off unless productSoakApproved
 * AND capability smoke green — even then recommendation is consider-default-on,
 * never auto-flips the flag.
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
    // recommendIsolationMode may suggest patch-flow mode; that is advisory only.
    if (rec.mode === "patch-flow") {
      notes.push("isolation matrix may recommend patch-flow mode; default flag stays false");
    }
  }

  const currentDefault = isCodingPatchFlowDefault();
  if (currentDefault !== false) {
    notes.push("WARNING: patchFlow.default is not false in runtime — red line risk");
  }

  // Graduation gate for default-on is intentionally strict and never auto-applied.
  const meetsGate = capabilityReady && productSoakApproved && currentDefault === false;
  const recommendation = meetsGate ? "consider-default-on" : "keep-off";

  const residual: string[] = [
    "runtime.coding.patchFlow.default remains false (recommend-only orchestration)",
    "Default-on requires product soak + explicit config change out of band",
  ];
  if (!productSoakApproved) residual.push("productSoakApproved not set");

  notes.push("C5-P pack never flips patchFlow.default");
  notes.push(`recommendation=${recommendation}`);

  return {
    ok: true,
    card: "C5-P",
    wave: "C5-P",
    completionClass: capabilityReady
      ? "done (hard-gates+keep-off)"
      : "done (partial+keep-off)",
    patchFlowDefault: false,
    // TF-0510: the gate must be able to report a real outcome. It is still false unless
    // the capability smoke passed AND an explicit product soak was approved, but it is no
    // longer hard-coded to false - a permanent keep-off is an API-only exit.
    meetsGate,
    recommendation,
    defaultsUnchanged: true,
    capabilityReady,
    residual,
    howToOptIn:
      "Call applyPatchProposalsSerial() / recommendIsolationMode() opt-in. Do NOT set runtime.coding.patchFlow.default=true without product approval after soak.",
    notes: [
      ...notes,
      productSoakApproved
        ? "productSoakApproved=true: humans may consider default-on out of band; this pack still keep-off"
        : "productSoakApproved=false: keep-off",
      meetsGate
        ? "advisory: criteria green for human consider-default-on (flag still false)"
        : "criteria not green for default-on consideration",
    ],
    checklist: [
      { id: "capability-ready", ok: capabilityReady, note: "serial apply + destructive hold surface" },
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