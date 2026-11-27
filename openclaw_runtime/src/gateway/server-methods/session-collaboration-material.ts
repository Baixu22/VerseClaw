import { createHash } from 'node:crypto';
import { createAgentToAgentPolicy, createSessionVisibilityRowChecker, resolveEffectiveSessionToolsVisibility } from '../../plugin-sdk/session-visibility.js';
import { resolveSandboxRuntimeStatus } from '../../agents/sandbox/runtime-status.js';
import { existsSync } from 'node:fs';
import type { TaskSystemStore } from '../../../../shared/task-system/store.js';
import { normalizeAutonomySessionScope, type AutonomySessionScope } from '../../../../shared/types/identity-scope.js';
import {
  emptyMaterialPage, MATERIAL_SCAN_LIMIT, MATERIAL_SUMMARY_LIMIT, materialReference,
  parseSessionCollaborationMaterialQuery, type SessionCollaborationMaterial, type SessionCollaborationMaterialQuery, type SessionCollaborationMaterialPage,
} from '../../../../shared/types/session-collaboration-material.js';
import { loadSessionEntry } from '../session-utils.js';
import { sessionActivityOwnerScope } from './session-activity-read-model.js';
import { readSessionCollaborationQuery } from './session-collaboration-query.js';
import type { GatewayRequestContext } from './types.js';

const SOURCE_PAGE_LIMIT = 12;
const FIRST_MATERIAL_SEQUENCE = Number.MAX_SAFE_INTEGER;
const signature = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function currentSession(scope: AutonomySessionScope) {
  const loaded = loadSessionEntry(scope.sessionKey, { readOnly: true, skipCache: true });
  const owner = sessionActivityOwnerScope(loaded.canonicalKey, loaded.entry);
  if (!owner || loaded.legacyKey) throw new Error('MATERIAL_SESSION_STALE');
  try { normalizeAutonomySessionScope(scope, owner); } catch { throw new Error('MATERIAL_SESSION_STALE'); }
  return loaded.entry;
}

const staleReason = (error: unknown) => error instanceof Error && error.message === 'MATERIAL_SESSION_STALE' ? 'generation-changed'
  : error instanceof Error && /STALE|REPLACED/.test(error.message) ? 'execution-changed' : null;

async function createOwnerReader() {
  const [{ createExecutionTaskAccess }, { TaskSystemStore }] = await Promise.all([
    import('../../agents/execution-task-authority.js'), import('../../../../shared/task-system/store.js'),
  ]);
  return function readOwner<T>(scope: AutonomySessionScope, read: (store: TaskSystemStore) => T): T | null {
  const entry = currentSession(scope);
  const root = entry?.workspaceDir ?? entry?.spawnedWorkspaceDir;
  if (!root) throw new Error('MATERIAL_OWNER_UNAVAILABLE');
  const access = createExecutionTaskAccess(root, undefined, true);
  const store = existsSync(access.domain.database) ? new TaskSystemStore(access.domain, undefined, access, true) : null;
  try {
    const result = store ? read(store) : null;
    access.assertCurrent();
    const after = currentSession(scope);
    if ((after?.workspaceDir ?? after?.spawnedWorkspaceDir) !== root) throw new Error('MATERIAL_EXECUTION_STALE');
    return result;
  } finally { store?.close(); }
  };
}

export function mayReadCollaborationSource(requester: AutonomySessionScope, target: AutonomySessionScope,
  context: GatewayRequestContext, deleted = false): boolean {
  currentSession(requester);
  const entry = deleted ? undefined : currentSession(target);
  const cfg = context.getRuntimeConfig();
  const sandboxed = resolveSandboxRuntimeStatus({ cfg, sessionKey: requester.sessionKey }).sandboxed;
  const checker = createSessionVisibilityRowChecker({ action: 'status', requesterSessionKey: requester.sessionKey,
    visibility: resolveEffectiveSessionToolsVisibility({ cfg, sandboxed }), a2aPolicy: createAgentToAgentPolicy(cfg) });
  return checker.check({ key: target.sessionKey, spawnedBy: entry?.spawnedBy, parentSessionKey: entry?.parentSessionKey }).allowed;
}

