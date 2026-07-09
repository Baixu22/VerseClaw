// @runtime-family v1.0
// @authority diagnostic_only
// @owner WP1

import { randomUUID } from 'node:crypto';

import { shadowSafetyBoundary } from './shadow-safety-boundary-adapter.js';
import type {
  LifecycleEntity,
  LifecycleEntityType,
  LifecyclePhase,
  LifecycleTransition,
  LifecycleTransitionOptions,
  RuntimeSpineMetadata,
  RuntimeSpineResult,
} from './types.js';

const allowedTransitions: Readonly<Record<LifecyclePhase, readonly LifecyclePhase[]>> = {
  created: ['planned', 'pre_gate', 'aborted', 'failed'],
  planned: ['pre_gate', 'running', 'aborted', 'failed'],
  pre_gate: ['gated_approved', 'gated_blocked', 'aborted', 'failed'],
  gated_approved: ['running', 'aborted', 'failed'],
  gated_blocked: ['review_required', 'aborted', 'failed'],
  running: ['evidence_collected', 'verification_pending', 'completed', 'failed', 'aborted'],
  evidence_collected: ['verification_pending', 'review_required', 'completed', 'failed'],
  verification_pending: ['verified_pass', 'verified_fail', 'failed', 'aborted'],
  verified_pass: ['completed', 'review_required'],
  verified_fail: ['review_required', 'failed', 'rolled_back'],
  review_required: ['gated_approved', 'running', 'completed', 'failed', 'aborted', 'rolled_back'],
  completed: [],
  failed: ['rolled_back'],
  aborted: ['rolled_back'],
  rolled_back: [],
};

class LifecycleEngine {
  private readonly entities = new Map<string, LifecycleEntity>();

  create(entityType: LifecycleEntityType, metadata?: RuntimeSpineMetadata): LifecycleEntity {
    const now = Date.now();
    const entity: LifecycleEntity = {
      entityId: randomUUID(),
      entityType,
      phase: 'created',
      createdAt: now,
      updatedAt: now,
      metadata,
      transitions: [],
    };

    shadowSafetyBoundary.execute('lifecycle.create', () => {
      this.entities.set(entity.entityId, entity);
    });

    return entity;
  }

  transition(
    entityId: string,
    to: LifecyclePhase,
    opts: LifecycleTransitionOptions = {},
  ): RuntimeSpineResult<LifecycleTransition> {
    const entity = this.entities.get(entityId);
    if (!entity) {
      return { success: false, error: `Lifecycle entity not found: ${entityId}` };
    }

    if (!allowedTransitions[entity.phase].includes(to)) {
      return {
        success: false,
        error: `Invalid lifecycle transition from ${entity.phase} to ${to}`,
      };
    }

    const transition: LifecycleTransition = {
      transitionId: randomUUID(),
      entityId,
      from: entity.phase,
      to,
      at: Date.now(),
      actor: opts.actor,
      reason: opts.reason,
      metadata: opts.metadata,
    };

    shadowSafetyBoundary.execute('lifecycle.transition', () => {
      entity.phase = to;
      entity.updatedAt = transition.at;
      entity.transitions.push(transition);
    });

    return { success: true, value: transition };
  }

  get(entityId: string): LifecycleEntity | undefined {
    return this.entities.get(entityId);
  }

  getAll(): LifecycleEntity[] {
    return Array.from(this.entities.values());
  }

  getByType(entityType: LifecycleEntityType): LifecycleEntity[] {
    return this.getAll().filter((entity) => entity.entityType === entityType);
  }

  rebuild(transitions: readonly LifecycleTransition[]): RuntimeSpineResult<LifecycleEntity[]> {
    const rebuilt = new Map<string, LifecycleEntity>();

    for (const transition of transitions) {
      const existing = rebuilt.get(transition.entityId);
      const entity: LifecycleEntity = existing ?? {
        entityId: transition.entityId,
        entityType: 'verification_task',
        phase: transition.from,
        createdAt: transition.at,
        updatedAt: transition.at,
        transitions: [],
      };

      if (!allowedTransitions[entity.phase].includes(transition.to)) {
        return {
          success: false,
          error: `Invalid lifecycle transition from ${entity.phase} to ${transition.to}`,
        };
      }

      entity.phase = transition.to;
      entity.updatedAt = transition.at;
      entity.transitions.push(transition);
      rebuilt.set(entity.entityId, entity);
    }

    shadowSafetyBoundary.execute('lifecycle.rebuild', () => {
      this.entities.clear();
      for (const [entityId, entity] of rebuilt.entries()) {
        this.entities.set(entityId, entity);
      }
    });

    return { success: true, value: this.getAll() };
  }
}

export const lifecycleEngine = new LifecycleEngine();
