// @runtime-family v1.0
// @authority diagnostic_only
// @owner WP1

import { describe, expect, it } from 'vitest';

import { lifecycleEngine } from '../lifecycle-engine.js';

describe('LifecycleEngine', () => {
  it('creates entities in the created phase', () => {
    const entity = lifecycleEngine.create('clawgraph_run', { test: 'initial-phase' });

    expect(entity.phase).toBe('created');
    expect(entity.entityType).toBe('clawgraph_run');
    expect(entity.transitions).toEqual([]);
  });

  it('returns a successful transition for legal phase changes', () => {
    const entity = lifecycleEngine.create('clawgraph_node');

    const result = lifecycleEngine.transition(entity.entityId, 'planned', {
      actor: 'unit-test',
      reason: 'legal transition',
      metadata: { sequence: 1 },
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.value).toMatchObject({
      entityId: entity.entityId,
      from: 'created',
      to: 'planned',
      actor: 'unit-test',
      reason: 'legal transition',
      metadata: { sequence: 1 },
    });
    expect(lifecycleEngine.get(entity.entityId)?.phase).toBe('planned');
  });

  it('returns an error for illegal transitions without throwing', () => {
    const entity = lifecycleEngine.create('ast_edit_plan');

    expect(() => lifecycleEngine.transition(entity.entityId, 'completed')).not.toThrow();
    const result = lifecycleEngine.transition(entity.entityId, 'completed');

    expect(result).toEqual({
      success: false,
      error: 'Invalid lifecycle transition from created to completed',
    });
    expect(lifecycleEngine.get(entity.entityId)?.phase).toBe('created');
  });

  it('records a complete audit trail for transitions', () => {
    const entity = lifecycleEngine.create('tool_invocation');

    lifecycleEngine.transition(entity.entityId, 'planned', { actor: 'planner' });
    lifecycleEngine.transition(entity.entityId, 'running', { actor: 'runner' });

    const stored = lifecycleEngine.get(entity.entityId);
    expect(stored?.transitions).toHaveLength(2);
    expect(stored?.transitions).toEqual([
      expect.objectContaining({ from: 'created', to: 'planned', actor: 'planner' }),
      expect.objectContaining({ from: 'planned', to: 'running', actor: 'runner' }),
    ]);
    expect(stored?.updatedAt).toBe(stored?.transitions.at(-1)?.at);
  });

  it('rebuilds entities from transitions and returns the last phase', () => {
    const entity = lifecycleEngine.create('verification_task');
    const first = lifecycleEngine.transition(entity.entityId, 'planned');
    const second = lifecycleEngine.transition(entity.entityId, 'running');

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    if (!first.success || !second.success) {
      return;
    }

    const result = lifecycleEngine.rebuild([first.value, second.value]);

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.value).toHaveLength(1);
    expect(result.value[0]).toMatchObject({
      entityId: entity.entityId,
      phase: 'running',
      transitions: [first.value, second.value],
    });
  });

  it('filters entities by type', () => {
    const run = lifecycleEngine.create('clawgraph_run');
    lifecycleEngine.create('checkpoint_restore');

    const runs = lifecycleEngine.getByType('clawgraph_run');

    expect(runs).toContainEqual(expect.objectContaining({ entityId: run.entityId }));
    expect(runs.every((entity) => entity.entityType === 'clawgraph_run')).toBe(true);
  });
});
