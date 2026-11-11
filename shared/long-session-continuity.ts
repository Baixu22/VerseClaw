import type { MemorySurfaceEntry, MemorySurfaceSnapshot } from './types/memory.js';
import type {
  TaskLedgerSnapshot,
  TaskLedgerWorkingContextField,
  TaskLedgerWorkingContextFieldValue,
  TaskLedgerWorkingContextSnapshot,
} from './types/task-ledger.js';

export type ContinuityItemKind =
  | 'objective'
  | 'constraint'
  | 'decision'
  | 'open-dependency'
  | 'next-action'
  | 'memory-ref'
  | 'knowledge-ref'
  | 'evidence';

export type ContinuityItemSource =
  | 'task-ledger-working-context'
  | 'task-ledger-node'
  | 'task-ledger-dependency'
  | 'compression-artifact'
  | 'accepted-memory-ref'
  | 'knowledge-ref';

export type ContinuityFreshness = 'fresh' | 'stale' | 'unknown';
export type ContinuityPackStatus = 'known' | 'partial' | 'unknown';

export type ContinuityContextItem = {
  id: string;
  kind: ContinuityItemKind;
  source: ContinuityItemSource;
  text: string;
  owner: 'task-ledger' | 'compression-artifact' | 'memory' | 'knowledge';
  scope: { kind: 'workspace' | 'project' | 'session' | 'task' | 'agent' | 'role' | 'user' | 'global' | 'unknown'; key?: string | null };
  freshness: ContinuityFreshness;
  acceptedAt?: string | null;
  expiresAt?: string | null;
  trust: 'owner-accepted' | 'owner-fact';
  evidenceRefs: string[];
  chars: number;
};

export type ContinuitySourceState = {
  source: 'task-ledger' | 'working-context' | 'compression-artifact' | 'memory' | 'knowledge';
  status: 'available' | 'unavailable' | 'unknown' | 'empty';
  detail?: string;
};

export type ContinuityExclusion = {
  ref: string;
  reason:
    | 'candidate-not-accepted'
    | 'pending-not-accepted'
    | 'expired'
    | 'revoked-or-superseded'
    | 'out-of-scope'
    | 'owner-gate-closed'
    | 'unverified-claim'
    | 'budget'
    | 'unknown-scope';
};

export type LongSessionContinuityContextPack = {
  schemaVersion: 'ContinuityContextPack/v1';
  generatedAt: string;
  sessionKey: string;
  workspaceId: string;
  bindingRevision: number;
  activeTaskNodeId?: string | null;
  status: ContinuityPackStatus;
  complete: false;
  budget: { maxChars: number; usedChars: number; truncated: boolean; droppedItems: number };
  items: ContinuityContextItem[];
  sourceStates: ContinuitySourceState[];
  exclusions: ContinuityExclusion[];
  originalHistory: {
    transcriptRef: string;
    taskLedgerRef: string;
    taskLedgerEventCount: number;
    compressionCheckpointId?: string;
    compressionAvailable: boolean;
  };
  evidenceRefs: string[];
};

export type ContinuityCompressionInput = {
  checkpointId?: string;
  objective?: string;
  constraints?: string[];
  decisions?: string[];
  blocked?: string[];
  inProgress?: string[];
  nextAction?: string;
  evidenceRefs?: string[];
  unverifiedClaims?: string[];
};

export type ContinuityKnowledgeReferenceInput = {
  id: string;
  title: string;
  lookup: string;
  corpus?: 'wiki' | 'memory' | 'all';
  freshnessLevel?: string;
  matchedClaimStatus?: string;
};

export type BuildLongSessionContinuityInput = {
  sessionKey: string;
  workspaceId: string;
  workspaceRootPath?: string;
  bindingRevision: number;
  activeTaskNodeId?: string | null;
  taskRefs?: readonly string[];
  taskLedger?: TaskLedgerSnapshot | null;
  workingContext?: TaskLedgerWorkingContextSnapshot | null;
  compression?: ContinuityCompressionInput | null;
  memorySurface?: MemorySurfaceSnapshot | null;
  roleMemoryEnabled?: boolean;
  nativeBackendOwnsCompaction?: boolean;
  roleName?: string;
  agentId?: string;
  knowledgeReferences?: readonly ContinuityKnowledgeReferenceInput[];
  availability?: Partial<Record<'taskLedger' | 'workingContext' | 'compression' | 'memory', boolean>>;
  budgetChars?: number;
  now?: number;
};

