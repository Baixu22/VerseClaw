import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SessionDelegationStatus } from '@/components/chat/SessionDelegationStatus';
import type { SessionDelegationReceipt } from '@shared/types/session-delegation';
import { createEmptySessionActivitySnapshot, type SessionActivityCompletionBatch } from '@shared/types/session-activity';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const worker = { id: 'worker-1', childSessionKey: 'child', status: 'completed' as const, updatedAt: 1, source: 'event' as const, summary: 'All business tasks are done.' };
const receipt = { coordinator: { workspaceId: 'project-a', sessionKey: 'parent', sessionGeneration: 'generation-1' }, status: 'accepted',
  children: [{ childSessionKey: 'child' }] } as SessionDelegationReceipt;
function snapshot(generation = 'generation-1') {
  const result = createEmptySessionActivitySnapshot('parent');
  result.session.sessionId = generation;
  result.subagents = [worker];
  result.completionBatches = [{ requesterSessionKey: 'parent', requesterSessionGeneration: generation, generationState: 'matching',
    acceptedAt: 1, members: [{ childSessionKey: 'child' }], delivery: { state: 'delivered', waitingForRequesterTurn: false },
  } as SessionActivityCompletionBatch];
  return result;
}
describe('delegation stage facts', () => {
  it('keeps accepted, run completion and report delivery separate from task acceptance', () => {
    const { container } = render(<SessionDelegationStatus workspaceId="project-a" sessionKey="parent" generation="generation-1"
      receipt={receipt} snapshot={snapshot()} worker={worker} />);
    expect(container.querySelector('[data-stage="admission"]')).toHaveAttribute('data-status', 'accepted');
    expect(container.querySelector('[data-stage="execution"]')).toHaveAttribute('data-status', 'completed');
    expect(container.querySelector('[data-stage="report"]')).toHaveAttribute('data-status', 'delivered');
    expect(container.querySelector('[data-stage="acceptance"]')).toHaveAttribute('data-status', 'unavailable');
    expect(container.querySelector('[data-stage="continuation"]')).toHaveAttribute('data-status', 'unavailable');
  });
  it('does not use an admission for another worker or a stale requester generation', () => {
    const value = snapshot(); value.completionBatches[0].generationState = 'mismatch';
    const { container } = render(<SessionDelegationStatus workspaceId="project-b" sessionKey="parent" generation="generation-2"
      receipt={receipt} snapshot={value} worker={worker} />);
    expect(container.querySelector('[data-stage="admission"]')).toHaveAttribute('data-status', 'unavailable');
    expect(container.querySelector('[data-stage="report"]')).toHaveAttribute('data-status', 'fenced');
    expect(container.querySelector('[data-stage="continuation"]')).toHaveAttribute('data-status', 'fenced');
  });
  it('uses the latest owner batch and exposes waiting without claiming a parent run started', () => {
    const value = snapshot(); value.completionBatches.push({ ...value.completionBatches[0], acceptedAt: 2,
      delivery: { ...value.completionBatches[0].delivery, state: 'pending', waitingForRequesterTurn: true } });
    const { container } = render(<SessionDelegationStatus workspaceId="project-a" sessionKey="parent" generation="generation-1"
      receipt={receipt} snapshot={value} worker={worker} />);
    expect(container.querySelector('[data-stage="report"]')).toHaveAttribute('data-status', 'pending');
    expect(container.querySelector('[data-stage="continuation"]')).toHaveAttribute('data-status', 'waiting');
  });
});
