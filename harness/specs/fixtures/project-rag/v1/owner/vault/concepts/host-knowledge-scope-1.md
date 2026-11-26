---
title: host-knowledge-scope / electron/services/knowledge-read-scope.ts
revision: 1
status: active
trust: confirmed
verifiedAt: "2026-11-09T22:32:47.090Z"
acl:
  read: [operator]
scope:
  workspaceId: rag-corpus-workspace
retention:
  policy: source-coupled
actor: codex/project-rag-corpus-author
driven_by: agent
---

# Repository source snapshot

Origin: electron/services/knowledge-read-scope.ts
Commit: 1a4cc531ee050794b89dc8d7e49ac7c7a1c71ec0

~~~typescript
import { realpath } from 'node:fs/promises';
import type { GatewayManager } from '../gateway/manager';
import { expandPath } from '../utils/paths';
import { getActiveWorkspaceProfile, getPersistedCoordinatorBinding } from './workspaces-api';
import type { MemoryWikiReadIdentity } from '../../openclaw_runtime/extensions/memory-wiki/runtime-api';

export type KnowledgeReadScope = {
  identity: MemoryWikiReadIdentity;
  expectedSessionGeneration?: string;
  fingerprint: string;
};

/** Renderer fields select an existing owner binding; they cannot supply its root or generation. */
export async function captureKnowledgeReadScope(
  gateway: Pick<GatewayManager, 'rpc'>,
  selection: { sessionKey?: string; workspaceId?: string | null } = {},
  egressProviderRefs: string[] = [],
): Promise<KnowledgeReadScope> {
  const workspace = await getActiveWorkspaceProfile();
  if (selection.workspaceId && selection.workspaceId !== workspace?.id) {
    throw Object.assign(new Error('Knowledge workspace changed or is not the current owner workspace.'), { code: 'VALIDATION' });
  }
  if (!workspace) {
    if (selection.sessionKey) throw Object.assign(new Error('Knowledge session has no workspace owner.'), { code: 'VALIDATION' });
    return { identity: { egressProviderRefs }, fingerprint: 'knowledge-ui:no-workspace' };
  }
  const sessionKey = selection.sessionKey || workspace.activeSessionKey;
  const binding = await getPersistedCoordinatorBinding(workspace.id, sessionKey);
  const belongsToOwner = sessionKey === workspace.activeSessionKey
    || Object.values(workspace.agentBindings ?? {}).some(entry => entry.sessionKey === sessionKey)
    || Boolean(binding);
  if (!belongsToOwner || (binding && binding.state !== 'active')) {
    throw Object.assign(new Error('Knowledge session is not an active owner binding.'), { code: 'VALIDATION' });
  }
  const root = await realpath(expandPath(binding?.environment.canonicalRoot || workspace.rootPath));
  const described = await gateway.rpc<{ session?: { key?: string; sessionId?: string; status?: string } | null }>(
    'sessions.describe', { key: sessionKey }, 15_000,
  );
  const session = described?.session;
  if (session?.status === 'archived' || (binding?.sessionGeneration && binding.sessionGeneration !== session?.sessionId)) {
    throw Object.assign(new Error('Knowledge session generation changed.'), { code: 'VALIDATION' });
  }
  const canonicalSessionKey = session?.key || sessionKey;
  return {
    identity: { agentSessionKey: canonicalSessionKey, sessionId: session?.sessionId,
      workspaceId: workspace.id, workspaceDir: root, egressProviderRefs },
    ...(session?.sessionId ? { expectedSessionGeneration: session.sessionId } : {}),
    fingerprint: JSON.stringify([workspace.id, workspace.selectedAgentId, workspace.permissionMode,
      canonicalSessionKey, session?.sessionId, root, binding?.bindingRevision, binding?.state]),
  };
}

export async function assertKnowledgeReadScopeCurrent(gateway: Pick<GatewayManager, 'rpc'>, scope: KnowledgeReadScope): Promise<void> {
  const current = await captureKnowledgeReadScope(gateway, {
    workspaceId: scope.identity.workspaceId, sessionKey: scope.identity.agentSessionKey,
  }, scope.identity.egressProviderRefs);
  if (current.fingerprint !== scope.fingerprint) {
    throw Object.assign(new Error('Knowledge identity changed during the read.'), { code: 'VALIDATION' });
  }
}

/** A first Chat read materializes the already-owned logical session through the session owner. */
export async function prepareKnowledgeReadScope(gateway: Pick<GatewayManager, 'rpc'>,
  selection: { sessionKey?: string; workspaceId?: string | null }, egressProviderRefs: string[] = []): Promise<KnowledgeReadScope> {
  let scope = await captureKnowledgeReadScope(gateway, selection, egressProviderRefs);
  if (scope.identity.agentSessionKey && !scope.expectedSessionGeneration) {
    const agentId = scope.identity.agentSessionKey.startsWith('agent:') ? scope.identity.agentSessionKey.split(':')[1] : undefined;
    await gateway.rpc('sessions.create', { key: scope.identity.agentSessionKey, ...(agentId ? { agentId } : {}) }, 30_000);
    scope = await captureKnowledgeReadScope(gateway, selection, egressProviderRefs);
    if (!scope.expectedSessionGeneration) throw Object.assign(new Error('Knowledge session generation is unavailable.'), { code: 'VALIDATION' });
  }
  return scope;
}

~~~
