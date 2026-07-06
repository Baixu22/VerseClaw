import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROUTE_README =
  "runtime-research/handoffs/phase-8-ast-patch-planner-route-correction/README.md";
const SHORT_TERM =
  "runtime-research/handoffs/phase-8-ast-patch-planner-route-correction/short-term-foundation.md";
const TASK_SPEC =
  "harness/specs/tasks/phase-8-ast-patch-planner-route-correction-foundation.md";
const NEXT_PHASE_PROMPT =
  "runtime-research/handoffs/phase-8-ast-patch-planner-route-correction/next-phase-prompt.md";
const AST_MAPPING = "runtime-research/ast-grep/clawx-mapping.md";
const RUNTIME_INDEX = "runtime-research/agent-runtime-index.md";

describe("AST patch planner route correction foundation", () => {
  it("anchors AST as structured patch planning instead of runtime intelligence", () => {
    const readme = readRepoFile(ROUTE_README);

    expect(readme).toContain("Status: accepted_route_correction_foundation");
    expect(readme).toContain(
      "AST is a structured code-edit planning layer, not a runtime intelligence layer",
    );
    expect(readme).toContain("not a general runtime optimization layer");
    expect(readme).toContain("AgentMap/Symbol scope");
    expect(readme).toContain("AST candidate plan");
    expect(readme).toContain("Evidence Verifier");
    expect(readme).toContain("explicit apply gate");
  });

  it("defines the short-term foundation as EditPlan IR plus a real ast-grep adapter", () => {
    const readme = readRepoFile(ROUTE_README);
    const foundation = readRepoFile(SHORT_TERM);

    expect(readme).toContain(
      "current TypeScript/TSX readonly helper remains useful as a prototype/fallback safety skeleton",
    );
    expect(readme).toContain("EditPlan IR");
    expect(readme).toContain("real ast-grep adapter");
    expect(foundation).toContain("source scope from AgentMap/Symbol");
    expect(foundation).toContain("ordered edit operations");
    expect(foundation).toContain("verifier requirements");
    expect(foundation).toContain("apply eligibility state");
    expect(foundation).toContain("Adapters return plans.");
  });

  it("keeps the task spec explicit about non-goals and rollback", () => {
    const spec = readRepoFile(TASK_SPEC);

    expect(spec).toContain("intent:");
    expect(spec).toContain("forbiddenPatterns:");
    expect(spec).toContain("featureFlags:");
    expect(spec).toContain("rollback:");
    expect(spec).toContain("acceptance:");
    expect(spec).toContain("This route-correction foundation adds no new runtime flag");
    expect(spec).toContain("cannot enable apply behavior");
  });

  it("updates the runtime index and ast-grep mapping to point future work at route correction", () => {
    const index = readRepoFile(RUNTIME_INDEX);
    const mapping = readRepoFile(AST_MAPPING);

    expect(index).toContain("accepted_route_correction_foundation");
    expect(index).toContain(
      "structured code-edit planning layer, not a runtime intelligence or optimization layer",
    );
    expect(index).toContain("EditPlan IR plus real ast-grep adapter");
    expect(index).toContain(
      "runtime-research/handoffs/phase-8-ast-patch-planner-route-correction/README.md",
    );

    expect(mapping).toContain("Route Correction");
    expect(mapping).toContain("AST belongs after AgentMap/Symbol scope selection");
    expect(mapping).toContain("before Evidence Verifier and any explicit apply gate");
    expect(mapping).toContain(
      "Do not extend the current TypeScript text-matcher prototype as the production engine",
    );
  });

  it("does not approve runtime authority, completion evidence, or apply behavior", () => {
    const combined = [
      readRepoFile(ROUTE_README),
      readRepoFile(SHORT_TERM),
      readRepoFile(TASK_SPEC),
    ].join("\n");

    const requiredRejections = [
      "no patch apply",
      "no workspace edit",
      "no symbol mutation",
      "no TaskLoop/Gateway/Main/renderer route",
      "no provider transport",
      "no prompt/model-message insertion",
      "no default-on AST behavior",
      "never task-completion evidence",
    ];

    for (const rejection of requiredRejections) {
      expect(combined).toContain(rejection);
    }
  });

  it("provides a persistent new-thread prompt with scope, constraints, capabilities, and acceptance", () => {
    const prompt = readRepoFile(NEXT_PHASE_PROMPT);

    expect(prompt).toContain("Persistent objective:");
    expect(prompt).toContain("EditPlan IR plus a real ast-grep readonly candidate-generation adapter");
    expect(prompt).toContain("Read first:");
    expect(prompt).toContain("Required capabilities:");
    expect(prompt).toContain("Hard constraints:");
    expect(prompt).toContain("Acceptance:");
    expect(prompt).toContain("No patch apply.");
    expect(prompt).toContain("No TaskLoop/Gateway/Main/renderer/host-api/api-client route.");
    expect(prompt).toContain("Do not fall back to expanding the current text matcher");
  });
});

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}
