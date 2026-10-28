import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import type { ProviderAccount } from '../../electron/shared/providers/types';
import { HOST_EVENT_CHANNELS } from '../../shared/host-events/contract';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { allocatePort } from './fixtures/fp-p1-harness';
import { probeSpaceBunny, readSpaceBunnyResource, redactSpaceBunny, startSpaceBunnyProxy, type ResponsesFault } from './fixtures/space-bunny-responses';

type Json = Record<string, unknown>;
type History = { messages?: Json[] };
const root = process.env.CLAWX_SPACE_BUNNY_ARTIFACT_ROOT ?? join(process.cwd(), '.tmp', 'space-bunny-evidence');
const actor = 'codex-playwright';
test.use({ trace: 'off', video: 'off' });
type ObservedWindow = Window & { __spaceBunnyEvents?: Json[] };

async function save(name: string, value: unknown) {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, name), redactSpaceBunny(JSON.stringify(value, null, 2)) + '\n');
}

async function candidate() {
  const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 }).trim();
  const commit = git('rev-parse', 'HEAD');
  const dirty = git('status', '--porcelain').length > 0;
  assert(!dirty || process.env.CLAWX_SPACE_BUNNY_PREFLIGHT === '1', 'Acceptance requires a clean committed candidate');
  const files: Array<{ path: string; sha256: string; bytes: number }> = [];
  const sources = git('ls-files').split('\n').filter(file =>
    /^(?:src\/|electron\/|shared\/|openclaw_runtime\/(?:src|packages)\/|tests\/e2e\/fixtures\/)/.test(file)
    || /^(?:package.json|pnpm-lock.yaml|vite.config.ts|playwright.config.ts|openclaw_runtime\/(?:package.json|pnpm-lock.yaml|tsdown.config.ts))$/.test(file));
  sources.push('tests/e2e/product-acceptance-space-bunny.spec.ts', 'tests/e2e/fixtures/space-bunny-responses.ts',
    'harness/specs/tasks/product-acceptance-space-bunny.md', 'harness/specs/tasks/product-acceptance-closeout.md');
  const addFile = async (file: string) => {
    const bytes = await readFile(file);
    files.push({ path: file.replaceAll('\\', '/'), sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
  };
  for (const file of [...new Set(sources)].sort()) await addFile(file);
  const sourceCount = files.length;
  const walk = async (directory: string) => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) await addFile(file);
    }
  };
  for (const directory of ['dist', 'dist-electron', 'openclaw_runtime/dist', 'openclaw_runtime/dist-runtime']) await walk(directory);
  const stamp = JSON.parse(await readFile('openclaw_runtime/dist/.buildstamp', 'utf8'));
  if (!dirty && process.env.CLAWX_SPACE_BUNNY_PREFLIGHT !== '1') assert.equal(stamp.head, commit, 'Runtime build is not bound to the clean candidate');
  const binding = { commit, tree: git('rev-parse', 'HEAD^{tree}'), dirty,
    grade: dirty ? 'diagnostic-preflight-not-acceptance' : 'source-host-acceptance',
    sourceCount, buildCount: files.length - sourceCount, runtimeBuildStamp: stamp,
    inputDigest: createHash('sha256').update(JSON.stringify(files)).digest('hex') };
  if (!dirty) {
    const proofPath = process.env.CLAWX_SPACE_BUNNY_BUILD_PROOF;
    assert(proofPath, 'A sealed fresh-build proof is required for acceptance');
    const proof = JSON.parse(await readFile(proofPath, 'utf8'));
    expect(proof.schema).toBe('TF0580FreshBuild/v1');
    expect(proof.candidate).toEqual({ commit, tree: binding.tree, dirty: false });
    expect(proof.inputDigest).toBe(binding.inputDigest);
    expect(proof.buildCommands.map((command: Json) => command.command)).toEqual([
      ['pnpm', 'run', 'build:vite'], ['pnpm', 'run', 'build:runtime'],
    ]);
    for (const command of proof.buildCommands) {
      expect(command.exitCode).toBe(0);
      expect(command.candidate).toEqual(proof.candidate);
    }
  }
  await save(`candidate-inputs-${binding.inputDigest}.json`, { ...binding, files });
  return binding;
}

