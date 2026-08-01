/**
 * Lock-in tests for the exec allowlist (command-prefix approval, Codex C2
 * equivalent).
 *
 * These pin two properties that keep the allowlist safe:
 * 1. `argPattern` matching is token-prefix aware (a `node -e` pattern does
 *    NOT allow `node server.js`).
 * 2. Shell chained commands (`;`, `&&`) are evaluated per segment — a chain
 *    that mixes an allowlisted command with an unlisted one is rejected
 *    (defends the Codex "git status; rm -rf /" bypass).
 */
import { describe, expect, it } from "vitest";
import { analyzeShellCommand } from "./exec-approvals-analysis.js";
import { evaluateExecAllowlist } from "./exec-approvals-allowlist.js";
import type { ExecAllowlistEntry } from "./exec-approvals.types.js";

function evaluate(command: string, allowlist: ExecAllowlistEntry[]) {
  const analysis = analyzeShellCommand({ command, cwd: process.cwd() });
  if (!analysis.ok) {
    return { allowlistSatisfied: false as const, reason: "analysis failed" };
  }
  const evaluation = evaluateExecAllowlist({
    analysis,
    allowlist,
    safeBins: new Set(),
    allowShellBuiltins: true,
  } as never);
  return evaluation;
}

describe("exec allowlist (command-prefix approval)", () => {
  // node/npm resolve to real executables in this environment; bare patterns
  // match by executable name (Windows: "node" matches the resolved
  // "node.exe" via normalizeExecutableToken), argPattern constrains the
  // argument PREFIX (non-`^` patterns are anchored to the arg start, so a
  // mid-argument substring never satisfies the entry).
  const nodePattern = 'node';
  const allowlist: ExecAllowlistEntry[] = [
    { pattern: nodePattern, argPattern: '^-e( |$)' },
    { pattern: 'npm', argPattern: '^(test|run)( |$)' },
  ];

  it('allows an allowlisted command with matching args', () => {
    const result = evaluate('node -e x', allowlist);
    expect(result.allowlistSatisfied).toBe(true);
  });

  it('rejects the same executable with non-matching args', () => {
    // node server.js must NOT be covered by the `node -e` pattern.
    const result = evaluate('node server.js', allowlist);
    expect(result.allowlistSatisfied).toBe(false);
  });

  it('allows npm test and npm run', () => {
    expect(evaluate('npm test', allowlist).allowlistSatisfied).toBe(true);
    expect(evaluate('npm run build', allowlist).allowlistSatisfied).toBe(true);
  });

  it('rejects chained commands where any segment is not allowlisted', () => {
    // Codex-style bypass: `npm test; rm -rf /` must not be allowed by the
    // `npm test` pattern alone.
    const result = evaluate('npm test; rm -rf /', allowlist);
    expect(result.allowlistSatisfied).toBe(false);
  });

  it('allows a chain where every segment is allowlisted', () => {
    const result = evaluate('node -e x && npm test', allowlist);
    expect(result.allowlistSatisfied).toBe(true);
  });
});
