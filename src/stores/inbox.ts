import { create } from 'zustand';
import { hostApi } from '@/lib/host-api';
import type { AgentBrowserTask } from '@shared/host-api/contract';
import type { RemoteTaskPreview, RemoteTaskRecord } from '@shared/types/remote-tasks';
import type {
  PermissionApprovalDecision,
  PermissionApprovalEvent,
  PermissionRiskLevel,
} from '@shared/types/workspace';
import { approvalDisplayDetails, isExternalWriteApproval, stripSensitiveApprovalDetails } from '@/lib/permission-approval-display';

export type InboxSource = 'permission' | 'remote-task' | 'browser-task' | 'operator';
export type InboxRisk = 'read' | PermissionRiskLevel;
export type InboxEvidenceKind =
  | 'command'
  | 'location'
  | 'paths'
  | 'parameters'
  | 'reason'
  | 'message'
  | 'settings'
  | 'result'
  | 'error'
  | 'target'
  | 'domains'
  | 'mode'
  | 'profile'
  | 'scope'
  | 'success'
  | 'steps';

export type InboxEvidence = {
  kind: InboxEvidenceKind;
  value: string;
};

type InboxItemBase = {
  key: string;
  id: string;
  source: InboxSource;
  title: string;
  summary?: string;
  risk: InboxRisk;
  status: string;
  timestamp: number;
  evidence: InboxEvidence[];
};

export type PermissionInboxItem = InboxItemBase & {
  source: 'permission';
  actions: Array<'approve' | 'deny'>;
  approval: PermissionApprovalEvent;
};

export type RemoteTaskInboxItem = InboxItemBase & {
  source: 'remote-task';
  actions: Array<'approve' | 'reject' | 'execute'>;
  task: RemoteTaskRecord;
};

export type BrowserTaskInboxItem = InboxItemBase & {
  source: 'browser-task';
  actions: Array<'approve-and-run' | 'reject'>;
  task: AgentBrowserTask;
};

/** RC-05: a real Operator slice intent projected from the durable approval ledger. */
export type OperatorInboxItem = InboxItemBase & {
  source: 'operator';
  actions: Array<'approve' | 'deny'>;
  /** Real approval ledger row fields (digest-only request). */
  approvalId: string;
  requestDigest: string;
  resolvedBy?: string | null;
  /** Structured lineage: context/effect/recovery refs from real receipts. */
  lineage?: {
    contextReceipts: string[];
    effectReceipt?: string;
    approval?: string;
    recovery: string;
    refs: string[];
  };
};

export type InboxItem =
  | PermissionInboxItem
  | RemoteTaskInboxItem
  | BrowserTaskInboxItem
  | OperatorInboxItem;

type InboxSourceErrors = Partial<Record<InboxSource, string>>;

type InboxState = {
  items: InboxItem[];
  loading: boolean;
  loaded: boolean;
  busyKey: string | null;
  sourceErrors: InboxSourceErrors;
  lastUpdatedAt: number | null;
  refresh: () => Promise<void>;
  decidePermission: (id: string, decision: PermissionApprovalDecision) => Promise<void>;
  actOnRemoteTask: (id: string, action: 'approve' | 'reject' | 'execute') => Promise<void>;
  actOnBrowserTask: (id: string, action: 'approve-and-run' | 'reject') => Promise<void>;
  previewRemoteTask: (id: string) => Promise<RemoteTaskPreview>;
  /** RC-05: decide a pending Operator slice intent (real governance decision). */
  decideOperator: (id: string, decision: 'approve' | 'deny') => Promise<void>;
  /** RC-05: fetch real Operator lineage (ContextReceipt/EffectReceipt) for an intent identity. */
  loadOperatorLineage: (runId: string, sessionKey: string) => Promise<unknown>;
  /** Last lineage payload returned by loadOperatorLineage. */
  operatorLineage?: unknown;
};

