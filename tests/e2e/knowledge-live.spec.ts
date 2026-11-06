import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { allocatePort } from './fixtures/fp-p1-harness';
import { readSpaceBunnyResource, redactSpaceBunny, startSpaceBunnyProxy } from './fixtures/space-bunny-responses';

type Json = Record<string, unknown>;
async function host<T = Json>(page: Page, module: string, action: string, payload?: Json): Promise<T> {
  return page.evaluate(async request => {
    const result = await window.verseClaw!.hostInvoke({ id: crypto.randomUUID(), module: request.module, action: request.action, ...(request.payload ? { payload: request.payload } : {}) });
    if (!result.ok) throw Error(result.error?.message ?? 'Host request failed');
    return result.data as T;
  }, { module, action, payload });
}

test('live Knowledge uses actual Gateway model-only inference and public GitHub capture', async ({ homeDir, userDataDir, launchElectronApp }) => {
  test.skip(process.env.CLAWX_KNOWLEDGE_LIVE !== '1', 'Opt-in authorized live resource');
  test.setTimeout(300_000);
  const output = process.env.CLAWX_KNOWLEDGE_LIVE_ARTIFACT_DIR ?? 'D:/tmp/knowledge-live-evidence'; await mkdir(output, { recursive: true });
  const resource = readSpaceBunnyResource();
  const proxy = await startSpaceBunnyProxy('knowledge-quality-no-tool-effect');
  const app = await launchElectronApp({ skipSetup: true, env: { CLAWX_SPACE_BUNNY_API_KEY: '' } });
  const receipt: Json = { driven_by: 'agent', actor: 'codex-knowledge-playwright', realHumanEvidence: false, status: 'fail' };
  try {
    const page = await getStableWindow(app);
    await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 60000 });
    const connector = { id: 'github-live', kind: 'github-public-directory', owner: 'openai', repo: 'openai-python', ref: 'main', path: 'README.md', enabled: true, intervalSeconds: 300 };
    expect(await host(page, 'knowledge', 'upsertSourceConnector', connector)).toMatchObject({ success: true });
    const synced = await host(page, 'knowledge', 'syncSourceConnector', { id: connector.id }); receipt.connector = synced;
    expect(synced).toMatchObject({ success: true, receipt: { status: 'ok', unchanged: 1 } });
    const inbox = await host(page, 'knowledge', 'listInboxItems', { status: 'pending', limit: 100 });
    const items = (inbox.items as Array<{ metadata?: Json }>).filter(item => item.metadata?.connectorId === connector.id);
    receipt.connectorCandidates = items;
    expect(items).toHaveLength(1); expect(items[0].metadata).toMatchObject({ driven_by: 'agent', actor: 'knowledge-github-connector', sourceStatus: 'active', requiresReview: true });
    await host(page, 'knowledge', 'removeSourceConnector', { id: connector.id });
    const now = new Date().toISOString();
    const account = { id: 'custom-kbqual01', vendorId: 'custom', label: 'Knowledge Space Bunny', authMode: 'api_key', apiProtocol: 'openai-responses',
      baseUrl: proxy.baseUrl, model: resource.model, modelProfile: { contextWindow: 128000, maxTokens: 2048, supportsVision: false },
      metadata: { validation: { status: 'valid', checkedAt: now, model: resource.model, source: 'settings' } }, enabled: true, isDefault: true, createdAt: now, updatedAt: now };
    expect(await host(page, 'providers', 'createAccount', { account, apiKey: proxy.proxyToken })).toMatchObject({ success: true });
    expect(await host(page, 'providers', 'setDefaultAccount', { accountId: account.id })).toMatchObject({ success: true });
    expect(await host(page, 'agents', 'updateModel', { id: 'main', modelRef: `${account.id}/${resource.model}` })).toMatchObject({ success: true });
    const vault = join(homeDir, 'knowledge-live-vault'); await mkdir(join(vault, 'concepts'), { recursive: true });
    await writeFile(join(vault, 'concepts', 'gateway.md'), `---\nid: gateway-live\ntitle: Gateway deployment\nkind: concept\nstatus: active\nrevision: 3\nupdatedAt: ${now}\n---\n网关部署端口为8467。网关恢复命令是 clawx recover --safe。\n`, 'utf8');
    // Seed only this isolated agent-owned fixture config. Product config and
    // accounts outside the fixture home are never read or modified.
    await app.evaluate(async (_electron, args) => {
      const fs = process.mainModule!.require('node:fs/promises') as typeof import('node:fs/promises');
      const path = process.mainModule!.require('node:path') as typeof import('node:path');
      const state = path.join(args.userDataDir, 'openclaw-source-state'); await fs.mkdir(state, { recursive: true });
      const file = path.join(state, 'openclaw.json');
      let config: Record<string, unknown> = {}; try { config = JSON.parse(await fs.readFile(file, 'utf8')); } catch { /* new fixture */ }
      const plugins = config.plugins as { entries?: Record<string, unknown> } | undefined;
      config.plugins = { ...plugins, entries: { ...plugins?.entries, 'memory-wiki': { enabled: true, config: { vaultMode: 'isolated', vault: { path: args.vault, renderMode: 'native' }, search: { backend: 'local', corpus: 'wiki' } } } } };
      await fs.writeFile(file, JSON.stringify(config, null, 2));
    }, { userDataDir, vault });
    const port = await allocatePort();
    await host(page, 'settings', 'set', { key: 'gatewayPort', value: port });
    receipt.gatewayStart = await host(page, 'gateway', 'start').catch(error => ({ error: String(error) }));
    await expect.poll(async () => (await host(page, 'gateway', 'status')).state, { timeout: 120000 }).toBe('running');
    const init = await host(page, 'knowledge', 'init'); receipt.init = init; expect(init.success).toBe(true);
    const first = await host(page, 'knowledge', 'answerFromSourceSet', { question: '网关部署端口是什么？', sourceRefs: [{ id: 'concepts/gateway.md', path: 'concepts/gateway.md', kind: 'wiki' }], synthesis: true });
    receipt.answer = first;
    expect(first).toMatchObject({ success: true, synthesisMode: 'model', model: { status: 'completed' } });
    expect(String(first.answer)).toContain('8467');
    const followup = await host(page, 'knowledge', 'answerFromSourceSet', { question: '它的恢复命令呢？', sourceRefs: [{ id: 'concepts/gateway.md', path: 'concepts/gateway.md', kind: 'wiki' }], synthesis: true,
      history: [{ role: 'user', content: '网关部署端口是什么？' }, { role: 'assistant', content: String(first.answer) }] });
    receipt.followup = followup; expect(String(followup.answer)).toContain('clawx recover --safe');
    const beforeCalls = proxy.observations.length;
    const missing = await host(page, 'knowledge', 'answerFromSourceSet', { question: '不存在的配置？', sourceRefs: [{ id: 'concepts/missing.md', path: 'concepts/missing.md', kind: 'wiki' }], synthesis: true });
    receipt.missing = missing; expect(missing.groundingStatus).toBe('missing_sources'); expect(proxy.observations).toHaveLength(beforeCalls);
    expect(proxy.observations.filter(row => row.httpStatus === 200).length).toBeGreaterThanOrEqual(2);
    expect(proxy.observations.every(row => !row.toolCount)).toBe(true);
    receipt.status = 'pass';
  } catch (error) {
    receipt.error = String(error); throw error;
  } finally {
    try { receipt.gatewayStop = await host(await getStableWindow(app), 'gateway', 'stop'); } catch { /* app may have failed */ }
    try {
      const logs = join(userDataDir, 'logs');
      const files = await readdir(logs);
      for (const file of files.filter(name => name.endsWith('.log'))) {
        const text = redactSpaceBunny(await readFile(join(logs, file), 'utf8')).split(proxy.proxyToken).join('[REDACTED]');
        await writeFile(join(output, file.replace(/\.log$/, '.txt')), text);
      }
    } catch { /* startup can fail before logging initialization */ }
    await closeElectronApp(app);
    receipt.proxyCleanup = await proxy.close(); receipt.provider = proxy.observations;
    await writeFile(join(output, 'receipt.json'), redactSpaceBunny(JSON.stringify(receipt, null, 2)));
  }
});
