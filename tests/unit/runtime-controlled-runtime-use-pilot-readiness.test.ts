import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

const AST_SPEC =
  "harness/specs/tasks/phase-8-ast-patch-planner-controlled-readonly-candidate-generation-pilot.md";
const REGISTRY_SPEC =
  "harness/specs/tasks/phase-3-provider-tool-registry-controlled-diagnostic-consumer-pilot.md";
const SAMPLE_MATRIX =
  "runtime-research/handoffs/controlled-runtime-use-pilot-readiness/sample-matrix.md";
const SCORECARD =
  "runtime-research/handoffs/controlled-runtime-use-pilot-readiness/scorecard.md";
const VETO_GATES =
  "runtime-research/handoffs/controlled-runtime-use-pilot-readiness/veto-gates.md";
const SYNTHESIS =
  "runtime-research/handoffs/controlled-runtime-use-pilot-readiness/synthesis.md";

describe("controlled runtime-use pilot readiness docs", () => {
  it("keeps AST and Registry pilot specs independently scoped", () => {
    const astSpec = readRepoFile(AST_SPEC);
    const registrySpec = readRepoFile(REGISTRY_SPEC);
    const requiredFields = [
      "intent:",
      "ownedPaths:",
      "touchedAreas:",
      "forbiddenPatterns:",
      "featureFlags:",
      "rollback:",
      "requiredTests:",
      "acceptance:",
    ];

    for (const field of requiredFields) {
      expect(astSpec).toContain(field);
      expect(registrySpec).toContain(field);
    }

    expect(astSpec).toContain("does not require registry diagnostics");
    expect(astSpec).toContain("does not authorize registry behavior");
    expect(astSpec).not.toContain("runtime.registryDiagnostics.collector");

    expect(registrySpec).toContain("does not require AST candidate generation");
    expect(registrySpec).toContain("does not authorize AST behavior");
    expect(registrySpec).not.toContain("runtime.astPatchPlanner.readonlyScan");
  });

  it("defines at least 30 fail-closed samples with required coverage", () => {
    const matrix = readRepoFile(SAMPLE_MATRIX);
    const rows = matrix
      .split(/\r?\n/u)
      .filter((line) => /^\| (AST|REG)-\d{2} \|/u.test(line));
    const requiredCoverage = [
      "success candidate",
      "no match",
      "invalid rule",
      "overbroad pattern",
      "unbound metavariable",
      "overlapping ranges",
      "resume drift",
      "preview diff disabled",
      "budget/limit exceeded",
      "registry provider exception",
      "unsupported MCP content",
      "denied tool outcome",
      "waiting tool outcome",
      "cancelled-like tool outcome",
      "missing injected diagnostics",
      "invalid injected diagnostics",
      "gated-off behavior",
      "renderer bypass sentinel",
      "provider ordering sensitive case",
    ];

    expect(rows).toHaveLength(32);
    expect(matrix).toContain("Fail-closed target: 100 percent.");
    expect(matrix).toContain("| ID | Pilot | Coverage | Input | Expected output | Failure mode | Boundary assertion | Evidence source |");

    for (const coverage of requiredCoverage) {
      expect(matrix).toContain(coverage);
    }

    for (const row of rows) {
      expect(row.split("|").filter(Boolean)).toHaveLength(8);
      expect(row).toMatch(/fail closed|none/u);
    }
  });

  it("keeps the scorecard quantitative and hard-veto aware", () => {
    const scorecard = readRepoFile(SCORECARD);
    const requiredCategories = [
      "| Usable value | 25 |",
      "| Current evidence strength | 20 |",
      "| Boundary safety | 20 |",
      "| Verification quantifiability | 15 |",
      "| Dependency maturity | 10 |",
      "| Rollback/reversibility | 10 |",
    ];

    for (const category of requiredCategories) {
      expect(scorecard).toContain(category);
    }

    expect(scorecard).toContain("## AST Pilot");
    expect(scorecard).toContain("## Registry Pilot");
    expect(scorecard).toContain("## Parallel Pilot");
    expect(scorecard).toContain("| Total | 100 | 94 |");
    expect(scorecard).toContain("| Total | 100 | 95 |");
    expect(scorecard).toContain("Hard vetoes override every score.");
  });

  it("records every hard veto gate required for pilot readiness", () => {
    const gates = readRepoFile(VETO_GATES);
    const requiredVetoes = [
      "default-on behavior appears",
      "provider ordering drift > 0",
      "leakage_count > 0",
      "fail-closed rate < 100 percent",
      "renderer bypass > 0",
      "AST mutation/apply/write surface appears",
      "TaskLoop/Gateway/provider transport authority drift",
      "rollback drill fails",
      "required validation missing without blocked reason",
    ];

    for (const veto of requiredVetoes) {
      expect(gates).toContain(veto);
    }
  });

  it("keeps the synthesis explicit about remaining forbidden surfaces", () => {
    const synthesis = readRepoFile(SYNTHESIS);
    const forbidden = [
      "AST patch apply",
      "file write",
      "workspace edit",
      "TaskLoop automatic AST invocation",
      "Gateway/Main/renderer/host-api/api-client AST routes",
      "Provider ordering cutover",
      "MCP response shape",
      "Diagnostic persistence",
      "Renderer direct IPC",
      "Default-on behavior",
    ];

    for (const item of forbidden) {
      expect(synthesis).toContain(item);
    }
  });
});

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}
