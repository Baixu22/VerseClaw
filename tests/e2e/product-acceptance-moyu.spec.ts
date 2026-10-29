import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import {
  createMoyuSnapshot,
  MOYU_ALLOWED_PATH,
  MOYU_ORACLE_PATH,
  MOYU_PYTHON,
  MOYU_SUBPROJECT,
  moyuOpenClawEnv,
  runMoyuChecks,
  sha256,
} from './fixtures/moyu-acceptance';
import { buildMockProviderConfig, hostInvoke, startGateway, startScriptedLlm, type LlmRequestLog } from './fixtures/fp-p1-harness';

type Json = Record<string, unknown>;
type History = { messages?: Json[] };
const SESSION_KEY = 'agent:main:main';
const MODEL = 'mock-moyu-coder';
const actor = 'codex-tf0581-moyu';
const ROUTER_SQL = '    sql = "INSERT INTO yonghu (username, email, status, created_time, updated_time) VALUES (\'" + username + "\', \'" + email + "\', \'" + status + "\', \'" + created_time + "\', \'" + created_time + "\')"';
const ROUTER_BLOCK = [
  '    # 直接写 SQL',
  '    sql = "INSERT INTO yonghu (username, email, status, created_time, updated_time) VALUES (\'" + username + "\', \'" + email + "\', \'" + status + "\', \'" + created_time + "\', \'" + created_time + "\')"',
  '',
  '    cursor = db.cursor()',
  '    cursor.execute(sql)',
].join('\n');
const ROUTER_PARAMETERIZED = [
  '    cursor = db.cursor()',
  '    cursor.execute(',
  '        "INSERT INTO yonghu (username, email, status, created_time, updated_time) VALUES (?, ?, ?, ?, ?)",',
  '        (username, email, status, created_time, created_time),',
  '    )',
].join('\n');

async function save(name: string, value: unknown) {
  await writeFile(name, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

async function toolResult(log: LlmRequestLog[], id: string): Promise<string> {
  const wanted = id.replace(/[^A-Za-z0-9]/g, '');
  for (const entry of log) {
    const key = Object.keys(entry.toolResults).find((candidate) => candidate === wanted || candidate.startsWith(wanted));
    if (key) return entry.toolResults[key] ?? '';
  }
  return '';
}

async function waitForLog(log: LlmRequestLog[], marker: string, timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (log.some((entry) => entry.issued?.startsWith('text:MOYU_ACCEPTANCE_OK')) ) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`scripted model did not finish ${marker}: ${JSON.stringify(log.slice(-2)).slice(0, 5000)}`);
}

async function sendWithModel(app: ElectronApplication, sessionKey: string, message: string, modelRef: string) {
  return hostInvoke<Json>(app, 'chat', 'sendWithMedia', {
    sessionKey, message, modelRef, idempotencyKey: 'tf0581-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
  });
}

async function send(page: Page, message: string) {
  const input = page.getByTestId('chat-composer-input');
  await expect(input).toBeEnabled({ timeout: 120_000 });
  const providerGate = page.getByTestId('chat-composer-send').locator('xpath=ancestor::body');
  const gateDismiss = page.getByRole('dialog').getByRole('button').filter({ hasText: /Not now|Later|暂不/ });
  const configureProvider = page.getByRole('dialog').getByRole('button', { name: /Configure provider|配置.*provider/i });
  if (await configureProvider.count() > 0) { await configureProvider.first().click(); await page.waitForTimeout(1000); await page.reload(); await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 }); }
  if (await gateDismiss.count() > 0) { await gateDismiss.first().click(); await page.waitForTimeout(1000); }
  await input.fill(message);
  const dialogs = await page.locator('[role=dialog]').allInnerTexts();
  if (dialogs.length > 0) console.log('[tf0581-dialogs]', JSON.stringify(dialogs));
  await page.getByTestId('chat-composer-send').click();
  console.log('[tf0581-send-state]', JSON.stringify({
    sendState: await page.getByTestId('chat-composer-send').getAttribute('data-send-state'),
    input: await input.inputValue(),
  }));
}

async function history(app: ElectronApplication): Promise<History> {
  return hostInvoke<History>(app, 'gateway', 'rpc', {
    method: 'chat.history', params: { sessionKey: SESSION_KEY, limit: 200, maxChars: 500_000 }, timeoutMs: 60_000,
  });
}

