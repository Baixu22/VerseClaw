/**
 * run-surface-promotion.ts — the single-responsibility table for run rendering.
 *
 * ## Why this file exists
 *
 * The chat transcript has two renderers that can both describe the same runtime
 * event:
 *
 *   1. `ExecutionGraphCard` — a compact text tree derived from `ChatRuntimeEvent`
 *      via `deriveRuntimeTaskSteps`. Cheap, always present, no interaction.
 *   2. Tool UI cards (`Terminal`, `CodeDiff`, `ApprovalCard`, `ToolUiPlanView`) —
 *      rich, interactive, expensive.
 *
 * Before this module existed the two were wired to different sources, so runtime
 * events only ever reached (1) and the rich cards were unreachable outside of
 * model-authored ```tool-ui fences. Now both read the table below: an event that
 * is *promoted* to a card contributes its graph step id to `promotedStepIds`,
 * and `sanitizeGraphSteps` drops that row. One event, one renderer — the overlap
 * is structurally impossible rather than merely avoided by convention.
 *
 * ## Promotion table
 *
 * | runtime event                     | promoted to        | graph row |
 * | --------------------------------- | ------------------ | --------- |
 * | `command.output`                  | Terminal card      | dropped   |
 * | `tool.started` that produced one  | Terminal card      | dropped†  |
 * | `approval.updated`                | ApprovalCard*      | dropped†† |
 * | `tool.*` name ∈ PLAN_TOOLS        | ToolUiPlanView     | dropped   |
 * | `patch.completed`                 | inline CodeDiff    | kept**    |
 * | every other `tool.*`              | —                  | kept      |
 *
 *   *  The card itself is driven by the host approval store (`useRunApprovals`),
 *      not by the event — the event carries no decision affordance. The event's
 *      row is still dropped so the user does not see a dead "Approval" line next
 *      to a live approval card.
 *   ** `patch.completed` keeps its one-line summary (it names the file and the
 *      +/- counts, which the diff card does not repeat) while the actual diff is
 *      rendered from `GeneratedFile` projections alongside it.
 *   †† Only when the event carries no `message`. The two approval planes are
 *      disjoint: `approval.updated` is emitted solely by the runtime exec
 *      approval path, while `PendingRunApprovals` renders the ClawX host
 *      permission store, whose only writers are the Electron service APIs. So a
 *      runtime approval's row has no card standing behind it, and its `message`
 *      — which is where the exec `warningText` lands, including VerseShell's
 *      static external-write no-rollback notice — is the only in-app rendering
 *      of that text. Dropping a row that carries one removed information no
 *      other surface shows. A message-less row is a bare "Approval" label with
 *      nothing under it and is still dropped.
 *   †  Only when a `command.output` for the same `toolCallId` exists. The graph
 *      row's detail is the command string, which the Terminal card already shows
 *      as its header — keeping both printed the command twice in one card. A
 *      `tool.started` with no output keeps its row; it is the only trace of a
 *      command that never produced anything.
 *
 * ## Boundaries this file deliberately does NOT collapse
 *
 * - `tool-ui/code-diff` (inline, transcript) vs `MonacoDiffViewer` (side panel,
 *   whole file). Different weight class; the transcript must not lazy-load an
 *   editor per turn.
 * - `ai-elements/{reasoning,chain-of-thought,task}` and `progress-tracker` are
 *   part of the model-authored Tool UI contract with distinct schemas. They are
 *   not runtime-event renderers and never appear in this table.
 * - Workspace panel approval banners gate a *panel action* (open terminal, git
 *   push). Different interaction, different lifetime, intentionally separate.
 *
 * ## Companion table
 *
 * `MESSAGE_CARD_EXCLUDED_TOOL_UI_TYPES` below extends the same "one event, one
 * renderer" rule to the message side: it names the Tool UI types a tool call
 * must not render on the message, because a surface listed above already owns
 * them. `message-render-projection.ts` is its only consumer.
 */
import {
  projectCommandSurfaces,
  projectGeneratedFileDiff,
  type RunCodeDiffSurface,
  type RunTerminalSurface,
} from '@/components/tool-ui/run-surfaces';
import { parseToolUiInteraction } from '@/components/tool-ui/agent-interactions';
import type { ToolUiPlanTodo } from '@/components/tool-ui/plan-view';
import type { GeneratedFile } from '@/lib/generated-files';
import type { ChatRuntimeRunState } from '@/stores/chat/types';
import {
  runtimeApprovalStepId,
  runtimeCommandStepId,
} from './task-visualization';

/** Tool names whose arguments carry a structured work plan. */
export const PLAN_TOOL_NAMES: ReadonlySet<string> = new Set([
  'update_plan',
  'update-plan',
  'todowrite',
  'todo_write',
  'todo-write',
]);

/**
 * Tool UI types a *tool call* must never render as a card on the message
 * itself, because another surface is already their single owner.
 *
 * `approval-card` belongs to `PendingRunApprovals`, which is driven by the host
 * approval store (`use-run-approvals.ts`) — the only source that can actually
 * unblock the run. A tool call that also parses as an approval would otherwise
 * put a second, decorative approval card next to the real one.
 *
 * Scope note: this gates the TOOL-CALL path only. A model-authored
 * ```tool-ui approval fence in the reply text still renders — that is the model
 * narrating a decision it wants, not a permission gate the host is holding.
 */
