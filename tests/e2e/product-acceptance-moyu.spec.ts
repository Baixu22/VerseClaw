import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { allocatePort, hostInvoke, startScriptedLlm, type LlmRequestLog } from './fixtures/fp-p1-harness';
import { createMoyuSnapshot, git, gitState, MOYU_ALLOWED_PATH, MOYU_ORACLE_PATH, MOYU_PYTHON, moyuOpenClawEnv, runMoyuChecks, sha256 } from './fixtures/moyu-acceptance';
import { readSpaceBunnyResource, redactSpaceBunny, startSpaceBunnyProxy } from './fixtures/space-bunny-responses';

type Json = Record<string, unknown>;
type History = { messages?: Json[] };
type Snapshot = Awaited<ReturnType<typeof createMoyuSnapshot>>;
const SESSION = 'agent:main:main';
const actor = 'codex-tf0581-moyu';
const replacement = [
  '    cursor = db.cursor()', '    cursor.execute(',
  '        "INSERT INTO yonghu (username, email, status, created_time, updated_time) VALUES (?, ?, ?, ?, ?)",',
  '        (username, email, status, created_time, created_time),', '    )',
].join('\n');

function text(message: Json): string {
  if (typeof message.content === 'string') return message.content;
  return (Array.isArray(message.content) ? message.content : []).map(part => String((part as Json).text ?? '')).join('\n');
}

