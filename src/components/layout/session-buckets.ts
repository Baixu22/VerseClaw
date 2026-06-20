import type { ChatSession } from '@/stores/chat';

function getAgentIdFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const [, agentId] = sessionKey.split(':');
  return agentId || 'main';
}

function getSessionCreatedAtMsFromKey(sessionKey: string): number | undefined {
  const match = sessionKey.match(/(?:^|:)session-(\d{11,})(?=$|:)/);
  if (!match) return undefined;

  const createdAtMs = Number(match[1]);
  return Number.isFinite(createdAtMs) && createdAtMs > 0 ? createdAtMs : undefined;
}

export function getSessionActivityMs(
  session: ChatSession,
  sessionLastActivity: Record<string, number>,
): number {
  const lastActivityMs = sessionLastActivity[session.key];
  if (Number.isFinite(lastActivityMs) && lastActivityMs > 0) return lastActivityMs;

  if (typeof session.updatedAt === 'number' && Number.isFinite(session.updatedAt) && session.updatedAt > 0) {
    return session.updatedAt;
  }

  return getSessionCreatedAtMsFromKey(session.key) ?? 0;
}

export function isSessionVisibleInWorkspace(params: {
  sessionKey: string;
  currentSessionKey: string;
  workspaceSessionKeys?: Iterable<string> | null;
}): boolean {
  if (getAgentIdFromSessionKey(params.sessionKey) !== getAgentIdFromSessionKey(params.currentSessionKey)) {
    return false;
  }
  if (!params.workspaceSessionKeys) return true;
  const workspaceSessionKeys = params.workspaceSessionKeys instanceof Set
    ? params.workspaceSessionKeys
    : new Set(params.workspaceSessionKeys);
  return workspaceSessionKeys.has(params.sessionKey) || params.sessionKey === params.currentSessionKey;
}
