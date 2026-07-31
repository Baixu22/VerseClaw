/**
 * Permission audit trail for the active workspace.
 *
 * One of the workspace panel's tab kinds. Terminal, git, and web preview each
 * have their own panel component and are routed to directly by
 * `ArtifactPanel`'s `PanelContent`, so this file only handles approvals.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { hostApi } from '@/lib/host-api';
import { useWorkspacesStore } from '@/stores/workspaces';
import type { PermissionApprovalEvent } from '@shared/types/workspace';

type T = ReturnType<typeof useTranslation>['t'];

function modeLabel(mode: string | undefined, t: T): string {
  switch (mode) {
    case 'readOnly': return t('approvals.mode.readOnly');
    case 'acceptEdits': return t('approvals.mode.acceptEdits');
    case 'plan': return t('approvals.mode.plan');
    case 'fullAccess': return t('approvals.mode.fullAccess');
    default: return t('approvals.mode.acceptEdits');
  }
}

function sourceLabel(source: PermissionApprovalEvent['source'], t: T): string {
  switch (source) {
    case 'terminal': return t('approvals.source.terminal');
    case 'gateway': return 'Gateway';
    case 'mcp': return 'MCP';
    case 'file': return t('approvals.source.file');
    case 'remoteControl': return t('approvals.source.remoteControl');
    default: return source;
  }
}

function riskLabel(risk: PermissionApprovalEvent['risk'], t: T): string {
  switch (risk) {
    case 'write': return t('approvals.risk.write');
    case 'dangerous': return t('approvals.risk.dangerous');
    default: return risk;
  }
}

function statusLabel(status: PermissionApprovalEvent['status'], t: T): string {
  switch (status) {
    case 'pending': return t('approvals.status.pending');
    case 'approved': return t('approvals.status.approved');
    case 'denied': return t('approvals.status.denied');
    case 'expired': return t('approvals.status.expired');
    default: return status;
  }
}

function formatApprovalTime(value: number): string {
  return new Date(value).toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function WorkspaceAuditPanel() {
  const { t } = useTranslation('chat');
  const activeWorkspace = useWorkspacesStore((s) => s.activeWorkspace);
  const workspaceId = activeWorkspace?.id;
  const [approvals, setApprovals] = useState<PermissionApprovalEvent[]>([]);

  const refreshApprovals = useCallback(async () => {
    if (!workspaceId) {
      setApprovals([]);
      return;
    }
    try {
      const result = await hostApi.permissions.approvals({
        workspaceId,
        includeExpired: true,
        limit: 200,
      });
      setApprovals(result.approvals);
    } catch {
      setApprovals([]);
    }
  }, [workspaceId]);

  useEffect(() => {
    queueMicrotask(() => {
      void refreshApprovals();
    });
  }, [refreshApprovals]);

  return (
    <div className="flex h-full min-h-0 flex-col p-3">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">{t('approvals.title')}</p>
          <p className="text-xs text-muted-foreground">{t('approvals.description')}</p>
        </div>
        <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => void refreshApprovals()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          {t('common:actions.refresh')}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-black/10 dark:border-white/10">
        {approvals.length === 0 ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
            {t('approvals.empty')}
          </div>
        ) : (
          <div className="divide-y divide-black/5 dark:divide-white/10">
            {approvals.map((approval) => (
              <div key={approval.id} className="p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-foreground">{sourceLabel(approval.source, t)}</span>
                  <Badge variant={approval.status === 'pending' ? 'warning' : 'outline'}>{statusLabel(approval.status, t)}</Badge>
                </div>
                <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                  {approval.command || approval.paths?.join(', ') || approval.reason || approval.id}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {formatApprovalTime(approval.requestedAt)} · {riskLabel(approval.risk, t)} · {modeLabel(approval.mode, t)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default WorkspaceAuditPanel;
