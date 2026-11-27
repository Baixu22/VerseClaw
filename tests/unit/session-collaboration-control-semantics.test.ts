import { describe, expect, it } from 'vitest';
import { SESSION_COLLABORATION_CONTROLS, qualifySessionCollaborationControl } from '../../shared/types/session-collaboration-control';
import { parseSessionCollaborationQuery } from '../../shared/types/session-collaboration';
import { normalizeRunScope } from '../../shared/types/identity-scope';
const scope = parseSessionCollaborationQuery({ requester: { workspaceId: 'workspace', projectId: 'workspace', sessionKey: 'agent:main:control', sessionGeneration: 'generation' } }).requester;
const run = normalizeRunScope({ runId: 'current-run', scope: { workspaceId: scope.workspaceId, projectId: scope.projectId, sessionKey: scope.sessionKey } });
describe('collaboration control semantics', () => {
  it('keeps guide, interrupt-send and messages distinct', () => {
    expect(SESSION_COLLABORATION_CONTROLS.guide.effect).toBe('same-run-input');
    expect(SESSION_COLLABORATION_CONTROLS.interruptSend.effect).toBe('interrupt-then-send');
    expect(SESSION_COLLABORATION_CONTROLS.message.effect).toBe('message');
    expect(SESSION_COLLABORATION_CONTROLS.guide.owner).not.toBe(SESSION_COLLABORATION_CONTROLS.interruptSend.owner);
  });
  it('rejects old generations and a different run before control dispatch', () => {
    expect(() => qualifySessionCollaborationControl('stop', { ...scope, sessionGeneration: 'old' }, scope, null, null)).toThrow();
    const next = normalizeRunScope({ ...run, runId: 'next-run' });
    expect(() => qualifySessionCollaborationControl('guide', scope, scope, run, next)).toThrow('RUN_CHANGED');
    expect(() => qualifySessionCollaborationControl('guide', scope, scope, null, run)).toThrow('OWNER_MISSING');
    expect(qualifySessionCollaborationControl('guide', scope, scope, run, run).effect).toBe('same-run-input');
  });
  it('leaves boundary selection and persistent operation handling to the original owner', () => {
    for (const action of ['truncate', 'fork', 'handoff', 'migrate'] as const) expect(SESSION_COLLABORATION_CONTROLS[action].effect).toBe('open-original-controls');
  });
});