const DEFAULT_BUDGET_CHARS = 1_800;
const FRESH_AGE_MS = 24 * 60 * 60 * 1_000;
const INCOMPLETE_STATUSES = new Set(['todo', 'doing', 'blocked', 'review']);

const FIELD_KIND: Partial<Record<TaskLedgerWorkingContextField, ContinuityItemKind>> = {
  Objective: 'objective',
  Constraints: 'constraint',
  Decisions: 'decision',
  OpenRisks: 'open-dependency',
  NextAction: 'next-action',
  ConfirmedFacts: 'evidence',
  ActiveFiles: 'evidence',
  Evidence: 'evidence',
};

const ITEM_PRIORITY: Record<ContinuityItemKind, number> = {
  objective: 0,
  constraint: 1,
  decision: 2,
  'open-dependency': 3,
  'next-action': 4,
  'memory-ref': 5,
  'knowledge-ref': 6,
  evidence: 7,
};

function renderValue(value: TaskLedgerWorkingContextFieldValue): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (typeof entry === 'string') return entry.trim();
      if (entry && typeof entry === 'object' && typeof entry.ref === 'string') {
        return typeof entry.type === 'string' ? `${entry.type}:${entry.ref}` : entry.ref;
      }
      return '';
    }).filter(Boolean).join('; ');
  }
  return '';
}

function refsFromValue(value: TaskLedgerWorkingContextFieldValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry === 'string' && entry.trim()) return [entry.trim()];
    if (entry && typeof entry === 'object' && typeof entry.ref === 'string') {
      return [typeof entry.type === 'string' ? `${entry.type}:${entry.ref}` : entry.ref];
    }
    return [];
  });
}

function freshnessForTimestamp(value: string | null | undefined, now: number): ContinuityFreshness {
  if (!value) return 'unknown';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'unknown';
  return now - timestamp <= FRESH_AGE_MS ? 'fresh' : 'stale';
}

