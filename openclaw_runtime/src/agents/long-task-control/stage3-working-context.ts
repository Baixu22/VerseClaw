// Stage 3 runtime adapter for the long-task Task Ledger. Default off: with the
// flag off this module performs zero Stage 3 JSONL read/write. With an explicit
// opt-in it delegates to the existing appendLongTaskLedgerEvents appender and
// never creates a table, snapshot cache, store, or daemon.
import type { TaskLedgerEventInput } from "../../../../shared/types/task-ledger.js";
import {
  createTaskLedgerWorkingContextDecision,
  createTaskLedgerWorkingContextProposal,
  emptyTaskLedgerWorkingContextSnapshot,
  mergeTaskLedgerWorkingContext,
  projectTaskLedgerWorkingContext,
  STAGE3_WORKING_CONTEXT_POLICY_DIGEST,
} from "../../../../shared/task-ledger-working-context.js";
import {
  appendLongTaskLedgerEvents,
  readLongTaskLedgerRevision,
} from "./task-ledger.js";

export const STAGE3_TASK_LEDGER_WORKING_CONTEXT_ENV = "OPENCLAW_STAGE3_TASK_LEDGER_WC";

export type Stage3WorkingContextState = {
  enabled: boolean;
};

export function resolveStage3WorkingContextState(
  env: NodeJS.ProcessEnv = process.env,
  explicit?: boolean,
): Stage3WorkingContextState {
  if (explicit !== undefined) return { enabled: explicit };
  const value = env[STAGE3_TASK_LEDGER_WORKING_CONTEXT_ENV];
  return { enabled: value === "1" || value === "true" };
}

export type AppendStage3WorkingContextEventsOptions = {
  workspaceId: string | null | undefined;
  events: TaskLedgerEventInput[];
  env?: NodeJS.ProcessEnv;
  /** Explicit test/runner opt-in. Defaults to env flag, which defaults off. */
  enabled?: boolean;
};

export function appendStage3WorkingContextEvents(
  options: AppendStage3WorkingContextEventsOptions,
): void {
  const state = resolveStage3WorkingContextState(options.env, options.enabled);
  if (!state.enabled || options.events.length === 0) return;
  appendLongTaskLedgerEvents(options.workspaceId, options.events, options.env ?? process.env);
}

export {
  createTaskLedgerWorkingContextDecision,
  createTaskLedgerWorkingContextProposal,
  emptyTaskLedgerWorkingContextSnapshot,
  mergeTaskLedgerWorkingContext,
  projectTaskLedgerWorkingContext,
  readLongTaskLedgerRevision,
  STAGE3_WORKING_CONTEXT_POLICY_DIGEST,
};
