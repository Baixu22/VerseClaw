import { render, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SessionDelegationStatus } from '@/components/chat/SessionDelegationStatus';
import type { SessionDelegationReceipt } from '@shared/types/session-delegation';
import { createEmptySessionActivitySnapshot, type SessionActivityCompletionBatch } from '@shared/types/session-activity';
import type { TaskEvidence, TaskView } from '@shared/task-system/types';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const worker = { id: 'worker-1', childSessionKey: 'child', status: 'completed' as const, updatedAt: 1, source: 'event' as const, summary: 'All business tasks are done.' };
const receipt = { coordinator: { workspaceId: 'project-a', sessionKey: 'parent', sessionGeneration: 'generation-1' }, status: 'accepted',
  children: [{ childSessionKey: 'child', admissionStatus: 'accepted' }] } as SessionDelegationReceipt;
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
  it('keeps the known child acceptance unavailable after its live roster and task owner disappear', () => {
    const { container } = render(<SessionDelegationStatus workspaceId="project-a" sessionKey="parent" generation="generation-1"
      childSessionKey="retained-child" task={null} />);
    expect(container.querySelector('[data-stage="acceptance"]')).toHaveAttribute('data-status', 'unavailable');
    expect(container.querySelector('[data-stage="execution"]')).toHaveAttribute('data-status', 'unavailable');
  });
  it('does not borrow another child admission or report for a run-only worker', () => {
    const runOnlyWorker = { id: 'run-only', status: 'error' as const, updatedAt: 1, source: 'event' as const };
    const { container } = render(<SessionDelegationStatus workspaceId="project-a" sessionKey="parent" generation="generation-1"
      receipt={receipt} snapshot={snapshot()} worker={runOnlyWorker} />);
    expect(container.querySelector('[data-stage="execution"]')).toHaveAttribute('data-status', 'error');
    expect(container.querySelector('[data-stage="admission"]')).toHaveAttribute('data-status', 'unavailable');
    expect(container.querySelector('[data-stage="report"]')).toHaveAttribute('data-status', 'unavailable');
  });
  it('shows a business acceptance only after its task owner accepts the contract', () => {
    const task = { contract: { taskNodeId: 'task-1', state: 'doing' } } as TaskView;
    const admission = { ...receipt, taskRef: 'task-1' };
    const props = { workspaceId: 'project-a', sessionKey: 'parent', generation: 'generation-1',
      receipt: admission, snapshot: snapshot(), worker };
    const { container, rerender } = render(<SessionDelegationStatus {...props} task={task} />);
    expect(container.querySelector('[data-stage="acceptance"]')).toHaveAttribute('data-status', 'pending');
    rerender(<SessionDelegationStatus {...props} task={{ ...task, contract: { ...task.contract, state: 'done' } }} />);
    expect(container.querySelector('[data-stage="acceptance"]')).toHaveAttribute('data-status', 'accepted');
    const otherTask = { ...task, contract: { ...task.contract, taskNodeId: 'another-task', state: 'done' } } as TaskView;
    rerender(<SessionDelegationStatus {...props} worker={undefined} task={otherTask} />);
    expect(container.querySelector('[data-stage="acceptance"]')).toHaveAttribute('data-status', 'unavailable');
  });
  it('keeps each child admission separate from a partial delegation and reads its canonical task independently of the root taskRef', () => {
    const partial = { ...receipt, status: 'partial', taskRef: 'root-task', children: [
      { childSessionKey: 'child', taskNodeId: 'graph-role-1', admissionStatus: 'accepted' },
      { childSessionKey: 'other-child', taskNodeId: 'graph-role-2', admissionStatus: 'rejected' },
    ] } as SessionDelegationReceipt;
    const task = { contract: { taskNodeId: 'canonical-child-task', state: 'done' } } as TaskView;
    const view = render(<SessionDelegationStatus workspaceId="project-a" sessionKey="parent" generation="generation-1"
      receipt={partial} worker={worker} task={task} />);
    expect(view.container.querySelector('[data-stage="admission"]')).toHaveAttribute('data-status', 'accepted');
    expect(view.container.querySelector('[data-stage="acceptance"]')).toHaveAttribute('data-status', 'accepted');
    view.rerender(<SessionDelegationStatus workspaceId="project-a" sessionKey="parent" generation="generation-1"
      receipt={partial} childSessionKey="other-child" />);
    expect(view.container.querySelector('[data-stage="admission"]')).toHaveAttribute('data-status', 'rejected');
    view.rerender(<SessionDelegationStatus workspaceId="project-a" sessionKey="parent" generation="generation-1" receipt={partial} />);
    expect(view.container.querySelector('[data-stage="admission"]')).toHaveAttribute('data-status', 'partial');
  });
  it('shows recorded verifier facts for one task revision, epoch and candidate without accepting the business task', () => {
    const task = { contract: { taskNodeId: 'task-1', revision: 2, state: 'doing',
      acceptance: [{ id: 'file' }, { id: 'test' }] } } as TaskView;
    const props = { workspaceId: 'project-a', sessionKey: 'parent', generation: 'generation-1', task, worker };
    const recorded = [{ taskNodeId: 'task-1', revision: 2, epoch: 3, candidate: 'candidate-a', criterionId: 'file', createdAt: 1 },
      { taskNodeId: 'task-1', revision: 2, epoch: 3, candidate: 'candidate-b', criterionId: 'test', createdAt: 2 },
      { taskNodeId: 'other-task', revision: 2, epoch: 3, candidate: 'candidate-b', criterionId: 'file', createdAt: 3 },
      { taskNodeId: 'task-1', revision: 1, epoch: 3, candidate: 'candidate-b', criterionId: 'file', createdAt: 4 }] as TaskEvidence[];
    const view = render(<SessionDelegationStatus {...props} verificationReceipts={[]} />);
    expect(view.container.querySelector('[data-stage="verification"]')).toHaveAttribute('data-status', 'pending');
    view.rerender(<SessionDelegationStatus {...props} verificationReceipts={recorded} />);
    expect(view.container.querySelector('[data-stage="verification"]')).toHaveAttribute('data-status', 'recorded');
    expect(view.container.querySelector('[data-stage="verification"]')).toHaveAttribute('data-recorded-criteria', '1');
    expect(view.container.querySelector('[data-stage="verification"]')).toHaveAttribute('data-candidate', 'candidate-b');
    expect(view.container.querySelector('[data-stage="acceptance"]')).toHaveAttribute('data-status', 'pending');
  });
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

