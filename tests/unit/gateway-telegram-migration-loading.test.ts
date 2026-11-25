// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const loaded = vi.hoisted(() => ({ message: 0, thread: 0 }));
// Legacy file parsing must not invoke the ACP service used by the live manager.
vi.mock('openclaw/plugin-sdk/acp-runtime', () => ({
  readAcpSessionEntry: () => { throw new Error('migration invoked ACP runtime'); },
}));
vi.mock('openclaw/plugin-sdk/conversation-runtime', () => ({}));
vi.mock('openclaw/plugin-sdk/channel-inbound', async () =>
  import('../../openclaw_runtime/src/channels/location'),
);
vi.mock('../../openclaw_runtime/extensions/telegram/src/message-cache.js', async original => {
  loaded.message++;
  return original();
});
vi.mock('../../openclaw_runtime/extensions/telegram/src/thread-bindings.js', async original => {
  loaded.thread++;
  return original();
});
import { detectTelegramLegacyStateMigrations } from '../../openclaw_runtime/extensions/telegram/legacy-state-migrations-api';

const root = mkdtempSync(join(tmpdir(), 'telegram-migrations-'));
afterEach(() => rmSync(root, { recursive: true, force: true }));

it('discovers migrations without runtime loading and reads existing message and thread records on demand', async () => {
  const store = join(root, 'agents/main/sessions/sessions.json');
  const params = {
    cfg: { session: { store } },
    env: { OPENCLAW_STATE_DIR: root, HOME: root, USERPROFILE: root },
    stateDir: root,
  };
  expect(await detectTelegramLegacyStateMigrations(params)).toEqual([]);
  expect(loaded).toEqual({ message: 0, thread: 0 });

  mkdirSync(join(root, 'agents/main/sessions'), { recursive: true });
  mkdirSync(join(root, 'telegram'), { recursive: true });
  const sourceMessage = { message_id: 7, date: 1, chat: { id: 42, type: 'private' }, text: 'retained' };
  writeFileSync(`${store}.telegram-messages.json`, JSON.stringify([
    { key: 'default:42:7', node: { sourceMessage } },
    { key: 'invalid', node: {} },
  ]));
  writeFileSync(join(root, 'telegram/thread-bindings-default.json'), JSON.stringify({
    version: 1,
    bindings: [
      { conversationId: '42', targetSessionKey: 'agent:main:acp:test', targetKind: 'acp', boundAt: 100, lastActivityAt: 101 },
      { conversationId: '', targetSessionKey: '' },
    ],
  }));
  const plans = (await detectTelegramLegacyStateMigrations(params))
    .filter(plan => plan.kind === 'plugin-state-import');
  expect(plans).toHaveLength(2);
  expect(loaded).toEqual({ message: 0, thread: 0 });
  const message = plans.find(plan => plan.namespace === 'telegram.message-cache')!;
  expect(message).toMatchObject({
    sourcePath: `${store}.telegram-messages.json`, cleanupSource: 'rename', maxEntries: 3000,
    scopeKey: createHash('sha256').update(`${store}.telegram-messages.json`).digest('hex').slice(0, 24),
  });
  expect(await message.readEntries()).toEqual([{ key: 'default:42:7', value: { sourceMessage } }]);
  const thread = plans.find(plan => plan.namespace === 'telegram.thread-bindings')!;
  expect(thread).toMatchObject({ cleanupSource: 'rename', maxEntries: 5000, scopeKey: '' });
  expect(await thread.readEntries()).toEqual([{
    key: createHash('sha256').update('default\0' + '42').digest('hex').slice(0, 32),
    value: { accountId: 'default', conversationId: '42', targetSessionKey: 'agent:main:acp:test', targetKind: 'acp', boundAt: 100, lastActivityAt: 101 },
  }]);
  expect(loaded).toEqual({ message: 1, thread: 1 });
});
