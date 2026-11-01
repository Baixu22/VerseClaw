/**
 * Boundary guard for start-of-session injection (TF-0648 -> TF-0642).
 *
 * A2a locked "the plan reaches no prompt at all". A2b wires it, so that lock is
 * replaced by the invariant that supersedes it: the plan reaches a prompt only
 * as a `session_start` candidate collected inside the Context Orchestrator -
 * never as text some other module splices into the body behind the ledger.
 *
 * A comment cannot enforce that, so the scan below names the modules that are
 * allowed to know about the plan and the modules that are not.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');

const PLAN_IDENTIFIERS = [
  'SessionStartInjectionPlan',
  'buildSessionStartInjectionPlan',
  'session-start-injection',
];

/** Modules that must stay ignorant of the plan: they own sources or charges. */
const NON_CONSUMERS = [
  'openclaw_runtime/src/auto-reply/reply/startup-context.ts',
  'openclaw_runtime/src/context-engine/context-candidate.ts',
  'openclaw_runtime/src/context-engine/turn-injection-budget.ts',
];

describe('start injection reaches prompts only as orchestrator candidates', () => {
  it.each(NON_CONSUMERS)('%s does not reference the start-injection plan', (relativePath) => {
    const source = readFileSync(path.join(ROOT, relativePath), 'utf8');
    for (const identifier of PLAN_IDENTIFIERS) {
      expect(source, `${relativePath} must not consume ${identifier}`).not.toContain(identifier);
    }
  });

  it('collects the plan through the one seam and nowhere else', () => {
    const orchestrator = readFileSync(
      path.join(ROOT, 'openclaw_runtime/src/context-engine/context-orchestrator.ts'),
      'utf8',
    );
    expect(orchestrator).toContain('applySessionStartInjection');
    // Candidate construction stays in the seam module: the orchestrator must not
    // build session-start candidates itself and grow a second assembly.
    expect(orchestrator).not.toContain('buildSessionStartInjectionCandidates');
  });

  it('keeps the seam module free of I/O and on the session_start channel', () => {
    const source = readFileSync(
      path.join(ROOT, 'openclaw_runtime/src/context-engine/session-start-injection.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/from "node:fs"/);
    expect(source).not.toMatch(/readFile|writeFile|readdir|Date\.now\(/);
    expect(source).toContain('"session_start"');
    expect(source).toContain('"system_prompt"');
  });

  it('lets the reply path build a request without splicing it into the body', () => {
    const source = readFileSync(
      path.join(ROOT, 'openclaw_runtime/src/auto-reply/reply/get-reply-run.ts'),
      'utf8',
    );
    expect(source).toContain('SESSION_START_INJECTION_REQUEST_SCHEMA');
    expect(source).toContain('bodyStartupContextPrelude');
    // The body may only carry the prelude the plan decided NOT to take.
    expect(source).toContain('startupContextPrelude: bodyStartupContextPrelude');
  });

  it('keeps the fact adapter I/O free', () => {
    const source = readFileSync(
      path.join(ROOT, 'openclaw_runtime/src/context-engine/session-start-injection-facts.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/from "node:fs"/);
    expect(source).not.toMatch(/readFile|writeFile|readdir/);
  });

  it('keeps the plan module free of I/O, clocks and stores', () => {
    const source = readFileSync(path.join(ROOT, 'shared/types/session-start-injection.ts'), 'utf8');
    expect(source).not.toMatch(/from "node:/);
    expect(source).not.toMatch(/Date\.now\(|Math\.random\(/);
    expect(source).not.toMatch(/updateSessionStore|localStorage|fetch\(/);
  });
});