function isoOrNull(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function memoryScope(
  entry: MemorySurfaceEntry,
  input: BuildLongSessionContinuityInput,
  relevantTaskIds: ReadonlySet<string>,
): { accepted: true; scope: ContinuityContextItem['scope'] } | { accepted: false; reason: ContinuityExclusion['reason'] } {
  const key = entry.scopeKey ?? null;
  const workspaceKeys = new Set([input.workspaceId, input.workspaceRootPath].filter((value): value is string => Boolean(value)));
  if (entry.scope === 'workspace' || entry.scope === 'project') {
    return key && workspaceKeys.has(key)
      ? { accepted: true, scope: { kind: entry.scope, key } }
      : { accepted: false, reason: key ? 'out-of-scope' : 'unknown-scope' };
  }
  if (entry.scope === 'session') {
    return key === input.sessionKey
      ? { accepted: true, scope: { kind: 'session', key } }
      : { accepted: false, reason: key ? 'out-of-scope' : 'unknown-scope' };
  }
  if (entry.scope === 'task') {
    return key && relevantTaskIds.has(key)
      ? { accepted: true, scope: { kind: 'task', key } }
      : { accepted: false, reason: key ? 'out-of-scope' : 'unknown-scope' };
  }
  if (entry.scope === 'agent') {
    return key && input.agentId && key === input.agentId
      ? { accepted: true, scope: { kind: 'agent', key } }
      : { accepted: false, reason: key ? 'out-of-scope' : 'unknown-scope' };
  }
  if (entry.scope === 'role') {
    const roles = entry.roleTags ?? [];
    return input.roleName && (roles.includes('*') || roles.includes(input.roleName))
      ? { accepted: true, scope: { kind: 'role', key: input.roleName } }
      : { accepted: false, reason: input.roleName ? 'out-of-scope' : 'unknown-scope' };
  }
  if (entry.scope === 'user' || entry.scope === 'global') {
    return { accepted: true, scope: { kind: entry.scope, key } };
  }
  return { accepted: false, reason: 'unknown-scope' };
}

function relevantTaskIds(input: BuildLongSessionContinuityInput): Set<string> {
  const ids = new Set((input.taskRefs ?? []).filter(Boolean));
  if (input.activeTaskNodeId) ids.add(input.activeTaskNodeId);
  for (const link of input.taskLedger?.sessionLinks ?? []) {
    if (link.sessionKey === input.sessionKey && link.nodeId) ids.add(link.nodeId);
  }
  return ids;
}

function addItem(items: ContinuityContextItem[], seen: Set<string>, item: Omit<ContinuityContextItem, 'chars'>) {
  const identity = `${item.kind}:${item.text}`;
  if (!item.text || seen.has(identity)) return;
  seen.add(identity);
  items.push({ ...item, chars: item.text.length });
}

function collectWorkingContext(
  input: BuildLongSessionContinuityInput,
  items: ContinuityContextItem[],
  seen: Set<string>,
  exclusions: ContinuityExclusion[],
  now: number,
) {
  if (!input.workingContext) return;
  for (const [field, projection] of Object.entries(input.workingContext.fields) as Array<
    [TaskLedgerWorkingContextField, TaskLedgerWorkingContextSnapshot['fields'][TaskLedgerWorkingContextField]]
  >) {
    const kind = FIELD_KIND[field];
    if (kind && projection.current) {
      const current = projection.current;
      const expiresAt = isoOrNull(current.ttl.expiresAt);
      if (expiresAt && Date.parse(expiresAt) <= now) {
        exclusions.push({ ref: `task-ledger-working-context:${current.proposalId}`, reason: 'expired' });
      } else {
        addItem(items, seen, {
          id: `working-context:${current.field}:${current.version}`,
          kind,
          source: 'task-ledger-working-context',
          text: renderValue(current.value),
          owner: 'task-ledger',
          scope: { kind: 'workspace', key: input.workspaceId },
          freshness: freshnessForTimestamp(current.acceptedAt, now),
          acceptedAt: current.acceptedAt,
          expiresAt,
          trust: 'owner-accepted',
          evidenceRefs: refsFromValue(current.evidenceRefs),
        });
      }
    }
    for (const pending of projection.pending) {
      exclusions.push({ ref: `task-ledger-working-context:${pending.proposalId}`, reason: 'pending-not-accepted' });
    }
    for (const expired of projection.expired) {
      exclusions.push({ ref: `task-ledger-working-context:${expired.proposalId}`, reason: 'expired' });
    }
  }
}

function collectTaskLedgerNodes(
  input: BuildLongSessionContinuityInput,
  relevantIds: ReadonlySet<string>,
  items: ContinuityContextItem[],
  seen: Set<string>,
  exclusions: ContinuityExclusion[],
  now: number,
) {
  if (!input.taskLedger) return;
  const nodeById = new Map(input.taskLedger.nodes.map((node) => [node.id, node]));
  for (const id of relevantIds) {
    const node = nodeById.get(id);
    if (!node) {
      exclusions.push({ ref: `task-ledger:${id}`, reason: 'unknown-scope' });
      continue;
    }
    if (node.status === 'dropped') {
      exclusions.push({ ref: `task-ledger:${node.id}`, reason: 'revoked-or-superseded' });
      continue;
    }
    const common = {
      owner: 'task-ledger' as const,
      scope: { kind: 'workspace' as const, key: input.workspaceId },
      freshness: freshnessForTimestamp(node.updatedAt, now),
      trust: 'owner-fact' as const,
      evidenceRefs: (node.evidenceRefs ?? []).map((ref) => `${ref.type}:${ref.ref}`),
    };
    if (node.kind === 'decision') {
      addItem(items, seen, {
        ...common,
        id: `task-node:${node.id}:decision`,
        kind: 'decision',
        source: 'task-ledger-node',
        text: `${node.status === 'done' ? 'Accepted decision' : 'Open decision'}: ${node.description || node.title}`,
        acceptedAt: node.updatedAt,
      });
    }
    if (node.status === 'blocked' || node.status === 'review') {
      addItem(items, seen, {
        ...common,
        id: `task-node:${node.id}:open`,
        kind: 'open-dependency',
        source: 'task-ledger-node',
        text: `${node.status}: ${node.title}`,
      });
    }
    const nextAction = typeof node.metadata?.nextAction === 'string' ? node.metadata.nextAction.trim() : '';
    if (nextAction) {
      addItem(items, seen, {
        ...common,
        id: `task-node:${node.id}:next`,
        kind: 'next-action',
        source: 'task-ledger-node',
        text: nextAction,
      });
    }
  }
}

function collectTaskLedgerDependencies(
  input: BuildLongSessionContinuityInput,
  relevantIds: ReadonlySet<string>,
  items: ContinuityContextItem[],
  seen: Set<string>,
  now: number,
) {
  if (!input.taskLedger) return;
  const nodeById = new Map(input.taskLedger.nodes.map((node) => [node.id, node]));
  for (const edge of input.taskLedger.edges) {
    if (!relevantIds.has(edge.from) && !relevantIds.has(edge.to)) continue;
    if (edge.type !== 'depends_on' && edge.type !== 'blocks') continue;
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to || !INCOMPLETE_STATUSES.has(to.status)) continue;
    addItem(items, seen, {
      id: `task-edge:${edge.id}`,
      kind: 'open-dependency',
      source: 'task-ledger-dependency',
      owner: 'task-ledger',
      text: `${from.title} ${edge.type === 'blocks' ? 'blocks' : 'depends on'} ${to.title}`,
      scope: { kind: 'workspace', key: input.workspaceId },
      freshness: freshnessForTimestamp(edge.createdAt, now),
      acceptedAt: edge.createdAt,
      trust: 'owner-fact',
      evidenceRefs: [`task-ledger-node:${from.id}`, `task-ledger-node:${to.id}`],
    });
  }
}