async function finishReceipt(receipt: Json, passed: boolean, app: ElectronApplication | undefined,
  proxy: Awaited<ReturnType<typeof startSpaceBunnyProxy>>, name: string) {
  receipt.status = 'fail';
  try {
    try {
      if (app) {
        const electronPid = app.process().pid;
        try {
          const page = await getStableWindow(app);
          const gateway = await host<Json>(page, 'gateway', 'status');
          const pid = gateway.pid;
          expect(typeof pid).toBe('number');
          expect(await host(page, 'gateway', 'stop')).toMatchObject({ success: true });
          await expect.poll(() => processAlive(Number(pid)), { timeout: 30_000 }).toBe(false);
          receipt.gatewayCleanup = { pid, statusBefore: gateway.state, aliveAfterStop: false };
        } finally {
          assert(electronPid, 'Owned Electron PID is missing');
          await closeElectronApp(app);
          await expect.poll(() => processAlive(electronPid), { timeout: 30_000 }).toBe(false);
          receipt.electronCleanup = { pid: electronPid, aliveAfterClose: false };
        }
      }
    }
    finally { receipt.cleanup = await proxy.close(); }
    expect(receipt.cleanup).toEqual({ listening: false, sockets: 0, requests: 0 });
    expect(await candidate()).toEqual(receipt.candidate);
    receipt.status = passed ? ((receipt.candidate as Json).dirty ? 'preflight-pass' : 'pass') : 'fail';
  } catch (error) {
    receipt.cleanupError = redactSpaceBunny(String(error));
    throw error;
  } finally {
    receipt.provider = proxy.observations;
    await save(name, receipt);
  }
}

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; }
}

async function host<T>(page: Page, module: string, action: string, payload?: Json): Promise<T> {
  return page.evaluate(async request => {
    if (!window.verseClaw) throw new Error('Renderer host bridge unavailable');
    const response = await window.verseClaw.hostInvoke({
      id: crypto.randomUUID(), module: request.module, action: request.action,
      ...(request.payload ? { payload: request.payload } : {}),
    });
    if (!response.ok) throw new Error(response.error?.message ?? 'Host request failed');
    return response.data as T;
  }, { module, action, payload });
}

async function history(page: Page, sessionKey = 'agent:main:main'): Promise<History> {
  return host(page, 'gateway', 'rpc', { method: 'chat.history', params: { sessionKey, limit: 100, maxChars: 500_000 }, timeoutMs: 30_000 });
}

async function observeRuntime(page: Page) {
  await page.evaluate(channels => {
    const observed = window as ObservedWindow;
    observed.__spaceBunnyEvents = [];
    for (const channel of channels) {
      window.electron.ipcRenderer.on(channel, (...args: unknown[]) => {
        observed.__spaceBunnyEvents!.push({ channel, args });
      });
    }
  }, [HOST_EVENT_CHANNELS.gateway.chatMessage, HOST_EVENT_CHANNELS.gateway.message, HOST_EVENT_CHANNELS.chat.runtimeEvent]);
}

async function runtimeEvents(page: Page) {
  return page.evaluate(() => (window as ObservedWindow).__spaceBunnyEvents ?? []);
}

async function trajectoryTools(userDataDir: string) {
  const dir = join(userDataDir, 'openclaw-source-state', 'agents', 'main', 'sessions');
  const rows: Json[] = [];
  for (const file of await readdir(dir)) {
    if (!file.endsWith('.trajectory.jsonl')) continue;
    for (const line of (await readFile(join(dir, file), 'utf8')).split('\n').filter(Boolean)) {
      const row = JSON.parse(line) as Json;
      if (row.type === 'tool/start' || row.type === 'tool/end') rows.push(row);
    }
  }
  return rows;
}

