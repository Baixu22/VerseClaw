/**
 * TF-0718: durable execution-phase store (single writer, CAS transitions).
 *
 * One row per tool invocation. `recordIntent` must commit before the tool is
 * dispatched; every later phase change is a compare-and-set on (phase,
 * revision), so a stale writer can never move a row backwards or skip a step.
 *
 * The domain journal remains the effect truth. This table only answers "which
 * phase did this invocation durably reach?", which is what recovery needs.
 */
import { randomUUID } from 'node:crypto';

import {
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
  getNodeSqliteKysely,
} from '../../infra/kysely-sync.js';
import {
  openOpenClawStateDatabase,
  runOpenClawStateWriteTransaction,
  type OpenClawStateDatabaseOptions,
} from '../../state/openclaw-state-db.js';
import type { DB as OpenClawStateKyselyDatabase } from '../../state/openclaw-state-db.generated.js';
import {
  canTransition,
  type ExecutionPhase,
} from '../../../../shared/recovery-contract/execution-phase.js';

export const EXECUTION_PHASE_OWNER = 'openclaw_runtime.agents.execution-phase.store';

export type ExecutionPhasesTable = OpenClawStateKyselyDatabase['execution_phases'];
export type ExecutionPhaseRow = SelectableRow;
type SelectableRow = ExecutionPhasesTable extends never ? never : import('kysely').Selectable<ExecutionPhasesTable>;

export type ExecutionEffectClass = 'safe' | 'unsafe' | 'reconcile';

export type RecordExecutionIntentInput = {
  idempotencyKey: string;
  toolName: string;
  effectClass: ExecutionEffectClass;
  sessionKey?: string;
  runId?: string;
  taskId?: string;
  /** Digest/refs only. Raw tool arguments must never be stored here. */
  intent?: Record<string, unknown>;
  now?: number;
};

export type RecordExecutionIntentResult = {
  ok: true;
  executionId: string;
  duplicate: boolean;
  phase: ExecutionPhase;
};

export type CommitExecutionPhaseInput = {
  idempotencyKey: string;
  from: ExecutionPhase;
  to: ExecutionPhase;
  recovery?: Record<string, unknown>;
  now?: number;
};

export type CommitExecutionPhaseFailure = 'not-found' | 'revision-conflict' | 'illegal-transition' | 'write-failed';

export type CommitExecutionPhaseResult =
  | { ok: true; phase: ExecutionPhase; revision: number }
  | { ok: false; reason: CommitExecutionPhaseFailure };

export type ExecutionPhaseOptions = OpenClawStateDatabaseOptions;

function table(options: ExecutionPhaseOptions) {
  const { db } = openOpenClawStateDatabase(options);
  return getNodeSqliteKysely<Pick<OpenClawStateKyselyDatabase, 'execution_phases'>>(db);
}

export function readExecutionPhase(
  idempotencyKey: string,
  options: ExecutionPhaseOptions = {},
): ExecutionPhaseRow | undefined {
  const { db } = openOpenClawStateDatabase(options);
  return executeSqliteQueryTakeFirstSync(
    db,
    table(options)
      .selectFrom('execution_phases')
      .selectAll()
      .where('idempotency_key', '=', idempotencyKey),
  ) as ExecutionPhaseRow | undefined;
}

export function readOpenExecutionPhases(
  sessionKey: string,
  options: ExecutionPhaseOptions = {},
): ExecutionPhaseRow[] {
  const { db } = openOpenClawStateDatabase(options);
  return executeSqliteQuerySync(
    db,
    table(options)
      .selectFrom('execution_phases')
      .selectAll()
      .where('session_key', '=', sessionKey)
      .where('phase', 'in', ['admitted', 'dispatched', 'effect_pending', 'effect_committed'])
      .orderBy('updated_at', 'desc'),
  ).rows as ExecutionPhaseRow[];
}

/** Record the intent BEFORE the tool runs. Idempotent on the idempotency key. */
export function recordExecutionIntent(
  input: RecordExecutionIntentInput,
  options: ExecutionPhaseOptions = {},
): RecordExecutionIntentResult {
  const now = input.now ?? Date.now();
  let result: RecordExecutionIntentResult | undefined;
  runOpenClawStateWriteTransaction(({ db }) => {
    const query = getNodeSqliteKysely<Pick<OpenClawStateKyselyDatabase, 'execution_phases'>>(db);
    const existing = executeSqliteQueryTakeFirstSync(
      db,
      query.selectFrom('execution_phases').selectAll().where('idempotency_key', '=', input.idempotencyKey),
    ) as ExecutionPhaseRow | undefined;
    if (existing) {
      result = {
        ok: true,
        executionId: existing.execution_id,
        duplicate: true,
        phase: existing.phase as ExecutionPhase,
      };
      return;
    }
    const executionId = `exe_${randomUUID()}`;
    executeSqliteQuerySync(
      db,
      query.insertInto('execution_phases').values({
        execution_id: executionId,
        idempotency_key: input.idempotencyKey,
        session_key: input.sessionKey ?? null,
        run_id: input.runId ?? null,
        task_id: input.taskId ?? null,
        tool_name: input.toolName,
        effect_class: input.effectClass,
        phase: 'dispatched',
        revision: 0,
        intent_json: JSON.stringify(input.intent ?? {}),
        recovery_json: '{}',
        created_at: now,
        updated_at: now,
      }),
    );
    result = { ok: true, executionId, duplicate: false, phase: 'dispatched' };
  }, options);
  if (!result) throw new Error('execution intent write produced no result');
  return result;
}

