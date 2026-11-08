import { useEffect, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useWorkspacesStore } from '@/stores/workspaces';
import { useChatStore } from '@/stores/chat';
import { activateWorkspaceScopedSession } from '@/lib/workspace-session';
import { Chat } from '@/pages/Chat';

export default function ProjectPage() {
  const { workspaceId = '' } = useParams();
  const location = useLocation();
  const { t } = useTranslation('chat');
  const profiles = useWorkspacesStore((state) => state.profiles);
  const workspace = profiles.find((profile) => profile.id === workspaceId);
  const hasWorkspace = Boolean(workspace);
  const selectedSession = useChatStore((state) => state.currentSessionKey);
  const activeWorkspaceId = useWorkspacesStore((state) => state.activeWorkspaceId);
  const agentId = workspace?.selectedAgentId ?? workspace?.agentId;
  const assistantKey = agentId ? workspace?.agentBindings?.[agentId]?.sessionKey : undefined;
  const coordinatorKey = workspace?.projectCoordinatorSessionKey
    ?? (assistantKey && workspace?.coordinatorBindings?.[assistantKey] ? assistantKey : undefined);
  const unavailable = !coordinatorKey || workspace?.archivedSessionKeys?.includes(coordinatorKey)
    || profiles.some((profile) => profile.id !== workspaceId && profile.projectCoordinatorSessionKey === coordinatorKey);
  const [entry, setEntry] = useState<{ workspaceId: string; sessionKey?: string; error?: string } | null>(null);
  useEffect(() => { void useWorkspacesStore.getState().fetchWorkspaces(); }, [workspaceId]);
  useEffect(() => {
    let cancelled = false;
    if (!hasWorkspace || !coordinatorKey || unavailable) return;
    void activateWorkspaceScopedSession(workspaceId, coordinatorKey, () => !cancelled).then((selected) => {
      if (!cancelled && selected) setEntry({ workspaceId, sessionKey: coordinatorKey });
    }).catch((error) => { if (!cancelled) setEntry({ workspaceId, sessionKey: coordinatorKey, error: String(error) }); });
    return () => { cancelled = true; };
  }, [workspaceId, hasWorkspace, coordinatorKey, unavailable, location.key]);
  if (!workspace || unavailable || (entry?.workspaceId === workspaceId && entry.sessionKey === coordinatorKey && entry.error)) return <p role="status" data-testid="project-entry-unavailable">{t('projectEntry.unavailable')}</p>;
  const selectedBelongs = workspace.activeSessionKey === selectedSession
    || Object.hasOwn(workspace.sessionStates ?? {}, selectedSession)
    || Object.hasOwn(workspace.coordinatorBindings ?? {}, selectedSession);
  if (entry?.workspaceId !== workspaceId || activeWorkspaceId !== workspaceId || !selectedBelongs) {
    return <p role="status">{t('projectEntry.loading')}</p>;
  }
  return <Chat projectWorkspaceId={selectedSession === coordinatorKey ? workspaceId : undefined} />;
}
