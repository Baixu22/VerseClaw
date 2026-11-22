/**
 * use-run-approvals.ts — brings host permission approvals into the chat stream.
 *
 * Approvals used to be reachable only from the workspace side panels, so a run
 * that blocked on permission showed the user a dead "Approval" line in the
 * execution graph with no way to act on it. This hook is the missing half: it
 * reads the host approval store and hands the pending set to
 * `PendingRunApprovals`, which renders the same `ApprovalCard` the Tool UI uses.
 *
 * Refresh strategy: `approval.updated` runtime events tell us *something* moved,
 * but they carry no decision affordance and no id we can trust to be the host
 * approval id — so they are used purely as a change signal, with a slow poll as
 * a safety net while a run is live. Both paths converge on
 * `hostApi.permissions.approvals`, which is authoritative.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { hostApi } from '@/lib/host-api';
import { selectPendingApprovals } from '@/components/tool-ui/run-surfaces';
import type { ChatRuntimeRunState } from '@/stores/chat/types';
import type { PermissionApprovalDecision, PermissionApprovalEvent } from '@shared/types/workspace';

const ACTIVE_RUN_POLL_MS = 3_000;

function countApprovalEvents(runState: ChatRuntimeRunState | null | undefined): number {
  if (!runState) return 0;
  let count = 0;
  for (const event of runState.events) {
    if (event.type === 'approval.updated') count += 1;
  }
  return count;
}

export function useRunApprovals({
  workspaceId,
  sessionKey,
  activeRunId,
  runState,
  runActive,
}: {
  workspaceId?: string;
  sessionKey: string;
  activeRunId: string | null;
  runState: ChatRuntimeRunState | null | undefined;
  runActive: boolean;
}): {
  pendingApprovals: PermissionApprovalEvent[];
  decideApproval: (id: string, decision: PermissionApprovalDecision) => Promise<void>;
} {
  const [approvals, setApprovals] = useState<PermissionApprovalEvent[]>([]);
  const approvalEventCount = countApprovalEvents(runState);
  const cancelledRef = useRef(false);
  // A run that stalls on permission eventually gets flagged as errored, which
  // clears `activeRunId`. Its approval is still the live one, so keep matching
  // against the last run we saw rather than dropping the card at that moment.
  // (React's "adjust state during render" pattern — no ref, no effect.)
  const [lastKnownRunId, setLastKnownRunId] = useState<string | null>(null);
  if (activeRunId && activeRunId !== lastKnownRunId) setLastKnownRunId(activeRunId);
  const matchRunId = activeRunId ?? lastKnownRunId;

  const refresh = useCallback(async () => {
    if (!workspaceId || !sessionKey) {
      setApprovals([]);
      return;
    }
    try {
      const result = await hostApi.permissions.approvals({
        workspaceId,
        sessionKey,
        status: 'pending',
        limit: 50,
      });
      if (cancelledRef.current) return;
      setApprovals(Array.isArray(result?.approvals) ? result.approvals : []);
    } catch {
      // Keep an actionable request through a transient read failure. The next
      // successful host snapshot removes resolved requests; session filtering
      // below keeps the previous session's requests out of the new composer.
    }
  }, [sessionKey, workspaceId]);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  // Change signal: a new approval.updated event, a session switch, or a new run.
  // Deferred to a microtask so the synchronous reset branch inside `refresh`
  // cannot cascade a render from the effect body (same pattern as
  // WorkspaceAuditPanel).
  useEffect(() => {
    queueMicrotask(() => {
      void refresh();
    });
  }, [refresh, approvalEventCount, activeRunId]);

  // Safety net while something is still in flight — the host may register an
  // approval before any approval.updated event reaches the renderer, and a
  // stalled run stops being "active" long before its approval is resolved.
  useEffect(() => {
    if (!runActive && approvals.length === 0) return;
    const timer = window.setInterval(() => {
      void refresh();
    }, ACTIVE_RUN_POLL_MS);
    return () => window.clearInterval(timer);
  }, [approvals.length, refresh, runActive]);

  const pendingApprovals = useMemo(
    () => (workspaceId
      ? selectPendingApprovals(approvals, {
        workspaceId,
        sessionKey,
        // Ordering hint only — see selectPendingApprovals. Every pending
        // approval for the session is returned regardless of which run raised
        // it, and `assignApprovalsToRunCards` decides which turn shows it.
        activeRunId: matchRunId,
      })
      : []),
    [approvals, matchRunId, sessionKey, workspaceId],
  );

  const decideApproval = useCallback(async (id: string, decision: PermissionApprovalDecision) => {
    const result = await hostApi.permissions.decideApproval({ id, decision });
    if (!result?.success) {
      throw new Error(result?.error || 'Approval decision failed');
    }
    await refresh();
  }, [refresh]);

  return { pendingApprovals, decideApproval };
}
