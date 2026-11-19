// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { sessionsReadHandlers } from '../../openclaw_runtime/src/gateway/server-methods/sessions.read';
import { validateSessionsDescribeParams } from '../../openclaw_runtime/packages/gateway-protocol/src';

const state = vi.hoisted(() => ({
  entry: { sessionId: 'generation-1', status: 'running' } as { sessionId: string; status: string } | undefined,
  buildRow: vi.fn(() => ({ key: 'agent:main:owner', model: 'display-model' })),
  load: vi.fn(() => ({})),
  archive: vi.fn(async () => ({ version: 1, entries: [] as Array<{ sessionKey: string; sessionsJsonSnapshot: { sessionId: string } | { key: string } }> })),
}));
vi.mock('../../openclaw_runtime/src/config/sessions', () => ({ loadSessionStore: state.load }));
vi.mock('../../openclaw_runtime/src/gateway/session-archive-index', () => ({
  readSessionArchiveIndex: state.archive,
  resolveSessionArchiveIndexPath: () => 'fixture-archive.json',
}));
vi.mock('../../openclaw_runtime/src/gateway/session-utils', () => ({
  buildGatewaySessionRow: state.buildRow,
  resolveFreshestSessionEntryFromStoreKeys: () => state.entry,
}));
vi.mock('../../openclaw_runtime/src/gateway/server-methods/sessions.shared', () => ({
  requireSessionKey: (key: string) => key,
  resolveGatewaySessionTargetFromKey: () => ({ target: { canonicalKey: 'agent:main:owner', storeKeys: ['owner'] }, storePath: 'fixture-sessions.json' }),
}));
beforeEach(() => {
  state.entry = { sessionId: 'generation-1', status: 'running' };
  vi.clearAllMocks();
  state.archive.mockResolvedValue({ version: 1, entries: [] });
});
const describe = async (identityOnly?: boolean) => {
  const respond = vi.fn();
  await sessionsReadHandlers['sessions.describe']({
    params: { key: 'owner', ...(identityOnly === undefined ? {} : { identityOnly }) }, respond,
    context: { getRuntimeConfig: () => ({}), chatAbortControllers: new Map() },
  } as never);
  return respond;
};
it('reads the current owner generation without model or transcript decoration', async () => {
  expect(validateSessionsDescribeParams({ key: 'owner', identityOnly: true })).toBe(true);
  expect(validateSessionsDescribeParams({ key: 'owner', identityOnly: 'true' })).toBe(false);
  expect(await describe(true)).toHaveBeenCalledWith(true, { session: { key: 'agent:main:owner', sessionId: 'generation-1', status: 'running' } }, undefined);
  state.entry = { sessionId: 'generation-2', status: 'running' };
  expect(await describe(true)).toHaveBeenCalledWith(true, { session: { key: 'agent:main:owner', sessionId: 'generation-2', status: 'running' } }, undefined);
  state.entry = undefined;
  expect(await describe(true)).toHaveBeenCalledWith(true, { session: null }, undefined);
  expect(state.load).toHaveBeenCalledTimes(3);
  expect(state.buildRow).not.toHaveBeenCalled();
});
it('rejects the archived generation while its active row still exists, and admits a fresh generation', async () => {
  state.archive.mockResolvedValue({ version: 1, entries: [{ sessionKey: 'agent:main:owner', sessionsJsonSnapshot: { sessionId: 'generation-1' } }] });
  expect(await describe(true)).toHaveBeenCalledWith(true, { session: { key: 'agent:main:owner', sessionId: 'generation-1', status: 'archived' } }, undefined);
  state.entry = { sessionId: 'generation-2', status: 'running' };
  expect(await describe(true)).toHaveBeenCalledWith(true, { session: { key: 'agent:main:owner', sessionId: 'generation-2', status: 'running' } }, undefined);
  state.archive.mockResolvedValueOnce({ version: 1, entries: [{ sessionKey: 'agent:main:owner', sessionsJsonSnapshot: { key: 'agent:main:owner' } }] });
  expect(await describe(true)).toHaveBeenCalledWith(true, { session: { key: 'agent:main:owner', sessionId: 'generation-2', status: 'archived' } }, undefined);
  state.archive.mockRejectedValueOnce(new Error('Archive index unreadable'));
  await expect(describe(true)).rejects.toThrow('Archive index unreadable');
  expect(state.buildRow).not.toHaveBeenCalled();
});
it('preserves the full describe response when identity-only is omitted', async () => {
  expect(await describe()).toHaveBeenCalledWith(true, { session: { key: 'agent:main:owner', model: 'display-model', hasActiveRun: false } }, undefined);
  expect(state.buildRow).toHaveBeenCalledTimes(1);
});
