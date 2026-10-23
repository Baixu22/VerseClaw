import type { ElectronApplication, Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { copyFile, readFile } from 'node:fs/promises';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

type HostResponse<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string } };
type GatewayStatus = { state?: string; gatewayReady?: boolean };
type MemorySurface = {
  accepted: Array<{ key: string; id: string; content: string; modelVisible: boolean; state: string }>;
  candidates: Array<{ key: string; id: string; content: string; modelVisible: boolean }>;
  model: { acceptedKeys: string[]; candidateKeysExcluded: string[] };
  counts: { accepted: number; candidates: number; modelVisible: number };
};

async function hostInvoke<T>(
  app: ElectronApplication,
  module: string,
  action: string,
  payload: Record<string, unknown> | null = null,
): Promise<T> {
  const response = await app.evaluate(async (_electron, request) => {
    const { ipcMain, BrowserWindow } = process.mainModule!.require('electron') as typeof import('electron');
    const handler = (ipcMain as unknown as {
      _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
    })._invokeHandlers?.get('host:invoke');
    if (!handler) throw new Error('host:invoke handler is not registered');
    const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    if (!win) throw new Error('No BrowserWindow available');
    const sender = win.webContents;
    return await handler(
      { sender, senderFrame: { url: sender.getURL() } },
      { id: 'memory-surface-' + Date.now() + '-' + Math.random(), ...request },
    );
  }, { module, action, payload }) as HostResponse<T>;
  if (!response.ok) throw new Error(response.error?.message ?? `host invoke failed: ${module}.${action}`);
  return response.data as T;
}

