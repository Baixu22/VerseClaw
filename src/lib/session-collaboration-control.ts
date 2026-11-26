import { hostApi } from './host-api';
import { readSessionCollaborationPage } from './session-read-model';
import { parseSessionCollaborationQuery } from '@shared/types/session-collaboration';
import { qualifySessionCollaborationControl, type SessionCollaborationControl } from '@shared/types/session-collaboration-control';
import type { AutonomySessionScope, ScopedRunId } from '@shared/types/identity-scope';

/** Fresh qualification never turns a read reference into another owner's control permission. */
export async function invokeSessionCollaborationControl(input: { action: SessionCollaborationControl; requester: AutonomySessionScope;
  target: AutonomySessionScope; run?: ScopedRunId | null; message?: string },
  openOwner: (action: SessionCollaborationControl, scope: AutonomySessionScope) => Promise<void> | void) {
  const page = await readSessionCollaborationPage(parseSessionCollaborationQuery({ requester: input.requester, target: input.target, limit: 1 }));
  const row = page.items[0];
  if (!row?.detail || row.sources.session.state !== 'ready') throw new Error(`CONTROL_SOURCE_${page.reason ?? page.state}`);
  const descriptor = qualifySessionCollaborationControl(input.action, input.target, row.detail.scope, input.run ?? null, row.sources.run.value);
  if (descriptor.effect === 'open-original-controls' || input.action === 'interruptSend' || input.action === 'message') return openOwner(input.action, input.target);
  if (input.action === 'guide') {
    // The original /loop input owner owns capability, queue and final run qualification.
    return openOwner(input.action, input.target);
  }
  if (input.action === 'stop') return hostApi.sessions.stop({ sessionKey: input.target.sessionKey, workspaceId: input.target.workspaceId, expectedSessionId: input.target.sessionGeneration });
  if (input.action === 'compact') return hostApi.sessions.compact({ sessionKey: input.target.sessionKey, expectedSessionId: input.target.sessionGeneration });
  return openOwner(input.action, input.target);
}
