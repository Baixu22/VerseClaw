/**
 * FP-P1-07 phase-exit journey. Route A keeps Electron, Main, Gateway, agent
 * tools, journal, restart, and support export real; only the remote provider is
 * replaced by a local OpenAI-compatible HTTP endpoint.
 */
import { createServer as createHttpServer, type Server } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import {
  MOCK_MODEL_ID,
  allocatePort,
  hostInvoke,
  startGateway,
  startScriptedLlm,
  type LlmRequestLog,
} from './fixtures/fp-p1-harness';

const VALID_KEY = 'test-key-ok';
const ORIGINAL = [
  'export function add(a, b) {',
  '  return a - b;',
  '}',
  '',
].join('\n');
const FIXED = [
  'export function add(a, b) {',
  '  return a + b;',
  '}',
  '',
].join('\n');
const BEFORE_RESTART = [
  'export function add(a, b) {',
  '  return a * b;',
  '}',
  '',
].join('\n');

function sanitizeCallId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '');
}

function hasResult(results: Record<string, string>, callId: string): boolean {
  const wanted = sanitizeCallId(callId);
  return Object.keys(results).some(
    (key) => key === wanted || new RegExp(`^${wanted}\\d+$`).test(key),
  );
}

function toolResultFor(log: LlmRequestLog[], callId: string): string {
  const wanted = sanitizeCallId(callId);
  for (const entry of log) {
    const key = Object.keys(entry.toolResults).find(
      (candidate) => candidate === wanted || new RegExp(`^${wanted}\\d+$`).test(candidate),
    );
    if (key) return entry.toolResults[key] ?? '';
  }
  return '';
}

function latestJourneyMarker(userText: string): string | null {
  const markers = [
    'JOURNEY-FIX',
    'JOURNEY-UNDO',
    'JOURNEY-EDIT-BEFORE-RESTART',
    'JOURNEY-RECOVER-AFTER-RESTART',
  ];
  return markers.reduce<{ marker: string | null; at: number }>((best, marker) => {
    const at = userText.lastIndexOf(marker);
    return at > best.at ? { marker, at } : best;
  }, { marker: null, at: -1 }).marker;
}

function nextJourneyAction(userText: string, results: Record<string, string>) {
  switch (latestJourneyMarker(userText)) {
    case 'JOURNEY-FIX':
      if (!hasResult(results, 'journey-read')) {
        return { toolCall: { id: 'journey-read', name: 'read', args: { path: 'journey.js' } } };
      }
      if (!hasResult(results, 'journey-edit')) {
        return {
          toolCall: {
            id: 'journey-edit',
            name: 'edit',
            args: {
              path: 'journey.js',
              edits: [{ oldText: ORIGINAL.trimEnd(), newText: FIXED.trimEnd() }],
            },
          },
        };
      }
      if (!hasResult(results, 'journey-test')) {
        return {
          toolCall: {
            id: 'journey-test',
            name: 'bash',
            args: { command: 'node --test journey.test.js' },
          },
        };
      }
      return { text: 'JOURNEY-FIX complete' };
    case 'JOURNEY-UNDO':
      if (!hasResult(results, 'journey-undo')) {
        return { toolCall: { id: 'journey-undo', name: 'undo_write', args: { steps: 1 } } };
      }
      return { text: 'JOURNEY-UNDO complete' };
    case 'JOURNEY-EDIT-BEFORE-RESTART':
      if (!hasResult(results, 'journey-edit-restart')) {
        return {
          toolCall: {
            id: 'journey-edit-restart',
            name: 'edit',
            args: {
              path: 'journey.js',
              edits: [{ oldText: ORIGINAL.trimEnd(), newText: BEFORE_RESTART.trimEnd() }],
            },
          },
        };
      }
      return { text: 'JOURNEY-EDIT-BEFORE-RESTART complete' };
    case 'JOURNEY-RECOVER-AFTER-RESTART':
      if (!hasResult(results, 'journey-read-restart')) {
        return {
          toolCall: { id: 'journey-read-restart', name: 'read', args: { path: 'journey.js' } },
        };
      }
      if (!hasResult(results, 'journey-undo-restart')) {
        return {
          toolCall: { id: 'journey-undo-restart', name: 'undo_write', args: { steps: 1 } },
        };
      }
      return { text: 'JOURNEY-RECOVER-AFTER-RESTART complete' };
    default:
      return { text: 'No journey action requested.' };
  }
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function stubFolderPicker(app: ElectronApplication, pickedFolder: string): Promise<void> {
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, pickedFolder);
}