async function ensureGatewayReady(app: ElectronApplication): Promise<void> {
  const deadline = Date.now() + 120_000;
  let startRequested = false;
  while (Date.now() < deadline) {
    const status = await hostInvoke<GatewayStatus>(app, 'gateway', 'status');
    if (status.gatewayReady === true || status.state === 'running') return;
    if (!startRequested && status.state !== 'starting') {
      startRequested = true;
      await hostInvoke(app, 'gateway', 'start');
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error('Gateway did not become ready');
}

async function openMemory(page: Page): Promise<void> {
  await page.getByTestId('sidebar-nav-memory').click();
  await expect(page.getByTestId('memory-page')).toBeVisible({ timeout: 30_000 });
}

test('real Host/Gateway Memory surface covers remember, candidate approval, export and delete', async ({ launchElectronApp }, testInfo) => {
  test.setTimeout(360_000);
  let app: ElectronApplication | undefined;
  const observation: Record<string, unknown> = {
    schema: 'clawx.memory-user-surface.e2e/v1',
    driven_by: 'agent',
    actor: 'codex-memory-user-surface',
    negative_cases: [
      'candidate modelVisible=false before approval',
      'deleted memory absent from accepted and model acceptedKeys after tombstone',
    ],
  };
  try {
    app = await launchElectronApp({ skipSetup: true });
    const page = await getStableWindow(app);
    await ensureGatewayReady(app);
    await openMemory(page);

    const token = Date.now().toString(36);
    const rememberedContent = `Workspace memory ${token}: use pnpm for package scripts.`;
    await page.getByTestId('memory-remember-button').click();
    await page.getByTestId('memory-remember-content').fill(rememberedContent);
    await page.getByTestId('memory-remember-submit').click();

    const remembered = page.getByTestId('memory-accepted-item').filter({ hasText: rememberedContent });
    await expect(remembered).toBeVisible({ timeout: 30_000 });
    const rememberedReadback = await hostInvoke<MemorySurface>(app, 'memory', 'surface', { limit: 100 });
    const rememberedEntry = rememberedReadback.accepted.find((entry) => entry.content === rememberedContent);
    expect(rememberedEntry).toBeTruthy();
    await expect(remembered).toHaveAttribute('data-model-visible', String(rememberedEntry!.modelVisible));
    expect(rememberedReadback.model.acceptedKeys.includes(rememberedEntry!.key)).toBe(rememberedEntry!.modelVisible);

    await page.getByTestId('memory-export-button').click();
    const exportPath = (await page.getByTestId('memory-export-path').textContent({ timeout: 30_000 }))?.trim();
    if (!exportPath) throw new Error('Memory export path is missing');
    const retainedExportPath = testInfo.outputPath('memory-export.json');
    await copyFile(exportPath, retainedExportPath);
    const exportText = await readFile(retainedExportPath, 'utf8');
    const exportJson = JSON.parse(exportText) as {
      schemaVersion: string;
      snapshot: MemorySurface & { model: { productDescription: string; approvalBoundary: string } };
    };
    expect(exportJson.schemaVersion).toBe('MemoryExport/v1');
    expect(exportJson.snapshot.accepted.some((entry) => entry.content === rememberedContent)).toBe(true);
    const acceptedKeys = new Set(exportJson.snapshot.accepted.map((entry) => entry.key));
    expect(exportJson.snapshot.model.acceptedKeys.every((key) => acceptedKeys.has(key))).toBe(true);
    expect(exportJson.snapshot.model.candidateKeysExcluded.every((key) => !exportJson.snapshot.model.acceptedKeys.includes(key))).toBe(true);
    const digest = createHash('sha256').update(exportText).digest('hex');
    observation.export = { path: exportPath, retainedPath: retainedExportPath, sha256: digest, accepted: exportJson.snapshot.accepted.length };

    const candidateContent = `Role workspace candidate ${token}: require an owner review before acceptance.`;
    const proposed = await hostInvoke<{
      accepted: boolean;
      action: string;
      proposal?: { id?: string };
    }>(app, 'memory', 'propose', {
      type: 'fact',
      scope: 'workspace',
      roleTags: ['architect'],
      content: candidateContent,
      confidence: 0.95,
      importance: 0.8,
      source: 'role',
      evidenceRefs: [{ type: 'manual', ref: `memory-surface-e2e:${token}` }],
    });
    expect(proposed.accepted).toBe(false);
    expect(proposed.action).toBe('needs_review');
    expect(proposed.proposal?.id).toBeTruthy();

    await page.reload();
    await openMemory(page);
    await page.getByTestId('memory-tab-candidates').click();
    const candidate = page.getByTestId('memory-candidate-item').filter({ hasText: candidateContent });
    await expect(candidate).toBeVisible({ timeout: 30_000 });
    await expect(candidate).toHaveAttribute('data-model-visible', 'false');
    await candidate.getByTestId('memory-approve-button').click();

    await page.getByTestId('memory-tab-accepted').click();
    const approved = page.getByTestId('memory-accepted-item').filter({ hasText: candidateContent });
    await expect(approved).toBeVisible({ timeout: 30_000 });

    const beforeDelete = await hostInvoke<MemorySurface>(app, 'memory', 'surface', { limit: 100 });
    const beforeDeleteRememberedEntry = beforeDelete.accepted.find((entry) => entry.content === rememberedContent);
    expect(beforeDeleteRememberedEntry).toBeTruthy();
    expect(beforeDelete.model.acceptedKeys.includes(beforeDeleteRememberedEntry!.key)).toBe(beforeDeleteRememberedEntry!.modelVisible);
    const candidateEntry = beforeDelete.candidates.find((entry) => entry.content === candidateContent);
    if (candidateEntry) {
      expect(beforeDelete.model.candidateKeysExcluded).toContain(candidateEntry.key);
      expect(beforeDelete.model.acceptedKeys).not.toContain(candidateEntry.key);
    }

    const rememberedItem = page.getByTestId('memory-accepted-item').filter({ hasText: rememberedContent });
    await rememberedItem.getByTestId('memory-delete-button').click();
    await page.getByTestId('confirm-dialog-confirm-button').click();
    await expect(rememberedItem).toHaveCount(0, { timeout: 30_000 });

    const afterDelete = await hostInvoke<MemorySurface>(app, 'memory', 'surface', { limit: 100 });
    expect(afterDelete.accepted.some((entry) => entry.id === beforeDeleteRememberedEntry!.id)).toBe(false);
    expect(afterDelete.model.acceptedKeys).not.toContain(beforeDeleteRememberedEntry!.key);

    await hostInvoke(app, 'settings', 'set', { key: 'language', value: 'zh' });
    await page.reload();
    await page.getByTestId('sidebar-nav-memory').click();
    await expect(page.getByRole('heading', { name: '记忆' })).toBeVisible({ timeout: 30_000 });
    observation.locales = ['en', 'zh'];

    await page.screenshot({ path: testInfo.outputPath('memory-surface.png'), fullPage: true });
    observation.screenshot = testInfo.outputPath('memory-surface.png');
    observation.counts = { beforeDelete: beforeDelete.counts, afterDelete: afterDelete.counts };
    observation.status = 'passed';
    console.log(JSON.stringify(observation));
  } finally {
    if (app) await closeElectronApp(app);
  }
});