describe('dispatch-time capacity explanation', () => {
  const planned: SessionDelegationReceipt = { ...receipt, acceptedAt: '2026-11-09T00:00:00.000Z',
    scheduler: { executionWaves: [{ wave: 1, taskNodeIds: ['a'], roles: ['planner'],
      reason: 'scheduled 1 ready node(s); deferred 1 for concurrency cap', deferredReasons: ['concurrency-cap'] }],
      metrics: { queued: 12, running: 1, scheduled: 1, skipped: 0, concurrencyCap: 1, budgetEstimate: 2 } } };
  it('shows the receipt plan without presenting its queued metric as a current wait', () => {
    const open = vi.fn();
    const view = render(<SessionDelegationStatus workspaceId="project-a" sessionKey="parent" generation="generation-1"
      receipt={planned} onOpenResources={open} />);
    expect(view.getByTestId('delegation-receipt-plan')).toHaveAttribute('data-plan-time', 'receipt');
    expect(view.getByTestId('delegation-plan-reason-1')).toHaveTextContent(planned.scheduler!.executionWaves[0].reason);
    expect(view.container.querySelector('[data-deferred-reason="concurrency-cap"]')).toHaveTextContent('delegationStages.capacity.reason.concurrencyCap');
    expect(view.queryByTestId('delegation-current-wait')).toBeNull();
    fireEvent.click(view.getByTestId('delegation-open-resources'));
    expect(open).toHaveBeenCalledOnce();
  });
  it.each([
    { workspaceId: 'other', sessionKey: 'parent', generation: 'generation-1' },
    { workspaceId: 'project-a', sessionKey: 'other', generation: 'generation-1' },
    { workspaceId: 'project-a', sessionKey: 'parent', generation: 'generation-2' },
  ])('hides another scope or generation receipt and its action: %j', scope => {
    const view = render(<SessionDelegationStatus {...scope} receipt={planned} onOpenResources={vi.fn()} />);
    expect(view.queryByTestId('delegation-receipt-plan')).toBeNull();
    expect(view.queryByTestId('delegation-open-resources')).toBeNull();
  });
  it('reads current queue and explicit worker waiting separately, and drops stale generation facts', () => {
    const value = snapshot();
    value.availability.continuity = true; value.availability.subagents = true;
    value.continuity.queueCount = 2;
    const waiting = { ...worker, status: 'yielded' as const }; value.subagents = [waiting];
    const view = render(<SessionDelegationStatus workspaceId="project-a" sessionKey="parent" generation="generation-1"
      receipt={planned} snapshot={value} worker={waiting} />);
    expect(view.getByTestId('delegation-current-queue')).toHaveAttribute('data-count', '2');
    expect(view.getByTestId('delegation-current-worker-wait')).toBeInTheDocument();
    value.continuity.queueCount = 0; value.subagents = [worker];
    view.rerender(<SessionDelegationStatus workspaceId="project-a" sessionKey="parent" generation="generation-1"
      receipt={planned} snapshot={value} worker={worker} />);
    expect(view.getByTestId('delegation-current-queue')).toHaveAttribute('data-count', '0');
    expect(view.queryByTestId('delegation-current-worker-wait')).toBeNull();
    expect(view.getByTestId('delegation-receipt-plan')).toBeInTheDocument();
    view.rerender(<SessionDelegationStatus workspaceId="project-a" sessionKey="parent" generation="generation-2"
      receipt={planned} snapshot={value} worker={worker} />);
    expect(view.queryByTestId('delegation-current-wait')).toBeNull();
    expect(view.queryByTestId('delegation-receipt-plan')).toBeNull();
  });
});
