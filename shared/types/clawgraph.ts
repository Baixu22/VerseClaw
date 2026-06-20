export type ClawGraphNodeType = 'agent' | 'audit';
export type ClawGraphNodeStatus =
  | 'queued'
  | 'ready'
  | 'running'
  | 'handoff_received'
  | 'auditing'
  | 'done'
  | 'failed'
  | 'review'
  | 'blocked'
  | 'aborted';

export type ClawGraphRunStatus = 'queued' | 'running' | 'complete' | 'blocked' | 'failed' | 'aborted' | 'review';
export type ClawGraphReviewDecision = 'approve' | 'reject';

export type ClawGraphDiagnostic = {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  path?: string;
  nodeId?: string;
};

export type ClawGraphWorkflowSpec = {
  schemaVersion: 1;
  workflow: {
    id: string;
    title?: string;
    objective: string;
  };
  models?: Record<string, { modelRef?: string }>;
  roles: Record<string, {
    runtimeRole: string;
    model?: string;
    sandbox?: 'read' | 'strict' | 'write';
    tools?: string[];
  }>;
  nodes: Array<{
    id: string;
    type?: ClawGraphNodeType;
    role?: string;
    task: string;
    dependsOn?: string[];
    checks?: string[];
    required?: boolean;
  }>;
  control?: {
    maxParallel?: number;
    policies?: Array<{
      on: string;
      action: string;
      maxAttempts?: number;
    }>;
  };
  termination?: {
    conditions?: string[];
  };
};

export type ClawGraphIRNode = {
  id: string;
  type: ClawGraphNodeType;
  role?: string;
  runtimeRole?: string;
  modelRef?: string | null;
  sandbox?: string;
  task: string;
  dependsOn: string[];
  checks: string[];
  required: boolean;
};

export type ClawGraphIR = {
  schemaVersion: 1;
  workflowId: string;
  title: string;
  objective: string;
  nodes: ClawGraphIRNode[];
  maxParallel: number;
  policies: Array<{ on: string; action: string; maxAttempts?: number }>;
  termination: string[];
  sourcePath?: string;
};

export type ClawGraphEvidenceRef = {
  type: 'trace' | 'subagent' | 'file' | 'tool' | 'manual' | 'other';
  ref: string;
  label?: string;
};

export type ClawGraphHandoff = {
  nodeId: string;
  status: 'done' | 'blocked' | 'failed' | 'review';
  summary: string;
  evidenceRefs?: ClawGraphEvidenceRef[];
  filesTouched?: string[];
  testsRun?: string[];
  decisions?: string[];
  deviations?: string[];
  risks?: string[];
  followupTasks?: string[];
  confidence?: number;
};

export type ClawGraphAuditResult = {
  nodeId: string;
  passed: boolean;
  checks: Array<{ id: string; passed: boolean; message: string }>;
  warnings: string[];
};

export type ClawGraphReviewItem = {
  id: string;
  runId: string;
  nodeId?: string;
  kind: 'audit_failure' | 'handoff_invalid' | 'graph_change' | 'risk' | 'manual';
  status: 'open' | 'approved' | 'rejected';
  title: string;
  reason: string;
  proposal?: Record<string, unknown>;
  createdAt: number;
  resolvedAt?: number;
  decisionReason?: string;
};

export type ClawGraphRunNodeSnapshot = {
  id: string;
  type: ClawGraphNodeType;
  role?: string;
  runtimeRole?: string;
  status: ClawGraphNodeStatus;
  attempt: number;
  dependsOn: string[];
  childRunId?: string;
  childSessionKey?: string;
  handoff?: ClawGraphHandoff;
  audit?: ClawGraphAuditResult;
  error?: string;
  startedAt?: number;
  endedAt?: number;
};

export type ClawGraphRunEvent = {
  id: string;
  runId: string;
  type:
    | 'run_started'
    | 'node_ready'
    | 'node_started'
    | 'node_handoff'
    | 'node_audit'
    | 'node_done'
    | 'node_failed'
    | 'review_requested'
    | 'review_resolved'
    | 'run_completed'
    | 'run_blocked'
    | 'run_aborted';
  nodeId?: string;
  message?: string;
  payload?: Record<string, unknown>;
  createdAt: number;
};

export type ClawGraphRunSnapshot = {
  runId: string;
  workflowId: string;
  title: string;
  objective: string;
  status: ClawGraphRunStatus;
  sessionKey: string;
  agentId?: string;
  workspaceId?: string | null;
  sourcePath?: string;
  progress: number;
  activeNodeIds: string[];
  blockedNodeIds: string[];
  reviewItems: ClawGraphReviewItem[];
  nodes: ClawGraphRunNodeSnapshot[];
  eventsCount: number;
  createdAt: number;
  updatedAt: number;
};

export type ClawGraphWorkflowFile = {
  name: string;
  path: string;
  relativePath: string;
  size?: number;
  mtime?: number;
};

export type ClawGraphCompileResult = {
  ok: boolean;
  ir?: ClawGraphIR;
  diagnostics: ClawGraphDiagnostic[];
};
