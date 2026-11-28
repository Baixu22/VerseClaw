// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { normalizeRunScope } from '../../shared/types/identity-scope';
import { parseSessionCollaborationQuery } from '../../shared/types/session-collaboration';
import { emptyMaterialPage, type SessionCollaborationMaterialPage } from '../../shared/types/session-collaboration-material';

const mocks = vi.hoisted(() => ({ query: vi.fn(), present: vi.fn(), watch: vi.fn(), sender: vi.fn() }));
vi.mock('../../src/lib/host-api', () => ({ hostApi: { sessions: {
  collaborationMaterials: mocks.query, presentCollaborationMaterial: mocks.present, collaborationSender: mocks.sender,
} } }));
vi.mock('../../src/stores/session-collaboration', () => ({ subscribeSessionCollaboration: mocks.watch }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import { SessionCollaborationMaterials } from '../../src/components/agents/SessionCollaborationMaterials';

const scope = parseSessionCollaborationQuery({ requester: { workspaceId: 'workspace', projectId: 'workspace',
  sessionKey: 'agent:main:reader', sessionGeneration: 'generation' } }).requester;
const ref = { id: 'finding', version: 1, authorityId: 'owner', taskNodeId: 'task' as never,
  taskRevision: 1, taskDigest: 'a'.repeat(64), contentDigest: 'b'.repeat(64) };
const item: SessionCollaborationMaterialPage['items'][number] = { ref, source: scope, kind: 'claim', state: 'claim',
  summary: 'A selected material', truncated: true, sensitivity: 'internal', createdAt: 1 };
const listed = { ...emptyMaterialPage({ requester: scope }, 'ready'), items: [item], scanned: 1 };
const detail: SessionCollaborationMaterialPage = { ...emptyMaterialPage({ requester: scope }, 'ready'), scanned: 1,
  detail: { state: 'claim', material: { ...ref, kind: 'claim', summary: 'Full original material', evidenceRefs: [],
    sensitivity: 'internal', sourceGeneration: scope.sessionGeneration,
    sourceRun: normalizeRunScope({ scope, runId: 'run' }), state: 'claim', createdAt: 1 } } };
const reply = (materials: SessionCollaborationMaterialPage) => ({ success: true, materials });

function toggle(open: boolean) {
  const element = screen.getByTestId('collaboration-materials') as HTMLDetailsElement;
  element.open = open;
  fireEvent(element, new Event('toggle'));
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.present.mockResolvedValue({ success: true, recorded: true });
  mocks.watch.mockReturnValue(() => {});
  mocks.sender.mockResolvedValue({ source: { scope } });
});

it('opens the exact inherited material version using the current reader without a discovery query', async () => {
  mocks.query.mockResolvedValue(reply(detail));
  const reference = { source: scope, ref };
  render(<MemoryRouter><SessionCollaborationMaterials target={scope} reference={reference} /></MemoryRouter>);
  await screen.findByText('Full original material');
  expect(mocks.query).toHaveBeenCalledOnce();
  expect(mocks.query).toHaveBeenCalledWith({ requester: scope, target: scope, ref });
});

it('uses the active reader from Main while preserving the selected material source', async () => {
  const active = { ...scope, sessionKey: 'agent:main:active' as typeof scope.sessionKey, sessionGeneration: 'active-generation' };
  mocks.sender.mockResolvedValue({ source: { scope: active } });
  mocks.query.mockResolvedValue(reply(emptyMaterialPage({ requester: active }, 'empty')));
  render(<MemoryRouter><SessionCollaborationMaterials target={scope} /></MemoryRouter>);
  toggle(true);
  await waitFor(() => expect(mocks.query).toHaveBeenCalledWith(expect.objectContaining({ requester: active, target: scope })));
});

it('keeps the pending selected detail across collapse and presents it only after reopening', async () => {
  let finish!: (value: ReturnType<typeof reply>) => void;
  mocks.query.mockResolvedValueOnce(reply(listed)).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<MemoryRouter><SessionCollaborationMaterials /></MemoryRouter>);
  expect(mocks.query).not.toHaveBeenCalled();
  toggle(true);
  fireEvent.click(await screen.findByRole('button', { name: /A selected material/ }));
  await waitFor(() => expect(mocks.query).toHaveBeenCalledTimes(2));
  toggle(false);
  await act(async () => finish(reply(detail)));
  expect(mocks.present).not.toHaveBeenCalled();
  expect(mocks.watch).not.toHaveBeenCalled();
  toggle(true);
  await waitFor(() => expect(screen.getByTestId('collaboration-material-detail').textContent).toContain('Full original material'));
  expect(mocks.query).toHaveBeenCalledTimes(2);
  await waitFor(() => expect(mocks.present).toHaveBeenCalledOnce());
  expect(mocks.present).toHaveBeenCalledWith(expect.objectContaining({ requester: scope, target: scope, ref }));
});

it('discards an earlier selected detail when another search finishes first', async () => {
  let finish!: (value: ReturnType<typeof reply>) => void;
  mocks.query.mockResolvedValueOnce(reply(listed)).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValueOnce(reply(emptyMaterialPage({ requester: scope }, 'empty')));
  render(<MemoryRouter><SessionCollaborationMaterials /></MemoryRouter>);
  toggle(true);
  fireEvent.click(await screen.findByRole('button', { name: /A selected material/ }));
  await waitFor(() => expect(mocks.query).toHaveBeenCalledTimes(2));
  fireEvent.change(screen.getByTestId('collaboration-material-search'), { target: { value: 'Another topic' } });
  fireEvent.click(screen.getByRole('button', { name: 'collaboration.materials.search' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('collaboration.materials.empty'));
  await act(async () => finish(reply(detail)));
  expect(screen.queryByTestId('collaboration-material-detail')).toBeNull();
  expect(mocks.present).not.toHaveBeenCalled();
});