/** Compare-and-set a phase transition. A stale or illegal move is rejected. */
export function commitExecutionPhase(
  input: CommitExecutionPhaseInput,
  options: ExecutionPhaseOptions = {},
): CommitExecutionPhaseResult {
  const now = input.now ?? Date.now();
  let result: CommitExecutionPhaseResult | undefined;
  try {
    runOpenClawStateWriteTransaction(({ db }) => {
      const query = getNodeSqliteKysely<Pick<OpenClawStateKyselyDatabase, 'execution_phases'>>(db);
      const existing = executeSqliteQueryTakeFirstSync(
        db,
        query.selectFrom('execution_phases').selectAll().where('idempotency_key', '=', input.idempotencyKey),
      ) as ExecutionPhaseRow | undefined;
      if (!existing) {
        result = { ok: false, reason: 'not-found' };
        return;
      }
      if (existing.phase === input.to) {
        result = { ok: true, phase: existing.phase as ExecutionPhase, revision: existing.revision };
        return;
      }
      if (existing.phase !== input.from) {
        result = { ok: false, reason: 'revision-conflict' };
        return;
      }
      if (!canTransition(existing.phase as ExecutionPhase, input.to)) {
        result = { ok: false, reason: 'illegal-transition' };
        return;
      }
      const revision = existing.revision + 1;
      executeSqliteQuerySync(
        db,
        query
          .updateTable('execution_phases')
          .set({
            phase: input.to,
            revision,
            recovery_json: JSON.stringify(input.recovery ?? {}),
            updated_at: now,
          })
          .where('execution_id', '=', existing.execution_id)
          .where('phase', '=', existing.phase)
          .where('revision', '=', existing.revision),
      );
      result = { ok: true, phase: input.to, revision };
    }, options);
  } catch {
    result = { ok: false, reason: 'write-failed' };
  }
  if (!result) throw new Error('execution phase commit produced no result');
  return result;
}

/**
 * Gateway startup settlement: an open row from a previous boot is `lost` unless
 * its phase says the effect may already be present, in which case it must be
 * reconciled instead of retried.
 */
export function settleOrphanedExecutionPhases(params: {
  runIdPrefix?: string;
  now?: number;
  options?: ExecutionPhaseOptions;
} = {}): { settled: number; needsReconciliation: number } {
  const now = params.now ?? Date.now();
  const { db } = openOpenClawStateDatabase(params.options ?? {});
  const query = getNodeSqliteKysely<Pick<OpenClawStateKyselyDatabase, 'execution_phases'>>(db);
  const open = executeSqliteQuerySync(
    db,
    query.selectFrom('execution_phases').selectAll()
      .where('phase', 'in', ['admitted', 'dispatched', 'effect_pending', 'effect_committed'])
      .orderBy('updated_at', 'asc'),
  ).rows as ExecutionPhaseRow[];
  let settled = 0;
  let needsReconciliation = 0;
  for (const row of open) {
    if (params.runIdPrefix && !String(row.run_id ?? '').startsWith(params.runIdPrefix)) continue;
    const phase = row.phase as ExecutionPhase;
    if (phase === 'effect_pending' || phase === 'effect_committed') {
      markExecutionNeedsReconciliation(row.idempotency_key, 'gateway-restart', now, params.options ?? {});
      needsReconciliation += 1;
      continue;
    }
    // admitted/dispatched: no effect truth, so the invocation is simply lost.
    commitExecutionPhase({
      idempotencyKey: row.idempotency_key,
      from: phase,
      to: 'failed',
      recovery: { settledAt: now, reason: 'gateway-restart', lost: true },
      now,
    }, params.options ?? {});
    settled += 1;
  }
  return { settled, needsReconciliation };
}


/** Mark a row as needing reconciliation without changing its committed phase. */
export function markExecutionNeedsReconciliation(
  idempotencyKey: string,
  reason: string,
  now: number = Date.now(),
  options: ExecutionPhaseOptions = {},
): boolean {
  try {
    runOpenClawStateWriteTransaction(({ db }) => {
      const query = getNodeSqliteKysely<Pick<OpenClawStateKyselyDatabase, 'execution_phases'>>(db);
      const existing = executeSqliteQueryTakeFirstSync(
        db,
        query.selectFrom('execution_phases').selectAll().where('idempotency_key', '=', idempotencyKey),
      ) as ExecutionPhaseRow | undefined;
      if (!existing) return false;
      executeSqliteQuerySync(
        db,
        query.updateTable('execution_phases')
          .set({
            recovery_json: JSON.stringify({ needsReconciliation: true, reason, settledAt: now }),
            updated_at: now,
          })
          .where('execution_id', '=', existing.execution_id),
      );
      return true;
    }, options);
    return true;
  } catch {
    return false;
  }
}