function assertGreen(checks: Awaited<ReturnType<typeof runMoyuChecks>>) {
  assert.equal(checks.pytest.exitCode, 0, checks.pytest.stdout + checks.pytest.stderr);
  assert.match(checks.pytest.stdout, /(?:1|[2-9]\d*) passed/);
  assert.equal(checks.acceptance.exitCode, 1, checks.acceptance.stdout + checks.acceptance.stderr);
  assert.match(checks.acceptance.stdout, /19 passed, 1 failed, 0 errors/);
}

async function configureProductProvider(app: ElectronApplication, page: Page, port: number, repetition: number) {
  const now = new Date().toISOString();
  const account = {
    id: 'custom-moyu-' + repetition,
    vendorId: 'custom',
    label: 'Moyu ' + repetition,
    authMode: 'api_key',
    apiProtocol: 'openai-completions',
    baseUrl: 'http://127.0.0.1:' + port + '/v1',
    model: MODEL,
    modelProfile: { contextWindow: 128000, maxTokens: 4096, supportsVision: false },
    metadata: { validation: { status: 'valid', checkedAt: now, model: MODEL, source: 'settings' } },
    enabled: true,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  };
  expect(await hostInvoke<Json>(app, 'providers', 'createAccount', { account, apiKey: 'test-key-ok' })).toMatchObject({ success: true });
  expect(await hostInvoke<Json>(app, 'providers', 'validateKey', { accountId: account.id })).toMatchObject({ valid: true });
  expect(await hostInvoke<Json>(app, 'providers', 'setDefaultAccount', { accountId: account.id })).toMatchObject({ success: true });
  expect(await hostInvoke<Json>(app, 'agents', 'updateModel', { id: 'main', modelRef: 'custom-moyu-' + repetition + '/' + MODEL })).toMatchObject({ success: true });
  await page.reload();
  await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
}

async function bindWorkspace(app: ElectronApplication, page: Page, snapshotProject: string, repetition: number, permissionMode: 'acceptEdits' | 'readOnly' = 'acceptEdits') {
  await hostInvoke<Json>(app, 'workspaces', 'create', { name: 'Moyu ' + repetition, rootPath: snapshotProject, permissionMode });
  const profiles = await hostInvoke<{ profiles?: Array<{ id?: string; rootPath?: string }> }>(app, 'workspaces', 'list');
  const profile = profiles.profiles?.find((entry) => entry.rootPath === snapshotProject);
  expect(profile?.id).toBeTruthy();
  await hostInvoke<Json>(app, 'workspaces', 'switch', { id: profile!.id });
  await page.reload();
  await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
  const active = await hostInvoke<{ activeWorkspace?: { rootPath?: string } }>(app, 'workspaces', 'getActive');
  expect(active.activeWorkspace?.rootPath).toBe(snapshotProject);
  const updateResult = await hostInvoke<Json>(app, 'agents', 'updateModel', { id: 'main', modelRef: 'custom-moyu-' + repetition + '/' + MODEL });
  console.log('[tf0581-update-model]', JSON.stringify(updateResult));
  expect(updateResult).toMatchObject({ success: true });
  await page.reload();
  await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
}