function collectCompression(
  input: BuildLongSessionContinuityInput,
  items: ContinuityContextItem[],
  seen: Set<string>,
  exclusions: ContinuityExclusion[],
) {
  const compression = input.compression;
  if (!compression) return;
  const base = {
    owner: 'compression-artifact' as const,
    scope: { kind: 'session' as const, key: input.sessionKey },
    freshness: 'unknown' as const,
    trust: 'owner-fact' as const,
  };
  if (input.nativeBackendOwnsCompaction === true) {
    for (const [index, claim] of (compression.unverifiedClaims ?? []).entries()) {
      exclusions.push({ ref: `compression-unverified:${index}:${claim.slice(0, 80)}`, reason: 'unverified-claim' });
    }
    return;
  }
  const addLines = (kind: ContinuityItemKind, source: ContinuityItemSource, lines: readonly string[] | undefined) => {
    for (const [index, line] of (lines ?? []).entries()) {
      addItem(items, seen, {
        ...base,
        id: `compression:${kind}:${index}`,
        kind,
        source,
        text: line,
        evidenceRefs: compression.evidenceRefs ?? [],
      });
    }
  };
  if (compression.objective) {
    addItem(items, seen, {
      ...base,
      id: 'compression:objective',
      kind: 'objective',
      source: 'compression-artifact',
      text: compression.objective,
      evidenceRefs: compression.evidenceRefs ?? [],
    });
  }
  addLines('constraint', 'compression-artifact', compression.constraints);
  addLines('decision', 'compression-artifact', compression.decisions);
  addLines('open-dependency', 'compression-artifact', compression.blocked);
  addLines('open-dependency', 'compression-artifact', compression.inProgress);
  if (compression.nextAction) {
    addItem(items, seen, {
      ...base,
      id: 'compression:next-action',
      kind: 'next-action',
      source: 'compression-artifact',
      text: compression.nextAction,
      evidenceRefs: compression.evidenceRefs ?? [],
    });
  }
  for (const [index, claim] of (compression.unverifiedClaims ?? []).entries()) {
    exclusions.push({ ref: `compression-unverified:${index}:${claim.slice(0, 80)}`, reason: 'unverified-claim' });
  }
}