function providerCalls(observations: Awaited<ReturnType<typeof startSpaceBunnyProxy>>['observations']) {
  return observations.flatMap(observation => observation.events.filter(event => event.type === 'response.completed')
    .flatMap(event => ((event.response as Json | undefined)?.output ?? []) as Json[])
    .filter(item => item.type === 'function_call'));
}

async function waitForFaultRetriesToSettle(
  proxy: Awaited<ReturnType<typeof startSpaceBunnyProxy>>,
  start: number,
  type: ResponsesFault,
  quietMs = 3_500,
  timeoutMs = 30_000,
) {
  const deadline = Date.now() + timeoutMs;
  let requests = proxy.observations.slice(start).filter(observation => observation.fault === type).length;
  let stableAt = Date.now();
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 250));
    const current = proxy.observations.slice(start).filter(observation => observation.fault === type).length;
    if (current !== requests || proxy.activeRequests() !== 0) {
      requests = current;
      stableAt = Date.now();
      continue;
    }
    if (Date.now() - stableAt >= quietMs) {
      return { settled: true, requests, quietMs, elapsedMs: timeoutMs - (deadline - Date.now()) };
    }
  }
  return { settled: false, requests, quietMs, elapsedMs: timeoutMs };
}

async function runtimeFailed(page: Page, sessionKey: string, start: number) {
  return (await runtimeEvents(page)).slice(start).some(event => {
    const encoded = JSON.stringify(event);
    return encoded.includes(sessionKey) && /"state":"(?:error|aborted)"|"status":"(?:error|aborted|failed|cancelled)"|"phase":"(?:error|aborted)"/.test(encoded);
  });
}

async function replayLateCancelledEvents(app: ElectronApplication, sessionKey: string, runId: string, marker: string, seqBase = 9000) {
  const frames = [
    { runId, sessionKey, seq: seqBase + 1, state: 'delta', message: {
      role: 'assistant', content: [{ type: 'text', text: marker }],
    } },
    { runId, sessionKey, seq: seqBase + 2, state: 'final', stopReason: 'toolUse', message: {
      role: 'assistant', stopReason: 'toolUse', content: [{
        type: 'toolCall', id: 'late-cancelled-call', name: 'write', arguments: { path: 'late-effect.txt', content: marker },
      }],
    } },
    { runId, sessionKey, seq: seqBase + 3, state: 'final', stopReason: 'stop', message: {
      role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: marker }],
    } },
  ];
  await app.evaluate(async ({ BrowserWindow }, input) => {
    const sender = BrowserWindow.getAllWindows().find(window => !window.isDestroyed())?.webContents;
    if (!sender) throw new Error('No window for delayed Gateway delivery');
    for (const frame of input.frames) {
      await new Promise(resolve => setTimeout(resolve, 50));
      sender.send(input.channel, { message: frame });
    }
  }, { frames, channel: HOST_EVENT_CHANNELS.gateway.chatMessage });
  return { driven_by: 'agent', actor: 'codex-delayed-delivery', boundary: 'Main-to-Renderer',
    source: 'explicit synthetic late canceled-run events', frames };
}

function messageText(message: Json): string {
  if (typeof message.content === 'string') return message.content;
  return (Array.isArray(message.content) ? message.content : [])
    .map(part => part && typeof part === 'object' ? (part as Json).text ?? '' : '').join('');
}

function terminalFailure(messages: Json[]) {
  return messages.filter(message => message.role === 'assistant')
    .some(message => ['error', 'aborted'].includes(String(message.stopReason))
      || /assistant turn failed|injected .* failure|terminal response event/i.test(String(message.errorMessage ?? messageText(message))));
}

function finalText(history: History): string {
  const assistants = (history.messages ?? []).filter(message => message.role === 'assistant');
  const last = assistants.at(-1);
  return last?.stopReason === 'stop' ? messageText(last) : '';
}

