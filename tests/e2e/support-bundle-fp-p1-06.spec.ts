/**
 * FP-P1-06 G3: support bundle export in real Electron with a real gateway child.
 *
 * Plants realistic leak vectors (a provider API key in secure storage and a
 * key-shaped string in a user-controlled label), exports through the REAL UI
 * button, then unpacks the archive and asserts:
 *  - the child's own counters are mirrored in (runtimeMirror.childPid/budget)
 *  - neither planted secret appears anywhere in the exported text
 *  - the redaction report itself is part of the bundle
 *  - no gateway token, no file contents
 */
import { readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

type HostResponse<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string } };
type GatewayStatus = { state?: string; port?: number; gatewayReady?: boolean };
type HostSuccess = { success: boolean };

const PLANTED_STORED_KEY = 'sk-realfakekey0987654321abcdef';
const PLANTED_LABEL_KEY = 'sk-plantedfakekey1234567890abcd';
/** Unique string written into a workspace file; must never appear in the bundle. */
const PLANTED_SOURCE_MARKER = 'PLANTED_SOURCE_BODY_MUST_NOT_LEAK_7f3a';

async function allocatePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('port allocation failed')));
        return;
      }
      server.close((err) => (err ? reject(err) : resolve(address.port)));
    });
  });
}

async function hostInvoke<T>(
  app: ElectronApplication,
  module: string,
  action: string,
  payload: Record<string, unknown> | null = null,
): Promise<T> {
  const response = (await app.evaluate(async (_electron, request) => {
    const { ipcMain, BrowserWindow } = process.mainModule!.require(
      'electron',
    ) as typeof import('electron');
    const handler = (
      ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      }
    )._invokeHandlers?.get('host:invoke');
    if (!handler) throw new Error('host:invoke handler is not registered');
    const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    if (!win) throw new Error('No BrowserWindow available for host:invoke sender auth');
    const sender = win.webContents;
    const event = {
      sender,
      senderFrame: { url: typeof sender.getURL === 'function' ? sender.getURL() : '' },
    };
    return await handler(event, { id: `fp-p1-06-${Date.now()}-${Math.random()}`, ...request });
  }, { module, action, payload })) as HostResponse<T>;
  if (!response.ok) {
    throw new Error(`[${response.error?.code ?? 'HOST'}] ${response.error?.message ?? 'failed'}`);
  }
  return response.data as T;
}

