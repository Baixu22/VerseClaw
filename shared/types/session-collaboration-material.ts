import type { BlackboardEntryType } from '../../openclaw_runtime/src/agents/orchestration-blackboard.js';
import { normalizeAutonomySessionScope, type AutonomySessionScope, type ScopedRunId, type TaskId } from './identity-scope.js';
import type { SessionActivityReadReason } from './session-activity.js';

export const SESSION_COLLABORATION_MATERIAL_KINDS = [
  'fact', 'claim', 'decision', 'artifact', 'conflict', 'handoff',
] as const satisfies readonly BlackboardEntryType[];

export type SessionCollaborationMaterialInput = {
  id: string;
  kind: (typeof SESSION_COLLABORATION_MATERIAL_KINDS)[number];
  summary: string;
  evidenceRefs: string[];
  sensitivity: 'internal' | 'restricted';
  applicability?: string[];
  expiresAt?: number;
  artifactRefs?: Array<{ path: string; sha256: string }>;
};

export type SessionCollaborationMaterial = SessionCollaborationMaterialInput & {
  version: number;
  authorityId: string;
  taskNodeId: TaskId;
  taskRevision: number;
  taskDigest: string;
  sourceGeneration: string;
  sourceRun: ScopedRunId;
  contentDigest: string;
  state: 'claim' | 'evidence-backed';
  createdAt: number;
};

export function parseSessionCollaborationMaterial(value: unknown): SessionCollaborationMaterialInput {
  const invalid = () => new TypeError('MATERIAL_INPUT_INVALID');
  const record = (input: unknown, keys: string[]) => {
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) ||
        Object.keys(input).some(key => !keys.includes(key))) throw invalid();
    return input as Record<string, unknown>;
  };
  const text = (input: unknown, max: number) => {
    if (typeof input !== 'string' || !input.trim() || input.length > max) throw invalid();
    return input;
  };
  const list = (input: unknown) => {
    if (!Array.isArray(input) || input.length > 16) throw invalid();
    return input as unknown[];
  };
  const input = record(value, ['id', 'kind', 'summary', 'evidenceRefs', 'sensitivity', 'applicability', 'expiresAt', 'artifactRefs']);
  const kind = input.kind as SessionCollaborationMaterialInput['kind'];
  const { sensitivity, expiresAt } = input;
  if (!SESSION_COLLABORATION_MATERIAL_KINDS.includes(kind) ||
      (sensitivity !== 'internal' && sensitivity !== 'restricted') ||
      (expiresAt !== undefined && (typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt) || expiresAt < 1))) throw invalid();
  const evidenceRefs = [...new Set(list(input.evidenceRefs).map(ref => text(ref, 160).trim()))];
  const applicability = input.applicability === undefined ? [] : list(input.applicability).map(condition => text(condition, 300));
  const artifactRefs = input.artifactRefs === undefined ? [] : list(input.artifactRefs).map(ref => {
    const artifact = record(ref, ['path', 'sha256']);
    const sha256 = text(artifact.sha256, 64);
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw invalid();
    return { path: text(artifact.path, 1024), sha256 };
  });
  if (kind === 'artifact' && !artifactRefs.length) throw invalid();
  return {
    id: text(input.id, 160).trim(), kind, summary: text(input.summary, 2048), sensitivity, evidenceRefs,
    ...(applicability.length ? { applicability } : {}),
    ...(artifactRefs.length ? { artifactRefs } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  };
}

export type SessionCollaborationMaterialRef = Pick<SessionCollaborationMaterial,
  'id' | 'version' | 'authorityId' | 'taskNodeId' | 'taskRevision' | 'taskDigest' | 'contentDigest'>;