async function enterProviderStep(app: ElectronApplication, page: Page): Promise<void> {
  await expect(page.getByTestId('setup-page')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('setup-welcome-step')).toContainText(
    'Windows x64 controlled preview',
  );
  await page.getByTestId('setup-next-button').click();
  await expect(page.getByTestId('setup-runtime-step')).toBeVisible();
  await startGateway(app);
  await expect(page.getByTestId('setup-next-button')).toBeEnabled({ timeout: 120_000 });
  await page.getByTestId('setup-next-button').click();
  await page.getByTestId('setup-installing-skip').click();
  await expect(page.getByTestId('setup-provider-step')).toBeVisible();
}

async function validateCustomProvider(page: Page, baseUrl: string): Promise<void> {
  await page.getByTestId('setup-provider-vendor-custom').click();
  await page.getByTestId('setup-provider-base-url').fill(baseUrl);
  await page.getByTestId('setup-provider-api-key').fill(VALID_KEY);
  await page.getByTestId('setup-provider-validate').click();
  await expect(page.getByTestId('setup-provider-validated')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('setup-next-button').click();
  await expect(page.getByTestId('setup-model-step')).toBeVisible();
}

async function selectModelAndWorkspace(
  app: ElectronApplication,
  page: Page,
  workspaceDir: string,
): Promise<void> {
  await page.getByTestId(`setup-model-option-${MOCK_MODEL_ID}`).click();
  await page.getByTestId('setup-model-confirm').click();
  await expect(page.getByTestId('setup-model-verified')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('setup-next-button').click();
  await expect(page.getByTestId('setup-workspace-step')).toBeVisible();
  await stubFolderPicker(app, workspaceDir);
  await page.getByTestId('setup-workspace-pick').click();
  await expect(page.getByTestId('setup-workspace-check-exists-ok')).toBeVisible({
    timeout: 30_000,
  });
  await page.getByTestId('setup-workspace-mode-acceptEdits').click();
  await page.getByTestId('setup-workspace-confirm').click();
  await expect(page.getByTestId('setup-workspace-confirmed')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('setup-next-button').click();
  await expect(page.getByTestId('setup-complete-provider-verified')).toBeVisible();
  await expect(page.getByTestId('setup-complete-workspace')).toBeVisible();
  await page.getByTestId('setup-next-button').click();
  await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
}

async function enableDcsPreview(page: Page): Promise<void> {
  await page.getByTestId('sidebar-nav-settings').click();
  await page.getByTestId('settings-nav-developer').click();
  const devMode = page.getByTestId('settings-dev-mode-switch');
  await expect(devMode).toBeVisible({ timeout: 60_000 });
  if ((await devMode.getAttribute('data-state')) !== 'checked') await devMode.click();
  const flagsPanel = page.getByTestId('settings-dcs-prod-flags');
  await expect(flagsPanel).toBeVisible({ timeout: 60_000 });
  await expect(flagsPanel).toContainText('DCS Controlled Preview Flags');
  await expect(page.getByTestId('settings-dcs-preview-card')).toContainText(
    'DCS Coding Controlled Preview',
  );
  const previewSwitch = page.getByTestId('settings-dcs-preview-switch');
  await expect(previewSwitch).toBeEnabled({ timeout: 60_000 });
  await previewSwitch.click();
  await expect(previewSwitch).toBeDisabled();
  await expect(previewSwitch).toBeEnabled({ timeout: 400_000 });
  await expect(page.getByTestId('settings-dcs-preview-ack')).toHaveAttribute(
    'data-ack-state',
    'applied',
    { timeout: 30_000 },
  );
  await page.getByTestId('settings-back-button').click();
  await expect(page.getByTestId('settings-page')).toHaveCount(0);
}

async function openChat(page: Page): Promise<void> {
  await page.getByTestId('sidebar-new-chat').click();
  await expect(page.getByTestId('chat-composer-input')).toBeVisible({ timeout: 60_000 });
}

async function sendUiTurn(
  page: Page,
  log: LlmRequestLog[],
  message: string,
  finalMarker: string,
): Promise<void> {
  const startAt = log.length;
  const composer = page.getByTestId('chat-composer-input');
  await expect(composer).toBeEnabled({ timeout: 120_000 });
  await composer.fill(message);
  await page.getByTestId('chat-composer-send').click();
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (log.slice(startAt).some((entry) => entry.issued?.startsWith('text:')
      && entry.issued.includes(finalMarker.slice(0, 18)))) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`UI turn did not finish: ${message}`);
}

async function mainSession(app: ElectronApplication): Promise<{ sessionId?: string }> {
  const result = await hostInvoke<{ sessions?: Array<{ key?: string; sessionId?: string }> }>(
    app,
    'gateway',
    'rpc',
    { method: 'sessions.list', params: { agentId: 'main' }, timeoutMs: 60_000 },
  );
  return result.sessions?.find((session) => session.key === 'agent:main:main') ?? {};
}

async function startValidationEndpoint(options: { fullModels: string[] }): Promise<{
  server: Server;
  port: number;
}> {
  const server = createHttpServer((req, res) => {
    if ((req.headers.authorization ?? '') !== `Bearer ${VALID_KEY}`) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Invalid API key provided' } }));
      return;
    }
    if ((req.url ?? '').includes('/models')) {
      const validationProbe = (req.url ?? '').includes('limit=1');
      const models = validationProbe ? [MOCK_MODEL_ID] : options.fullModels;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: models.map((id) => ({ id })) }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'not found' } }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('validation endpoint failed');
  return { server, port: address.port };
}

test.describe('FP-P1-07 first-product journey (real Electron + real Gateway)', () => {
  test('clean setup through coding, undo, restart recovery, and support bundle', async ({
    launchElectronApp,
  }) => {
    test.setTimeout(1_200_000);
    const llm = await startScriptedLlm(nextJourneyAction);
    const workspaceDir = await mkdtemp(join(tmpdir(), 'clawx-fp-p1-07-success-'));
    await writeFile(join(workspaceDir, 'journey.js'), ORIGINAL, 'utf8');
    await writeFile(
      join(workspaceDir, 'journey.test.js'),
      "import test from 'node:test';\nimport assert from 'node:assert/strict';\n"
        + "import { add } from './journey.js';\ntest('add', () => assert.equal(add(2, 3), 5));\n",
      'utf8',
    );
    await writeFile(
      join(workspaceDir, 'package.json'),
      `${JSON.stringify({ type: 'module', scripts: { test: 'node --test journey.test.js' } }, null, 2)}\n`,
      'utf8',
    );
    let app: ElectronApplication | null = await launchElectronApp({ skipSetup: false });
    try {
      let page = await getStableWindow(app);
      await enterProviderStep(app, page);
      await validateCustomProvider(page, `http://127.0.0.1:${llm.port}/v1`);
      await selectModelAndWorkspace(app, page, workspaceDir);
      await enableDcsPreview(page);
      await openChat(page);

      await sendUiTurn(page, llm.log, 'JOURNEY-FIX fix journey.js and run its test.', 'JOURNEY-FIX complete');
      expect(await readFile(join(workspaceDir, 'journey.js'), 'utf8')).toBe(FIXED);
      expect(toolResultFor(llm.log, 'journey-read')).toContain('return a - b;');
      expect(toolResultFor(llm.log, 'journey-edit')).toContain('diff:');
      // FP-P2-05 turned auto-verify default OFF; edit still detects the runner but reports disabled.
      expect(toolResultFor(llm.log, 'journey-edit')).toContain('verify_tests: disabled');
      expect(toolResultFor(llm.log, 'journey-test')).toMatch(/pass|passed|tests? 1/i);

      await sendUiTurn(page, llm.log, 'JOURNEY-UNDO undo that edit.', 'JOURNEY-UNDO complete');
      expect(await readFile(join(workspaceDir, 'journey.js'), 'utf8')).toBe(ORIGINAL);
      expect(toolResultFor(llm.log, 'journey-undo').replace(/\s+/g, '')).toContain('"ok":true');

      await sendUiTurn(
        page,
        llm.log,
        'JOURNEY-EDIT-BEFORE-RESTART prepare restart recovery.',
        'JOURNEY-EDIT-BEFORE-RESTART complete',
      );
      expect(await readFile(join(workspaceDir, 'journey.js'), 'utf8')).toBe(BEFORE_RESTART);
      const sessionBefore = await mainSession(app);
      await closeElectronApp(app);
      app = null;

      app = await launchElectronApp({ skipSetup: true });
      page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
      await startGateway(app);
      const sessionAfter = await mainSession(app);
      expect(sessionAfter.sessionId).toBe(sessionBefore.sessionId);
      await sendUiTurn(
        page,
        llm.log,
        'JOURNEY-RECOVER-AFTER-RESTART read then undo the pending edit.',
        'JOURNEY-RECOVER-AFTER-RESTART complete',
      );
      expect(toolResultFor(llm.log, 'journey-read-restart')).toContain('return a * b;');
      expect(toolResultFor(llm.log, 'journey-undo-restart').replace(/\s+/g, '')).toContain(
        '"ok":true',
      );
      expect(await readFile(join(workspaceDir, 'journey.js'), 'utf8')).toBe(ORIGINAL);

      await page.getByTestId('sidebar-nav-settings').click();
      await page.getByTestId('settings-nav-system').click();
      await page.getByTestId('settings-support-bundle-export').click();
      await expect(page.getByTestId('settings-support-bundle-result')).toBeVisible({
        timeout: 120_000,
      });
      const bundleResult = await hostInvoke<{
        success: boolean;
        path?: string;
        redaction?: { verified?: boolean };
      }>(app, 'diagnostics', 'exportSupportBundle');
      expect(bundleResult.success).toBe(true);
      expect(bundleResult.redaction?.verified).toBe(true);
      const rawBundle = await readFile(bundleResult.path!, 'utf8');
      const bundle = JSON.parse(rawBundle) as Record<string, unknown>;
      expect(bundle.schema).toBe('verse-claw-support-bundle/1');
      expect((bundle.runtimeMirror as { available?: boolean }).available).toBe(true);
      expect(bundle.workspace).toBeTruthy();
      expect(rawBundle).not.toContain(VALID_KEY);
      expect(rawBundle).not.toContain('return a - b;');

      console.log('[fp-p1-07-success]', JSON.stringify({
        model: MOCK_MODEL_ID,
        sessionId: sessionAfter.sessionId,
        dcsAck: 'applied',
        read: true,
        edit: true,
        test: true,
        undoBeforeRestart: true,
        undoAfterRestart: true,
        supportBundle: bundleResult.path,
      }));
    } finally {
      if (app) await closeElectronApp(app).catch(() => undefined);
      await closeServer(llm.server);
      await rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test('gateway-not-ready and no-provider failures both give an operator action', async ({
    launchElectronApp,
  }) => {
    test.setTimeout(420_000);
    const app = await launchElectronApp({ skipSetup: false });
    try {
      const page = await getStableWindow(app);
      await page.getByTestId('setup-next-button').click();
      await expect(page.getByTestId('setup-runtime-step')).toBeVisible();
      await expect(page.getByTestId('setup-next-button')).toBeDisabled();
      await expect(page.getByTestId('setup-runtime-gateway-status')).toContainText(
        'Gateway is not running',
      );
      const startButton = page.getByTestId('setup-runtime-start-gateway');
      await expect(startButton).toBeVisible();
      await hostInvoke(app, 'settings', 'set', { key: 'gatewayPort', value: await allocatePort() });
      await startButton.click();
      await expect(page.getByTestId('setup-next-button')).toBeEnabled({ timeout: 180_000 });

      await page.getByTestId('setup-next-button').click();
      await page.getByTestId('setup-installing-skip').click();
      await expect(page.getByTestId('setup-provider-step')).toBeVisible();
      await page.getByTestId('setup-skip-button').click();
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
      const composer = page.getByTestId('chat-composer-input');
      await expect(composer).toBeEnabled({ timeout: 120_000 });
      await composer.fill('first product task without provider');
      await page.getByTestId('chat-composer-send').click();
      await expect(page.getByTestId('chat-provider-gate-dialog')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('chat-provider-gate-configure')).toBeVisible();
      console.log('[fp-p1-07-failure]', JSON.stringify({
        gatewayNotReady: 'start-gateway action shown and recovered',
        noProvider: 'configure-provider action shown',
      }));
    } finally {
      await closeElectronApp(app);
    }
  });

  test('invalid credentials and unavailable model stay blocked with retry guidance', async ({
    launchElectronApp,
  }) => {
    test.setTimeout(420_000);
    const endpoint = await startValidationEndpoint({ fullModels: [] });
    const app = await launchElectronApp({ skipSetup: false });
    try {
      const page = await getStableWindow(app);
      await enterProviderStep(app, page);
      await page.getByTestId('setup-provider-vendor-custom').click();
      await page.getByTestId('setup-provider-base-url').fill(
        `http://127.0.0.1:${endpoint.port}/v1`,
      );
      await page.getByTestId('setup-provider-api-key').fill('wrong-key');
      await page.getByTestId('setup-provider-validate').click();
      const credentialError = page.getByTestId('setup-provider-error-credentials');
      await expect(credentialError).toBeVisible({ timeout: 30_000 });
      await expect(credentialError).toContainText('paste a fresh key and validate again');
      await expect(page.getByTestId('setup-next-button')).toBeDisabled();

      await page.getByTestId('setup-provider-api-key').fill(VALID_KEY);
      await page.getByTestId('setup-provider-validate').click();
      await expect(page.getByTestId('setup-provider-validated')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('setup-next-button').click();
      const modelUnavailable = page.getByTestId('setup-model-list-error');
      await expect(modelUnavailable).toBeVisible({ timeout: 30_000 });
      await expect(modelUnavailable).toContainText('Could not list models');
      await expect(modelUnavailable).toContainText('Retry, or go back and check');
      await expect(modelUnavailable.getByRole('button', { name: 'Retry' })).toBeVisible();
      await expect(page.getByTestId('setup-next-button')).toBeDisabled();
      console.log('[fp-p1-07-failure]', JSON.stringify({
        invalidCredentials: 'fresh-key retry guidance',
        modelUnavailable: 'model-list failure with retry guidance blocks Next',
      }));
    } finally {
      await closeElectronApp(app);
      await closeServer(endpoint.server);
    }
  });

  test('workspace denial and kill refusal fail closed without silent fallback', async ({
    homeDir,
    userDataDir,
    launchElectronApp,
  }) => {
    test.setTimeout(720_000);
    const llm = await startScriptedLlm(nextJourneyAction);
    const workspaceDir = await mkdtemp(join(tmpdir(), 'clawx-fp-p1-07-kill-'));
    const app = await launchElectronApp({ skipSetup: false });
    try {
      const page = await getStableWindow(app);
      await enterProviderStep(app, page);
      await validateCustomProvider(page, `http://127.0.0.1:${llm.port}/v1`);
      await page.getByTestId(`setup-model-option-${MOCK_MODEL_ID}`).click();
      await page.getByTestId('setup-model-confirm').click();
      await expect(page.getByTestId('setup-model-verified')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('setup-next-button').click();
      await expect(page.getByTestId('setup-workspace-step')).toBeVisible();

      const blockedDir = process.platform === 'win32' ? 'C:\\Windows' : '/etc';
      await stubFolderPicker(app, blockedDir);
      await page.getByTestId('setup-workspace-pick').click();
      const blocked = page.getByTestId('setup-workspace-blocked');
      await expect(blocked).toBeVisible({ timeout: 30_000 });
      await expect(blocked).toContainText('pick another folder');
      await expect(page.getByTestId('setup-next-button')).toBeDisabled();

      await stubFolderPicker(app, workspaceDir);
      await page.getByTestId('setup-workspace-pick').click();
      await expect(page.getByTestId('setup-workspace-check-exists-ok')).toBeVisible({
        timeout: 30_000,
      });
      await page.getByTestId('setup-workspace-mode-acceptEdits').click();
      await page.getByTestId('setup-workspace-confirm').click();
      await expect(page.getByTestId('setup-workspace-confirmed')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('setup-next-button').click();
      await page.getByTestId('setup-next-button').click();
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });

      const sourceConfigPath = join(userDataDir, 'openclaw-source-state', 'openclaw.json');
      const homeConfigPath = join(homeDir, '.openclaw', 'openclaw.json');
      const config = JSON.parse(await readFile(sourceConfigPath, 'utf8')) as Record<string, unknown>;
      const killedConfig = {
        ...config,
        runtime: {
          ...((config.runtime as Record<string, unknown> | undefined) ?? {}),
          contextEnhancement: { killSwitch: true },
        },
      };
      const serialized = `${JSON.stringify(killedConfig, null, 2)}\n`;
      await mkdir(join(userDataDir, 'openclaw-source-state'), { recursive: true });
      await mkdir(join(homeDir, '.openclaw'), { recursive: true });
      await writeFile(sourceConfigPath, serialized, 'utf8');
      await writeFile(homeConfigPath, serialized, 'utf8');

      await page.getByTestId('sidebar-nav-settings').click();
      await page.getByTestId('settings-nav-developer').click();
      const devMode = page.getByTestId('settings-dev-mode-switch');
      if ((await devMode.getAttribute('data-state')) !== 'checked') await devMode.click();
      const previewSwitch = page.getByTestId('settings-dcs-preview-switch');
      await expect(previewSwitch).toBeEnabled({ timeout: 60_000 });
      await previewSwitch.click();
      await expect(previewSwitch).toBeDisabled();
      await expect(previewSwitch).toBeEnabled({ timeout: 400_000 });
      await expect(page.getByTestId('settings-dcs-preview-ack')).toHaveAttribute(
        'data-ack-state',
        'failed',
        { timeout: 30_000 },
      );
      await expect(page.getByTestId('settings-dcs-preview-ack-state')).toHaveText(/killed/i);
      await expect(page.getByTestId('settings-dcs-preview-killswitch')).toBeVisible();
      console.log('[fp-p1-07-failure]', JSON.stringify({
        workspaceDenied: blockedDir,
        kill: 'failed/killed with kill-switch explanation',
      }));
    } finally {
      await closeElectronApp(app);
      await closeServer(llm.server);
      await rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