export const MESSAGE_CARD_EXCLUDED_TOOL_UI_TYPES: ReadonlySet<string> = new Set([
  'approval-card',
]);

export type RunPlanSurface = {
  id: string;
  title?: string;
  description?: string;
  todos: ToolUiPlanTodo[];
};

/** Minimal shape of a transcript message this module reads plan tool calls from. */
export type PlanSourceMessage = { content?: unknown };

export type PromotedRunSurfaces = {
  terminals: RunTerminalSurface[];
  diffs: RunCodeDiffSurface[];
  plan: RunPlanSurface | null;
  /** Graph step ids already rendered by a rich card — `sanitizeGraphSteps` drops these. */
  promotedStepIds: Set<string>;
};

export const EMPTY_PROMOTED_SURFACES: PromotedRunSurfaces = {
  terminals: [],
  diffs: [],
  plan: null,
  promotedStepIds: new Set(),
};

export function isPlanToolName(name: string | undefined): boolean {
  return !!name && PLAN_TOOL_NAMES.has(name.trim().toLowerCase());
}

function planSurfaceFromPayload(payload: unknown, fallbackId: string): RunPlanSurface | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const interaction = parseToolUiInteraction(
    { ...(payload as Record<string, unknown>), type: 'plan', id: fallbackId },
    fallbackId,
  );
  if (interaction?.type !== 'plan') return null;
  return {
    id: interaction.id,
    title: interaction.title,
    description: interaction.description,
    todos: interaction.todos,
  };
}

/**
 * Reuse the Tool UI parser rather than writing a second plan reader — the
 * `update_plan` shape (`{ explanation, plan: [{ step, status }] }`) is handled
 * there, so a plan renders identically whether it arrives as a live runtime
 * event or as a `tool_use` block replayed from history.
 */
function readPlanSurface(runState: ChatRuntimeRunState): {
  plan: RunPlanSurface | null;
  stepIds: string[];
} {
  const stepIds: string[] = [];
  let latest: RunPlanSurface | null = null;

  for (const event of runState.events) {
    if (event.type !== 'tool.started' && event.type !== 'tool.updated' && event.type !== 'tool.completed') {
      continue;
    }
    if (!isPlanToolName(event.name)) continue;
    stepIds.push(event.toolCallId);

    const args = event.type === 'tool.updated'
      ? event.partialResult
      : event.type === 'tool.completed'
        ? event.result
        : event.args;
    const surface = planSurfaceFromPayload(args, event.toolCallId);
    if (surface) latest = surface;
  }

  return { plan: latest, stepIds };
}

/**
 * History fallback: once a run ends the runtime state is no longer the active
 * run, so the same plan has to be recoverable from the `tool_use` blocks left
 * in the transcript. Without this the plan card would disappear on reload.
 */
function readPlanSurfaceFromMessages(messages: PlanSourceMessage[]): RunPlanSurface | null {
  let latest: RunPlanSurface | null = null;
  for (const message of messages) {
    const content = message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const record = block as Record<string, unknown>;
      const type = record.type;
      if (type !== 'tool_use' && type !== 'toolCall' && type !== 'toolUse') continue;
      const name = typeof record.name === 'string' ? record.name : undefined;
      if (!isPlanToolName(name)) continue;
      const id = typeof record.id === 'string' ? record.id : `plan-${name}`;
      const surface = planSurfaceFromPayload(record.input ?? record.args, id);
      if (surface) latest = surface;
    }
  }
  return latest;
}

export function promoteRunSurfaces({
  runState,
  generatedFiles = [],
  segmentMessages = [],
}: {
  runState: ChatRuntimeRunState | null | undefined;
  generatedFiles?: GeneratedFile[];
  segmentMessages?: PlanSourceMessage[];
}): PromotedRunSurfaces {
  const diffs = generatedFiles
    .map((file) => projectGeneratedFileDiff(file))
    .filter((surface): surface is RunCodeDiffSurface => surface != null);
  const historyPlan = readPlanSurfaceFromMessages(segmentMessages);

  if (!runState) {
    return diffs.length === 0 && !historyPlan
      ? EMPTY_PROMOTED_SURFACES
      : { terminals: [], diffs, plan: historyPlan, promotedStepIds: new Set() };
  }

  const terminals = projectCommandSurfaces(runState);
  const { plan, stepIds: planStepIds } = readPlanSurface(runState);
  const promotedStepIds = new Set<string>(planStepIds);

  for (const event of runState.events) {
    if (event.type === 'command.output') {
      promotedStepIds.add(runtimeCommandStepId(event));
      // The `tool.started` that launched this command is promoted with it. Its
      // graph row's detail is the same command string the Terminal card already
      // shows as its header, so leaving it produced the command twice in one
      // card. A tool call whose output never materialized keeps its row — that
      // is the only trace the user gets of it.
      if (event.toolCallId) promotedStepIds.add(event.toolCallId);
      continue;
    }
    if (event.type === 'approval.updated') {
      // A runtime approval has no card behind it (see †† above), so its row is
      // the only place its message is rendered. Keep the row when it carries
      // one; drop the bare label when it does not.
      if (!event.message?.trim()) promotedStepIds.add(runtimeApprovalStepId(event));
    }
  }

  return { terminals, diffs, plan: plan ?? historyPlan, promotedStepIds };
}