function compactEvidence(entries: Array<InboxEvidence | null | undefined>): InboxEvidence[] {
  return entries.filter((entry): entry is InboxEvidence => Boolean(entry?.value.trim()));
}

function permissionTitle(approval: PermissionApprovalEvent): string {
  return approvalDisplayDetails(approval).title?.trim() || approval.source;
}

export function projectPermissionApproval(approval: PermissionApprovalEvent): PermissionInboxItem {
  const display = approvalDisplayDetails(approval);
  const externalWrite = isExternalWriteApproval(approval);
  return {
    key: `permission:${approval.id}`,
    id: approval.id,
    source: 'permission',
    title: permissionTitle(approval),
    summary: display.command || display.cwd || display.paramsPreview,
    risk: approval.risk,
    status: approval.status,
    timestamp: approval.resolvedAt ?? approval.requestedAt,
    evidence: externalWrite ? [] : compactEvidence([
      display.command ? { kind: 'command', value: display.command } : null,
      display.cwd ? { kind: 'location', value: display.cwd } : null,
      display.paths?.length ? { kind: 'paths', value: display.paths.join('\n') } : null,
      display.paramsPreview ? { kind: 'parameters', value: display.paramsPreview } : null,
      display.reason ? { kind: 'reason', value: display.reason } : null,
    ]),
    actions: approval.status === 'pending' ? ['approve', 'deny'] : [],
    approval: stripSensitiveApprovalDetails(approval),
  };
}

function remoteTaskTitle(task: RemoteTaskRecord): string {
  if (task.command.kind === 'message') return task.command.title;
  if (task.command.kind === 'doctor') return `doctor:${task.command.mode}`;
  return Object.keys(task.command.patch).join(', ');
}

function remoteTaskRisk(task: RemoteTaskRecord): InboxRisk {
  if (task.command.kind === 'settingsPatch') return 'write';
  if (task.command.kind === 'doctor' && task.command.mode === 'fix') return 'dangerous';
  return 'read';
}

export function projectRemoteTask(task: RemoteTaskRecord): RemoteTaskInboxItem {
  const commandEvidence: InboxEvidence = task.command.kind === 'message'
    ? { kind: 'message', value: task.command.body }
    : task.command.kind === 'doctor'
      ? { kind: 'command', value: `openclaw doctor${task.command.mode === 'fix' ? ' --fix' : ''}` }
      : { kind: 'settings', value: JSON.stringify(task.command.patch, null, 2) };
  const actions: RemoteTaskInboxItem['actions'] = task.status === 'pendingApproval'
    ? ['approve', 'reject']
    : task.status === 'pending' || task.status === 'failed'
      ? ['execute']
      : [];

  return {
    key: `remote-task:${task.id}`,
    id: task.id,
    source: 'remote-task',
    title: remoteTaskTitle(task),
    summary: task.reason || (task.command.kind === 'message' ? task.command.body : undefined),
    risk: remoteTaskRisk(task),
    status: task.status,
    timestamp: Date.parse(task.updatedAt || task.createdAt),
    evidence: compactEvidence([
      commandEvidence,
      task.reason ? { kind: 'reason', value: task.reason } : null,
      task.resultSummary ? { kind: 'result', value: task.resultSummary } : null,
      task.error ? { kind: 'error', value: task.error } : null,
    ]),
    actions,
    task,
  };
}

function browserTaskRisk(task: AgentBrowserTask): InboxRisk {
  return task.permissionScope.includes('interact-page') ? 'external-write' : 'network';
}