function collectAcceptedMemory(
  input: BuildLongSessionContinuityInput,
  relevantIds: ReadonlySet<string>,
  items: ContinuityContextItem[],
  seen: Set<string>,
  exclusions: ContinuityExclusion[],
  now: number,
) {
  for (const candidate of input.memorySurface?.candidates ?? []) {
    exclusions.push({ ref: candidate.key, reason: 'candidate-not-accepted' });
  }
  for (const entry of input.memorySurface?.accepted ?? []) {
    if (entry.state !== 'accepted') {
      exclusions.push({ ref: entry.key, reason: 'candidate-not-accepted' });
      continue;
    }
    const ownerGateOpen = input.memorySurface?.status?.roleMemory?.readGate !== 'closed';
    const expired = Boolean(entry.expiresAt && Number.isFinite(Date.parse(entry.expiresAt)) && Date.parse(entry.expiresAt) <= now);
    const revoked = entry.stateLabel === 'tombstone'
      || entry.stateLabel === 'archived'
      || entry.stateLabel === 'revoked'
      || entry.stateLabel === 'superseded';
    if (expired) {
      exclusions.push({ ref: entry.key, reason: 'expired' });
      continue;
    }
    if (revoked) {
      exclusions.push({ ref: entry.key, reason: 'revoked-or-superseded' });
      continue;
    }
    if (
      input.roleMemoryEnabled === false ||
      !ownerGateOpen ||
      !entry.modelVisible ||
      !entry.injectable ||
      !entry.retrievable
    ) {
      exclusions.push({ ref: entry.key, reason: 'owner-gate-closed' });
      continue;
    }
    const scope = memoryScope(entry, input, relevantIds);
    if (!scope.accepted) {
      exclusions.push({ ref: entry.key, reason: scope.reason });
      continue;
    }
    addItem(items, seen, {
      id: `accepted-memory:${entry.key}`,
      kind: 'memory-ref',
      source: 'accepted-memory-ref',
      owner: 'memory',
      text: `${entry.key} (${entry.sourceLabel}; ${entry.scope})`,
      scope: scope.scope,
      freshness: freshnessForTimestamp(entry.updatedAt ?? entry.createdAt, now),
      acceptedAt: entry.updatedAt ?? entry.createdAt,
      trust: 'owner-accepted',
      evidenceRefs: [`memory:${entry.key}`, ...entry.provenance],
    });
  }
}

function collectKnowledge(
  input: BuildLongSessionContinuityInput,
  items: ContinuityContextItem[],
  seen: Set<string>,
) {
  for (const reference of input.knowledgeReferences ?? []) {
    addItem(items, seen, {
      id: `knowledge:${reference.id}`,
      kind: 'knowledge-ref',
      source: 'knowledge-ref',
      owner: 'knowledge',
      text: `${reference.title} (${reference.lookup})`,
      scope: { kind: 'workspace', key: input.workspaceId },
      freshness: reference.freshnessLevel === 'fresh' || reference.freshnessLevel === 'stale'
        ? reference.freshnessLevel
        : 'unknown',
      trust: 'owner-fact',
      evidenceRefs: [
        `knowledge:${reference.id}`,
        ...(reference.matchedClaimStatus ? [`claim:${reference.matchedClaimStatus}`] : []),
      ],
    });
  }
}

function applyBudget(
  items: ContinuityContextItem[],
  maxChars: number,
  exclusions: ContinuityExclusion[],
): { items: ContinuityContextItem[]; usedChars: number; dropped: number } {
  const sorted = [...items].sort((left, right) => ITEM_PRIORITY[left.kind] - ITEM_PRIORITY[right.kind] || left.id.localeCompare(right.id));
  const kept: ContinuityContextItem[] = [];
  let usedChars = 0;
  let dropped = 0;
  for (const item of sorted) {
    const lineChars = item.text.length + item.kind.length + item.source.length + item.freshness.length + 24;
    if (usedChars + lineChars > maxChars) {
      dropped += 1;
      exclusions.push({ ref: item.id, reason: 'budget' });
      continue;
    }
    kept.push(item);
    usedChars += lineChars;
  }
  return { items: kept, usedChars, dropped };
}