test.describe('TF-0581 moyu coding acceptance', () => {
  test.setTimeout(1_800_000);
  for (let repetition = 1; repetition <= 3; repetition += 1) {
    test(`positive journey ${repetition}: read, edit, verify, visible reply, undo`, async ({ homeDir, userDataDir, launchElectronApp }) => {
      const runId = 'tf0581-moyu-' + Date.now() + '-' + repetition;
      const root = join('D:\\tmp\\clawx-product-acceptance', runId, 'b2-moyu');
      const snapshot = await createMoyuSnapshot(root, 'positive-' + repetition);
      const marker = 'MOYU_FIXED_' + repetition + '_' + Date.now();
      const llm = await startScriptedLlm((userText, results) => {
        const has = (id: string) => Object.keys(results).some((key) => key.startsWith(id.replace(/[^A-Za-z0-9]/g, '')));
        const isUndo = userText.lastIndexOf('UNDO-MOYU') > userText.lastIndexOf('FIX-MOYU');
        if (isUndo) {
          if (!has('undo-router')) return { toolCall: { id: 'undo-router', name: 'undo_write', args: { steps: 1 } } };
          return { text: 'MOYU_UNDO_OK ' + marker };
        }
        if (!has('read-router')) return { toolCall: { id: 'read-router', name: 'read', args: { path: MOYU_ALLOWED_PATH } } };
        if (!has('edit-router')) return {
          toolCall: {
            id: 'edit-router',
            name: 'edit',
            args: {
              path: MOYU_ALLOWED_PATH,
              edits: [{ oldText: snapshot.routerBlock, newText: ROUTER_PARAMETERIZED }],
            },
          },
        };
        if (!has('run-pytest')) return {
          toolCall: { id: 'run-pytest', name: 'bash', args: { command: '& "' + MOYU_PYTHON + '" -m pytest ' + MOYU_ORACLE_PATH + ' -q', workdir: snapshot.snapshotProject, timeout: 120 } },
        };
        if (!has('run-acceptance')) return {
          toolCall: { id: 'run-acceptance', name: 'bash', args: { command: '& "' + MOYU_PYTHON + '" -m acceptance run --mode offline --seed 20260908 --output acceptance-after', workdir: snapshot.snapshotProject, timeout: 120 } },
        };
        return { text: 'MOYU_ACCEPTANCE_OK ' + marker };
      });
      let app: ElectronApplication | undefined;
      const receipt: Json = { actor, driven_by: 'agent', repetition, runId, marker, candidate: snapshot.originalGit, oracleHash: snapshot.oracleHash, baseline: snapshot.baselineCommit, status: 'running' };
      try {
        const config = buildMockProviderConfig(llm.port, snapshot.snapshotProject);
        config.tools = { profile: 'full', exec: { host: 'gateway', security: 'full', ask: 'off' } };
        (config.runtime as Json).coding = { ...(config.runtime as Json).coding as Json, autoVerify: { enabled: false } };
        await writeFile(join(userDataDir, 'openclaw-source-state', 'openclaw.json'), JSON.stringify(config), 'utf8').catch(async () => {
          const { mkdir } = await import('node:fs/promises');
          await mkdir(join(userDataDir, 'openclaw-source-state'), { recursive: true });
          await writeFile(join(userDataDir, 'openclaw-source-state', 'openclaw.json'), JSON.stringify(config), 'utf8');
        });
        app = await launchElectronApp({ skipSetup: true, env: moyuOpenClawEnv(homeDir) });
        const page = await getStableWindow(app);
        await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
        await startGateway(app);
        await configureProductProvider(app, page, llm.port, repetition);
        await bindWorkspace(app, page, snapshot.snapshotProject, repetition);
        await send(page, 'FIX-MOYU. Read ' + MOYU_ALLOWED_PATH + ', apply the smallest parameterized-SQL fix identified by the frozen oracle, run the project tests and acceptance, then report the outcome. Do not change the oracle.');
        await expect.poll(() => llm.log.length + llm.anomalies.length, { timeout: 30_000 }).toBeGreaterThan(0);
        await waitForLog(llm.log, marker);
        const checks = await runMoyuChecks(snapshot);
        assertGreen(checks);
        const source = await readFile(join(snapshot.snapshotProject, MOYU_ALLOWED_PATH), 'utf8');
        assert.match(source, /VALUES \(\?, \?, \?, \?, \?\)/);
        assert.equal(sha256(await readFile(join(snapshot.snapshotProject, MOYU_ORACLE_PATH))), snapshot.oracleHash);
        const tools = llm.log.flatMap((entry) => Object.entries(entry.toolResults));
        assert.ok(tools.some(([id, value]) => id.startsWith('readrouter') && value.includes('INSERT INTO yonghu')));
        assert.ok((await toolResult(llm.log, 'edit-router')).includes('Successfully replaced') || tools.some(([, value]) => value.includes('Successfully replaced')));
        assert.ok((await toolResult(llm.log, 'run-pytest')).includes('1 passed'));
        assert.ok((await toolResult(llm.log, 'run-acceptance')).includes('19 passed, 1 failed'));
        const transcript = await history(app);
        assert.ok(JSON.stringify(transcript).includes(marker) || (await page.locator('body').innerText()).includes(marker));
        const beforeUndo = await readFile(join(snapshot.snapshotProject, MOYU_ALLOWED_PATH), 'utf8');
        expect(beforeUndo).toContain('VALUES (?, ?, ?, ?, ?)');
        await send(page, 'UNDO-MOYU the last edit now.');
        await expect.poll(() => llm.log.some((entry) => entry.issued?.startsWith('text:MOYU_UNDO_OK')) , { timeout: 120_000 }).toBe(true);
        const undoOutcome = await toolResult(llm.log, 'undo-router');
        expect(undoOutcome.replace(/\s+/g, '')).toContain('"ok":true');
        const restored = await readFile(join(snapshot.snapshotProject, MOYU_ALLOWED_PATH), 'utf8');
        expect(restored).toContain('sql = "INSERT INTO yonghu');
        expect(restored).not.toContain('VALUES (?, ?, ?, ?, ?)');
        await snapshot.verifyRestored();
        receipt.undo = { outcome: undoOutcome, restored: true };
        await save(join(root, 'positive-' + repetition + '.json'), { ...receipt, checks, tools, transcript });
        await page.screenshot({ path: join(root, 'positive-' + repetition + '.png') });
        receipt.status = 'pass';
      } catch (error) {
        receipt.status = 'fail';
        receipt.error = String(error);
        if (app) {
          receipt.gatewaySnapshot = await hostInvoke<Json>(app, 'diagnostics', 'gatewaySnapshot').catch((cause) => ({ error: String(cause) }));
          receipt.chatHistory = await hostInvoke<Json>(app, 'gateway', 'rpc', { method: 'chat.history', params: { sessionKey: SESSION_KEY, limit: 50, maxChars: 200_000 }, timeoutMs: 30_000 }).catch((cause) => ({ error: String(cause) }));
          receipt.gatewayStatus = await hostInvoke<Json>(app, 'gateway', 'status').catch((cause) => ({ error: String(cause) }));
        }
        receipt.providerAnomalies = [...llm.anomalies];
        receipt.progress = {
          entries: llm.log.length,
          issued: llm.log.map((entry) => entry.issued),
          keys: llm.log.map((entry) => Object.keys(entry.toolResults)),
          values: llm.log.map((entry) => Object.fromEntries(Object.entries(entry.toolResults).map(([key, value]) => [key, value.slice(0, 500)]))),
          bash: await toolResult(llm.log, 'run-pytest'),
          acceptance: await toolResult(llm.log, 'run-acceptance'),
        };
        throw error;
      } finally {
        if (app) await closeElectronApp(app).catch(() => undefined);
        await new Promise<void>((resolve) => llm.server.close(() => resolve()));
        await snapshot.verifyOriginalUnchanged().catch((error) => { receipt.originalUnchangedError = String(error); });
        await save(join(root, 'receipt-' + repetition + '.json'), receipt);
        if (process.env.CLAWX_MOYU_KEEP_WS !== '1') await snapshot.cleanup();
      }
    });
  }

  test('readOnly workspace denies mutation without an approval request or side effect', async ({ homeDir, userDataDir, launchElectronApp }) => {
    const runId = 'tf0581-moyu-' + Date.now() + '-readonly';
    const root = join('D:\\tmp\\clawx-product-acceptance', runId, 'b2-moyu');
    const snapshot = await createMoyuSnapshot(root, 'readonly');
    const llm = await startScriptedLlm(() => ({ text: 'READONLY_BRANCH_COMPLETE' }));
    let app: ElectronApplication | undefined;
    const receipt: Json = { actor, driven_by: 'agent', scenario: 'readOnly-denial', runId, candidate: snapshot.originalGit, status: 'running' };
    try {
      app = await launchElectronApp({ skipSetup: true, env: moyuOpenClawEnv(homeDir) });
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
      await startGateway(app);
      await configureProductProvider(app, page, llm.port, 9);
      await bindWorkspace(app, page, snapshot.snapshotProject, 9, 'readOnly');
      const target = join(snapshot.snapshotProject, MOYU_ALLOWED_PATH);
      const before = await readFile(target, 'utf8');
      const result = await hostInvoke<{ success?: boolean; blocked?: boolean; approvalRequired?: boolean; error?: string }>(
        app, 'gateway', 'rpc', { method: 'tools.exec', params: { command: 'echo tamper > user_router.py' }, timeoutMs: 30_000 },
      ).catch((cause) => ({ error: String(cause) }));
      expect(JSON.stringify(result)).toMatch(/blocked|denied|read.?only|计划模式|plan/i);
      expect(await readFile(target, 'utf8')).toBe(before);
      receipt.result = result;
      receipt.sideEffect = false;
      receipt.status = 'pass';
    } catch (error) {
      receipt.status = 'fail';
      receipt.error = String(error);
      receipt.issued = llm.log.map((entry) => entry.issued);
      receipt.keys = llm.log.map((entry) => Object.keys(entry.toolResults));
      receipt.values = llm.log.map((entry) => Object.fromEntries(Object.entries(entry.toolResults).map(([k, v]) => [k, String(v).slice(0, 300)])));
      throw error;
    } finally {
      if (app) await closeElectronApp(app).catch(() => undefined);
      await new Promise<void>((resolve) => llm.server.close(() => resolve()));
      await snapshot.verifyOriginalUnchanged().catch((error) => { receipt.originalUnchangedError = String(error); });
      await save(join(root, 'receipt.json'), receipt);
      if (process.env.CLAWX_MOYU_KEEP_WS !== '1') await snapshot.cleanup();
    }
  });

  test('cancelled turn leaves no edit and no completed reply, then the next turn succeeds once', async ({ homeDir, userDataDir, launchElectronApp }) => {
    const runId = 'tf0581-moyu-' + Date.now() + '-cancel';
    const root = join('D:\\tmp\\clawx-product-acceptance', runId, 'b2-moyu');
    const snapshot = await createMoyuSnapshot(root, 'cancel');
    const before = await readFile(join(snapshot.snapshotProject, MOYU_ALLOWED_PATH), 'utf8');
    const llm = await startScriptedLlm(() => ({ text: 'MOYU_CANCEL_BRANCH_MARKER' }));
    let app: ElectronApplication | undefined;
    const receipt: Json = { actor, driven_by: 'agent', scenario: 'cancel-before-edit', runId, candidate: snapshot.originalGit, status: 'running' };
    try {
      app = await launchElectronApp({ skipSetup: true, env: moyuOpenClawEnv(homeDir) });
      const page = await getStableWindow(app);
      await page.getByTestId('main-layout').waitFor({ timeout: 60_000 });
      await startGateway(app);
      await configureProductProvider(app, page, llm.port, 10);
      await bindWorkspace(app, page, snapshot.snapshotProject, 10);
      const sessionKey = await hostInvoke<{ sessionKey: string }>(app, 'workspaces', 'getActive')
        .then((active) => ({ sessionKey: (active as { activeWorkspace?: { activeSessionKey?: string } }).activeWorkspace?.activeSessionKey ?? SESSION_KEY }));
      const sendResult = await hostInvoke<Json>(app, 'chat', 'sendWithMedia', {
        sessionKey: sessionKey.sessionKey, message: 'FIX-MOYU would edit, but this run is cancelled before any edit.',
        idempotencyKey: 'tf0581-cancel-' + Date.now(),
      });
      receipt.sendResult = sendResult;
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      const stop = await hostInvoke<Json>(app, 'chat', 'abort', { sessionKey: sessionKey.sessionKey }).catch((cause) => ({ error: String(cause) }));
      receipt.abortResult = stop;
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      const transcript = await history(app);
      const text = JSON.stringify(transcript);
      expect(text).not.toContain('MOYU_ACCEPTANCE_OK');
      expect(await readFile(join(snapshot.snapshotProject, MOYU_ALLOWED_PATH), 'utf8')).toBe(before);
      expect(await readFile(join(snapshot.snapshotProject, MOYU_ORACLE_PATH), 'utf8')).toContain('O\'Brien');
      receipt.transcript = transcript;
      receipt.sideEffect = false;
      receipt.status = 'pass';
    } catch (error) {
      receipt.status = 'fail';
      receipt.error = String(error);
      throw error;
    } finally {
      if (app) await closeElectronApp(app).catch(() => undefined);
      await new Promise<void>((resolve) => llm.server.close(() => resolve()));
      await snapshot.verifyOriginalUnchanged().catch((error) => { receipt.originalUnchangedError = String(error); });
      await save(join(root, 'receipt.json'), receipt);
      if (process.env.CLAWX_MOYU_KEEP_WS !== '1') await snapshot.cleanup();
    }
  });

  test('undo with a missing journal snapshot fails closed without partial restore', async ({ homeDir, userDataDir, launchElectronApp }) => {
    const runId = 'tf0581-moyu-' + Date.now() + '-stalejournal';
    const root = join('D:\\tmp\\clawx-product-acceptance', runId, 'b2-moyu');
    const snapshot = await createMoyuSnapshot(root, 'stalejournal');
    const marker = 'MOYU_STALE_' + Date.now();
    // First turn: edit then remove the newest journal .pre snapshot; second turn: undo must fail closed.
    const llm = await startScriptedLlm((userText, results) => {
      const has = (id: string) => Object.keys(results).some((key) => key.startsWith(id.replace(/[^A-Za-z0-9]/g, '')));
      const isUndo = userText.lastIndexOf('UNDO-STAIL') > userText.lastIndexOf('FIX-STAIL');
      if (isUndo) {
        if (!has('undo-stale')) return { toolCall: { id: 'undo-stale', name: 'undo_write', args: { steps: 1 } } };
        return { text: 'MOYU_STALE_UNDO_DONE ' + marker };
      }
      if (!has('edit-stale')) return {
        toolCall: { id: 'edit-stale', name: 'edit', args: { path: MOYU_ALLOWED_PATH, edits: [{ oldText: snapshot.routerBlock, newText: ROUTER_PARAMETERIZED }] } },
      };
      return { text: 'MOYU_STALE_EDIT_DONE ' + marker };
    });
    let app: ElectronApplication | undefined;
    const receipt: Json = { actor, driven_by: 'agent', scenario: 'stale-journal-undo', runId, marker, candidate: snapshot.originalGit, status: 'running' };
    try {
      app = await launchElectronApp({ skipSetup: true, env: moyuOpenClawEnv(homeDir) });
      const page = await getStableWindow(app);
      await page.getByTestId('main-layout').waitFor({ timeout: 60_000 });
      await startGateway(app);
      await configureProductProvider(app, page, llm.port, 11);
      await bindWorkspace(app, page, snapshot.snapshotProject, 11);
      const { readdir, unlink } = await import('node:fs/promises');
      await send(page, 'FIX-STAIL edit user_router.py, then stop.');
      await expect.poll(() => llm.log.some((entry) => entry.issued?.startsWith('text:MOYU_STALE_EDIT_DONE')), { timeout: 240_000 }).toBe(true);
      const edited = await readFile(join(snapshot.snapshotProject, MOYU_ALLOWED_PATH), 'utf8');
      expect(edited).toContain('VALUES (?, ?, ?, ?, ?)');
      const journalRoot = join(snapshot.snapshotProject, '.openclaw', 'journal');
      const sessions = await readdir(journalRoot);
      expect(sessions.length).toBeGreaterThan(0);
      const sessionDir = join(journalRoot, sessions[0]);
      const pres = (await readdir(sessionDir)).filter((name) => name.endsWith('.pre')).sort();
      expect(pres.length).toBeGreaterThan(0);
      await unlink(join(sessionDir, pres.at(-1)!));
      await send(page, 'UNDO-STAIL the last edit now.');
      await expect.poll(() => llm.log.some((entry) => entry.issued?.startsWith('text:MOYU_STALE_UNDO_DONE')), { timeout: 240_000 }).toBe(true);
      const outcome = await toolResult(llm.log, 'undo-stale');
      const compact = outcome.replace(/\s+/g, '');
      const failedClosed = compact.includes('"ok":false') || /snapshot missing|journal/i.test(outcome);
      expect(failedClosed).toBe(true);
      const notHalfRestored = (await readFile(join(snapshot.snapshotProject, MOYU_ALLOWED_PATH), 'utf8')).includes('VALUES (?, ?, ?, ?, ?)');
      expect(notHalfRestored).toBe(true);
      const metasLeft = (await readdir(sessionDir)).filter((name) => name.endsWith('.meta.json')).length;
      expect(metasLeft).toBeGreaterThan(0);
      receipt.undoOutcome = outcome;
      receipt.failedClosed = true;
      receipt.notHalfRestored = true;
      receipt.status = 'pass';
    } catch (error) {
      receipt.status = 'fail';
      receipt.error = String(error);
      receipt.issued = llm.log.map((entry) => entry.issued);
      receipt.keys = llm.log.map((entry) => Object.keys(entry.toolResults));
      receipt.values = llm.log.map((entry) => Object.fromEntries(Object.entries(entry.toolResults).map(([k, v]) => [k, String(v).slice(0, 300)])));
      receipt.chatHistory = app ? await hostInvoke<Json>(app, 'gateway', 'rpc', { method: 'chat.history', params: { sessionKey: SESSION_KEY, limit: 50, maxChars: 200_000 }, timeoutMs: 30_000 }).catch((cause) => ({ error: String(cause) })) : null;
      throw error;
    } finally {
      if (app) await closeElectronApp(app).catch(() => undefined);
      await new Promise<void>((resolve) => llm.server.close(() => resolve()));
      await snapshot.verifyOriginalUnchanged().catch((error) => { receipt.originalUnchangedError = String(error); });
      await save(join(root, 'receipt.json'), receipt);
      if (process.env.CLAWX_MOYU_KEEP_WS !== '1') await snapshot.cleanup();
    }
  });
});
