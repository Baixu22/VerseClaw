import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
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
        baseUrl: 'http://127.0.0.1:1/v1', apiProtocol: 'openai-completions', model: 'diag-model',
        enabled: true, isDefault: true, createdAt: now, updatedAt: now,
      },
      apiKey: 'diag-key',
    });
    out.setDefault = await hostInvoke(page, 'providers', 'setDefaultAccount', { accountId: 'diag-custom' });
    out.updateModel = await hostInvoke(page, 'agents', 'updateModel', { id: 'main', modelRef: 'custom-diagcust/diag-model' });
    out.providersList = await hostInvoke(page, 'providers', 'list').catch((e: unknown) => ({ error: String(e) }));
    await new Promise((r) => setTimeout(r, 5_000));
    for (const rel of ['.openclaw/openclaw.json', 'AppData/Roaming/openclaw/openclaw.json']) {
      const p = join(homeDir, rel);
      try {
        const cfg = JSON.parse(await readFile(p, 'utf8')) as { models?: { providers?: Record<string, unknown> } };
        const providers = (cfg.models?.providers ?? {}) as Record<string, unknown>;
        out[rel] = { providers: Object.keys(providers) };
        for (const [key, value] of Object.entries(providers)) {
          const entry = value as Record<string, unknown>;
          out[rel + ':' + key] = { keys: Object.keys(entry), api: entry.api, baseUrl: entry.baseUrl, models: entry.models, model: entry.model };
        }
      } catch (error) {
        out[rel] = { readError: String(error).slice(0, 200) };
      }
    }
    // Send one chat turn against the injected endpoint and capture what the app/runtime say.
    const fixture = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          appendFileSync('D:/tmp/clawx-vb-n7-20261016/diag-stub-requests.jsonl', JSON.stringify({ url: req.url }) + '\n');
        } catch { /* best effort */ }
        const alreadyOpened = /sessionId/.test(body);
        const args = alreadyOpened
          ? JSON.stringify({ action: 'takeSnapshot', sessionId: (body.match(/"sessionId"\s*:\s*"([^"]+)"/) || [])[1] })
          : JSON.stringify({ action: 'open', url: 'http://127.0.0.1:1/' });
        const callId = 'call_diag_' + (alreadyOpened ? 'snapshot' : 'open');
        if (String(req.url).includes('chat/completions')) {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
          const chunk = (delta: unknown, finish: string | null) => 'data: ' + JSON.stringify({ id: 'chatcmpl_diag', object: 'chat.completion.chunk', created: 1, model: 'diag-model', choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n';
          res.write(chunk({ role: 'assistant', tool_calls: [{ index: 0, id: callId, type: 'function', function: { name: 'agent_browser', arguments: args } }] }, null));
          res.write(chunk({}, 'tool_calls'));
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      });
    });
    await new Promise<void>((r) => fixture.listen(0, '127.0.0.1', () => r()));
    const probePort = (fixture.address() as { port: number }).port;
    out.probeEndpoint = 'http://127.0.0.1:' + probePort + '/v1';
    try {
      await hostInvoke(page, 'providers', 'createAccount', {
        account: {
          id: 'diag-turn', vendorId: 'custom', label: 'Diag turn', authMode: 'api_key',
          baseUrl: out.probeEndpoint as string, apiProtocol: 'openai-completions', model: 'diag-model',
          enabled: true, isDefault: true, createdAt: now, updatedAt: now,
        },
        apiKey: 'diag-key',
      });
      await hostInvoke(page, 'providers', 'setDefaultAccount', { accountId: 'diag-turn' });
      await hostInvoke(page, 'agents', 'updateModel', { id: 'main', modelRef: 'custom-diagturn/diag-model' });
      out.turnModelRef = 'custom-diagturn/diag-model';
      await hostInvoke(page, 'gateway', 'start').catch(() => undefined);
      await new Promise((r) => setTimeout(r, 8_000));
      const input = page.getByTestId('chat-composer-input');
      const send = page.getByTestId('chat-composer-send');
      await input.fill('Say hi.').catch(() => undefined);
      await send.click().catch(() => undefined);
      await new Promise((r) => setTimeout(r, 45_000));
      out.afterTurn = {
        history: await hostInvoke(page, 'gateway', 'rpc', { method: 'chat.history', params: { sessionKey: 'agent:main:main', limit: 20, maxChars: 20_000 }, timeoutMs: 20_000 }).catch((e: unknown) => ({ error: String(e) })),
        bodyText: (await page.locator('body').innerText().catch(() => '')).slice(0, 3_000),
      };
    } finally {
      await new Promise<void>((r) => fixture.close(() => r()));
      const logsDir = join(homeDir, '.openclaw', 'logs');
      try {
        const names = (await readdir(logsDir)).map((n) => join(logsDir, n));
        const sized = await Promise.all(names.map(async (n) => ({ n, t: (await stat(n)).mtimeMs })));
        const newest = sized.sort((a, b) => b.t - a.t)[0];
        out.runtimeLog = { path: newest ? newest.n : undefined, tail: newest ? (await readFile(newest.n, 'utf8')).slice(-4_000) : undefined };
      } catch (error) {
        out.runtimeLog = { error: String(error).slice(0, 200) };
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
