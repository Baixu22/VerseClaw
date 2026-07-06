import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const HANDOFF_DIR =
  "runtime-research/handoffs/phase-8-ast-editplan-narrow-evaluation-decision-gate";
const README = `${HANDOFF_DIR}/README.md`;
const SYNTHESIS = `${HANDOFF_DIR}/synthesis.md`;
const TASK_SPEC =
  "harness/specs/tasks/phase-8-ast-editplan-narrow-evaluation-decision-gate.md";
const RUNTIME_INDEX = "runtime-research/agent-runtime-index.md";

const ALLOWED_FINAL_STATES = [
  "keep_readonly_infrastructure_only",
  "run_later_narrow_evaluation",
  "pause_ast_investment",
] as const;

describe("AST EditPlan narrow-evaluation decision gate", () => {
  it("publishes the P7 synthesis status and final decision", () => {
    const synthesis = repoText(SYNTHESIS);
    const readme = repoText(README);

    expect(synthesis).toContain(
      "Status: accepted_phase_8_ast_editplan_narrow_evaluation_decision_gate",
    );
    expect(readme).toContain(
      "Status: accepted_phase_8_ast_editplan_narrow_evaluation_decision_gate",
    );
    expect(synthesis).toContain("Decision: run_later_narrow_evaluation");
    expect(readme).toContain("Decision: run_later_narrow_evaluation");
    expect(synthesis).toContain(
      "Selected final AST line state: run_later_narrow_evaluation.",
    );
  });

  it("lists exactly the three allowed final AST line states", () => {
    const synthesis = repoText(SYNTHESIS);

    for (const state of ALLOWED_FINAL_STATES) {
      expect(synthesis).toContain(`- ${state}`);
    }
    expect(uniqueAllowedStateMentions(synthesis)).toEqual([...ALLOWED_FINAL_STATES]);
  });

  it("rejects runtime pilot, production, default-on, and integration expansion", () => {
    const combined = decisionText();

    expect(combined).toContain("Current usable AST runtime pilot: rejected.");
    expect(combined).toContain("Production readiness: rejected.");
    expect(combined).toContain("Default-on behavior: rejected.");
    expect(combined).toContain("TaskLoop-Gateway-provider-prompt integration: rejected.");
    expect(combined).toContain(
      "TaskLoop/Gateway/Main/renderer/host-api/api-client integration: rejected.",
    );
    expect(combined).toContain("Provider transport or provider ordering changes: rejected.");
    expect(combined).toContain("Prompt/model-message insertion: rejected.");
  });

  it("requires a fresh accepted spec for any later narrow evaluation", () => {
    const combined = decisionText();

    expect(combined).toContain(
      "Any later narrow evaluation must use a fresh accepted task spec.",
    );
    expect(combined).toContain("fixed target-file allowlists");
    expect(combined).toContain("bounded source volume");
    expect(combined).toContain("false-positive measurement");
    expect(combined).toContain("review-time measurement");
    expect(combined).toContain("cost-envelope proof");
  });

  it("does not authorize scan, broad edit, symbol mutation, or completion evidence", () => {
    const combined = decisionText();

    expect(combined).toContain("Workspace scan: not authorized.");
    expect(combined).toContain("Broad workspace edit: not authorized.");
    expect(combined).toContain("Symbol mutation: not authorized.");
    expect(combined).toContain("Task-completion evidence: not authorized.");
    expect(combined).toContain(
      "AST output, preview diff, apply result, replay proof, decision report",
    );
    expect(combined).toContain("cannot be treated as evidence that a user task is complete");
  });

  it("preserves existing AST proof infrastructure and Registry as the current pilot", () => {
    const combined = decisionText();
    const index = repoText(RUNTIME_INDEX);

    for (const preserved of [
      "Existing readonly AST helper.",
      "Existing ast-grep readonly adapter.",
      "Existing EditPlan IR.",
      "Existing Evidence Verifier readiness bridge.",
      "Existing explicit apply gate readiness helper.",
      "Existing controlled explicit apply pilot.",
      "Existing P6 narrow-rule replay proof.",
      "No new production runtime behavior.",
    ]) {
      expect(combined).toContain(preserved);
    }

    expect(combined).toContain(
      "Registry controlled diagnostic consumer remains the current accepted controlled pilot direction.",
    );
    expect(index).toContain("accepted_phase_8_ast_editplan_narrow_evaluation_decision_gate");
    expect(index).toContain("Registry controlled diagnostic consumer remains the current accepted controlled pilot direction");
  });
});

function decisionText(): string {
  return [repoText(README), repoText(SYNTHESIS), repoText(TASK_SPEC)].join("\n");
}

function uniqueAllowedStateMentions(text: string): string[] {
  return [...new Set(ALLOWED_FINAL_STATES.filter((state) => text.includes(`- ${state}`)))];
}

function repoText(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}
