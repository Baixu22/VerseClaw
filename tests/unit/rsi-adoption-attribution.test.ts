import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { KnowledgeStore } from '../../openclaw_runtime/src/knowledge/sekb/knowledge-store';
import { closeOpenClawStateDatabaseForTest } from '../../openclaw_runtime/src/state/openclaw-state-db';
import {
  getPrincipleVersion,
  type Principle,
  type SekbAdoptionEvidence,
} from '../../openclaw_runtime/src/knowledge/sekb/types';

const roots: string[] = [];
afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function setup() {
  const root = mkdtempSync('D:/tmp/rsi-adoption-');
  roots.push(root);
  const database = { path: join(root, 'openclaw.sqlite') };
  const store = new KnowledgeStore({ database });
  const principle: Principle = {
    principle_id: 'rsi-principle', created_at: '2026-11-08T00:00:00.000Z',
    updated_at: '2026-11-08T00:00:00.000Z', title: 'Verify the public contract',
    condition: 'When implementing code', action: 'Check the public interface before finishing',
    reason: 'Interface checks catch integration errors', full_content: 'Check the public interface',
    task_types: ['code/task'], context_tags: ['code'], embedding: null, source_trajectories: [],
    created_by: 'agent', status: 'active', retrieval_count: 0, adoption_count: 0,
    post_adoption_success: 0, criticality: 'medium', pinned: false, metadata: {},
  };
  store.save_principle(principle);
  const evidence: SekbAdoptionEvidence = {
    schemaVersion: 'RsiExperienceAttribution/v1', principleVersion: getPrincipleVersion(store.get_principle(principle.principle_id)),
    taskId: 'task-a', runId: 'run-a', sessionId: 'session-a', sessionKey: 'agent:a:main',
    experimentId: 'experiment-a', arm: 'on', repeat: 1, trajectoryId: 'trajectory-a',
    trigger: 'retrieved', source: 'runtime', outcome: 'unknown', outcomeKind: null,
    observationId: null, operation: null, actor: 'codex/rsi-adoption-test', driven_by: 'agent',
  };
  const record = (patch: Partial<SekbAdoptionEvidence> = {}) => store.record_adoption(principle.principle_id, { ...evidence, ...patch });
  return { store, database, principle, evidence, record };
}