async function waitForFinal(page: Page, sessionKey: string, marker: string, afterMessageCount = 0): Promise<History> {
  let observed: History = {};
  await expect.poll(async () => {
    observed = await history(page, sessionKey);
    return finalText({ messages: (observed.messages ?? []).slice(afterMessageCount) });
  }, { timeout: 30_000 }).toContain(marker);
  return observed;
}

async function prepare(page: Page, proxy: Awaited<ReturnType<typeof startSpaceBunnyProxy>>, workspace: string) {
  const resource = readSpaceBunnyResource();
  const now = new Date().toISOString();
  const account: ProviderAccount = { id: 'custom-gasmok01', vendorId: 'custom',
    label: 'Space Bunny Acceptance', authMode: 'api_key', apiProtocol: 'openai-responses', baseUrl: proxy.baseUrl,
    model: resource.model, modelProfile: { contextWindow: 128_000, maxTokens: 2048, supportsVision: false },
    metadata: { validation: { status: 'valid', checkedAt: now, model: resource.model, source: 'settings' } },
    enabled: true, isDefault: true, createdAt: now, updatedAt: now };
  expect(await host(page, 'providers', 'createAccount', { account, apiKey: proxy.proxyToken })).toMatchObject({ success: true });
  expect(await host(page, 'providers', 'validateKey', { accountId: account.id })).toMatchObject({ valid: true });
  expect(await host(page, 'providers', 'setDefaultAccount', { accountId: account.id })).toMatchObject({ success: true });
  expect(await host(page, 'agents', 'updateModel', { id: 'main', modelRef: `custom-gasmok01/${resource.model}` })).toMatchObject({ success: true });
  const created = await host<Json>(page, 'workspaces', 'create', {
    rootPath: workspace, name: 'Responses Acceptance', agentId: 'main', activeSessionKey: 'agent:main:main', permissionMode: 'default',
  });
  expect(created.success).toBe(true);
  const profiles = created.profiles as Json[];
  const profile = profiles.find(value => value.rootPath === workspace);
  expect(profile).toBeTruthy();
  expect(await host(page, 'workspaces', 'switch', { id: profile!.id })).toMatchObject({ success: true });
  // Host writes persist the profile; rehydrate renderer stores before using its new-session UI.
  await page.reload();
  await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
  const port = await allocatePort();
  expect(await host(page, 'settings', 'set', { key: 'gatewayPort', value: port })).toMatchObject({ success: true });
  await host(page, 'gateway', 'start');
  await expect.poll(async () => (await host<Json>(page, 'gateway', 'status')).state, { timeout: 120_000 }).toBe('running');
  await page.getByTestId('sidebar-nav-settings').click();
  await page.getByTestId('settings-nav-models').click();
  await expect(page.getByTestId('provider-card-custom-gasmok01')).toContainText('Space Bunny Acceptance');
  await page.getByTestId('settings-back-button').click();
  await page.getByTestId('sidebar-new-chat').click();
  await expect(page.getByTestId('chat-composer-input')).toBeVisible();
  return { port, accountId: account.id, modelRef: `custom-gasmok01/${resource.model}`, workspaceId: profile!.id };
}

async function send(page: Page, message: string) {
  const input = page.getByTestId('chat-composer-input');
  await expect(input).toBeEnabled({ timeout: 90_000 });
  await input.fill(message);
  await page.getByTestId('chat-composer-send').click();
}

async function idle(page: Page, timeout = 150_000) {
  await expect(page.getByTestId('chat-composer-send')).toHaveAttribute('data-send-state', /^(idle|ready|empty)/, { timeout });
}

async function latestSession(page: Page): Promise<string> {
  const started = (await runtimeEvents(page)).flatMap(event => event.args as Json[] ?? [])
    .filter(event => event.type === 'run.started' && typeof event.sessionKey === 'string').at(-1);
  if (!started) throw new Error('Actual Gateway run session is unavailable');
  return String(started.sessionKey);
}

