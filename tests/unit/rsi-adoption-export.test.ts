import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { KnowledgeStore } from '../../openclaw_runtime/src/knowledge/sekb/knowledge-store';
import { closeOpenClawStateDatabaseForTest } from '../../openclaw_runtime/src/state/openclaw-state-db';
import { getPrincipleVersion, type Principle, type SekbAdoptionEvidence } from '../../openclaw_runtime/src/knowledge/sekb/types';

const roots: string[] = [];
afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync('D:/tmp/rsi-adoption-export-');
  roots.push(root);
  const dbPath = join(root, 'state.sqlite');
  const store = new KnowledgeStore({ database: { path: dbPath } });
  const principle: Principle = {
    principle_id: 'export-principle', created_at: '2026-11-08T00:00:00.000Z', updated_at: '2026-11-08T00:00:00.000Z',
    title: 'Verify interfaces', condition: 'When coding', action: 'Check the public contract', reason: 'Callers require it',
    full_content: 'Verify interfaces', task_types: ['code/task'], context_tags: ['code'], embedding: null,
    source_trajectories: [], created_by: 'agent', status: 'active', retrieval_count: 0, adoption_count: 0,
    post_adoption_success: 0, criticality: 'medium', pinned: false, metadata: {},
  };
  store.save_principle(principle);
  const evidence: SekbAdoptionEvidence = {
    schemaVersion: 'RsiExperienceAttribution/v1', principleVersion: getPrincipleVersion(store.get_principle(principle.principle_id)),
    taskId: null, runId: 'export-run', sessionId: 'export-session', sessionKey: null,
    experimentId: null, arm: null, repeat: null, trajectoryId: 'export-trajectory',
    trigger: 'retrieved', source: 'runtime', outcome: 'unknown', outcomeKind: null, observationId: null,
    operation: null, actor: 'codex/rsi-export-test', driven_by: 'agent',
  };
  store.record_adoption(principle.principle_id, evidence);
  store.record_adoption(principle.principle_id, { ...evidence, trigger: 'cited', source: 'agent' });
  store.record_adoption(principle.principle_id, { ...evidence, trigger: 'outcome', outcomeKind: 'operational', observationId: 'agent-end' });
  closeOpenClawStateDatabaseForTest();
  return { root, dbPath, store, evidence, principle };
}

describe('readable RSI attribution export', () => {
  it('preserves missing experiment linkage and unknown outcomes in a read-only export', async () => {
    const { exportAdoptionEvents, validateAdoptionExport } = await import('../../scripts/rsi-adoption-export.mjs');
    const { dbPath } = fixture();
    const report = exportAdoptionEvents({ dbPath });
    expect(report.source).toMatchObject({ state: 'present', totalRows: 3, exportedRows: 3, truncated: false });
    expect(report.records.every((record) => record.evidence.taskId === null && record.evidence.arm === null)).toBe(true);
    expect(report.diagnostics).toMatchObject({ missingTaskIdentity: 3, missingExperimentIdentity: 3, unknownOutcomes: 1 });
    expect(validateAdoptionExport(report).passed).toBe(true);
  });

  it('discloses truncation and rejects a changed experiment identity without matching receipt digests', async () => {
    const { exportAdoptionEvents, validateAdoptionExport } = await import('../../scripts/rsi-adoption-export.mjs');
    const { dbPath } = fixture();
    const limited = exportAdoptionEvents({ dbPath, maxRows: 1 });
    expect(limited.source).toMatchObject({ totalRows: 3, exportedRows: 1, truncated: true });
    const tampered = exportAdoptionEvents({ dbPath });
    tampered.records[0].evidence.arm = 'off';
    expect(validateAdoptionExport(tampered).passed).toBe(false);
    expect(validateAdoptionExport(tampered).errors.some((error) => error.code === 'payload-digest')).toBe(true);
  });

  it('does not create an absent source database', async () => {
    const { exportAdoptionEvents } = await import('../../scripts/rsi-adoption-export.mjs');
    const { root } = fixture();
    const absent = join(root, 'absent.sqlite');
    expect(exportAdoptionEvents({ dbPath: absent }).source.state).toBe('absent');
    expect(existsSync(absent)).toBe(false);
  });

  it('rejects a forged accepted status when the run has no matching exposure', async () => {
    const { exportAdoptionEvents, validateAdoptionExport } = await import('../../scripts/rsi-adoption-export.mjs');
    const { dbPath, store, evidence, principle } = fixture();
    store.record_adoption(principle.principle_id, { ...evidence, runId: 'unexposed-run', trigger: 'cited', source: 'agent' });
    closeOpenClawStateDatabaseForTest();
    const report = exportAdoptionEvents({ dbPath });
    const rejected = report.records.find((row) => row.status === 'rejected')!;
    rejected.status = 'accepted';
    rejected.reason = null;
    report.diagnostics.rejected = 0;
    expect(validateAdoptionExport(report).errors.some((error) => error.code === 'provenance-unexposed')).toBe(true);
  });
});