/** Finish all asynchronous preparation before collecting the selected owners in one synchronous batch. */
export async function readSessionCollaborationMaterialBatch(value: unknown, context: GatewayRequestContext): Promise<SessionCollaborationMaterialPage[]> {
  if (!Array.isArray(value) || !value.length || value.length > 4) throw new TypeError('One bounded material batch required');
  const queries = value.map(parseSessionCollaborationMaterialQuery);
  for (const query of queries) {
    normalizeAutonomySessionScope(query.requester, queries[0].requester);
    if (!query.target || !query.ref) throw new TypeError('Each batch item requires an exact material reference');
  }
  const visible = await Promise.all(queries.map(query => readSessionCollaborationQuery({ requester: query.requester,
    target: query.target, fields: [], limit: 1 }, context)));
  const readOwner = await createOwnerReader();
  return queries.map((query, index) => {
    if (visible[index].state !== 'ready') return emptyMaterialPage(query, visible[index].state, visible[index].reason);
    try {
      const target = query.target!;
      if (!mayReadCollaborationSource(query.requester, target, context)) return emptyMaterialPage(query, 'unavailable', 'not-visible');
      const detail = readOwner(target, store => {
        const material = store.readSharedMaterial(query.requester, target, query.ref!);
        return material ? { material, ...store.sharedMaterialStatus(material, query.requester, Date.now()) } : null;
      });
      if (!mayReadCollaborationSource(query.requester, target, context)) return emptyMaterialPage(query, 'unavailable', 'not-visible');
      return { ...emptyMaterialPage(query, detail ? 'ready' : 'empty'), detail, scanned: 1 };
    } catch (error) {
      const reason = staleReason(error);
      return reason ? emptyMaterialPage(query, 'stale', reason) : emptyMaterialPage(query, 'unavailable', 'owner-unavailable');
    }
  });
}

function matchesMaterial(material: SessionCollaborationMaterial, query: SessionCollaborationMaterialQuery) {
  const artifacts = material.artifactRefs?.map(artifact => artifact.path.toLowerCase()) ?? [];
  if (query.taskNodeId && material.taskNodeId !== query.taskNodeId) return false;
  if (query.file && !artifacts.includes(query.file.replace(/\\/g, '/').toLowerCase())) return false;
  if (query.evidenceRef && !material.evidenceRefs.includes(query.evidenceRef)) return false;
  const search = query.search?.toLowerCase();
  return !search || [material.id, material.taskNodeId, material.summary, ...artifacts,
    ...material.evidenceRefs, ...material.applicability ?? []].some(value => value.toLowerCase().includes(search));
}

type Position = { basis: string; sources: string | null; index: number; before: number };
function readPosition(cursor: string): Position {
  const value = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as Position;
  if (!value || typeof value.basis !== 'string' ||
      (value.sources !== null && (typeof value.sources !== 'string' || value.sources.length > 256)) ||
      !Number.isSafeInteger(value.index) || value.index < 0 || value.index >= SOURCE_PAGE_LIMIT ||
      !Number.isSafeInteger(value.before) || value.before < 1) throw new Error('MATERIAL_CURSOR_INVALID');
  return value;
}

