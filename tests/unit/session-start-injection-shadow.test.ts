/**
 * Negative guard for the shadow start-injection plan (TF-0648).
 *
 * The plan must not reach a prompt. A comment cannot enforce that, so this test
 * scans the prompt-assembly owners and the plan module itself.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');

const PROMPT_OWNERS = [
  'openclaw_runtime/src/auto-reply/reply/get-reply-run.ts',
  'openclaw_runtime/src/auto-reply/reply/startup-context.ts',
  'openclaw_runtime/src/context-engine/context-orchestrator.ts',
  'openclaw_runtime/src/context-engine/context-candidate.ts',
  'openclaw_runtime/src/context-engine/turn-injection-budget.ts',
];

const PLAN_IDENTIFIERS = [
  'SessionStartInjectionPlan',
  'buildSessionStartInjectionPlan',
  'session-start-injection',
];

describe('start injection plan stays out of prompt assembly', () => {
  it.each(PROMPT_OWNERS)('%s does not reference the start-injection plan', (relativePath) => {
    const source = readFileSync(path.join(ROOT, relativePath), 'utf8');
    for (const identifier of PLAN_IDENTIFIERS) {
      expect(source, `${relativePath} must not consume ${identifier}`).not.toContain(identifier);
    }
  });

  it('keeps the plan module free of I/O, clocks and stores', () => {
    const source = readFileSync(path.join(ROOT, 'shared/types/session-start-injection.ts'), 'utf8');
    expect(source).not.toMatch(/from "node:/);
    expect(source).not.toMatch(/Date\.now\(|Math\.random\(/);
    expect(source).not.toMatch(/updateSessionStore|localStorage|fetch\(/);
  });

  it('keeps the fact adapter free of I/O', () => {
    const source = readFileSync(
      path.join(ROOT, 'openclaw_runtime/src/context-engine/session-start-injection-facts.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/from "node:fs"/);
    expect(source).not.toMatch(/readFile|writeFile|readdir/);
  });
});