describe('versioned SEKB adoption attribution', () => {
  it('separates exposure, citation, adoption, operational completion and independent grading', () => {
    const { store, principle, record } = setup();
    expect(record().status).toBe('accepted');
    expect(record({ trigger: 'cited', source: 'agent' }).status).toBe('accepted');
    const operation = { toolCallId: 'edit-1', toolName: 'edit', observed: true, succeeded: true };
    expect(record({ trigger: 'adopted', source: 'agent', operation }).reason).toBe('operation-not-observed');
    expect(store.get_principle(principle.principle_id).adoption_count).toBe(0);
    record({ trigger: 'operation', operation });
    expect(record({ trigger: 'adopted', source: 'agent', operation }).status).toBe('accepted');
    expect(store.get_principle(principle.principle_id).adoption_count).toBe(1);
    record({ trigger: 'outcome', outcomeKind: 'operational', outcome: 'success', observationId: 'agent-end' });
    expect(store.get_principle(principle.principle_id).post_adoption_success).toBe(0);
    record({ trigger: 'outcome', source: 'grader', outcomeKind: 'task', observationId: 'grade-pending' });
    record({ trigger: 'outcome', source: 'grader', outcomeKind: 'task', outcome: 'success', observationId: 'grade-final' });
    expect(store.get_principle(principle.principle_id).post_adoption_success).toBe(1);
    record({ trigger: 'outcome', source: 'grader', outcomeKind: 'task', outcome: 'success', observationId: 'grade-final-duplicate' });
    expect(store.get_principle(principle.principle_id).post_adoption_success).toBe(1);
    expect(store.list_adoption_events({ principleId: principle.principle_id }).some((event) => event.evidence.outcome === 'unknown')).toBe(true);
  });

  it('retains deduplication across more than twenty receipts and a database reopen', () => {
    const { database, principle, evidence, record } = setup();
    record();
    const operation = { toolCallId: 'edit-first', toolName: 'edit', observed: true, succeeded: true };
    record({ trigger: 'operation', operation });
    const first = record({ trigger: 'adopted', source: 'agent', operation });
    for (let i = 0; i < 25; i++) record({ trigger: 'operation', operation: { ...operation, toolCallId: `other-${i}` } });
    closeOpenClawStateDatabaseForTest();
    const reopened = new KnowledgeStore({ database });
    const duplicate = reopened.record_adoption(principle.principle_id, { ...evidence, trigger: 'adopted', source: 'agent', operation });
    expect(duplicate.eventId).toBe(first.eventId);
    expect(duplicate.duplicateCount).toBe(1);
    const reordered = Object.fromEntries(Object.entries({ ...evidence, trigger: 'adopted', source: 'agent', operation }).reverse()) as SekbAdoptionEvidence;
    expect(reopened.record_adoption(principle.principle_id, reordered).disposition).toBe('duplicate');
    expect(reopened.get_principle(principle.principle_id).adoption_count).toBe(1);
    expect(reopened.list_adoption_events({ runId: evidence.runId! })).toHaveLength(28);
  });

  it('rejects unexposed, cross-run, changed-version and conflicting outcome evidence', () => {
    const { store, principle, evidence, record } = setup();
    expect(record({ trigger: 'cited', source: 'agent' }).reason).toBe('principle-not-exposed');
    record();
    expect(record({ trigger: 'cited', source: 'agent', runId: 'another-run' }).reason).toBe('principle-not-exposed');
    expect(record({ trigger: 'cited', source: 'agent', repeat: 2 }).reason).toBe('principle-not-exposed');
    expect(record({ trigger: 'cited', source: 'agent', runId: null }).reason).toBe('run-identity-missing');
    record({ trigger: 'outcome', source: 'grader', outcomeKind: 'task', outcome: 'failure', observationId: 'grade-1' });
    const conflict = record({ trigger: 'outcome', source: 'grader', outcomeKind: 'task', outcome: 'success', observationId: 'grade-1' });
    expect(conflict.conflictCount).toBe(1);
    expect(conflict.evidence.outcome).toBe('failure');
    expect(record({ trigger: 'outcome', source: 'grader', outcomeKind: 'task', outcome: 'success', observationId: 'grade-2' }).reason).toBe('conflicting-task-outcome');
    store.update_principle(principle.principle_id, { action: 'Changed advice' });
    expect(record({ trigger: 'adopted', source: 'agent', operation: { toolCallId: 'edit-x', toolName: 'edit', observed: true, succeeded: true } }).reason).toBe('principle-version-mismatch');
    expect(store.get_principle(principle.principle_id).adoption_count).toBe(0);
    expect(store.list_adoption_events().every((event) => event.evidence.principleVersion === evidence.principleVersion)).toBe(true);
  });

  it('versions public advice rather than counters and removes receipt data with principle deletion', () => {
    const { store, principle, evidence, record } = setup();
    record({ taskId: null, experimentId: null, arm: null, repeat: null });
    store.increment_retrieval_count(principle.principle_id);
    store.update_principle(principle.principle_id, { metadata: { diagnostic: true }, pinned: true });
    expect(getPrincipleVersion(store.get_principle(principle.principle_id))).toBe(evidence.principleVersion);
    store.update_principle(principle.principle_id, { action: 'Changed advice' });
    expect(getPrincipleVersion(store.get_principle(principle.principle_id))).not.toBe(evidence.principleVersion);
    expect(store.list_adoption_events()[0].evidence.taskId).toBeNull();
    expect(() => record({ extraPayload: 'not allowed' } as never)).toThrow(/fields/);
    expect(() => record({ driven_by: 'real-human' } as never)).toThrow(/requires/);
    store.delete_trajectory(evidence.trajectoryId!);
    expect(store.list_adoption_events()).toHaveLength(0);
    store.update_principle(principle.principle_id, { action: principle.action });
    record();
    store.delete_principle(principle.principle_id);
    expect(store.list_adoption_events()).toHaveLength(0);
  });
});