async function seed(home: string, userData: string, workspace: string) {
  await mkdir(workspace, { recursive: true });
  const config = { gateway: { mode: 'local', controlUi: { enabled: false } },
    agents: { defaults: { workspace, skipBootstrap: true }, list: [{ id: 'main', default: true }] },
    skills: { allowBundled: [] } };
  await writeFile(join(home, '.openclaw', 'openclaw.json'), JSON.stringify(config));
  await writeFile(join(userData, 'settings.json'), JSON.stringify({ language: 'en', gatewayAutoStart: false }));
}

test.describe('space-bunny Responses acceptance', () => {
  test.setTimeout(720_000);

  test('direct Responses text, SSE and ga_echo round trip', async () => {
    const binding = await candidate();
    const probes = await probeSpaceBunny();
    expect(await candidate()).toEqual(binding);
    await save('direct-probes.json', { candidate: binding, ...probes, status: binding.dirty ? 'preflight-pass' : 'pass' });
  });

  test('cleanup failure still reclaims the owned Electron process and proxy', async ({ homeDir, userDataDir, launchElectronApp }) => {
    await seed(homeDir, userDataDir, join(homeDir, 'cleanup-control-workspace'));
    const binding = await candidate();
    const app = await launchElectronApp({ skipSetup: true, env: { CLAWX_SPACE_BUNNY_API_KEY: '' } });
    const page = await getStableWindow(app);
    await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
    const stopped = await host<Json>(page, 'gateway', 'status');
    expect(stopped.pid).toBeUndefined();
    const proxy = await startSpaceBunnyProxy('CLEANUP_CONTROL');
    const receipt: Json = { actor, driven_by: 'agent', candidate: binding, expectedFailure: 'Gateway has no owned PID before startup' };
    await expect(finishReceipt(receipt, false, app, proxy, 'cleanup-control-expected-failure.json')).rejects.toThrow();
    const readback = JSON.parse(await readFile(join(root, 'cleanup-control-expected-failure.json'), 'utf8'));
    expect(readback.status).toBe('fail');
    expect(readback.electronCleanup.aliveAfterClose).toBe(false);
    expect(readback.cleanup).toEqual({ listening: false, sockets: 0, requests: 0 });
    expect(await candidate()).toEqual(binding);
    await save('cleanup-negative-control.json', { actor, driven_by: 'agent', candidate: binding,
      expectedFailureObserved: true, ownedElectronReclaimed: true, proxyReclaimed: true,
      status: binding.dirty ? 'preflight-pass' : 'pass' });
  });

  for (let repetition = 1; repetition <= 3; repetition += 1) {
    test(`product smoke ${repetition}: real read once, continuation and session isolation`, async ({ homeDir, userDataDir, launchElectronApp }) => {
      const marker = randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase();
      const workspace = join(homeDir, 'responses-workspace');
      await seed(homeDir, userDataDir, workspace);
      await writeFile(join(workspace, 'probe.txt'), marker + '\n');
      const binding = await candidate();
      const proxy = await startSpaceBunnyProxy(marker);
      let app: ElectronApplication | undefined;
      const receipt: Json = { actor, driven_by: 'agent', candidate: binding, repetition, marker,
        fixtureHash: createHash('sha256').update(marker + '\n').digest('hex'), status: 'running' };
      let passed = false;
      try {
        app = await launchElectronApp({ skipSetup: true, env: { CLAWX_SPACE_BUNNY_API_KEY: '' } });
        const page = await getStableWindow(app);
        await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
        receipt.configuration = await prepare(page, proxy, workspace);
        await observeRuntime(page);
        const before = proxy.observations.length;
        await send(page, 'Use the read tool exactly once to read probe.txt. Then reply with only the opaque identifier returned by that tool. Do not use any other tool.');
        await expect.poll(() => proxy.observations.slice(before).some(observation => observation.events
          .some(event => (event.response as Json | undefined)?.text?.toString().includes(marker))), { timeout: 150_000 }).toBe(true);
        await idle(page);
        await expect(page.locator('body')).toContainText(marker);
        const sessionKey = await latestSession(page);
        const first = await waitForFinal(page, sessionKey, marker);
        expect(finalText(first)).toContain(marker);
        const results = (first.messages ?? []).filter(message => message.role === 'toolResult' || message.role === 'tool');
        const readResults = results.filter(message => messageText(message).includes(marker));
        expect(readResults).toHaveLength(1);
        const calls = providerCalls(proxy.observations.slice(before));
        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('read');
        // The transcript can reach final/idle before the gateway flushes its
        // trajectory sidecar. Wait for the complete lifecycle pair so a slow
        // flush is not misreported as a missing tool effect.
        await expect.poll(async () => {
          const rows = await trajectoryTools(userDataDir);
          return rows.filter(row => row.type === 'tool/start' || row.type === 'tool/end').length;
        }, { timeout: 30_000 }).toBe(2);
        const tools = await trajectoryTools(userDataDir);
        expect(tools.filter(row => row.type === 'tool/start')).toHaveLength(1);
        expect(tools.filter(row => row.type === 'tool/end')).toHaveLength(1);
        expect(tools.filter(row => row.type === 'tool/start')[0].toolCallId).toBe(calls[0].call_id);
        expect(tools.filter(row => row.type === 'tool/end')[0].toolCallId).toBe(calls[0].call_id);
        expect(proxy.observations.slice(before).some(observation => observation.inputItems
          .some(item => item.type === 'function_call_output' && JSON.stringify(item).includes(marker)))).toBe(true);
        receipt.firstTurn = { sessionKey, messages: first.messages, readResults: readResults.length,
          providerCalls: calls, trajectoryTools: tools };
        const continuationStart = proxy.observations.length;
        await send(page, 'Without calling any tools, repeat the opaque identifier from your previous tool result exactly.');
        await expect.poll(() => proxy.observations.slice(continuationStart).some(observation => observation.events
          .some(event => (event.response as Json | undefined)?.text?.toString().includes(marker))), { timeout: 150_000 }).toBe(true);
        await idle(page);
        receipt.continuation = await waitForFinal(page, sessionKey, marker, first.messages!.length);
        const continuationMessages = (receipt.continuation as History).messages!.slice(first.messages!.length);
        expect(continuationMessages[0].role).toBe('user');
        expect(continuationMessages.filter(message => message.role === 'assistant' && message.stopReason === 'stop')).toHaveLength(1);
        expect(continuationMessages.at(-1)!.responseId).not.toBe(first.messages!.at(-1)!.responseId);
        expect(providerCalls(proxy.observations.slice(continuationStart))).toHaveLength(0);
        expect(finalText(receipt.continuation as History)).toContain(marker);
        expect(((receipt.continuation as History).messages ?? []).filter(message => (message.role === 'toolResult' || message.role === 'tool')
          && messageText(message).includes(marker))).toHaveLength(1);
        await page.getByTestId('sidebar-new-chat').click();
        const isolatedStart = proxy.observations.length;
        await send(page, 'Without tools, if this conversation has a previous tool result, repeat its opaque identifier. Otherwise reply with exactly NO_PRIOR_TOOL_RESULT.');
        await expect.poll(() => proxy.observations.slice(isolatedStart).some(observation => observation.events
          .some(event => (event.response as Json | undefined)?.text?.toString().includes('NO_PRIOR_TOOL_RESULT'))), { timeout: 150_000 }).toBe(true);
        await idle(page);
        const isolatedSessionKey = await latestSession(page);
        expect(isolatedSessionKey).not.toBe(sessionKey);
        expect(proxy.observations.slice(isolatedStart).every(observation => !observation.fixtureResultInInput)).toBe(true);
        const isolated = await waitForFinal(page, isolatedSessionKey, 'NO_PRIOR_TOOL_RESULT');
        expect(providerCalls(proxy.observations.slice(isolatedStart))).toHaveLength(0);
        expect(finalText(isolated)).toContain('NO_PRIOR_TOOL_RESULT');
        expect((isolated.messages ?? []).some(message => terminalFailure([message]))).toBe(false);
        await expect(page.getByTestId('chat-assistant-avatar').locator('..').last()).toContainText('NO_PRIOR_TOOL_RESULT');
        receipt.isolation = { sessionKey: isolatedSessionKey, history: isolated, previousResultInProviderInput: false };
        expect(await readFile(join(workspace, 'probe.txt'), 'utf8')).toBe(marker + '\n');
        expect(await trajectoryTools(userDataDir)).toEqual(tools);
        receipt.runtimeEvents = await runtimeEvents(page);
        await page.screenshot({ path: join(root, `smoke-${repetition}.png`) });
        passed = true;
      } finally {
        await finishReceipt(receipt, passed, app, proxy, `smoke-${repetition}.json`);
      }
    });
  }

  test('provider faults and cancellation fail visibly, then the next turn recovers', async ({ homeDir, userDataDir, launchElectronApp }) => {
    const workspace = join(homeDir, 'responses-fault-workspace');
    await seed(homeDir, userDataDir, workspace);
    const binding = await candidate();
    const proxy = await startSpaceBunnyProxy('NO_TOOL_EFFECT_EXPECTED');
    const receipt: Json = { actor, driven_by: 'agent', candidate: binding, cases: [], status: 'running' };
    let app: ElectronApplication | undefined;
    let passed = false;
    try {
      app = await launchElectronApp({ skipSetup: true, env: { CLAWX_SPACE_BUNNY_API_KEY: '' } });
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
      await prepare(page, proxy, workspace);
      await observeRuntime(page);
      for (const type of ['timeout', 'cancel', '401', '404', '429', '500', '504', 'malformed', 'drop'] as ResponsesFault[]) {
        await page.getByTestId('sidebar-new-chat').click();
        const marker = `FAULT_${type}_${randomUUID().slice(0, 8)}`;
        const start = proxy.observations.length;
        const eventStart = (await runtimeEvents(page)).length;
        const began = Date.now();
        proxy.inject(type, marker);
        await send(page, `Probe ${marker}: use no tools and reply with exactly SHOULD_NOT_COMPLETE.`);
        await expect.poll(() => proxy.observations.slice(start).length, { timeout: 60_000 }).toBeGreaterThan(0);
        if (type === 'cancel') {
          const primary = page.getByTestId('chat-composer-send');
          await expect(primary).toHaveAttribute('data-send-state', 'running');
          await primary.click();
          await expect(primary).toHaveAttribute('data-send-state', 'paused');
        }
        if (type !== 'cancel') await idle(page, 180_000);
        const sessionKey = await latestSession(page);
        await expect.poll(() => runtimeFailed(page, sessionKey, eventStart), { timeout: 90_000 }).toBe(true);
        const failed = await history(page, sessionKey);
        expect((failed.messages ?? []).filter(message => message.role === 'assistant' && message.stopReason === 'stop')
          .some(message => messageText(message).includes('SHOULD_NOT_COMPLETE'))).toBe(false);
        let faultRequests = proxy.observations.slice(start).filter(observation => observation.fault === type);
        if (type === 'timeout') {
          expect(faultRequests.every(observation => observation.httpStatus === 200)).toBe(true);
          expect(faultRequests.some(observation => observation.aborted)).toBe(true);
          expect(faultRequests.every(observation => !observation.safetyCutoff)).toBe(true);
          const timeoutErrors = (failed.messages ?? []).filter(message => message.role === 'assistant' && message.stopReason === 'error')
            .map(message => String(message.errorMessage ?? '')).join('\n');
          expect(timeoutErrors).toMatch(/request timed out|idle timeout|request timeout/i);
        }
        // Keep the injected fault active until every bounded retry has settled.
        // Clearing on the first visible error races the runner's final retry.
        const settlement = await waitForFaultRetriesToSettle(proxy, start, type);
        expect(settlement.settled).toBe(true);
        expect(settlement.requests).toBeLessThanOrEqual(12);
        faultRequests = proxy.observations.slice(start).filter(observation => observation.fault === type);
        expect(faultRequests).toHaveLength(settlement.requests);
        expect(faultRequests.every(observation => !observation.events.some(event => event.type === 'response.completed'))).toBe(true);
        expect(providerCalls(faultRequests)).toHaveLength(0);
        expect(await trajectoryTools(userDataDir)).toHaveLength(0);
        const settledFailure = await history(page, sessionKey);
        expect((settledFailure.messages ?? []).filter(message => message.role === 'assistant' && message.stopReason === 'stop')
          .some(message => messageText(message).includes('SHOULD_NOT_COMPLETE'))).toBe(false);
        if (type === 'cancel') {
          await expect.poll(() => proxy.activeRequests(), { timeout: 30_000 }).toBe(0);
          expect(faultRequests.some(observation => observation.aborted)).toBe(true);
        }
        proxy.clearFault();
        const lateMarker = `LATE_${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
        let lateDelivery: Json | undefined;
        if (type === 'cancel') {
          const aborted = (await runtimeEvents(page)).slice(eventStart).flatMap(event => (event.args as Json[] ?? [])
            .map(value => (value.message as Json | undefined) ?? value))
            .find(value => value.sessionKey === sessionKey && value.state === 'aborted');
          expect(aborted?.runId).toBeTruthy();
          lateDelivery = await replayLateCancelledEvents(app, sessionKey, String(aborted!.runId), lateMarker);
          await expect(page.locator('body')).not.toContainText(lateMarker);
        }
        await page.getByTestId('sidebar-new-chat').click();
        const recoveryStart = proxy.observations.length;
        const recovered = `RECOVER_${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
        await send(page, `Without tools, copy this opaque identifier exactly: ${recovered}`);
        if (lateDelivery) {
          lateDelivery.recoveryFrames = await replayLateCancelledEvents(app, sessionKey, String((lateDelivery.frames as Json[])[0].runId), lateMarker, 10000);
        }
        await expect.poll(() => proxy.observations.slice(recoveryStart).some(observation => observation.events
          .some(event => (event.response as Json | undefined)?.text?.toString().includes(recovered))), { timeout: 120_000 }).toBe(true);
        await idle(page);
        await expect(page.getByTestId('chat-assistant-avatar').locator('..').last()).toContainText(recovered);
        const recoveryHistory = await waitForFinal(page, await latestSession(page), recovered);
        expect(finalText(recoveryHistory)).toContain(recovered);
        expect(providerCalls(proxy.observations.slice(recoveryStart))).toHaveLength(0);
        expect(await trajectoryTools(userDataDir)).toHaveLength(0);
        const cancelledAfterRecovery = await history(page, sessionKey);
        expect(JSON.stringify(cancelledAfterRecovery)).not.toContain(lateMarker);
        await expect(page.locator('body')).not.toContainText(lateMarker);
        expect(await readdir(workspace)).not.toContain('late-effect.txt');
        expect(proxy.observations.slice(recoveryStart).every(observation => !JSON.stringify(observation.inputItems).includes(lateMarker))).toBe(true);
        (receipt.cases as Json[]).push({ type, marker, sessionKey, faultRequests: faultRequests.length,
          elapsedMs: Date.now() - began, failed: settledFailure, settlement, runtimeEvents: (await runtimeEvents(page)).slice(eventStart),
          lateDelivery, cancelledAfterRecovery, lateEffectExists: false,
          recovery: await history(page, await latestSession(page)), status: 'pass', runtimeProbe: {
            faultRequests: faultRequests.length,
            settled: settlement.settled,
            responseCompleted: faultRequests.some(observation => observation.events.some(event => event.type === 'response.completed')),
            providerCalls: providerCalls(faultRequests).length,
            trajectoryTools: (await trajectoryTools(userDataDir)).length,
            activeRequests: proxy.activeRequests(),
          } });
      }
      passed = true;
    } finally {
      await finishReceipt(receipt, passed, app, proxy, 'faults.json');
    }
  });
});
