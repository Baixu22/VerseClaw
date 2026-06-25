import type { ChatGet, ChatSet, RuntimeActions } from './store-api';
import { createRuntimeEventActions } from './runtime-event-actions';
import { createRuntimeSendActions } from './runtime-send-actions';
import { createRuntimeUiActions } from './runtime-ui-actions';
import { hostApi } from '@/lib/host-api';
import { useWorkspacesStore } from '../workspaces';

export function createRuntimeActions(set: ChatSet, get: ChatGet): RuntimeActions {
  return {
    ...createRuntimeSendActions(set, get),
    ...createRuntimeEventActions(set, get),
    ...createRuntimeUiActions(set, get),
    refreshTaskLedger: async () => {
      const wsId = useWorkspacesStore.getState().activeWorkspaceId;
      if (!wsId) {
        set({ taskLedgerSnapshot: null, taskLedgerLoaded: true });
        return;
      }
      try {
        const result = await hostApi.taskLedger.snapshot({ workspaceId: wsId });
        set({ taskLedgerSnapshot: result.success ? result.snapshot : null, taskLedgerLoaded: true });
      } catch {
        set({ taskLedgerSnapshot: null, taskLedgerLoaded: true });
      }
    },
  };
}
