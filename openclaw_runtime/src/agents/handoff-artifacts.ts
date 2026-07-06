// Handoff Artifacts (Area 3 §3.4) — typed inter-worker data flow through the
// existing task graph.
//
// When a `handoff` edge connects worker A → worker B in the task graph, B's
// spawn `extraSystemPrompt` includes A's expected output schema sections (from
// `RoleContract.outputSchema.sections`). This delivers most of the value of
// `bounded_a2a` (data flow between workers) with none of its risks: no new
// communication channel, no Lead bypass — the orchestrator mediates, all flow
// remains observable in traces, and the injection adds prompt text only
// (never tools or permissions; see §9 boundary).
//
// Default-off for one release (§6). The artifact is *schema-shaped* (§3.2),
// not runtime output: at B's spawn time we tell B which sections A was asked
// to produce, so B knows what evidence shape to expect. Capturing A's actual
// runtime output for injection into B is a follow-up that requires blocking
// on A's completion across waves — out of scope for this additive v1.

import type { OrchestrationTaskGraph, OrchestrationTaskNode } from "./orchestration-protocol.js";
import type { OrchestratorPlan } from "./orchestrator.js";
import type { RoleContract } from "./role-contract.js";

export type HandoffArtifactsPilotMode = "off" | "on";

export const DEFAULT_HANDOFF_ARTIFACTS_PILOT_MODE: HandoffArtifactsPilotMode = "off";

/**
 * Resolve the handoff-artifacts pilot mode from runtime config.
 *
 * Defaults to 'off'. Accepts `runtime.orchestration.handoffArtifacts` with
 * values 'off' | 'on'. Unknown values fall back to 'off'.
 *
 * When 'on', `runOrchestrationObserved` injects predecessor output-schema
 * sections into a dependent worker's `extraSystemPrompt` along `handoff`
 * edges. When 'off', today's behavior is unchanged (no injection).
 */
export function resolveHandoffArtifactsPilotMode(value: unknown): HandoffArtifactsPilotMode {
  const record = isRecord(value) ? value : undefined;
  const runtime = isRecord(record?.runtime) ? record.runtime : undefined;
  const orchestration = isRecord(runtime?.orchestration) ? runtime.orchestration : undefined;
  const pilot = orchestration?.handoffArtifacts;
  return pilot === "on" ? "on" : DEFAULT_HANDOFF_ARTIFACTS_PILOT_MODE;
}

/**
 * Build the handoff-artifact prompt fragment for a dependent worker.
 *
 * Finds all `handoff` edges in `plan.taskGraph` whose `to` matches `node.taskNodeId`,
 * resolves each predecessor node's role contract, and renders a "Handoff Context"
 * section listing each predecessor's expected output sections.
 *
 * Returns `undefined` when:
 *   - the node has no taskNodeId
 *   - there are no handoff edges pointing to this node
 *   - no predecessor role contracts expose `outputSchema.sections`
 *
 * The caller appends this fragment to the worker's `extraSystemPrompt` when
 * non-undefined. Purely additive prompt text — no tools, no permissions.
 */
export function buildHandoffArtifactPrompt(params: {
  node: OrchestrationTaskNode | undefined;
  plan: OrchestratorPlan;
  resolveRole: (roleName: string) => RoleContract | undefined;
}): string | undefined {
  const { node, plan, resolveRole } = params;
  if (!node?.taskNodeId) return undefined;

  const taskGraph: OrchestrationTaskGraph = plan.taskGraph;
  const predecessorEdges = taskGraph.edges.filter(
    (edge) => edge.type === "handoff" && edge.to === node.taskNodeId,
  );
  if (predecessorEdges.length === 0) return undefined;

  const entries: Array<{ roleName: string; sections: string[] }> = [];
  for (const edge of predecessorEdges) {
    const predecessorNode = taskGraph.nodes.find((n) => n.taskNodeId === edge.from);
    if (!predecessorNode) continue;
    const role = resolveRole(predecessorNode.roleName);
    const sections = role?.outputSchema?.sections ?? [];
    // Only include predecessors that actually declare output sections —
    // otherwise the handoff line is noise ("predecessor X owes you evidence"
    // with no shape is already covered by the generic orchestration framing).
    if (sections.length > 0) {
      entries.push({ roleName: predecessorNode.roleName, sections });
    }
  }
  if (entries.length === 0) return undefined;

  const lines = [
    "## Handoff Context (Area 3 §3.4)",
    "Predecessor workers were asked to produce the following output sections. Treat their output as evidence in those categories when synthesizing your work. Do not block waiting for their output; if a predecessor's section is absent, note it as a gap.",
    "",
  ];
  for (const entry of entries) {
    lines.push(`- From ${entry.roleName}: ${entry.sections.join(", ")}`);
  }
  return lines.join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
