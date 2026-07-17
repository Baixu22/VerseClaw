import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { isRecord } from './payload-utils';
import type { PermissionDecisionEvent } from '@shared/product-semantics';
import type {
  PermissionApprovalDecision,
  PermissionApprovalEvent,
  PermissionRiskLevel,
  WorkspacePermissionMode,
  WorkspaceProfile,
} from '@shared/types/workspace';

type PermissionStoreDocument = {
  approvals: PermissionApprovalEvent[];
  decisionEvents: PermissionDecisionEvent[];
};

type ApprovalDecisionBody = {
  id?: unknown;
  decision?: unknown;
};

type ApprovalListBody = {
  workspaceId?: unknown;
  sessionKey?: unknown;
  status?: unknown;
  source?: unknown;
  includeExpired?: unknown;
  limit?: unknown;
};

type CreateApprovalInput = {
  workspace: WorkspaceProfile;
  source: PermissionApprovalEvent['source'];
  risk: PermissionRiskLevel;
  command?: string;
  cwd?: string;
  reason?: string;
  runId?: string | null;
  paths?: string[];
  requestHash?: string;
  paramsPreview?: string;
};

const MAX_APPROVAL_EVENTS = 2000;
const MAX_PERMISSION_DECISION_EVENTS = 2000;
const DEFAULT_APPROVAL_LIMIT = 200;
const MAX_APPROVAL_LIMIT = 1000;
const PENDING_APPROVAL_TTL_MS = 10 * 60 * 1000;
const VALID_DECISIONS = new Set<PermissionApprovalDecision>(['approved', 'denied']);
const VALID_STATUSES = new Set<PermissionApprovalEvent['status']>(['pending', 'approved', 'denied', 'expired']);
const VALID_SOURCES = new Set<PermissionApprovalEvent['source']>(['terminal', 'gateway', 'mcp', 'file', 'remoteControl', 'git', 'cleaner']);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let permissionStoreInstance: any = null;
let permissionDecisionEventWriteQueue: Promise<void> = Promise.resolve();
// P2-002 / F-AUTH-006: serialize approval create/decide/consume read-modify-write
// so concurrent Promise.all consumers cannot both succeed.
let approvalMutationQueue: Promise<void> = Promise.resolve();

let approvalMutationDepth = 0;

async function withApprovalMutation<T>(fn: () => Promise<T>): Promise<T> {
  // Re-entrant: nested expire/read-modify-write inside an outer critical section must not deadlock.
  if (approvalMutationDepth > 0) {
    return await fn();
  }
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previous = approvalMutationQueue;
  approvalMutationQueue = previous.then(() => gate, () => gate);
  await previous.catch(() => undefined);
  approvalMutationDepth += 1;
  try {
    return await fn();
  } finally {
    approvalMutationDepth -= 1;
    release();
  }
}


async function getPermissionStore() {
  if (!permissionStoreInstance) {
    const Store = (await import('electron-store')).default;
    const options = {
      name: 'workspace-permissions',
      projectName: 'Verse Claw',
      defaults: {
        approvals: [],
        decisionEvents: [],
      },
    };
    permissionStoreInstance = new Store<PermissionStoreDocument>(
      // electron-store forwards this to conf, which requires projectName
      // outside Electron. The published types do not expose that option.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      options as any,
    );
  }
  return permissionStoreInstance;
}