export async function readSessionCollaborationMaterials(value: unknown, context: GatewayRequestContext) {
  const query = parseSessionCollaborationMaterialQuery(value);
  const { requester, target, ref } = query;
  const workspace = { workspaceId: requester.workspaceId, projectId: requester.projectId };
  if (target && (target.workspaceId !== workspace.workspaceId || target.projectId !== workspace.projectId))
    return emptyMaterialPage(query, 'unavailable', 'not-visible');

  let position: Position | undefined;
  try { position = query.cursor ? readPosition(query.cursor) : undefined; }
  catch { return emptyMaterialPage(query, 'stale', 'scope-mismatch'); }
  const sourcePage = await readSessionCollaborationQuery({ requester, target, workspace, fields: [],
    limit: target ? 1 : SOURCE_PAGE_LIMIT, cursor: position?.sources ?? undefined }, context);
  const readOwner = await createOwnerReader();
  if (target && ref && sourcePage.reason === 'not-visible' &&
      !loadSessionEntry(target.sessionKey, { readOnly: true, skipCache: true }).entry) {
    try {
      const mayReadDeletedSource = () => {
        // Deleted sources have no live lineage; task association cannot recreate a visibility grant.
        return mayReadCollaborationSource(requester, target, context, true);
      };
      if (!mayReadDeletedSource()) return emptyMaterialPage(query, 'unavailable', 'not-visible');
      const detail = readOwner(requester, store => store.readHistoricalSharedMaterial(requester, target, ref));
      if (!mayReadDeletedSource()) return emptyMaterialPage(query, 'unavailable', 'not-visible');
      if (detail && !loadSessionEntry(target.sessionKey, { readOnly: true, skipCache: true }).entry)
        return { ...emptyMaterialPage(query, 'ready'), detail, scanned: 1 };
    } catch { return emptyMaterialPage(query, 'unavailable', 'owner-unavailable'); }
  }
  if (sourcePage.state !== 'ready') return emptyMaterialPage(query, sourcePage.state, sourcePage.reason);
  const sources = sourcePage.items.map(row => row.detail?.scope);
  const requestBasis = signature({ ...query, cursor: undefined });
  const sourceBasis = signature([requestBasis, sources, sourcePage.nextCursor]);
  if (position && ((position.basis !== sourceBasis && position.basis !== requestBasis) || position.index >= sources.length))
    return emptyMaterialPage(query, 'stale', 'scope-mismatch');

  const now = Date.now();
  const page = emptyMaterialPage(query, 'empty');
  if (ref && target) {
    try {
      if (!mayReadCollaborationSource(requester, target, context)) return emptyMaterialPage(query, 'unavailable', 'not-visible');
      const detail = readOwner(target, store => {
        const material = store.readSharedMaterial(requester, target, ref);
        return material ? { material, ...store.sharedMaterialStatus(material, requester, now) } : null;
      });
      if (!mayReadCollaborationSource(requester, target, context)) return emptyMaterialPage(query, 'unavailable', 'not-visible');
      if (detail) {
        page.detail = detail;
        page.state = 'ready';
        page.scanned = 1;
      }
      return page;
    } catch (error) {
      const reason = staleReason(error);
      return reason ? emptyMaterialPage(query, 'stale', reason) : emptyMaterialPage(query, 'unavailable', 'owner-unavailable');
    }
  }

  let index = position?.index ?? 0;
  let before = position?.before ?? FIRST_MATERIAL_SEQUENCE;
  let partial = false;
  scan: for (; index < sources.length; index++, before = FIRST_MATERIAL_SEQUENCE) {
    const source = sources[index];
    if (!source) { partial = true; continue; }
    try {
      if (!mayReadCollaborationSource(requester, source, context)) return emptyMaterialPage(query, 'unavailable', 'not-visible');
      const events = readOwner(source, store => {
        let remaining = (query.limit ?? 12) - page.items.length;
        return store.sharedMaterialEvents(requester, source, before, MATERIAL_SCAN_LIMIT - page.scanned + 1)
          .map(event => {
            if (remaining <= 0 || !matchesMaterial(event.material, query)) return { ...event, status: null };
            remaining--;
            return { ...event, status: store.sharedMaterialStatus(event.material, requester, now) };
          });
      });
      for (const { seq, material, status } of events ?? []) {
        if (page.scanned >= MATERIAL_SCAN_LIMIT || page.items.length >= (query.limit ?? 12)) break scan;
        page.scanned++;
        before = seq;
        if (!status) continue;
        const chars = [...material.summary];
        page.items.push({ ref: materialReference(material), source, kind: material.kind, state: status.state,
          summary: chars.slice(0, MATERIAL_SUMMARY_LIMIT).join(''), truncated: chars.length > MATERIAL_SUMMARY_LIMIT,
          sensitivity: material.sensitivity, createdAt: material.createdAt });
      }
    } catch (error) {
      const reason = staleReason(error);
      if (reason) return emptyMaterialPage(query, 'stale', reason);
      partial = true;
    }
  }
  try {
    currentSession(requester);
    for (const source of new Set(page.items.map(item => item.source))) {
      if (!mayReadCollaborationSource(requester, source, context)) return emptyMaterialPage(query, 'unavailable', 'not-visible');
    }
  } catch { return emptyMaterialPage(query, 'stale', 'generation-changed'); }
  const next = index < sources.length ? { basis: sourceBasis, sources: position?.sources ?? null, index, before }
    : sourcePage.nextCursor ? { basis: requestBasis, sources: sourcePage.nextCursor, index: 0, before: FIRST_MATERIAL_SEQUENCE } : null;
  page.nextCursor = next ? Buffer.from(JSON.stringify(next)).toString('base64url') : null;
  page.state = page.items.length ? 'ready' : partial || next ? 'unknown' : 'empty';
  if (partial) page.reason = 'owner-unavailable';
  return page;
}
