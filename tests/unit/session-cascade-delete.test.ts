import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BlockStore } from '../../openclaw_runtime/src/context-engine/block-store';
import { closeOpenClawStateDatabaseForTest, openOpenClawStateDatabase } from '../../openclaw_runtime/src/state/openclaw-state-db';
import type { ContextBlock } from '../../openclaw_runtime/src/context-engine/block';

const roots: string[] = [];
let stateDir = '';

vi.mock('@electron/utils/paths', () => ({
  getOpenClawRuntimeDir: () => path.join(stateDir, 'missing-openclaw-runtime'),
}));

vi.mock('@electron/services/knowledge-api', () => ({
  resolveHostOpenClawStateDir: () => stateDir,
}));

function makeExperienceBlock(sessionKey: string, principleId: string): ContextBlock {
  const now = new Date('2026-08-17T00:00:00.000Z');
  return {
    block_id: `experience:sekb:experience-projection/v1:${sessionKey}:${principleId}:rev1`,
    block_type: 'experience',
    source_system: 'sekb',
    session_id: sessionKey,
    presence: { always_on: false, on_demand: { expand_tool: 'context_search', auto_register: false }, background: true },
    entities: ['postgresql'],
    valid_at: now,
    created_at: now,
    mutability: 'system_managed',
    summary: 'Experience',
    full_content: 'Check PG access before retrying.',
    compression_depth: 0,
    entity_extraction_status: 'empty',
  };
}

beforeEach(() => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'clawx-session-cascade-'));
  roots.push(root);
  stateDir = path.join(root, 'state');
  mkdirSync(stateDir, { recursive: true });
});

afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('KS-02 host session derivative cascade', () => {
  it('hard-deletes real DCS experience Blocks from the shared openclaw-state database', async () => {
    const sessionKey = 'agent:alpha:main';
    const database = openOpenClawStateDatabase({
      env: { ...process.env, OPENCLAW_STATE_DIR: stateDir },
    });
    const blockStore = new BlockStore(database.db);
    await blockStore.upsert(makeExperienceBlock(sessionKey, 'principle-1'), {
      confirmed: true,
      confidence: 0.8,
      write_origin: 'handler',
    });
    const journalDir = path.join(stateDir, 'dcs-experience-journal');
    mkdirSync(journalDir, { recursive: true });
    const journalName = `experience_sekb_${sessionKey.replace(/:/g, '_')}_principle-1.json`;
    writeFileSync(path.join(journalDir, journalName), JSON.stringify({ block: { session_id: sessionKey } }));

    const { runHostSessionDerivativeCascade } = await import('@electron/services/session-cascade-delete');
    const report = await runHostSessionDerivativeCascade(sessionKey, 'base-id');

    expect(report.success).toBe(true);
    expect(report.removed).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'dcs_experience_block', id: expect.stringContaining('experience-projection/v1') }),
      expect.objectContaining({ kind: 'dcs_experience_journal', id: journalName }),
    ]));
    expect(await blockStore.enumerateBySession(sessionKey)).toHaveLength(0);
  });

  it('reports retryable incomplete when the shared state database cannot be opened', async () => {
    stateDir = path.join(roots[roots.length - 1], 'state-as-file');
    writeFileSync(stateDir, 'not-a-directory');
    const { runHostSessionDerivativeCascade } = await import('@electron/services/session-cascade-delete');
    const report = await runHostSessionDerivativeCascade('agent:alpha:missing', 'base-id');
    expect(report.success).toBe(false);
    expect(report.retryable).toBe(true);
    expect(report.errors.some((entry) => entry.kind === 'dcs_experience_block')).toBe(true);
  });
});