function createApprovalId(): string {
  return `approval-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeDecision(value: unknown): PermissionApprovalDecision {
  if (typeof value === 'string' && VALID_DECISIONS.has(value as PermissionApprovalDecision)) {
    return value as PermissionApprovalDecision;
  }
  throw new Error('decision must be approved or denied');
}

function requireId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('id is required');
  }
  return value.trim();
}

function normalizeLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_APPROVAL_LIMIT;
  return Math.max(1, Math.min(Math.floor(value), MAX_APPROVAL_LIMIT));
}

function normalizeStringFilter(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeEnumFilter<T extends string>(
  value: unknown,
  allowed: Set<T>,
): T[] | undefined {
  const rawValues = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const values = rawValues.filter((item): item is T => (
    typeof item === 'string' && allowed.has(item as T)
  ));
  return values.length > 0 ? values : undefined;
}

async function readApprovals(): Promise<PermissionApprovalEvent[]> {
  const store = await getPermissionStore();
  const approvals = store.get('approvals');
  return Array.isArray(approvals) ? approvals as PermissionApprovalEvent[] : [];
}

async function writeApprovals(approvals: PermissionApprovalEvent[]): Promise<void> {
  const store = await getPermissionStore();
  store.set('approvals', approvals.slice(0, MAX_APPROVAL_EVENTS));
}

async function readPermissionDecisionEvents(): Promise<PermissionDecisionEvent[]> {
  const store = await getPermissionStore();
  const events = store.get('decisionEvents');
  return Array.isArray(events) ? events as PermissionDecisionEvent[] : [];
}

async function writePermissionDecisionEvents(events: PermissionDecisionEvent[]): Promise<void> {
  const store = await getPermissionStore();
  store.set('decisionEvents', events.slice(0, MAX_PERMISSION_DECISION_EVENTS));
}

export async function recordPermissionDecisionEvent(event: PermissionDecisionEvent): Promise<PermissionDecisionEvent> {
  const write = permissionDecisionEventWriteQueue.then(async () => {
    const events = await readPermissionDecisionEvents();
    await writePermissionDecisionEvents([event, ...events]);
  });
  permissionDecisionEventWriteQueue = write.then(
    () => undefined,
    () => undefined,
  );
  await write;
  return event;
}

export async function listPermissionDecisionEvents(limit = DEFAULT_APPROVAL_LIMIT): Promise<PermissionDecisionEvent[]> {
  const normalizedLimit = normalizeLimit(limit);
  await permissionDecisionEventWriteQueue;
  return (await readPermissionDecisionEvents()).slice(0, normalizedLimit);
}

function isExpiredPendingApproval(approval: PermissionApprovalEvent, now = Date.now()): boolean {
  return approval.status === 'pending' && now - approval.requestedAt > PENDING_APPROVAL_TTL_MS;
}

async function readApprovalsWithExpiredPendingMarked(): Promise<PermissionApprovalEvent[]> {
  // Expire under the same mutex as consume/decide so TTL deny cannot race a concurrent approve/consume.
  return withApprovalMutation(async () => {
    const approvals = await readApprovals();
    let modified = false;
    const now = Date.now();
    const next = approvals.map((approval) => {
      if (!isExpiredPendingApproval(approval, now)) return approval;
      modified = true;
      return {
        ...approval,
        status: 'expired' as const,
        resolvedAt: now,
        reason: approval.reason ?? 'Approval request expired; default deny',
      };
    });
    if (modified) {
      await writeApprovals(next);
    }
    return next;
  });
}

function matchesApprovalRequest(approval: PermissionApprovalEvent, input: CreateApprovalInput): boolean {
  return approval.status === 'pending'
    && approval.workspaceId === input.workspace.id
    && approval.sessionKey === input.workspace.activeSessionKey
    && approval.source === input.source
    && approval.risk === input.risk
    && approval.command === input.command
    && approval.cwd === input.cwd
    && approval.requestHash === input.requestHash
    && JSON.stringify(approval.paths ?? []) === JSON.stringify(input.paths ?? []);
}

function buildApproval(input: CreateApprovalInput, status: PermissionApprovalEvent['status']): PermissionApprovalEvent {
  const now = Date.now();
  return {
    id: createApprovalId(),
    workspaceId: input.workspace.id,
    sessionKey: input.workspace.activeSessionKey,
    runId: input.runId ?? null,
    mode: input.workspace.permissionMode as WorkspacePermissionMode,
    source: input.source,
    requestedAt: now,
    resolvedAt: status === 'pending' ? undefined : now,
    status,
    risk: input.risk,
    command: input.command,
    cwd: input.cwd,
    paths: input.paths,
    requestHash: input.requestHash,
    paramsPreview: input.paramsPreview,
    reason: input.reason,
  };
}

export async function listPermissionApprovals(): Promise<PermissionApprovalEvent[]> {
  return await readApprovalsWithExpiredPendingMarked();
}

export async function createPermissionApproval(input: CreateApprovalInput): Promise<PermissionApprovalEvent> {
  return withApprovalMutation(async () => {
    const approvals = await readApprovalsWithExpiredPendingMarked();
    const existing = approvals.find((approval) => matchesApprovalRequest(approval, input));
    if (existing) {
      return existing;
    }
    const approval = buildApproval(input, 'pending');
    await writeApprovals([approval, ...approvals]);
    return approval;
  });
}

export async function recordPermissionAudit(input: CreateApprovalInput): Promise<PermissionApprovalEvent> {
  return withApprovalMutation(async () => {
    const approval = buildApproval(input, 'approved');
    const approvals = await readApprovals();
    await writeApprovals([approval, ...approvals]);
    return approval;
  });
}

function approvalMatchesConsumeRequest(
  approval: PermissionApprovalEvent,
  input: {
    id: string;
    workspaceId: string;
    source: PermissionApprovalEvent['source'];
    command?: string;
    paths?: string[];
    requestHash?: string;
  },
): boolean {
  if (approval.id !== input.id) return false;
  if (approval.workspaceId !== input.workspaceId) return false;
  if (approval.source !== input.source) return false;
  // P2-002 / F-AUTH-006: if the stored approval carries binding fields, consumers must match them.
  // Optional consumer-only filters still apply when provided.
  if (approval.command != null && approval.command !== '') {
    if (input.command !== approval.command) return false;
  } else if (input.command !== undefined && approval.command !== input.command) {
    return false;
  }
  if (approval.requestHash != null && approval.requestHash !== '') {
    if (input.requestHash !== approval.requestHash) return false;
  } else if (input.requestHash !== undefined && approval.requestHash !== input.requestHash) {
    return false;
  }
  if (Array.isArray(approval.paths) && approval.paths.length > 0) {
    if (JSON.stringify(input.paths ?? []) !== JSON.stringify(approval.paths)) return false;
  } else if (input.paths !== undefined && JSON.stringify(approval.paths ?? []) !== JSON.stringify(input.paths)) {
    return false;
  }
  return true;
}

export async function consumeApprovedPermissionApproval(input: {
  id: string;
  workspaceId: string;
  source: PermissionApprovalEvent['source'];
  command?: string;
  paths?: string[];
  requestHash?: string;
}): Promise<PermissionApprovalEvent | null> {
  return withApprovalMutation(async () => {
    // Re-read under the mutex so concurrent Promise.all consumers CAS on the latest status.
    const approvals = await readApprovalsWithExpiredPendingMarked();
    const index = approvals.findIndex((approval) => approval.id === input.id);
    if (index === -1) return null;
    const approval = approvals[index];
    if (approval.status !== 'approved') {
      return null;
    }
    if (!approvalMatchesConsumeRequest(approval, input)) {
      return null;
    }
    const consumed: PermissionApprovalEvent = {
      ...approval,
      status: 'expired',
      resolvedAt: Date.now(),
      reason: approval.reason ?? 'Approval consumed (single-use)',
    };
    const next = [...approvals];
    next[index] = consumed;
    await writeApprovals(next);
    // Return the pre-consume approved snapshot for the single successful consumer.
    return approval;
  });
}

export function createPermissionsApi(): CompleteHostServiceRegistry['permissions'] {
  return {
    approvals: async (payload) => {
      const body = isRecord(payload) ? payload as ApprovalListBody : {};
      const workspaceId = normalizeStringFilter(body.workspaceId);
      const sessionKey = normalizeStringFilter(body.sessionKey);
      const statuses = normalizeEnumFilter(body.status, VALID_STATUSES);
      const sources = normalizeEnumFilter(body.source, VALID_SOURCES);
      const includeExpired = body.includeExpired === true;
      const limit = normalizeLimit(body.limit);
      const approvals = (await readApprovalsWithExpiredPendingMarked()).filter((approval) => (
        (!workspaceId || approval.workspaceId === workspaceId)
        && (!sessionKey || approval.sessionKey === sessionKey)
        && (!statuses || statuses.includes(approval.status))
        && (!sources || sources.includes(approval.source))
        && (includeExpired || approval.status !== 'expired')
      ));
      return {
        success: true,
        approvals: approvals.slice(0, limit),
      };
    },
    decisionEvents: async (payload) => {
      const body = isRecord(payload) ? payload as { limit?: unknown } : {};
      const limit = normalizeLimit(body.limit);
      return {
        success: true,
        events: await listPermissionDecisionEvents(limit),
      };
    },
    decideApproval: async (payload) => {
      const body = isRecord(payload) ? payload as ApprovalDecisionBody : {};
      const id = requireId(body.id);
      const decision = normalizeDecision(body.decision);
      return withApprovalMutation(async () => {
        const approvals = await readApprovalsWithExpiredPendingMarked();
        const index = approvals.findIndex((approval) => approval.id === id);
        if (index === -1) throw new Error(`Approval "${id}" not found`);
        const current = approvals[index];
        // P2-002 A2: timed-out pending approvals are expired and cannot flip to approved (default deny).
        if (current.status === 'expired') {
          return {
            success: false,
            error: 'Approval request expired; default deny',
            approval: current,
          };
        }
        if (current.status !== 'pending') {
          return {
            success: false,
            error: 'Approval request already resolved',
            approval: current,
          };
        }
        const approval: PermissionApprovalEvent = {
          ...current,
          status: decision,
          resolvedAt: Date.now(),
        };
        const next = [...approvals];
        next[index] = approval;
        await writeApprovals(next);
        return {
          success: true,
          approval,
        };
      });
    },
  };
}
