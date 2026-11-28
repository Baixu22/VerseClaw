// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SessionCollaborationResources } from '../../src/components/agents/SessionCollaborationResources';
import type { AutonomySessionScope } from '../../shared/types/identity-scope';
import type { SessionOwnerInventory } from '../../shared/long-session-resource-reclamation';

const { resources } = vi.hoisted(() => ({ resources: vi.fn() }));
vi.mock('../../src/lib/host-api', () => ({ hostApi: { sessionActivity: { resources } } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-US' } }) }));

it('keeps held, spent and unknown values separate across three budgets and the admission fence', async () => {
  const scope = { sessionKey: 'agent:main:budget', workspaceId: 'project', projectId: 'project',
    sessionGeneration: 'generation' } as AutonomySessionScope;
  const owner: SessionOwnerInventory = { kind: 'provider', owner: 'ProviderOutboundBudget', authority: 'managed',
    generation: scope.sessionGeneration, state: 'known', count: null, pids: null, processTreePids: null, rssKb: null, cpuPercent: null,
    activePermits: null, waiters: null, helperRefs: null, worktreeIds: null, sessionIds: null, budgetEnabled: true };
  resources.mockResolvedValue({ success: true, resources: { state: 'ready', inventory: { capturedAt: new Date().toISOString(), owners: [
    { ...owner, spend: [
      { scope: 'host', spentTokens: 90, heldTokens: 25, spentCostMicros: 2000, heldCostMicros: 1000, activeCalls: 3, unknownCostCalls: 0, unknownTokenCalls: 0 },
      { scope: 'project', spentTokens: 0, heldTokens: 10, spentCostMicros: 0, heldCostMicros: 0, activeCalls: 1, unknownCostCalls: 1, unknownTokenCalls: 1 },
    ] },
    { ...owner, kind: 'admission-permit', owner: 'SessionAdmissionRegistry', count: 0, activePermits: 0, waiters: 0,
      admission: { fenced: true, rejectedWhileFenced: 2 } },
  ] } } });
  render(<SessionCollaborationResources requester={scope} target={scope} />);
  expect(resources).not.toHaveBeenCalled();
  const details = screen.getByTestId('collaboration-resources') as HTMLDetailsElement;
  details.open = true;
  fireEvent(details, new Event('toggle'));
  const host = within(await screen.findByTestId('collaboration-budget-host'));
  expect(host.getByText('90')).toBeTruthy();
  expect(host.getByText('25')).toBeTruthy();
  expect(host.queryByText('115')).toBeNull();
  expect(within(screen.getByTestId('collaboration-budget-project')).getAllByText('collaboration.sources.unknown')).toHaveLength(3);
  expect(within(screen.getByTestId('collaboration-budget-session')).getByText('collaboration.sources.unknown')).toBeTruthy();
  expect(screen.getByTestId('collaboration-admission-state').textContent).toBe('collaboration.budget.admissionStates.fenced');
});
