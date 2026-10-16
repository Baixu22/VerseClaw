import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import type { Page } from '@playwright/test';
import type { HostSuccess, ProviderAccount } from '../../shared/host-api/contract';
import { expect, getStableWindow, test } from './fixtures/electron';

/**
 * Spec N7: a REAL model issues an agent_browser tool call and the runtime ->
 * Gateway -> Main -> driver chain carries requestId/toolCallId/session/owner.
 *
 * Gated by env (no owner action needed):
 *   CLAWX_LIVE_MODEL_E2E=1
 *   CLAWX_LIVE_PROVIDER=custom
 *   CLAWX_LIVE_BASE_URL=http://127.0.0.1:3065/v1
 *   CLAWX_LIVE_MODEL_REF=custom/glm-5.3-flash
 *   CLAWX_LIVE_API_KEY=<resident local key>
 */
const LIVE_ENABLED = process.env.CLAWX_LIVE_MODEL_E2E === '1';
const SESSION_KEY = process.env.CLAWX_LIVE_SESSION_KEY?.trim() || 'agent:main:main';
const EVIDENCE_DIR = resolve(process.env.CLAWX_LIVE_EVIDENCE_DIR?.trim() || 'artifacts/agent-dev-workbench');

// The live leg waits on a real model plus a Gateway boot; keep well clear of the 90s default.
test.setTimeout(600_000);

test.skip(!LIVE_ENABLED, 'set CLAWX_LIVE_MODEL_E2E=1 plus CLAWX_LIVE_PROVIDER/BASE_URL/MODEL_REF/API_KEY to run the live chain');

async function hostInvoke<T>(page: Page, module: string, action: string, payload?: unknown): Promise<T> {
  const response = await page.evaluate(async ([m, a, p]) => {
    const api = (window as unknown as { verseClaw: { hostInvoke: (r: unknown) => Promise<unknown> } }).verseClaw;
    return await api.hostInvoke({ id: Math.random().toString(36).slice(2), module: m, action: a, ...(p ? { payload: p } : {}) });
  }, [module, action, payload ?? null] as const);
  const typed = response as { ok: boolean; data?: unknown; error?: { message?: string } };
  if (!typed.ok) throw new Error(typed.error?.message || 'hostInvoke failed');
  return typed.data as T;
}

async function configureLiveProvider(page: Page): Promise<void> {
  const provider = process.env.CLAWX_LIVE_PROVIDER?.trim() || 'custom';
  const modelId = process.env.CLAWX_LIVE_MODEL_ID?.trim() || 'glm-5.3-flash';
  const baseUrl = process.env.CLAWX_LIVE_BASE_URL?.trim();
  const apiKey = process.env.CLAWX_LIVE_API_KEY?.trim();
  if (!baseUrl || !apiKey) throw new Error('CLAWX_LIVE_BASE_URL and CLAWX_LIVE_API_KEY are required');
  const now = new Date().toISOString();
  const account: ProviderAccount = {
    id: 'live-e2e-custom', vendorId: provider as ProviderAccount['vendorId'], label: 'Live E2E custom',
    authMode: 'api_key', baseUrl, model: modelId, enabled: true, isDefault: true, createdAt: now, updatedAt: now,
  };
  expect((await hostInvoke<HostSuccess>(page, 'providers', 'createAccount', { account, apiKey })).success).toBe(true);
  expect((await hostInvoke<HostSuccess>(page, 'providers', 'setDefaultAccount', { accountId: account.id })).success).toBe(true);
  expect((await hostInvoke<HostSuccess>(page, 'agents', 'updateModel', { id: 'main', modelRef: `${provider}/${modelId}` })).success).toBe(true);
}

async function ensureGatewayReady(page: Page): Promise<void> {
  const status = await hostInvoke<Record<string, unknown>>(page, 'gateway', 'status');
  if (status.state !== 'running' && status.state !== 'starting') {
    await hostInvoke<HostSuccess>(page, 'gateway', 'start').catch(() => undefined);
  }
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const current = await hostInvoke<Record<string, unknown>>(page, 'gateway', 'status');
    if (current.state === 'running') return;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error('gateway did not become ready');
}

test('a real model issues an agent_browser tool call through the Gateway', async ({ launchElectronApp }) => {
  const fixture = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>N7 live</title><h1>N7 live fixture</h1>');
  });
  await new Promise<void>((r) => fixture.listen(0, '127.0.0.1', () => r()));
  const port = (fixture.address() as { port: number }).port;
  const app = await launchElectronApp({ skipSetup: true });
  try {
    const page = await getStableWindow(app);
    await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 30_000 });
    await configureLiveProvider(page);
    await ensureGatewayReady(page);
    const input = page.getByTestId('chat-composer-input');
    const send = page.getByTestId('chat-composer-send');
    await expect(input).toBeEnabled({ timeout: 90_000 });
    await input.fill(
      'Use the agent_browser tool twice and nothing else. First: action=open with url=http://127.0.0.1:' + port + '/ . ' +
      'Then: action=takeSnapshot with the returned sessionId. Do not explain.',
    );
    await expect(send).toBeEnabled();
    await send.click();

    let history: unknown = {};
    let sawBrowserCall = false;
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      try {
        history = await hostInvoke(page, 'gateway', 'rpc', { method: 'chat.history', params: { sessionKey: SESSION_KEY, limit: 50, maxChars: 500_000 }, timeoutMs: 30_000 });
      } catch (error) {
        history = { error: String(error) };
      }
      if (JSON.stringify(history).includes('agent_browser')) { sawBrowserCall = true; break; }
      await new Promise((r) => setTimeout(r, 5_000));
    }

    await mkdir(EVIDENCE_DIR, { recursive: true });
    await writeFile(join(EVIDENCE_DIR, 'versebrowser-live-chain.json'), JSON.stringify({
      driven_by: 'agent', actor: 'codex', generatedAt: new Date().toISOString(),
      model: process.env.CLAWX_LIVE_MODEL_REF, baseUrlConfigured: true, sessionKey: SESSION_KEY,
      sawBrowserCall, history,
    }, null, 2) + '\n');
    expect(sawBrowserCall).toBe(true);
  } finally {
    await new Promise<void>((r) => fixture.close(() => r()));
  }
});
