import type { GatewayManager } from './manager';
import type { JsonRpcNotification } from './protocol';
import { parseSessionTaskEffectRequest, type SessionTaskEffectAdmission, type SessionTaskEffectRequest } from '@shared/session-task-scope';
import { logger } from '../utils/logger';

/** Reverse RPC only: the Workspace owner qualifies the runtime's session/run tuple. */
export function registerSessionTaskScopeBridge(
  gateway: GatewayManager,
  admit: (request: SessionTaskEffectRequest) => Promise<SessionTaskEffectAdmission>,
): () => void {
  const onNotification = (notification: JsonRpcNotification) => {
    if (notification.method !== 'taskScope.admit.request') return;
    let request: SessionTaskEffectRequest;
    try { request = parseSessionTaskEffectRequest(notification.params); }
    catch { logger.warn('[task-scope] Rejected malformed admission request'); return; }
    void (async () => {
      let result: { admission: SessionTaskEffectAdmission } | { error: string };
      try { result = { admission: await admit(request) }; }
      catch (error) { result = { error: error instanceof Error ? error.message : String(error) }; }
      await gateway.rpc('taskScope.admit.result', {
        requestId: request.requestId, sessionKey: request.sessionKey,
        sessionGeneration: request.sessionGeneration, runId: request.runId, ...result,
      });
    })().catch((error) => logger.warn('[task-scope] Could not deliver admission result', error));
  };
  gateway.on('notification', onNotification);
  return () => { gateway.off('notification', onNotification); };
}
