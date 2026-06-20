import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { hostApi } from '@/lib/host-api';
import { useWorkspacesStore } from '@/stores/workspaces';
import type { PermissionApprovalEvent } from '@shared/types/workspace';
import { WorkspaceTerminalPanel } from './WorkspaceTerminalPanel';
import { WorkspaceWebPreviewPanel } from './WorkspaceWebPreviewPanel';
import { WorkspaceGitPanel } from './WorkspaceGitPanel';
import type { GitDiffMode } from '@shared/types/git';

type WorkspaceOperationsPanelProps = {
  view: 'terminal' | 'web' | 'audit' | 'git';
  onOpenWorkspaceWebView?: () => void;
  onAppendComposerDraft?: (text: string) => void;
  gitSelectedPath?: string | null;
  gitDiffMode?: GitDiffMode;
  onGitSelectedPathChange?: (path: string | null) => void;
  onGitDiffModeChange?: (mode: GitDiffMode) => void;
};

function modeLabel(mode: string | undefined): string {
  switch (mode) {
    case 'readOnly': return '只读';
    case 'acceptEdits': return '接受修改';
    case 'plan': return '计划';
    case 'fullAccess': return '完全访问';
    default: return '接受修改';
  }
}

function sourceLabel(source: PermissionApprovalEvent['source']): string {
  switch (source) {
    case 'terminal': return '终端';
    case 'gateway': return 'Gateway';
    case 'mcp': return 'MCP';
    case 'file': return '文件';
    case 'remoteControl': return '远程控制';
    default: return source;
  }
}

function riskLabel(risk: PermissionApprovalEvent['risk']): string {
  switch (risk) {
    case 'write': return '写入';
    case 'dangerous': return '高风险';
    default: return risk;
  }
}

function statusLabel(status: PermissionApprovalEvent['status']): string {
  switch (status) {
    case 'pending': return '待处理';
    case 'approved': return '已批准';
    case 'denied': return '已拒绝';
    case 'expired': return '已消费';
    default: return status;
  }
}

function formatApprovalTime(value: number): string {
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function WorkspaceOperationsPanel({
  view,
  onOpenWorkspaceWebView,
  onAppendComposerDraft,
  gitSelectedPath,
  gitDiffMode,
  onGitSelectedPathChange,
  onGitDiffModeChange,
}: WorkspaceOperationsPanelProps) {
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

  if (view === 'terminal') return <WorkspaceTerminalPanel />;
  if (view === 'git') {
    return (
      <WorkspaceGitPanel
        selectedPath={gitSelectedPath}
        diffMode={gitDiffMode}
        onSelectedPathChange={onGitSelectedPathChange}
        onDiffModeChange={onGitDiffModeChange}
      />
    );
  }
  if (view === 'web') {
    return (
      <WorkspaceWebPreviewPanel
        onOpenWorkspaceWebView={onOpenWorkspaceWebView}
        onAppendComposerDraft={onAppendComposerDraft}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col p-3">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">审批与审计</p>
          <p className="text-xs text-muted-foreground">当前工作区的权限请求记录</p>
        </div>
        <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => void refreshApprovals()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          刷新
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-black/10 dark:border-white/10">
        {approvals.length === 0 ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
            暂无审批或高风险审计记录
          </div>
        ) : (
          <div className="divide-y divide-black/5 dark:divide-white/10">
            {approvals.map((approval) => (
              <div key={approval.id} className="p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-foreground">{sourceLabel(approval.source)}</span>
                  <Badge variant={approval.status === 'pending' ? 'warning' : 'outline'}>{statusLabel(approval.status)}</Badge>
                </div>
                <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                  {approval.command || approval.paths?.join(', ') || approval.reason || approval.id}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {formatApprovalTime(approval.requestedAt)} · {riskLabel(approval.risk)} · {modeLabel(approval.mode)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