export function projectBrowserTask(task: AgentBrowserTask): BrowserTaskInboxItem {
  const successValue = task.successCriteria
    ? `${task.successCriteria.kind}: ${task.successCriteria.value}`
    : task.successCondition;
  return {
    key: `browser-task:${task.id}`,
    id: task.id,
    source: 'browser-task',
    title: task.name,
    summary: task.objective,
    risk: browserTaskRisk(task),
    status: task.status,
    timestamp: Date.parse(task.updatedAt || task.createdAt),
    evidence: compactEvidence([
      { kind: 'target', value: task.url },
      task.allowedDomains.length ? { kind: 'domains', value: task.allowedDomains.join(', ') } : null,
      { kind: 'mode', value: task.mode },
      { kind: 'profile', value: task.profile },
      task.permissionScope.length ? { kind: 'scope', value: task.permissionScope.join(', ') } : null,
      successValue ? { kind: 'success', value: successValue } : null,
      { kind: 'steps', value: String(task.steps.length) },
    ]),
    actions: task.status === 'waiting-approval' && task.approval.status === 'pending'
      ? ['approve-and-run', 'reject']
      : [],
    task,
  };
}

export function isInboxItemActionable(item: InboxItem): boolean {
  return item.actions.length > 0;
}

/** RC-05: project a real Operator slice intent row into an Inbox item. */
export function projectOperatorIntent(intent: {
  approvalId: string;
  state: string;
  requestDigest: string;
  createdAtMs: number;
  expiresAtMs: number;
  resolvedBy?: string | null;
  decision?: string | null;
}): OperatorInboxItem {
  const pending = intent.state === 'approval_pending';
  return {
    key: `operator:${intent.approvalId}`,
    id: intent.approvalId,
    source: 'operator',
    title: `operator:${intent.approvalId.slice(0, 12)}`,
    // Pure domain data, never display prose: the UI renders i18n labels.
    summary: intent.requestDigest,
    risk: 'write',
    status: intent.decision ?? intent.state,
    timestamp: intent.createdAtMs,
    evidence: [
      { kind: 'reason', value: intent.state },
      { kind: 'result', value: intent.requestDigest },
      intent.resolvedBy ? { kind: 'profile', value: intent.resolvedBy } : null,
    ].filter((entry): entry is InboxEvidence => entry !== null),
    actions: pending ? ['approve', 'deny'] : [],
    approvalId: intent.approvalId,
    requestDigest: intent.requestDigest,
    resolvedBy: intent.resolvedBy ?? null,
  };
}

