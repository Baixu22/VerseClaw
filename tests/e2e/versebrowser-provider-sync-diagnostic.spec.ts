import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { getStableWindow, test } from './fixtures/electron';

/**
 * Diagnostic (spec N7): after creating a provider account through the host API,
 * does the app-side state AND the runtime's own OpenClaw config both carry it?
 * The fixture exposes homeDir, so the runtime config can be read directly.
 */
test.setTimeout(240_000);

async function hostInvoke<T>(page: Page, module: string, action: string, payload?: unknown): Promise<T> {
  const response = await page.evaluate(async ([m, a, p]) => {
    const api = (window as unknown as { verseClaw: { hostInvoke: (r: unknown) => Promise<unknown> } }).verseClaw;
    return await api.hostInvoke({ id: Math.random().toString(36).slice(2), module: m, action: a, ...(p ? { payload: p } : {}) });
  }, [module, action, payload ?? null] as const);
  const typed = response as { ok: boolean; data?: unknown; error?: { message?: string } };
  if (!typed.ok) throw new Error(typed.error?.message || 'hostInvoke failed');
  return typed.data as T;
}

test('provider sync diagnostic', async ({ launchElectronApp, homeDir, userDataDir }) => {
  const app = await launchElectronApp({ skipSetup: true });
  const out: Record<string, unknown> = { homeDir, userDataDir };
  try {
    const page = await getStableWindow(app);
    const now = new Date().toISOString();
    out.createAccount = await hostInvoke(page, 'providers', 'createAccount', {
      account: {
        id: 'diag-custom', vendorId: 'custom', label: 'Diag custom', authMode: 'api_key',
        baseUrl: 'http://127.0.0.1:1/v1', apiProtocol: 'openai-responses', model: 'diag-model',
        enabled: true, isDefault: true, createdAt: now, updatedAt: now,
      },
      apiKey: 'diag-key',
    });
    out.setDefault = await hostInvoke(page, 'providers', 'setDefaultAccount', { accountId: 'diag-custom' });
    out.updateModel = await hostInvoke(page, 'agents', 'updateModel', { id: 'main', modelRef: 'custom-diagnost/diag-model' });
    out.providersList = await hostInvoke(page, 'providers', 'list').catch((e: unknown) => ({ error: String(e) }));
    await new Promise((r) => setTimeout(r, 5_000));
    for (const rel of ['.openclaw/openclaw.json', 'AppData/Roaming/openclaw/openclaw.json']) {
      const p = join(homeDir, rel);
      try {
        const cfg = JSON.parse(await readFile(p, 'utf8')) as { models?: { providers?: Record<string, unknown> } };
        out[rel] = { providers: Object.keys(cfg.models?.providers ?? {}) };
      } catch (error) {
        out[rel] = { readError: String(error).slice(0, 200) };
      }
    }
    const udProviders = join(userDataDir, 'clawx-providers.json');
    try {
      const store = JSON.parse(await readFile(udProviders, 'utf8')) as { providerAccounts?: Record<string, unknown> };
      out.appProviderStore = Object.keys(store.providerAccounts ?? {});
    } catch (error) {
      out.appProviderStore = { readError: String(error).slice(0, 200) };
    }
  } finally {
    await mkdir('D:/tmp/clawx-vb-n7-20261016', { recursive: true });
    await writeFile('D:/tmp/clawx-vb-n7-20261016/provider-sync-diagnostic.json', JSON.stringify(out, null, 2) + '\n');
    await app.close().catch(() => undefined);
  }
});