async function startGateway(app: ElectronApplication): Promise<void> {
  const port = await allocatePort();
  await hostInvoke<HostSuccess>(app, 'settings', 'set', { key: 'gatewayPort', value: port });
  const deadline = Date.now() + 240_000;
  let attempts = 0;
  while (Date.now() < deadline) {
    try {
      const status = await hostInvoke<GatewayStatus>(app, 'gateway', 'status');
      if (status.gatewayReady === true || status.state === 'running') return;
      if (status.state !== 'starting' && attempts < 10) {
        attempts += 1;
        await hostInvoke<HostSuccess>(app, 'gateway', 'start').catch(() => undefined);
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error('gateway never became ready');
}

test.describe('FP-P1-06 support bundle export (real Electron + real child)', () => {
  test('one-click export is sanitized, child-mirrored, and self-reporting', async ({
    launchElectronApp,
  }) => {
    test.setTimeout(600_000);
    const workspaceDir = await mkdtemp(join(tmpdir(), 'clawx-fp-p1-06-'));
    // A real source file whose CONTENTS must not reach the bundle.
    await writeFile(
      join(workspaceDir, 'secret-source.js'),
      `// ${PLANTED_SOURCE_MARKER}
export const x = 1;
`,
      'utf8',
    );
    const app = await launchElectronApp({ skipSetup: true });
    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60_000 });
      await startGateway(app);

      // Plant leak vectors: a stored API key + a key-shaped user label + a workspace.
      await hostInvoke<Record<string, unknown>>(app, 'providers', 'createAccount', {
        account: {
          id: 'e2e-bundle-acct',
          vendorId: 'custom',
          label: `Leaky label ${PLANTED_LABEL_KEY}`,
          authMode: 'api_key',
          baseUrl: 'http://127.0.0.1:9/v1',
          enabled: true,
          isDefault: false,
          metadata: {
            validation: { status: 'valid', checkedAt: new Date().toISOString(), source: 'settings' },
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        apiKey: PLANTED_STORED_KEY,
      });
      await hostInvoke<Record<string, unknown>>(app, 'workspaces', 'create', {
        rootPath: workspaceDir, permissionMode: 'acceptEdits',
      });

      // ---- export through the real UI ----
      await page.getByTestId('sidebar-nav-settings').click();
      await page.getByTestId('settings-nav-system').click();
      await expect(page.getByTestId('settings-support-bundle')).toBeVisible({ timeout: 60_000 });
      await page.getByTestId('settings-support-bundle-export').click();
      await expect(page.getByTestId('settings-support-bundle-result')).toBeVisible({
        timeout: 120_000,
      });
      const uiResultText = await page.getByTestId('settings-support-bundle-result').textContent();
      // eslint-disable-next-line no-console -- evidence for FP-P1-06 UI path
      console.log('[fp-p1-06-ui]', uiResultText);
      expect(uiResultText ?? '').toContain('support-bundles');

      // ---- export again via control plane to get a clean path for unpacking ----
      const result = await hostInvoke<{
        success: boolean; path?: string;
        redaction?: { totalHits: number; verified: boolean; findings: Array<{ type: string; hits: number }> };
      }>(app, 'diagnostics', 'exportSupportBundle');
      // eslint-disable-next-line no-console -- evidence for FP-P1-06
      console.log('[fp-p1-06-export]', JSON.stringify({
        success: result.success, path: result.path, redaction: result.redaction,
      }));
      expect(result.success).toBe(true);
      expect(result.redaction?.verified).toBe(true);

      // ---- unpack + structural assertions ----
      const raw = await readFile(result.path!, 'utf8');
      const bundle = JSON.parse(raw) as Record<string, unknown>;
      expect(bundle.schema).toBe('verse-claw-support-bundle/1');

      // Child counters mirrored from the REAL gateway child:
      const mirror = bundle.runtimeMirror as {
        available?: boolean; childPid?: number; injectionBudget?: { counters?: Record<string, number> };
        effectiveFlags?: Record<string, unknown>; configSource?: Record<string, unknown>;
      };
      expect(mirror.available).toBe(true);
      expect(typeof mirror.childPid).toBe('number');
      expect(mirror.injectionBudget?.counters).toBeDefined();
      expect(mirror.effectiveFlags).toBeDefined();

      // Provider type + verification state present; the KEYS are not:
      const providers = bundle.providers as Array<Record<string, unknown>>;
      const planted = providers.find((provider) => provider.vendorId === 'custom');
      expect(planted?.hasKey).toBe(true);
      expect((planted?.validation as { status?: string })?.status).toBe('valid');
      expect(raw).not.toContain(PLANTED_STORED_KEY);
      expect(raw).not.toContain(PLANTED_LABEL_KEY);
      expect(raw).not.toContain('gatewayToken');

      // The redaction report is part of the bundle and counted the planted label.
      const report = bundle.redactionReport as {
        totalHits?: number; verified?: boolean; findings?: Array<{ type: string; hits: number }>;
      };
      expect(report.verified).toBe(true);
      expect(report.totalHits ?? 0).toBeGreaterThan(0);
      // Findings carry counts and types only — never values:
      for (const finding of report.findings ?? []) {
        expect(Object.keys(finding).sort()).toEqual(['hits', 'type']);
      }

      // Workspace lineage present; usernames in paths are masked.
      expect(bundle.workspace).toBeTruthy();
      expect(raw).toContain('[REDACTED:user]');

      // AC: no source-code bodies. The workspace holds a file with a unique
      // marker; the journal summary may name the path but must never carry the
      // contents (support-bundle.ts collectJournalSummary is paths+counts only).
      expect(raw).not.toContain(PLANTED_SOURCE_MARKER);
      // The journal section, when present, exposes only metadata keys.
      const journal = bundle.journal as { sessions?: Array<{ entries?: Array<Record<string, unknown>> }> };
      for (const session of journal?.sessions ?? []) {
        for (const entry of session.entries ?? []) {
          expect(Object.keys(entry).sort()).toEqual(
            ['createdAtMs', 'hadPrior', 'relPath', 'seq', 'toolName'],
          );
        }
      }

      // AC: size cap + truncation policy is explicit, not silent.
      const sizeBytes = Buffer.byteLength(raw, 'utf8');
      const truncated = bundle.truncated as string[] | undefined;
      // eslint-disable-next-line no-console -- evidence for FP-P1-06 size policy
      console.log('[fp-p1-06-size]', JSON.stringify({ sizeBytes, truncated }));
      expect(sizeBytes).toBeLessThanOrEqual(6 * 1024 * 1024);
      expect(Array.isArray(truncated)).toBe(true);
      // Whatever was cut is NAMED, so a reader can tell the bundle is partial.
      for (const entry of truncated ?? []) {
        expect(entry).toMatch(/:/);
      }
    } finally {
      await closeElectronApp(app);
      await rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });
});