export function projectInboxItems(input: {
  approvals?: PermissionApprovalEvent[];
  remoteTasks?: RemoteTaskRecord[];
  browserTasks?: AgentBrowserTask[];
  operatorIntents?: Array<{
    approvalId: string;
    state: string;
    requestDigest: string;
    createdAtMs: number;
    expiresAtMs: number;
    resolvedBy?: string | null;
    decision?: string | null;
  }>;
}): InboxItem[] {
  return [
    ...(input.approvals ?? []).map(projectPermissionApproval),
    ...(input.remoteTasks ?? []).map(projectRemoteTask),
    ...(input.browserTasks ?? [])
      .filter((task) => task.status === 'waiting-approval' && task.approval.status === 'pending')
      .map(projectBrowserTask),
    ...(input.operatorIntents ?? []).map(projectOperatorIntent),
  ].sort((left, right) => right.timestamp - left.timestamp);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertHostSuccess(result: { success: boolean; error?: string }): void {
  if (!result.success) throw new Error(result.error || 'Host action failed');
}

let refreshInFlight: Promise<void> | null = null;

export const useInboxStore = create<InboxState>((set, get) => ({
  items: [],
  loading: false,
  loaded: false,
  busyKey: null,
  sourceErrors: {},
  lastUpdatedAt: null,

  refresh: async () => {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      if (!get().loaded) set({ loading: true });
      const [permissionsResult, remoteTasksResult, browserTasksResult, operatorIntentsResult] =
        await Promise.allSettled([
          hostApi.permissions.approvals({ includeExpired: true, limit: 200 }),
          hostApi.remoteTasks.list(),
          hostApi.agentBrowser.tasks(),
          // RC-05: real Operator slice intents from the durable approval ledger
          // through the Gateway Inbox methods (never a fabricated list).
          hostApi.gateway.rpc<{ intents: Array<{
            approvalId: string;
            state: string;
            requestDigest: string;
            createdAtMs: number;
            expiresAtMs: number;
            resolvedBy?: string | null;
            decision?: string | null;
          }> }>('inbox.operator.list', {}),
        ]);

      const sourceErrors: InboxSourceErrors = {};
      const approvals = permissionsResult.status === 'fulfilled'
        ? permissionsResult.value.approvals
        : (sourceErrors.permission = errorMessage(permissionsResult.reason), undefined);
      const remoteTasks = remoteTasksResult.status === 'fulfilled'
        ? remoteTasksResult.value.tasks
        : (sourceErrors['remote-task'] = errorMessage(remoteTasksResult.reason), undefined);
      const browserTasks = browserTasksResult.status === 'fulfilled'
        ? browserTasksResult.value.tasks
        : (sourceErrors['browser-task'] = errorMessage(browserTasksResult.reason), undefined);
      const operatorIntents = operatorIntentsResult.status === 'fulfilled'
        ? operatorIntentsResult.value.intents
        : (sourceErrors.operator = errorMessage(operatorIntentsResult.reason), undefined);

      set({
        items: projectInboxItems({ approvals, remoteTasks, browserTasks, operatorIntents }),
        sourceErrors,
        loading: false,
        loaded: true,
        lastUpdatedAt: Date.now(),
      });
    })();

    try {
      await refreshInFlight;
    } finally {
      refreshInFlight = null;
    }
  },

  decidePermission: async (id, decision) => {
    set({ busyKey: `permission:${id}` });
    try {
      const result = await hostApi.permissions.decideApproval({ id, decision });
      assertHostSuccess(result);
    } finally {
      await get().refresh();
      set({ busyKey: null });
    }
  },

  actOnRemoteTask: async (id, action) => {
    set({ busyKey: `remote-task:${id}` });
    try {
      const result = action === 'approve'
        ? await hostApi.remoteTasks.approve({ id })
        : action === 'reject'
          ? await hostApi.remoteTasks.reject({ id })
          : await hostApi.remoteTasks.execute({ id });
      assertHostSuccess(result);
    } finally {
      await get().refresh();
      set({ busyKey: null });
    }
  },

  actOnBrowserTask: async (id, action) => {
    set({ busyKey: `browser-task:${id}` });
    try {
      const result = action === 'approve-and-run'
        ? await hostApi.agentBrowser.approveTask({ taskId: id })
        : await hostApi.agentBrowser.rejectTask({ taskId: id });
      assertHostSuccess(result);
    } finally {
      await get().refresh();
      set({ busyKey: null });
    }
  },

  decideOperator: async (id, decision) => {
    set({ busyKey: `operator:${id}` });
    try {
      // UI action names (approve/deny) map to the wire protocol values
      // (approved/denied) the Gateway inbox.operator.decide accepts.
      const wireDecision = decision === 'approve' ? 'approved' : decision === 'deny' ? 'denied' : decision;
      const result = await hostApi.gateway.rpc<{ success: boolean; error?: string }>(
        'inbox.operator.decide',
        { approvalId: id, decision: wireDecision },
      );
      assertHostSuccess(result);
    } finally {
      await get().refresh();
      set({ busyKey: null });
    }
  },

  /** RC-05: fetch the real Operator lineage (ContextReceipt/EffectReceipt) for
   *  an intent identity through the Gateway Inbox lineage API. */
  loadOperatorLineage: async (runId, sessionKey) => {
    const result = await hostApi.gateway.rpc<{ success: boolean; lineage?: unknown; error?: string }>(
      'inbox.operator.lineage',
      { runId, sessionKey },
    );
    if (!result.success) throw new Error(result.error || 'Operator lineage failed');
    set({ operatorLineage: result.lineage });
    return result.lineage;
  },

  previewRemoteTask: async (id) => {
    const result = await hostApi.remoteTasks.preview({ id });
    assertHostSuccess(result);
    return { requiresApproval: result.requiresApproval, changes: result.changes };
  },
}));