function alive(pid?: number): boolean {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function history(app: ElectronApplication, sessionKey: string): Promise<History> {
  return hostInvoke<History>(app, 'gateway', 'rpc', { method: 'chat.history', params: { sessionKey, limit: 200, maxChars: 500_000 }, timeoutMs: 30_000 });
}

async function activeSession(app: ElectronApplication): Promise<string> {
  const active = await hostInvoke<{ activeWorkspace?: { activeSessionKey?: string } }>(app, 'workspaces', 'getActive');
  return active.activeWorkspace?.activeSessionKey ?? SESSION;
}


async function send(page: Page, message: string) {
  await expect(page.getByTestId('chat-composer-input')).toBeEnabled({ timeout: 60_000 });
  await page.getByTestId('chat-composer-input').fill(message);
  await page.getByTestId('chat-composer-send').click();
}

async function final(
  app: ElectronApplication,
  page: Page,
  sessionKey: string,
  marker: string,
  after = 0,
  options: { autoApprove?: boolean; onApproval?: () => void; timeoutMs?: number } = {},
): Promise<History> {
  let result: History = {};
  await expect.poll(async () => {
    result = await history(app, sessionKey);

    const completed = (result.messages ?? []).slice(after)
      .filter(message => message.role === 'assistant' && message.stopReason === 'stop')
      .map(text).join('\n');
    if (completed.includes(marker) || !options.autoApprove) return completed;

    // acceptEdits surfaces on-miss exec approvals through the real product
    // dialog. Answer only the decision the runtime itself offered, and keep
    // polling the same turn until the product reaches a finished reply.
    const prompt = page.getByTestId('runtime-approval-prompt');
    if (await prompt.isVisible().catch(() => false)) {
      const allowOnce = page.getByTestId('runtime-approval-allow-once');
      if (await allowOnce.isVisible().catch(() => false)) {
        await allowOnce.click();
        options.onApproval?.();
      }
    }
    return completed;
  }, { timeout: options.timeoutMs ?? 240_000 }).toContain(marker);
  await expect(page.getByTestId('chat-composer-send')).toHaveAttribute('data-send-state', /^(idle|ready|empty)/, { timeout: 30_000 });
  await expect(page.locator('body')).toContainText(marker);
  return result;
}

async function openProduct(
  launch: (options: { skipSetup: boolean; env: Record<string, string> }) => Promise<ElectronApplication>,
  homeDir: string, userDataDir: string, snapshot: Snapshot,
  provider: { baseUrl: string; model: string; key: string; protocol: 'openai-responses' | 'openai-completions' },
  permissionMode: 'acceptEdits' | 'readOnly' = 'acceptEdits',
  execAsk: 'off' | 'always' = 'off',
) {
  const config = {
    gateway: { mode: 'local', controlUi: { enabled: false } },
    // Multi-tool acceptance turns legitimately exceed the 120s default. Keep
    // the provider ceiling explicit as well; the E2E deadline remains the hard
    // upper bound.
    agents: { defaults: { workspace: snapshot.snapshotProject, skipBootstrap: true, timeoutSeconds: 900 }, list: [{ id: 'main', default: true }] },
    tools: { profile: 'full', exec: { host: 'gateway', security: 'full', ask: execAsk } },
    runtime: { coding: { staleWriteGuard: { enabled: true }, autoVerify: { enabled: false } } },
    skills: { allowBundled: [] },
  };
  await writeFile(join(homeDir, '.openclaw', 'openclaw.json'), JSON.stringify(config));
  await writeFile(join(userDataDir, 'settings.json'), JSON.stringify({ language: 'en', gatewayAutoStart: false }));
  const app = await launch({ skipSetup: true, env: { ...moyuOpenClawEnv(homeDir), PYTHONPATH: snapshot.snapshotProject, PYTHONDONTWRITEBYTECODE: '1', CLAWX_SPACE_BUNNY_API_KEY: '' } });
  try {
    const page = await getStableWindow(app);
    await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
    const now = new Date().toISOString();
    const account = {
      id: 'custom-moyucode', vendorId: 'custom', label: 'Moyu Acceptance', authMode: 'api_key', apiProtocol: provider.protocol,
      baseUrl: provider.baseUrl, model: provider.model, modelProfile: { contextWindow: 128_000, maxTokens: 4096, supportsVision: false },
      metadata: { validation: { status: 'valid', checkedAt: now, model: provider.model, source: 'settings' } },
      enabled: true, isDefault: true, createdAt: now, updatedAt: now,
    };
    expect(await hostInvoke<Json>(app, 'providers', 'createAccount', { account, apiKey: provider.key })).toMatchObject({ success: true });
    expect(await hostInvoke<Json>(app, 'providers', 'validateKey', { accountId: account.id })).toMatchObject({ valid: true });
    expect(await hostInvoke<Json>(app, 'providers', 'setDefaultAccount', { accountId: account.id })).toMatchObject({ success: true });
    expect(await hostInvoke<Json>(app, 'agents', 'updateModel', { id: 'main', modelRef: account.id + '/' + provider.model })).toMatchObject({ success: true });
    const created = await hostInvoke<{ success?: boolean; profiles?: Json[] }>(app, 'workspaces', 'create', {
      rootPath: snapshot.snapshotProject, name: 'Moyu Acceptance', agentId: 'main', activeSessionKey: SESSION, permissionMode,
    });
    expect(created.success).toBe(true);
    const profile = created.profiles?.find(entry => entry.rootPath === snapshot.snapshotProject);
    expect(profile).toBeTruthy();
    expect(await hostInvoke<Json>(app, 'workspaces', 'switch', { id: profile!.id })).toMatchObject({ success: true });
    const port = await allocatePort();
    await hostInvoke(app, 'settings', 'set', { key: 'gatewayPort', value: port });
    await hostInvoke(app, 'gateway', 'start');
    await expect.poll(async () => (await hostInvoke<Json>(app, 'gateway', 'status')).state, { timeout: 120_000 }).toBe('running');
    const status = await hostInvoke<{ pid?: number }>(app, 'gateway', 'status');
    await page.reload();
    await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
    return { app, page, port, pid: status.pid, profileId: profile!.id };
  } catch (error) { await closeElectronApp(app); throw error; }
}

async function journal(snapshot: Snapshot) {
  const root = join(snapshot.snapshotProject, '.openclaw', 'journal');
  const files: string[] = [];
  for (const session of await readdir(root).catch(() => [])) {
    for (const file of await readdir(join(root, session))) if (file.endsWith('.meta.json') || file.endsWith('.pre')) files.push(join(root, session, file));
  }
  return files.sort();
}

function has(results: Record<string, string>, id: string, requestIndex?: number) {
  return (requestIndex === undefined || requestIndex > 0) &&
    Object.keys(results).some(key => key.startsWith(id.replace(/[^a-zA-Z0-9]/g, '')));
}

function outcome(log: LlmRequestLog[], id: string): string {
  const wanted = id.replace(/[^a-zA-Z0-9]/g, '');
  return log.flatMap(entry => Object.entries(entry.toolResults)).find(([key]) => key.startsWith(wanted))?.[1] ?? '';
}

async function finish(root: string, snapshot: Snapshot, receipt: Json, app?: ElectronApplication, gatewayPid?: number) {
  let failure: unknown;
  const appPid = app?.process().pid;
  try {
    if (app) await closeElectronApp(app);
    await expect.poll(() => alive(appPid) || alive(gatewayPid), { timeout: 20_000 }).toBe(false);
    await snapshot.verifyOriginalUnchanged();
    receipt.originalUnchanged = true;
    receipt.cleanup = { electronStopped: !alive(appPid), gatewayStopped: !alive(gatewayPid) };
  } catch (error) { receipt.status = 'fail'; receipt.cleanupError = String(error); failure = error; }
  if (receipt.status === 'pass' && (receipt.candidate as Json).dirty === true) receipt.status = 'preflight-pass';
  await writeFile(join(root, 'receipt.json'), redactSpaceBunny(JSON.stringify(receipt, null, 2)) + '\n');
  await snapshot.cleanup();
  if (failure) throw failure;
}

async function begin(name: string) {
  const root = join(process.env.CLAWX_MOYU_ARTIFACT_ROOT ?? 'D:/tmp/clawx-product-acceptance/b2-moyu', name + '-' + Date.now());
  await mkdir(root, { recursive: true });
  const snapshot = await createMoyuSnapshot(root, name);
  const receipt: Json = {
    driven_by: 'agent', actor, scenario: name, candidate: gitState(process.cwd()), targetProject: snapshot.originalGit,
    baselineCommit: snapshot.baselineCommit, baselineHashes: snapshot.baselineHashes, originalHashes: snapshot.originalHashes,
    oracleHash: snapshot.oracleHash, baseline: { projectTests: snapshot.projectTestsBefore, oracle: snapshot.pytestBefore, acceptance: snapshot.acceptanceBefore }, status: 'running',
  };
  if (process.env.CLAWX_MOYU_PREFLIGHT !== '1') assert.equal((receipt.candidate as Json).dirty, false, 'Final acceptance needs a clean source candidate');
  return { root, snapshot, receipt };
}

test.describe('TF-0581 real moyu product acceptance', () => {
  test.setTimeout(720_000);
  for (let repetition = 1; repetition <= 3; repetition++) {
    test('live journey ' + repetition + ': cancel, fix, tests, restart readback and undo', async ({ homeDir, userDataDir, launchElectronApp }) => {
      const { root, snapshot, receipt } = await begin('live-' + repetition);
      const proxy = await startSpaceBunnyProxy('MOYU_' + repetition);
      const progressTimer = setInterval(() => {
        void writeFile(join(root, 'provider-progress.json'), redactSpaceBunny(JSON.stringify(proxy.observations, null, 2))).catch(() => undefined);
      }, 3000).unref();
      const resource = readSpaceBunnyResource();
      let opened: Awaited<ReturnType<typeof openProduct>> | undefined;
      const marker = 'MOYU_VERIFIED_' + repetition + '_' + Date.now();
      const cancelMarker = 'MOYU_CANCEL_' + repetition + '_' + Date.now();
      try {
        opened = await openProduct(launchElectronApp, homeDir, userDataDir, snapshot, { baseUrl: proxy.baseUrl, model: resource.model, key: proxy.proxyToken, protocol: 'openai-responses' });
        const { app, page } = opened;
        const initialSessionKey = await activeSession(app);
        proxy.inject('cancel', cancelMarker);
        await send(page, cancelMarker + ': inspect the project, but do not edit anything. Do not start shell commands; only use read.');
        await expect.poll(() => proxy.observations.some(entry => entry.fault === 'cancel'), { timeout: 30_000 }).toBe(true);
        // A non-terminal upstream stream is a fail-closed control. Wait for
        // the composer to enter a terminal state before deciding whether the
        // explicit Stop affordance is still required.
        await expect(page.getByTestId('chat-composer-send')).toHaveAttribute(
          'data-send-state', /^(paused|idle|ready|empty)$/, { timeout: 30_000 });
        const paused = page.getByTestId('chat-composer-send');
        if (await paused.isEnabled()) {
          await paused.click();
        } else {
          await hostInvoke(opened.app, 'gateway', 'rpc', {
            method: 'chat.abort', params: { sessionKey: SESSION }, timeoutMs: 30_000,
          });
        }
        await expect.poll(() => proxy.observations.filter(entry => entry.fault === 'cancel').every(entry => !entry.safetyCutoff), { timeout: 30_000 }).toBe(true);
        await expect(page.getByTestId('chat-composer-send')).toHaveAttribute('data-send-state', /^(paused|idle|ready|empty)$/, { timeout: 30_000 });
        await snapshot.verifyAllowedChanges([]);
        expect(await journal(snapshot)).toEqual([]);
        await expect.poll(async () => ((await history(app, initialSessionKey)).messages ?? []).some(message => message.role === 'assistant' && ['aborted', 'error'].includes(String(message.stopReason))), { timeout: 30_000 }).toBe(true);
        const cancelled = await history(app, initialSessionKey);
        expect((cancelled.messages ?? []).filter(message => message.role === 'assistant' && message.stopReason === 'stop')).toEqual([]);
        receipt.cancel = cancelled;
        proxy.clearFault();
        const pendingAfterCancel = (await history(app, SESSION)).messages ?? [];
        expect(pendingAfterCancel.filter(message => message.role === 'user').map(text).join('\n')).toContain(cancelMarker);
        expect(pendingAfterCancel.filter(message =>
          message.role === 'assistant' && ['error', 'aborted'].includes(String(message.stopReason)))).toHaveLength(1);
        const abortedRun = [...(await history(app, SESSION)).messages ?? []].find(message =>
          message.role === 'assistant' && ['error', 'aborted'].includes(String(message.stopReason)));
        expect(abortedRun).toBeTruthy();
        // Assert the live session is reusable before branching: the new-chat
        // button must switch to a fresh session, not inherit the failed one.
        await expect(page.getByTestId('chat-composer-input')).toBeEnabled({ timeout: 30_000 });
        await page.getByTestId('sidebar-new-chat').click();
        const workSessionKey = await activeSession(app);
        const python = '& "' + MOYU_PYTHON + '"';
        await send(page, [
          'Fix the frozen apostrophe username CRUD regression in this disposable Python project.',
          'Workspace: ' + snapshot.snapshotProject + '. Only modify user_router.py; all tests and other source files are frozen.',
          'Use the real read tool to inspect ' + MOYU_ORACLE_PATH + ' and user_router.py, reproduce the failing oracle, then make one minimal edit.',
          'Use exec (not bash) with the absolute workdir above (its shell is already non-interactive PowerShell) and these commands: ' +
          python + ' -m pytest ' + MOYU_ORACLE_PATH + ' -q; ' +
          python + ' -m pytest tests/acceptance -q; ' +
          python + ' -m acceptance run --mode offline --seed 20260908 --output acceptance-after.',
          'The unrelated create_invalid_user defect is the known baseline of 19 passed / 1 failed / 0 errors; preserve that finding. Do not change a test or the Git baseline.',
          'After executing the checks, report the actual test outcomes and end the final answer with ' + marker + '.',
        ].join('\n'));
        let approvals = 0;
        const transcript = await final(app, page, workSessionKey, marker, 0, {
          autoApprove: true,
          onApproval: () => { approvals += 1; },
          timeoutMs: 600_000,
        });
        const checks = await runMoyuChecks(snapshot);
        await snapshot.verifyAllowedChanges([MOYU_ALLOWED_PATH]);
        assert.equal(checks.projectTests.exitCode, 0, checks.projectTests.stdout);
        assert.equal(checks.pytest.exitCode, 0, checks.pytest.stdout);
        assert.equal(checks.acceptance.exitCode, 1);
        assert.match(checks.acceptance.stdout, /19 passed, 1 failed, 0 errors/);
        const changed = await snapshot.verifyAllowedChanges([MOYU_ALLOWED_PATH]);
        const calls = (transcript.messages ?? []).flatMap(message => Array.isArray(message.content) ? message.content : []).filter(part => (part as Json).type === 'toolCall') as Json[];
        // Gateway display projection may drop an intermediate assistant message
        // while retaining its real toolResult. Use real calls when present and
        // fall back to the toolResult's own toolName for this inventory only.
        expect(calls.length + (transcript.messages ?? []).filter(message => message.role === 'toolResult').length).toBeGreaterThanOrEqual(4);
        const toolNames = new Set([
          ...calls.map(call => String(call.name ?? '')),
          ...(transcript.messages ?? []).filter(message => message.role === 'toolResult')
            .map(message => String(message.toolName ?? '')),
        ]);
        expect(toolNames.has('read')).toBe(true);
        expect(toolNames.has('edit')).toBe(true);
        expect(toolNames.has('bash') || toolNames.has('exec')).toBe(true);
        // The frozen oracle must have been observed through a read result even
        // when an earlier summary/generation dropped the corresponding call from
        // the persisted toolCall list.
        const readResults = (transcript.messages ?? [])
          .filter(message => message.role === 'toolResult' && message.toolName === 'read')
          .map(text).join('\n');
        expect(readResults).toContain('test_apostrophe_username_round_trip');
        const snapshots = await journal(snapshot);
        expect(snapshots.filter(path => path.endsWith('.pre'))).toHaveLength(1);
        await expect(page.getByTestId('chat-mutation-code-diff').first()).toBeVisible();
        const fixSessionKey = workSessionKey;
        receipt.fix = { checks, changed, transcript, diff: git(snapshot.snapshotRoot, ['diff']), journalFiles: snapshots, calls, sessionKey: fixSessionKey,
          approvals: { count: approvals, driven_by: 'agent', actor } };
        await page.screenshot({ path: join(root, 'fixed.png') });
        await page.reload();
        await expect(page.getByTestId('main-layout')).toBeVisible();
        expect(JSON.stringify(await history(app, fixSessionKey))).toContain(marker);
        await expect(page.locator('body')).toContainText(marker);
        const undoMarker = 'MOYU_UNDONE_' + repetition + '_' + Date.now();
        const undoBase = (await history(app, fixSessionKey)).messages?.length ?? 0;
        await send(page, 'Use undo_write with steps=1 to undo the last edit. Report its actual result and end with ' + undoMarker + '.');
        let undoApprovals = 0;
        const undone = await final(app, page, fixSessionKey, undoMarker, undoBase, {
          autoApprove: true,
          onApproval: () => { undoApprovals += 1; },
        });
        const undoResults = (undone.messages ?? []).filter(message => message.role === 'toolResult' && message.toolName === 'undo_write').map(text);
        expect(undoResults.join('\n').replace(/\s/g, '')).toContain('"ok":true');
        await snapshot.verifyRestored();
        await snapshot.verifyAllowedChanges([]);
        receipt.undo = { transcript: undone, restored: true, journal: await journal(snapshot),
          approvals: { count: undoApprovals, driven_by: 'agent', actor } };
        receipt.taskSuccess = true; receipt.trajectorySafety = true; receipt.status = 'pass';
      } catch (error) {
        receipt.status = 'fail'; receipt.error = String(error);
        receipt.transcript = opened ? await history(opened.app, await activeSession(opened.app)).catch(cause => ({ error: String(cause) })) : null;
        throw error;
      } finally {
        clearInterval(progressTimer);
        receipt.provider = proxy.observations; receipt.proxyCleanup = await proxy.close();
        await finish(root, snapshot, receipt, opened?.app, opened?.pid);
      }
    });
  }

  test('readOnly policy denies a real edit without approval or file effect', async ({ homeDir, userDataDir, launchElectronApp }) => {
    const { root, snapshot, receipt } = await begin('readonly');
    const llm = await startScriptedLlm((_user, results, requestIndex) => requestIndex > 0 || has(results, 'readonly-edit')
      ? { text: 'MOYU_READONLY_DONE' }
      : { toolCall: { id: 'readonly-edit', name: 'edit', args: { path: MOYU_ALLOWED_PATH, edits: [{ oldText: snapshot.routerBlock, newText: replacement }] } } });
    let opened: Awaited<ReturnType<typeof openProduct>> | undefined;
    try {
      opened = await openProduct(launchElectronApp, homeDir, userDataDir, snapshot, { baseUrl: 'http://127.0.0.1:' + llm.port + '/v1', model: 'mock-coder', key: 'test-key-ok', protocol: 'openai-completions' }, 'readOnly');
      await send(opened.page, 'Attempt one edit under the active readOnly policy, then report the result.');
      const readonlySessionKey = await activeSession(opened.app);
      const readonlyTranscript = await final(opened.app, opened.page, readonlySessionKey, 'MOYU_READONLY_DONE');
      receipt.transcript = readonlyTranscript;
      const toolResult = (readonlyTranscript.messages ?? []).find(message =>
        message.role === 'toolResult' && message.toolName === 'edit');
      const result = outcome(llm.log, 'readonly-edit') || (toolResult ? text(toolResult) : '');
      expect(result).toMatch(/denied|read.?only|not allowed|not found|plan mode|权限|只读/i);
      expect(result).not.toMatch(/Successfully replaced/);
      expect(await hostInvoke<Json>(opened.app, 'runtimeApprovals', 'list')).toMatchObject({ pending: [] });
      await snapshot.verifyAllowedChanges([]); expect(await journal(snapshot)).toEqual([]);
      receipt.result = result; receipt.noApproval = true; receipt.noEffect = true; receipt.status = 'pass';
    } catch (error) { receipt.status = 'fail'; receipt.error = String(error); throw error; }
    finally {
      receipt.modelDriver = 'scripted-negative-control'; receipt.provider = llm.log;
      llm.server.closeAllConnections(); await new Promise<void>(resolve => llm.server.close(() => resolve()));
      await finish(root, snapshot, receipt, opened?.app, opened?.pid);
    }
  });

  test('the UI denies an actual outside-root exec approval and the next allowed edit succeeds', async ({ homeDir, userDataDir, launchElectronApp }) => {
    const { root, snapshot, receipt } = await begin('outside-approval');
    const llm = await startScriptedLlm((user, results, requestIndex) => {
      if (user.lastIndexOf('ALLOWED-EDIT') > user.lastIndexOf('OUTSIDE-WRITE')) return has(results, 'allowed-edit')
        ? { text: 'MOYU_ALLOWED_DONE' }
        : { toolCall: { id: 'allowed-edit', name: 'edit', args: { path: MOYU_ALLOWED_PATH, edits: [{ oldText: snapshot.routerBlock, newText: replacement }] } } };
      return has(results, 'outside-write', requestIndex) ? { text: 'MOYU_OUTSIDE_DONE' }
        : { toolCall: { id: 'outside-write', name: 'bash', args: { command: 'Set-Content -LiteralPath "' + snapshot.sentinel + '" -Value tampered', workdir: snapshot.snapshotProject, timeout: 60 } } };
    });
    let opened: Awaited<ReturnType<typeof openProduct>> | undefined;
    try {
      opened = await openProduct(launchElectronApp, homeDir, userDataDir, snapshot, { baseUrl: 'http://127.0.0.1:' + llm.port + '/v1', model: 'mock-coder', key: 'test-key-ok', protocol: 'openai-completions' }, 'acceptEdits', 'always');
      await send(opened.page, 'OUTSIDE-WRITE: request the outside-sentinel write once.');
      await expect(opened.page.getByTestId('runtime-approval-prompt')).toBeVisible({ timeout: 90_000 });
      const pending = await hostInvoke<Json>(opened.app, 'runtimeApprovals', 'list');
      expect((pending.pending as Json[]).length).toBeGreaterThan(0);
      await opened.page.getByTestId('runtime-approval-deny').click();
      const negativeSessionKey = await activeSession(opened.app);
      const denied = await final(opened.app, opened.page, negativeSessionKey, 'MOYU_OUTSIDE_DONE');
      const result = outcome(llm.log, 'outside-write');
      expect(result).toMatch(/denied|rejected|not approved|拒绝/i);
      await snapshot.verifyAllowedChanges([]);
      expect(sha256(await readFile(snapshot.sentinel))).toBe(snapshot.sentinelHash);
      await send(opened.page, 'ALLOWED-EDIT: apply one allowed edit and stop.');
      receipt.transcript = await final(opened.app, opened.page, negativeSessionKey, 'MOYU_ALLOWED_DONE', denied.messages?.length ?? 0);
      expect(outcome(llm.log, 'allowed-edit')).toContain('Successfully replaced');
      await snapshot.verifyAllowedChanges([MOYU_ALLOWED_PATH]);
      receipt.approval = { pending, result, decision: 'deny', driven_by: 'agent' };
      receipt.noOutsideEffect = true; receipt.allowedContinuation = true; receipt.status = 'pass';
    } catch (error) { receipt.status = 'fail'; receipt.error = String(error); throw error; }
    finally {
      receipt.modelDriver = 'scripted-negative-control'; receipt.provider = llm.log;
      llm.server.closeAllConnections(); await new Promise<void>(resolve => llm.server.close(() => resolve()));
      await finish(root, snapshot, receipt, opened?.app, opened?.pid);
    }
  });

  test('missing journal snapshot rejects undo and preserves the full edited file and metadata', async ({ homeDir, userDataDir, launchElectronApp }) => {
    const { root, snapshot, receipt } = await begin('missing-journal');
    const llm = await startScriptedLlm((user, results) => {
      if (user.lastIndexOf('UNDO-MISSING') > user.lastIndexOf('FIX-MISSING')) return has(results, 'missing-undo')
        ? { text: 'MOYU_MISSING_UNDO_DONE' } : { toolCall: { id: 'missing-undo', name: 'undo_write', args: { steps: 1 } } };
      return has(results, 'missing-edit') ? { text: 'MOYU_MISSING_EDIT_DONE' }
        : { toolCall: { id: 'missing-edit', name: 'edit', args: { path: MOYU_ALLOWED_PATH, edits: [{ oldText: snapshot.routerBlock, newText: replacement }] } } };
    });
    let opened: Awaited<ReturnType<typeof openProduct>> | undefined;
    try {
      opened = await openProduct(launchElectronApp, homeDir, userDataDir, snapshot, { baseUrl: 'http://127.0.0.1:' + llm.port + '/v1', model: 'mock-coder', key: 'test-key-ok', protocol: 'openai-completions' });
      await send(opened.page, 'FIX-MISSING: edit user_router.py once, then stop.');
      const missingSessionKey = await activeSession(opened.app);
      await final(opened.app, opened.page, missingSessionKey, 'MOYU_MISSING_EDIT_DONE');
      const editedHash = sha256(await readFile(join(snapshot.snapshotProject, MOYU_ALLOWED_PATH)));
      await snapshot.verifyAllowedChanges([MOYU_ALLOWED_PATH]);
      const files = await journal(snapshot);
      const pre = files.find(path => path.endsWith('.pre')); const meta = files.find(path => path.endsWith('.meta.json'));
      expect(pre).toBeTruthy(); expect(meta).toBeTruthy();
      const metaHash = sha256(await readFile(meta!)); await unlink(pre!);
      await send(opened.page, 'UNDO-MISSING: call undo_write now and report its actual failure.');
      receipt.transcript = await final(opened.app, opened.page, missingSessionKey, 'MOYU_MISSING_UNDO_DONE');
      const result = outcome(llm.log, 'missing-undo');
      expect(result.replace(/\s/g, '')).toContain('"ok":false'); expect(result).toContain('journalDir');
      expect(sha256(await readFile(join(snapshot.snapshotProject, MOYU_ALLOWED_PATH)))).toBe(editedHash);
      expect(sha256(await readFile(meta!))).toBe(metaHash);
      receipt.result = result; receipt.editedHash = editedHash; receipt.metaHash = metaHash; receipt.notHalfRestored = true; receipt.status = 'pass';
    } catch (error) { receipt.status = 'fail'; receipt.error = String(error); throw error; }
    finally {
      receipt.modelDriver = 'scripted-negative-control'; receipt.provider = llm.log;
      llm.server.closeAllConnections(); await new Promise<void>(resolve => llm.server.close(() => resolve()));
      await finish(root, snapshot, receipt, opened?.app, opened?.pid);
    }
  });
});

















































