import { describe, expect, it } from 'vitest';
import { getSessionActivityMs, isSessionVisibleInWorkspace } from '@/components/layout/session-buckets';

describe('sidebar session activity resolution', () => {
  it('uses the timestamp embedded in a locally-created session key as activity fallback', () => {
    const createdAtMs = new Date('2026-05-06T10:00:00.000Z').getTime();
    const session = {
      key: `agent:main:session-${createdAtMs}`,
      displayName: `agent:main:session-${createdAtMs}`,
    };

    const activityMs = getSessionActivityMs(session, {});

    expect(activityMs).toBe(createdAtMs);
  });

  it('prefers real message activity over backend metadata or key creation time', () => {
    const keyCreatedAtMs = new Date('2026-05-06T10:00:00.000Z').getTime();
    const updatedAtMs = new Date('2026-05-06T11:00:00.000Z').getTime();
    const messageActivityMs = new Date('2026-05-06T12:00:00.000Z').getTime();

    expect(getSessionActivityMs(
      {
        key: `agent:main:session-${keyCreatedAtMs}`,
        updatedAt: updatedAtMs,
      },
      { [`agent:main:session-${keyCreatedAtMs}`]: messageActivityMs },
    )).toBe(messageActivityMs);
  });

  it('returns 0 for unparseable session keys without updatedAt', () => {
    expect(getSessionActivityMs({ key: 'garbage' }, {})).toBe(0);
  });

  it('keeps sessions scoped to the current workspace and agent', () => {
    const workspaceSessionKeys = new Set([
      'agent:main:workspace-a',
      'agent:main:workspace-a-older',
      'agent:reviewer:workspace-a',
    ]);

    expect(isSessionVisibleInWorkspace({
      sessionKey: 'agent:main:workspace-a',
      currentSessionKey: 'agent:main:workspace-a',
      workspaceSessionKeys,
    })).toBe(true);
    expect(isSessionVisibleInWorkspace({
      sessionKey: 'agent:main:workspace-b',
      currentSessionKey: 'agent:main:workspace-a',
      workspaceSessionKeys,
    })).toBe(false);
    expect(isSessionVisibleInWorkspace({
      sessionKey: 'agent:reviewer:workspace-a',
      currentSessionKey: 'agent:main:workspace-a',
      workspaceSessionKeys,
    })).toBe(false);
  });
});
