/**
 * assignApprovalsToRunCards — which turn shows which pending approval.
 *
 * Regression guard for the audit's F4: approvals used to be handed to whichever
 * card happened to be last (`card.runKey === latestRunKey`) after being filtered
 * down to the active run. Sending the next message therefore dropped an
 * undecided approval out of the UI entirely while the host went on holding it.
 */
import { describe, expect, it } from 'vitest';
import { assignApprovalsToRunCards, type UserRunCard } from '@/pages/Chat/execution-projection';
import type { PermissionApprovalEvent } from '@shared/types/workspace';
import { EMPTY_PROMOTED_SURFACES } from '@/pages/Chat/run-surface-promotion';

function card(overrides: Partial<UserRunCard> = {}): UserRunCard {
  return {
    runKey: 'run-key-1',
    triggerIndex: 0,
    replyIndex: null,
    active: false,
    status: 'completed',
    hasVisibleReply: true,
    agentLabel: 'main',
    sessionLabel: 'session',
    segmentEnd: 1,
    steps: [],
    orchestrations: [],
    messageStepTexts: [],
    streamingReplyText: null,
    suppressThinking: false,
    surfaces: EMPTY_PROMOTED_SURFACES,
    ...overrides,
  };
}

function approval(overrides: Partial<PermissionApprovalEvent> = {}): PermissionApprovalEvent {
  return {
    id: 'approval-1',
    workspaceId: 'workspace-1',
    sessionKey: 'agent:main:main',
    runId: 'run-1',
    source: 'terminal',
    risk: 'dangerous',
    status: 'pending',
    reason: 'rm -rf ./dist',
    command: 'rm -rf ./dist',
    cwd: '/repo',
    requestedAt: 1,
    ...overrides,
  } as PermissionApprovalEvent;
}

describe('assignApprovalsToRunCards', () => {
  it('returns nothing when there is no card or no approval', () => {
    expect(assignApprovalsToRunCards([], [approval()]).size).toBe(0);
    expect(assignApprovalsToRunCards([card()], []).size).toBe(0);
  });

  it('attributes an approval to the turn whose run raised it', () => {
    const first = card({ runKey: 'key-1', runId: 'run-1', triggerIndex: 0 });
    const second = card({ runKey: 'key-2', runId: 'run-2', triggerIndex: 2 });

    const assigned = assignApprovalsToRunCards([first, second], [approval({ runId: 'run-1' })]);

    // The point of F4: it lands on the turn that produced it, NOT on the newest.
    expect(assigned.get('key-1')?.map((entry) => entry.id)).toEqual(['approval-1']);
    expect(assigned.get('key-2')).toBeUndefined();
  });

  it('keeps an undecided approval reachable after the user moves to the next turn', () => {
    const finished = card({ runKey: 'key-1', runId: 'run-1', triggerIndex: 0 });
    const current = card({ runKey: 'key-2', runId: 'run-2', triggerIndex: 2, active: true, status: 'running' });

    const assigned = assignApprovalsToRunCards([finished, current], [approval({ runId: 'run-1' })]);

    expect(assigned.get('key-1')?.map((entry) => entry.id)).toEqual(['approval-1']);
  });

  it('falls back to the newest turn when the approval carries no run id', () => {
    const first = card({ runKey: 'key-1', runId: 'run-1', triggerIndex: 0 });
    const second = card({ runKey: 'key-2', runId: 'run-2', triggerIndex: 2 });

    const assigned = assignApprovalsToRunCards([first, second], [approval({ id: 'legacy', runId: undefined })]);

    expect(assigned.get('key-2')?.map((entry) => entry.id)).toEqual(['legacy']);
    expect(assigned.get('key-1')).toBeUndefined();
  });

  it('falls back to the newest turn when no card can claim the run', () => {
    // History cards carry no runId at all, so an approval from a run that has
    // scrolled out of the window still has to surface somewhere.
    const history = card({ runKey: 'key-1', runId: undefined, triggerIndex: 0 });
    const newest = card({ runKey: 'key-2', runId: undefined, triggerIndex: 2 });

    const assigned = assignApprovalsToRunCards([history, newest], [approval({ runId: 'run-long-gone' })]);

    expect(assigned.get('key-2')?.map((entry) => entry.id)).toEqual(['approval-1']);
  });

  it('groups several approvals per turn and preserves host order', () => {
    const first = card({ runKey: 'key-1', runId: 'run-1', triggerIndex: 0 });
    const second = card({ runKey: 'key-2', runId: 'run-2', triggerIndex: 2 });

    const assigned = assignApprovalsToRunCards([first, second], [
      approval({ id: 'a1', runId: 'run-1' }),
      approval({ id: 'b1', runId: 'run-2' }),
      approval({ id: 'a2', runId: 'run-1' }),
      approval({ id: 'orphan', runId: undefined }),
    ]);

    expect(assigned.get('key-1')?.map((entry) => entry.id)).toEqual(['a1', 'a2']);
    expect(assigned.get('key-2')?.map((entry) => entry.id)).toEqual(['b1', 'orphan']);
  });

  it('never loses an approval', () => {
    const cards = [
      card({ runKey: 'key-1', runId: 'run-1', triggerIndex: 0 }),
      card({ runKey: 'key-2', runId: 'run-2', triggerIndex: 2 }),
    ];
    const approvals = [
      approval({ id: 'a', runId: 'run-1' }),
      approval({ id: 'b', runId: 'run-2' }),
      approval({ id: 'c', runId: 'run-unknown' }),
      approval({ id: 'd', runId: undefined }),
    ];

    const assigned = assignApprovalsToRunCards(cards, approvals);
    const placed = Array.from(assigned.values()).flat().map((entry) => entry.id).sort();

    expect(placed).toEqual(['a', 'b', 'c', 'd']);
  });
});
