import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CheckCircle2, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { LongTaskControlStatus } from '@shared/types/long-task-control';
import type { SessionCompactionStatus } from '@shared/host-api/contract';
import { SettingsButton, SettingsRow, SettingsSection, SettingsSelect, SettingsSwitch } from '@/components/settings/primitives';
import { hostApi } from '@/lib/host-api';
import { useChatStore } from '@/stores/chat';
import { useGatewayStore } from '@/stores/gateway';
import { useSessionActivityStore } from '@/stores/session-activity';
import { useSettingsStore, type SessionActivityAutoExpand, type SessionActivityRetentionMinutes } from '@/stores/settings';
import { useWorkspacesStore } from '@/stores/workspaces';
import { deriveRecoveryRecommendations } from '@/pages/Chat/rollback-plan';
import { SessionEffectivePolicyPanel } from '@/pages/Chat/SessionEffectivePolicyPanel';

export function RecoverySettingsSection() {
  const { t } = useTranslation(['settings', 'chat']);
  const navigate = useNavigate();
  const location = useLocation();
  const sessions = useChatStore((state) => state.sessions);
  const currentSessionKey = useChatStore((state) => state.currentSessionKey);
  const activeWorkspaceId = useWorkspacesStore((state) => state.activeWorkspaceId);
  const activeWorkspacePermissionMode = useWorkspacesStore((state) => state.activeWorkspace?.permissionMode);
  const gatewayStatus = useGatewayStore((state) => state.status);
  const settings = useSettingsStore();
  const snapshots = useSessionActivityStore((state) => state.snapshots);
  const loadActivity = useSessionActivityStore((state) => state.load);
  const requestedSession = new URLSearchParams(location.search).get('sessionKey');
  const [selectedSessionKey, setSelectedSessionKey] = useState(requestedSession || currentSessionKey);
  const [compactionStatus, setCompactionStatus] = useState<SessionCompactionStatus | null>(null);
  const [longTaskStatus, setLongTaskStatus] = useState<LongTaskControlStatus | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedSessionKey) return;
    void loadActivity({ workspaceId: activeWorkspaceId, sessionKey: selectedSessionKey });
    void Promise.allSettled([
      hostApi.sessions.compactionStatus({ sessionKey: selectedSessionKey }),
      hostApi.sessions.longTaskControlStatus({ sessionKey: selectedSessionKey }),
    ]).then(([compaction, longTask]) => {
      setCompactionStatus(compaction.status === 'fulfilled' && compaction.value.success ? compaction.value : null);
      setLongTaskStatus(longTask.status === 'fulfilled' && longTask.value.success ? longTask.value : null);
    });
  }, [
    activeWorkspaceId,
    activeWorkspacePermissionMode,
    gatewayStatus.connectedAt,
    gatewayStatus.gatewayReady,
    gatewayStatus.pid,
    gatewayStatus.port,
    gatewayStatus.state,
    loadActivity,
    selectedSessionKey,
  ]);

  const snapshot = snapshots[selectedSessionKey];
  const hasPolicyStatus = snapshot?.policy !== undefined || snapshot?.availability.policy !== undefined;
  const recoveryPlan = useMemo(() => deriveRecoveryRecommendations({
    activeRun: snapshot?.session.status === 'running' || snapshot?.session.status === 'waiting_approval',
    gatewayAvailable: true,
    queueDrainBusy: busyAction === 'queueDrain',
    compactionBusy: busyAction === 'compact',
    handoffDisabled: false,
    contextRange: null,
    compactionStatus,
    longTaskControlStatus: longTaskStatus,
    gitStatus: snapshot?.git,
    activeTerminalCount: snapshot?.terminals.filter((terminal) => terminal.status === 'running').length ?? 0,
    taskLedgerReviewCount: snapshot?.tasks.filter((task) => task.status === 'review').length ?? 0,
    taskLedgerBlockedCount: snapshot?.tasks.filter((task) => task.status === 'blocked').length ?? 0,
    recoveryFactsCount: snapshot?.continuity.checkpoint || snapshot?.continuity.blockedReason ? 1 : 0,
    checkpointAvailable: snapshot?.continuity.checkpoint,
    queueCount: snapshot?.continuity.queueCount,
    contextPressure: snapshot?.continuity.contextPressure,
  }), [busyAction, compactionStatus, longTaskStatus, snapshot]);

  const runRecoveryAction = async (command: string | undefined) => {
    if (!command || !selectedSessionKey) return;
    setBusyAction(command);
    try {
      if (command === 'queueDrain') {
        await hostApi.sessions.queueDrain({ sessionKey: selectedSessionKey });
      } else if (command === 'compact') {
        await hostApi.sessions.compact({ sessionKey: selectedSessionKey });
      } else if (command === 'interruptTerminal') {
        await Promise.all((snapshot?.terminals ?? []).filter((terminal) => terminal.status === 'running' && terminal.kind !== 'agentCommand').map((terminal) => hostApi.terminal.interrupt({ sessionId: terminal.id })));
      } else if (command === 'openTaskLedger') {
        navigate('/task-ledger');
        return;
      } else if (command === 'createMemoryDraft') {
        navigate('/knowledge');
        return;
      } else {
        navigate(`/?sessionKey=${encodeURIComponent(selectedSessionKey)}`);
        return;
      }
      toast.success(t('settings:recovery.actionComplete'));
      await loadActivity({ workspaceId: activeWorkspaceId, sessionKey: selectedSessionKey });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('settings:recovery.actionFailed'));
    } finally {
      setBusyAction(null);
    }
  };

  const sessionOptions = (sessions.length > 0 ? sessions : [{ key: currentSessionKey }]).map((session) => ({
    value: session.key,
    label: session.label || session.displayName || session.derivedTitle || session.key,
  }));

  return (
    <div className="space-y-8" data-testid="recovery-settings-section">
      <SettingsSection title={t('settings:recovery.activityTitle')}>
        <SettingsRow
          title={t('settings:recovery.enabled.title')}
          description={t('settings:recovery.enabled.description')}
          control={<SettingsSwitch ariaLabel={t('settings:recovery.enabled.title')} checked={settings.sessionActivityPanelEnabled} onChange={settings.setSessionActivityPanelEnabled} testId="settings-session-activity-enabled" />}
        />
        <SettingsRow
          title={t('settings:recovery.autoExpand.title')}
          description={t('settings:recovery.autoExpand.description')}
          control={<SettingsSelect ariaLabel={t('settings:recovery.autoExpand.title')} value={settings.sessionActivityAutoExpand} onChange={(value) => settings.setSessionActivityAutoExpand(value as SessionActivityAutoExpand)} testId="settings-session-activity-auto-expand" options={[
            { value: 'active', label: t('settings:recovery.autoExpand.active') },
            { value: 'attention', label: t('settings:recovery.autoExpand.attention') },
            { value: 'never', label: t('settings:recovery.autoExpand.never') },
          ]} />}
        />
        <SettingsRow
          title={t('settings:recovery.completedRunsExpanded.title')}
          description={t('settings:recovery.completedRunsExpanded.description')}
          control={(
            <SettingsSwitch
              ariaLabel={t('settings:recovery.completedRunsExpanded.title')}
              checked={settings.runActivityKeepExpandedOnComplete}
              onChange={settings.setRunActivityKeepExpandedOnComplete}
              testId="settings-run-activity-completed-expanded"
            />
          )}
        />
        <SettingsRow
          title={t('settings:recovery.showGit.title')}
          description={t('settings:recovery.showGit.description')}
          control={<SettingsSwitch ariaLabel={t('settings:recovery.showGit.title')} checked={settings.sessionActivityShowGit} onChange={settings.setSessionActivityShowGit} testId="settings-session-activity-show-git" />}
        />
        <SettingsRow
          title={t('settings:recovery.showCommands.title')}
          description={t('settings:recovery.showCommands.description')}
          control={<SettingsSwitch ariaLabel={t('settings:recovery.showCommands.title')} checked={settings.sessionActivityShowCommands} onChange={settings.setSessionActivityShowCommands} testId="settings-session-activity-show-commands" />}
        />
        <SettingsRow
          title={t('settings:recovery.notifications.title')}
          description={t('settings:recovery.notifications.description')}
          control={<SettingsSwitch ariaLabel={t('settings:recovery.notifications.title')} checked={settings.sessionRecoveryNotificationsEnabled} onChange={settings.setSessionRecoveryNotificationsEnabled} testId="settings-session-recovery-notifications" />}
        />
        <SettingsRow
          title={t('settings:recovery.retention.title')}
          description={t('settings:recovery.retention.description')}
          control={<SettingsSelect ariaLabel={t('settings:recovery.retention.title')} value={String(settings.sessionActivityRetentionMinutes)} onChange={(value) => settings.setSessionActivityRetentionMinutes(Number(value) as SessionActivityRetentionMinutes)} testId="settings-session-activity-retention" options={[
            { value: '0', label: t('settings:recovery.retention.none') },
            { value: '5', label: t('settings:recovery.retention.five') },
            { value: '15', label: t('settings:recovery.retention.fifteen') },
          ]} />}
        />
      </SettingsSection>

      <SettingsSection title={t('settings:recovery.currentTitle')}>
        <SettingsRow
          title={t('settings:recovery.session.title')}
          description={t('settings:recovery.session.description')}
          control={<SettingsSelect ariaLabel={t('settings:recovery.session.title')} value={selectedSessionKey} onChange={setSelectedSessionKey} testId="settings-recovery-session" options={sessionOptions} />}
        />
        {hasPolicyStatus ? (
          <div className="px-4 pb-3">
            <SessionEffectivePolicyPanel policy={snapshot?.policy ?? null} />
          </div>
        ) : null}
        {recoveryPlan.available ? recoveryPlan.actions.map((action) => (
          <SettingsRow
            key={action.kind}
            title={t(`chat:${action.titleKey}`)}
            description={t(`chat:${action.detailKey}`, action.detailValues)}
            control={<SettingsButton disabled={busyAction !== null} onClick={() => void runRecoveryAction(action.command)}>{t('settings:recovery.runAction')}</SettingsButton>}
          />
        )) : (
          <SettingsRow
            testId="settings-recovery-healthy"
            title={t('settings:recovery.healthy')}
            control={<CheckCircle2 className="h-4 w-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />}
          />
        )}
        <SettingsRow
          title={t('settings:recovery.openConversation')}
          control={
            <SettingsButton onClick={() => navigate(`/?sessionKey=${encodeURIComponent(selectedSessionKey)}`)}>
              <RotateCcw className="h-3.5 w-3.5" />
              {t('settings:recovery.openConversation')}
            </SettingsButton>
          }
        />
      </SettingsSection>
    </div>
  );
}

export default RecoverySettingsSection;