export type SessionCollaborationMaterialSummary = {
  ref: SessionCollaborationMaterialRef;
  source: AutonomySessionScope;
  kind: SessionCollaborationMaterial['kind'];
  state: SessionCollaborationMaterial['state'] | 'expired';
  sensitivity: SessionCollaborationMaterial['sensitivity'];
  summary: string;
  truncated: boolean;
  createdAt: number;
};
export type SessionCollaborationMaterialQuery = {
  requester: AutonomySessionScope;
  target?: AutonomySessionScope;
  search?: string;
  taskNodeId?: string;
  file?: string;
  evidenceRef?: string;
  ref?: SessionCollaborationMaterialRef;
  cursor?: string;
  limit?: number;
};
export type SessionCollaborationMaterialPage = {
  schemaVersion: 'SessionCollaborationMaterials/v1';
  requester: AutonomySessionScope;
  state: 'ready' | 'empty' | 'unavailable' | 'stale' | 'unknown';
  reason?: SessionActivityReadReason;
  items: SessionCollaborationMaterialSummary[];
  detail: { material: SessionCollaborationMaterial; state: SessionCollaborationMaterialSummary['state'] } | null;
  scanned: number;
  nextCursor: string | null;
};

export const MATERIAL_SCAN_LIMIT = 60;
export const MATERIAL_SUMMARY_LIMIT = 240;

export function materialReference(material: SessionCollaborationMaterial): SessionCollaborationMaterialRef {
  const { id, version, authorityId, taskNodeId, taskRevision, taskDigest, contentDigest } = material;
  return { id, version, authorityId, taskNodeId, taskRevision, taskDigest, contentDigest };
}

export function materialSource(material: SessionCollaborationMaterial): AutonomySessionScope {
  const scope = { ...material.sourceRun.scope, sessionGeneration: material.sourceGeneration };
  return normalizeAutonomySessionScope(scope, scope as AutonomySessionScope);
}

export function equalMaterialRef(a: SessionCollaborationMaterialRef, b: SessionCollaborationMaterialRef) {
  return Object.entries(a).every(([key, value]) => b[key as keyof SessionCollaborationMaterialRef] === value);
}

export function canReadMaterial(viewer: AutonomySessionScope, source: AutonomySessionScope, sensitivity: SessionCollaborationMaterial['sensitivity']) {
  return viewer.workspaceId === source.workspaceId && viewer.projectId === source.projectId &&
    (sensitivity === 'internal' || (sensitivity === 'restricted' && viewer.sessionKey === source.sessionKey && viewer.sessionGeneration === source.sessionGeneration));
}

export function materialState(material: SessionCollaborationMaterial, now: number): SessionCollaborationMaterialSummary['state'] {
  return material.expiresAt !== undefined && material.expiresAt <= now ? 'expired' : material.state;
}

export function parseSessionCollaborationMaterialQuery(value: unknown): SessionCollaborationMaterialQuery {
  const invalid = () => new TypeError('Invalid collaboration material query');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['requester', 'target', 'search', 'taskNodeId', 'file', 'evidenceRef', 'ref', 'cursor', 'limit'].includes(key))) throw invalid();
  const requester = normalizeAutonomySessionScope(input.requester, input.requester as AutonomySessionScope);
  const target = input.target === undefined ? undefined : normalizeAutonomySessionScope(input.target, input.target as AutonomySessionScope);
  const bounded = (value: unknown, max: number) => {
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw invalid();
    return value.trim();
  };
  const integer = (value: unknown, max: number) => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) throw invalid();
    return value;
  };
  const limit = input.limit === undefined ? 12 : integer(input.limit, 20);
  let ref: SessionCollaborationMaterialRef | undefined;
  if (input.ref !== undefined) {
    if (!target || input.cursor !== undefined || input.search !== undefined || input.file !== undefined ||
        input.taskNodeId !== undefined || input.evidenceRef !== undefined ||
        !input.ref || typeof input.ref !== 'object' || Array.isArray(input.ref)) throw invalid();
    const r = input.ref as Record<string, unknown>;
    if (Object.keys(r).some(key => !['id', 'version', 'authorityId', 'taskNodeId', 'taskRevision', 'taskDigest', 'contentDigest'].includes(key)) ||
        typeof r.taskDigest !== 'string' || !/^[a-f0-9]{64}$/.test(r.taskDigest) ||
        typeof r.contentDigest !== 'string' || !/^[a-f0-9]{64}$/.test(r.contentDigest)) throw invalid();
    ref = { id: bounded(r.id, 160), version: integer(r.version, Number.MAX_SAFE_INTEGER), authorityId: bounded(r.authorityId, 300),
      taskNodeId: bounded(r.taskNodeId, 300) as TaskId, taskRevision: integer(r.taskRevision, Number.MAX_SAFE_INTEGER),
      taskDigest: r.taskDigest, contentDigest: r.contentDigest };
  }
  return { requester, ...(target ? { target } : {}), limit, ...(ref ? { ref } : {}),
    ...(input.search === undefined ? {} : { search: bounded(input.search, 300) }),
    ...(input.file === undefined ? {} : { file: bounded(input.file, 1024) }),
    ...(input.taskNodeId === undefined ? {} : { taskNodeId: bounded(input.taskNodeId, 300) }),
    ...(input.evidenceRef === undefined ? {} : { evidenceRef: bounded(input.evidenceRef, 160) }),
    ...(input.cursor === undefined ? {} : { cursor: bounded(input.cursor, 640) }),
  };
}

