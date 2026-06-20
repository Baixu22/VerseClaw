export type TaskLedgerNodeKind =
  | 'goal'
  | 'milestone'
  | 'task'
  | 'check'
  | 'decision'
  | 'risk'
  | 'deviation'
  | 'review';

export type TaskLedgerNodeStatus = 'todo' | 'doing' | 'blocked' | 'review' | 'done' | 'dropped';
export type TaskLedgerActor = 'user' | 'assistant' | 'system';
export type TaskLedgerOwner = 'user' | 'agent' | 'system';
export type TaskLedgerPriority = 'low' | 'normal' | 'high';

export type TaskLedgerEdgeType =
  | 'depends_on'
  | 'blocks'
  | 'relates_to'
  | 'derived_from'
  | 'supersedes'
  | 'needs_review';

export type TaskLedgerEventType =
  | 'node_created'
  | 'node_updated'
  | 'node_deleted'
  | 'status_changed'
  | 'progress_changed'
  | 'edge_added'
  | 'edge_removed'
  | 'dependency_added'
  | 'decision_recorded'
  | 'deviation_logged'
  | 'review_requested'
  | 'review_cleared'
  | 'session_linked';

export type TaskLedgerEvidenceRef = {
  type: 'session' | 'trace' | 'file' | 'memory' | 'manual' | 'tool' | 'other';
  ref: string;
  label?: string;
};

export type TaskLedgerNode = {
  id: string;
  title: string;
  kind: TaskLedgerNodeKind;
  parentId?: string | null;
  status: TaskLedgerNodeStatus;
  progress?: number;
  owner?: TaskLedgerOwner;
  priority?: TaskLedgerPriority;
  tags?: string[];
  description?: string;
  evidenceRefs?: TaskLedgerEvidenceRef[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
};

export type TaskLedgerEdge = {
  id: string;
  from: string;
  to: string;
  type: TaskLedgerEdgeType;
  label?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

export type TaskLedgerSessionLink = {
  id: string;
  sessionKey: string;
  nodeId?: string | null;
  agentId?: string | null;
  traceId?: string | null;
  relation?: 'related' | 'forked_from' | 'handoff_from';
  sourceSessionKey?: string | null;
  summary?: string;
  createdAt: string;
};

export type TaskLedgerEventPayload = {
  node?: TaskLedgerNode;
  nodeId?: string;
  patch?: Partial<Omit<TaskLedgerNode, 'id' | 'createdAt'>>;
  status?: TaskLedgerNodeStatus;
  progress?: number;
  edge?: TaskLedgerEdge;
  edgeId?: string;
  sessionLink?: TaskLedgerSessionLink;
  reviewReason?: string;
  decision?: string;
  deviation?: string;
  note?: string;
};

export type TaskLedgerEvent = {
  id: string;
  workspaceId: string;
  type: TaskLedgerEventType;
  actor: TaskLedgerActor;
  taskId?: string | null;
  sessionId?: string | null;
  idempotencyKey?: string | null;
  payload: TaskLedgerEventPayload;
  createdAt: string;
};

export type TaskLedgerEventInput = Omit<TaskLedgerEvent, 'id' | 'workspaceId' | 'createdAt'> & {
  id?: string;
  workspaceId?: string;
  createdAt?: string;
};

export type TaskLedgerWarning = {
  type: 'invalid_jsonl' | 'invalid_event' | 'projection';
  message: string;
  line?: number;
  eventId?: string;
};

export type TaskLedgerSnapshot = {
  schemaVersion: 1;
  workspaceId: string;
  generatedAt: string;
  nodes: TaskLedgerNode[];
  edges: TaskLedgerEdge[];
  sessionLinks: TaskLedgerSessionLink[];
  rootNodeIds: string[];
  reviewNodeIds: string[];
  activeNodeIds: string[];
  blockedNodeIds: string[];
  currentGoalId?: string | null;
  recentDecisions: TaskLedgerNode[];
  eventsCount: number;
  warnings: TaskLedgerWarning[];
};