export function buildLongSessionContinuityContext(
  input: BuildLongSessionContinuityInput,
): LongSessionContinuityContextPack {
  const now = input.now ?? Date.now();
  const budgetChars = Math.max(200, Math.floor(input.budgetChars ?? DEFAULT_BUDGET_CHARS));
  const relevantIds = relevantTaskIds(input);
  const items: ContinuityContextItem[] = [];
  const exclusions: ContinuityExclusion[] = [];
  const seen = new Set<string>();

  collectWorkingContext(input, items, seen, exclusions, now);
  collectTaskLedgerNodes(input, relevantIds, items, seen, exclusions, now);
  collectTaskLedgerDependencies(input, relevantIds, items, seen, now);
  collectCompression(input, items, seen, exclusions);
  collectAcceptedMemory(input, relevantIds, items, seen, exclusions, now);
  collectKnowledge(input, items, seen);
  const budgeted = applyBudget(items, budgetChars, exclusions);

  const sourceStates: ContinuitySourceState[] = [
    {
      source: 'task-ledger',
      status: input.availability?.taskLedger === false ? 'unavailable' : input.taskLedger ? 'available' : 'unknown',
      ...(input.taskLedger ? { detail: `events=${input.taskLedger.eventsCount}; nodes=${input.taskLedger.nodes.length}` } : { detail: 'task ledger snapshot unavailable' }),
    },
    {
      source: 'working-context',
      status: input.availability?.workingContext === false ? 'unavailable' : input.workingContext ? 'available' : 'unknown',
      ...(input.workingContext ? {} : { detail: 'accepted working context unavailable' }),
    },
    {
      source: 'compression-artifact',
      status: input.availability?.compression === false || input.nativeBackendOwnsCompaction === true
        ? 'unavailable'
        : input.compression ? 'available' : 'empty',
      ...(input.nativeBackendOwnsCompaction === true
        ? { detail: 'native backend owns compaction and continuity projection' }
        : input.compression ? { detail: input.compression.checkpointId ?? 'latest checkpoint' } : { detail: 'no compression artifact for this session' }),
    },
    {
      source: 'memory',
      status: input.availability?.memory === false ? 'unavailable' : input.memorySurface ? 'available' : 'unknown',
      ...(input.memorySurface ? { detail: `accepted=${input.memorySurface.accepted.length}; modelVisible=${input.memorySurface.counts.modelVisible}` } : { detail: 'memory surface unavailable' }),
    },
    {
      source: 'knowledge',
      status: (input.knowledgeReferences?.length ?? 0) > 0 ? 'available' : 'empty',
      ...((input.knowledgeReferences?.length ?? 0) > 0 ? { detail: `refs=${input.knowledgeReferences?.length}` } : { detail: 'no selected knowledge refs' }),
    },
  ];
  const unavailable = sourceStates.filter((state) => state.status === 'unavailable' || state.status === 'unknown').length;
  const status: ContinuityPackStatus = budgeted.items.length === 0
    ? 'unknown'
    : unavailable > 0
      ? 'partial'
      : 'known';
  const evidenceRefs = [...new Set(budgeted.items.flatMap((item) => item.evidenceRefs))];

  return {
    schemaVersion: 'ContinuityContextPack/v1',
    generatedAt: new Date(now).toISOString(),
    sessionKey: input.sessionKey,
    workspaceId: input.workspaceId,
    bindingRevision: input.bindingRevision,
    activeTaskNodeId: input.activeTaskNodeId ?? null,
    status,
    complete: false,
    budget: {
      maxChars: budgetChars,
      usedChars: budgeted.usedChars,
      truncated: budgeted.dropped > 0,
      droppedItems: budgeted.dropped,
    },
    items: budgeted.items,
    sourceStates,
    exclusions,
    originalHistory: {
      transcriptRef: `session:${input.sessionKey}`,
      taskLedgerRef: `task-ledger:${input.workspaceId}`,
      taskLedgerEventCount: input.taskLedger?.eventsCount ?? 0,
      ...(input.compression?.checkpointId ? { compressionCheckpointId: input.compression.checkpointId } : {}),
      compressionAvailable: Boolean(input.compression),
    },
    evidenceRefs,
  };
}

export function renderLongSessionContinuityContext(pack: LongSessionContinuityContextPack): string {
  const lines = [
    'Continuity context (owner-derived, bounded metadata; verify work with tools):',
    `schema=${pack.schemaVersion}; status=${pack.status}; complete=false; bindingRevision=${pack.bindingRevision}; chars=${pack.budget.usedChars}/${pack.budget.maxChars}; truncated=${pack.budget.truncated}`,
    ...pack.items.map((item) => `- [${item.kind}] ${item.text} (source=${item.source}; scope=${item.scope.kind}${item.scope.key ? `:${item.scope.key}` : ''}; freshness=${item.freshness}; trust=${item.trust})`),
  ];
  if (pack.items.length === 0) {
    lines.push('- No accepted continuity items were available. Do not infer task completion or missing facts.');
  }
  const unavailable = pack.sourceStates.filter((state) => state.status === 'unavailable' || state.status === 'unknown');
  if (unavailable.length > 0) {
    lines.push(`Unavailable/unknown sources: ${unavailable.map((state) => `${state.source}:${state.status}`).join(', ')}`);
  }
  lines.push(
    `Original history is not copied into this turn: transcript=${pack.originalHistory.transcriptRef}; taskLedger=${pack.originalHistory.taskLedgerRef}; taskLedgerEvents=${pack.originalHistory.taskLedgerEventCount}; compression=${pack.originalHistory.compressionAvailable ? (pack.originalHistory.compressionCheckpointId ?? 'available') : 'unavailable'}. Recall old evidence on demand through the owning session/task APIs.`,
  );
  return lines.join('\n');
}