export function emptyMaterialPage(query: SessionCollaborationMaterialQuery, state: SessionCollaborationMaterialPage['state'], reason?: SessionActivityReadReason): SessionCollaborationMaterialPage {
  return { schemaVersion: 'SessionCollaborationMaterials/v1', requester: query.requester, state,
    ...(reason ? { reason } : {}), items: [], detail: null, scanned: 0, nextCursor: null };
}

export function validateMaterialPage(query: SessionCollaborationMaterialQuery, value: unknown): SessionCollaborationMaterialPage {
  const invalid = () => emptyMaterialPage(query, 'unknown', 'protocol-unverified');
  if (!value || typeof value !== 'object') return invalid();
  const page = value as SessionCollaborationMaterialPage;
  const allowedStates = ['ready', 'empty', 'unavailable', 'stale', 'unknown'];
  try {
    normalizeAutonomySessionScope(page.requester, query.requester);
    if (page.schemaVersion !== 'SessionCollaborationMaterials/v1' || !allowedStates.includes(page.state) ||
        !Array.isArray(page.items) || page.items.length > (query.limit ?? 12) ||
        !Number.isSafeInteger(page.scanned) || page.scanned < page.items.length || page.scanned > MATERIAL_SCAN_LIMIT ||
        (page.state === 'ready') !== Boolean(page.items.length || page.detail) ||
        (page.nextCursor !== null && (typeof page.nextCursor !== 'string' || page.nextCursor.length > 640 || !page.nextCursor ||
          (page.state !== 'ready' && page.state !== 'unknown')))) return invalid();
    const seen = new Set<string>();
    for (const item of page.items) {
      const source = normalizeAutonomySessionScope(item.source, query.target ?? item.source);
      const ref = parseSessionCollaborationMaterialQuery({ requester: query.requester, target: source, ref: item.ref }).ref!;
      const key = JSON.stringify([ref.authorityId, ref.id, ref.version]);
      if (query.ref || seen.has(key) || !canReadMaterial(query.requester, source, item.sensitivity) ||
          typeof item.summary !== 'string' || [...item.summary].length > MATERIAL_SUMMARY_LIMIT ||
          typeof item.truncated !== 'boolean' || !Number.isSafeInteger(item.createdAt) ||
          !SESSION_COLLABORATION_MATERIAL_KINDS.includes(item.kind) ||
          !['claim', 'evidence-backed', 'expired'].includes(item.state)) return invalid();
      seen.add(key);
    }
    if (page.detail !== null) {
      const { material, state } = page.detail;
      const source = normalizeAutonomySessionScope(materialSource(material), query.target ?? null);
      if (!query.ref || !equalMaterialRef(query.ref, materialReference(material)) ||
          !canReadMaterial(query.requester, source, material.sensitivity) || page.nextCursor !== null ||
          !['claim', 'evidence-backed', 'expired'].includes(state)) return invalid();
      parseSessionCollaborationMaterial({
        id: material.id, kind: material.kind, summary: material.summary, evidenceRefs: material.evidenceRefs,
        sensitivity: material.sensitivity, applicability: material.applicability, artifactRefs: material.artifactRefs, expiresAt: material.expiresAt,
      });
    }
  } catch { return invalid(); }
  return page;
}
