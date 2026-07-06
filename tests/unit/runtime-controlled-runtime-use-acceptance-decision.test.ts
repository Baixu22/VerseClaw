import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const RESULTS =
  "runtime-research/handoffs/controlled-runtime-use-pilot-deep-validation/results.md";
const README =
  "runtime-research/handoffs/controlled-runtime-use-pilot-deep-validation/README.md";

describe("controlled runtime-use acceptance decision", () => {
  it("accepts Registry and rejects AST as the current usable pilot direction", () => {
    const results = readRepoFile(RESULTS);

    expect(results).toContain(
      "Status: accepted_registry_pilot_ast_current_pilot_needs_revision",
    );
    expect(results).toContain(
      "accepts the Registry controlled diagnostic consumer as the next pilot direction",
    );
    expect(results).toContain(
      "rejects AST as a current usable pilot direction",
    );
    expect(results).toContain(
      "Do not proceed with AST controlled readonly candidate-generation pilot in the current phase.",
    );
    expect(results).toContain(
      "abandon AST as a current pilot, optimize only as a later narrow evaluation track",
    );
  });

  it("keeps AST re-entry narrower than the rejected pilot", () => {
    const results = readRepoFile(RESULTS);
    const requiredReentryGates = [
      "fixed target-file allowlist, no repository-wide scan",
      "max file count, max source bytes, max matches, and max preview diff bytes",
      "measured false-positive rate and review time on at least 30 narrow-rule samples",
      "no apply/write/mutation/completion evidence",
      "hard fail-closed on overbroad, ambiguous, or budget-exceeded cases",
    ];

    for (const gate of requiredReentryGates) {
      expect(results).toContain(gate);
    }
  });

  it("does not delete the existing AST readonly safety boundary", () => {
    const readme = readRepoFile(README);

    expect(readme).toContain("Preserve AST readonly helper and existing boundary tests.");
    expect(readme).toContain("Abandon broad AST pilot");
    expect(readme).toContain("Continue forbidding apply, workspace edit, symbol mutation");
  });
});

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}
