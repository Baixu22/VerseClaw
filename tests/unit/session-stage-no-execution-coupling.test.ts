/**
 * Negative guard for the read-only SessionStage projection (TF-0641).
 *
 * The acceptance criterion is that stage never becomes an execution input. A
 * comment cannot enforce that, so this test scans the production sources that
 * build prompts, charge the injection budget, and decide compaction, and fails
 * if any of them mentions the stage projection.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');

/**
 * Files that own prompt assembly, injection accounting, or compaction timing.
 * Adding one of these here is a promise that stage must stay out of it.
 */
const EXECUTION_OWNERS = [
  'openclaw_runtime/src/context-engine/context-orchestrator.ts',
  'openclaw_runtime/src/context-engine/context-candidate.ts',
  'openclaw_runtime/src/context-engine/turn-injection-budget.ts',
  'openclaw_runtime/src/context-engine/injection-budget.ts',
  'openclaw_runtime/src/context-engine/assembler.ts',
  'openclaw_runtime/packages/agent-core/src/harness/compaction/compaction.ts',
  'openclaw_runtime/packages/agent-core/src/harness/compaction/compression-planner.ts',
  'openclaw_runtime/src/agents/embedded-agent-runner/run/preemptive-compaction.ts',
  'openclaw_runtime/src/agents/agent-hooks/compaction-safeguard.ts',
];

/** Identifiers that would mean stage leaked into an execution decision. */
const STAGE_IDENTIFIERS = [
  'SessionStage',
  'sessionStage',
  'deriveSessionStage',
  'projectSessionStage',
  'session-stage',
];

describe('SessionStage stays out of execution decisions', () => {
  it.each(EXECUTION_OWNERS)('%s does not reference the stage projection', (relativePath) => {
    const source = readFileSync(path.join(ROOT, relativePath), 'utf8');
    for (const identifier of STAGE_IDENTIFIERS) {
      expect(source, `${relativePath} must not read ${identifier}`).not.toContain(identifier);
    }
  });

  it('keeps the projection module free of write paths', () => {
    const source = readFileSync(
      path.join(ROOT, 'openclaw_runtime/src/gateway/server-methods/session-stage-projection.ts'),
      'utf8',
    );
    // A projection that imports a store, fs, or the budget could grow a write path.
    expect(source).not.toMatch(/from "node:fs"/);
    expect(source).not.toMatch(/updateSessionStore|updateSessionStoreEntry/);
    expect(source).not.toMatch(/chargeTurnInjection|applyInjectionBudget/);
  });

  it('derives the same stage for the same facts regardless of caller identity', () => {
    // Purity is the property that keeps a projection from becoming state.
    const source = readFileSync(
      path.join(ROOT, 'shared/types/session-stage.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/Date\.now\(/);
    expect(source).not.toMatch(/Math\.random\(/);
    expect(source).not.toMatch(/from "node:/);
  });
});
