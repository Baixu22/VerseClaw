/**
 * TF-0718: tool-execution boundary.
 *
 * `recordIntent` must land before the tool runs; the phase is advanced only
 * after the tool returns. Gated by `OPENCLAW_EXECUTION_PHASE_WRITER` so the
 * default behaviour stays legacy until the cutover is explicitly selected.
 */
import { commitExecutionPhase, recordExecutionIntent, type ExecutionEffectClass } from './store.js';

export const EXECUTION_PHASE_WRITER_ENV = 'OPENCLAW_EXECUTION_PHASE_WRITER';

export function isExecutionPhaseWriterEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[EXECUTION_PHASE_WRITER_ENV];
  if (typeof raw !== 'string') return false;
  const value = raw.trim().toLowerCase();
  return value === 'taskflow' || value === '1' || value === 'true';
}

const UNSAFE_TOOLS = new Set([
  'write', 'edit', 'apply_patch', 'undo_write', 'bash', 'exec', 'process', 'message',
]);
const SAFE_TOOLS = new Set([
  'read', 'ls', 'glob', 'grep', 'find', 'web_search', 'web_fetch', 'session_status',
]);

export function classifyToolEffect(toolName: string): ExecutionEffectClass {
  const name = toolName.trim().toLowerCase();
  if (UNSAFE_TOOLS.has(name)) return 'unsafe';
  if (SAFE_TOOLS.has(name)) return 'safe';
  return 'reconcile';
}

export type ToolIntentKey = {
  runId?: string;
  toolCallId?: string;
  toolName: string;
};

export function buildToolIntentIdempotencyKey(key: ToolIntentKey): string | null {
  if (!key.toolCallId) return null;
  return `${key.runId ?? 'run'}:${key.toolCallId}`;
}

/** Returns the key when the writer is enabled and the call is identifiable. */
export function beginToolExecution(
  key: ToolIntentKey,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (!isExecutionPhaseWriterEnabled(env)) return null;
  const idempotencyKey = buildToolIntentIdempotencyKey(key);
  if (!idempotencyKey) return null;
  try {
    recordExecutionIntent({
      idempotencyKey,
      toolName: key.toolName,
      effectClass: classifyToolEffect(key.toolName),
      ...(key.runId ? { runId: key.runId } : {}),
      intent: { tool: key.toolName, effectClass: classifyToolEffect(key.toolName) },
    });
    return idempotencyKey;
  } catch {
    return null;
  }
}

export function completeToolExecution(idempotencyKey: string | null): void {
  if (!idempotencyKey) return;
  try {
    commitExecutionPhase({ idempotencyKey, from: 'dispatched', to: 'effect_pending' });
    commitExecutionPhase({ idempotencyKey, from: 'effect_pending', to: 'effect_committed' });
  } catch {
    // A phase write failure must never change the tool result.
  }
}

export function failToolExecution(idempotencyKey: string | null): void {
  if (!idempotencyKey) return;
  try {
    commitExecutionPhase({ idempotencyKey, from: 'dispatched', to: 'failed' });
  } catch {
    // best effort
  }
}
