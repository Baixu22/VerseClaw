import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:main';
const WORKSPACE_ID = 'workspace-remote-forge';
const FAKE_TOKEN = 'fixture-remote-forge-token';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    .join(',')}}`;
}

function sendJson(response: ServerResponse, value: unknown, status = 200): void {
  response.writeHead(status, { 'content-type': 'application/json', 'x-github-request-id': 'fixture-request' });
  response.end(JSON.stringify(value));
}

function sendText(response: ServerResponse, value: string): void {
  response.writeHead(200, { 'content-type': 'text/plain', 'x-github-request-id': 'fixture-request' });
  response.end(value);
}

async function startFakeForge() {
  const requests: Array<{ method: string; url: string; authorization?: string; body?: string }> = [];
  const heads = new Map([['7', 'head-sha-7'], ['8', 'head-sha-8']]);
  let updatedAt = '2026-07-28T00:00:00Z';
  let title = 'Controlled preview read';
  let description = 'Fixture pull request';
  let failLabels = false;
  const merged = new Map([['7', false], ['8', false]]);
  let failMergeRefresh = false;
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString('utf8');
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const method = request.method ?? '';
      requests.push({
        method,
        url: url.pathname + url.search,
        authorization: Array.isArray(request.headers.authorization)
          ? request.headers.authorization[0]
          : request.headers.authorization,
        ...(body ? { body } : {}),
      });
      const pullMatch = url.pathname.match(/^\/repos\/acme\/demo\/pulls\/(7|8)$/);
      const mergeMatch = url.pathname.match(/^\/repos\/acme\/demo\/pulls\/(7|8)\/merge$/);
      const accept = String(request.headers.accept ?? '');
      const number = pullMatch?.[1]
        ?? url.pathname.match(/\/pulls\/(7|8)\//)?.[1]
        ?? url.pathname.match(/head-sha-(7|8)/)?.[1]
        ?? '7';
      const headSha = heads.get(number) ?? `head-sha-${number}`;
      const file = {
        filename: 'src/remote.ts',
        status: 'modified',
        additions: 1,
        deletions: 1,
        changes: 2,
        patch: '@@ -1 +1 @@\n-old remote\n+new remote',
      };
      const diff = [
        'diff --git a/src/remote.ts b/src/remote.ts',
        'index 3367afd..3e75765 100644',
        '--- a/src/remote.ts',
        '+++ b/src/remote.ts',
        '@@ -1 +1 @@',
        '-old remote',
        '+new remote',
        '',
      ].join('\n');

      if (url.pathname === '/repos/acme/demo') {
        sendJson(response, { id: 1, full_name: 'acme/demo' });
        return;
      }
      if (pullMatch && method === 'GET' && accept.includes('diff')) {
        sendText(response, diff);
        return;
      }
      if (pullMatch && method === 'PATCH') {
        const update = JSON.parse(body || '{}') as { title?: string; body?: string };
        if (update.title !== undefined) title = update.title;
        if (update.body !== undefined) description = update.body;
        updatedAt = '2026-07-28T00:02:00Z';
        sendJson(response, { id: Number(number), number: Number(number), title, body: description, updated_at: updatedAt });
        return;
      }
      if (mergeMatch && method === 'PUT') {
        const mergeInput = JSON.parse(body || '{}') as { sha?: string; merge_method?: string };
        if (mergeInput.sha !== headSha) {
          sendJson(response, { merged: false, message: 'fixture stale head' }, 409);
          return;
        }
        merged.set(number, true);
        sendJson(response, { merged: true, sha: `merge-sha-${number}`, message: 'fixture merged' });
        return;
      }
      if (pullMatch && method === 'GET') {
        if (merged.get(number) && failMergeRefresh) {
          failMergeRefresh = false;
          sendJson(response, { message: 'fixture refresh failure' }, 502);
          return;
        }
        sendJson(response, {
          number: Number(number),
          title: number === '7' ? title : 'Incomplete preview read',
          body: description,
          state: merged.get(number) ? 'closed' : 'open',
          merged: merged.get(number),
          draft: false,
          head: { ref: `feature/forge-${number}`, sha: headSha },
          base: { ref: 'main', sha: 'base-sha' },
          user: { login: 'fixture-user' },
          mergeable: true,
          mergeable_state: 'clean',
          updated_at: updatedAt,
        });
        return;
      }
      if (/\/pulls\/(7|8)\/commits$/.test(url.pathname)) {
        sendJson(response, [{ sha: `commit-${number}`, commit: { message: 'Remote change', author: { name: 'Fixture' } } }]);
        return;
      }
      if (/\/pulls\/(7|8)\/files$/.test(url.pathname)) {
        sendJson(response, number === '8' ? [file, { filename: 'C:\\private\\invalid.ts' }] : [file]);
        return;
      }
      if (/\/pulls\/(7|8)\/reviews$/.test(url.pathname) && method === 'POST') {
        sendJson(response, { id: 501, state: 'COMMENTED', commit_id: headSha });
        return;
      }
      if (/\/pulls\/(7|8)\/reviews$/.test(url.pathname)) {
        sendJson(response, [{ id: Number(number), state: 'APPROVED', user: { login: 'reviewer' }, commit_id: headSha }]);
        return;
      }
      if (url.pathname.endsWith('/issues/7/labels') && method === 'PUT') {
        sendJson(response, failLabels ? { message: 'fixture labels failure' } : [], failLabels ? 502 : 200);
        return;
      }
      if (url.pathname.endsWith('/requested_reviewers') && method === 'POST') {
        sendJson(response, { requested_reviewers: [{ login: 'reviewer' }] });
        return;
      }
      if (url.pathname.endsWith(`/commits/${headSha}/check-runs`)) {
        sendJson(response, { check_runs: [{ id: Number(number), name: 'test', status: 'completed', conclusion: 'success' }] });
        return;
      }
      if (url.pathname.endsWith('/branches/main/protection')) {
        sendJson(response, {
          required_pull_request_reviews: { required_approving_review_count: 1 },
          required_status_checks: { contexts: ['test'], strict: true },
          required_conversation_resolution: { enabled: false },
        });
        return;
      }
      if (url.pathname.endsWith('/contents/src/remote.ts')) {
        const content = 'export const remote = true;\n';
        sendJson(response, {
          path: 'src/remote.ts',
          encoding: 'base64',
          size: Buffer.byteLength(content),
          content: Buffer.from(content).toString('base64'),
        });
        return;
      }
      sendJson(response, { message: 'fixture route not found' }, 404);
    })().catch(() => {
      if (!response.headersSent) sendJson(response, { message: 'fixture failure' }, 500);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    setHead(number: number, value: string) {
      heads.set(String(number), value);
    },
    setFailLabels(value: boolean) {
      failLabels = value;
    },
    setMerged(number: number, value: boolean) {
      merged.set(String(number), value);
    },
    setFailMergeRefresh(value: boolean) {
      failMergeRefresh = value;
    },
    close: async () => await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test.describe('Remote Forge controlled preview', () => {
  test('reads complete and incomplete PR evidence through the real Main adapter without remote writes', async ({ launchElectronApp }) => {
    const forge = await startFakeForge();
    const app = await launchElectronApp({
      skipSetup: true,
      env: {
        CLAWX_REMOTE_FORGE_BASE_URL: forge.baseUrl,
        GITHUB_TOKEN: FAKE_TOKEN,
        GH_TOKEN: '',
        NO_PROXY: '127.0.0.1,localhost',
      },
    });

    try {
      await expect(app.evaluate(() => process.env.CLAWX_REMOTE_FORGE_BASE_URL)).resolves.toBe(forge.baseUrl);
      const page = await getStableWindow(app);
      const workspace = {
        id: WORKSPACE_ID,
        name: 'Remote Forge Workspace',
        rootPath: 'C:/workspace/remote-forge',
        permissionMode: 'acceptEdits',
        activeSessionKey: SESSION_KEY,
        state: {},
        sessionStates: {},
      };
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
          },
        },
        hostApi: {
          [stableStringify(['agents', 'list', null])]: {
            success: true,
            agents: [{ id: 'main', name: 'Main', isDefault: true, workspace: workspace.rootPath, mainSessionKey: SESSION_KEY, channelTypes: [] }],
            defaultAgentId: 'main',
            configuredChannelTypes: [],
            channelOwners: {},
            channelAccountOwners: {},
          },
          [stableStringify(['workspaces', 'list', null])]: {
            profiles: [workspace], activeWorkspaceId: WORKSPACE_ID, activeWorkspace: workspace,
          },
          [stableStringify(['workspaces', 'getActive', null])]: {
            activeWorkspaceId: WORKSPACE_ID, activeWorkspace: workspace,
          },
          [stableStringify(['git', 'branches', null])]: { success: true, branches: [] },
        },
      });

      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) throw error;
      }

      await page.getByTestId('sidebar-footer-menu-trigger').click();
      await page.getByTestId('sidebar-more-code-review').click();
      await page.getByTestId('workspace-review-view-pull-requests').click();
      await expect(page.getByTestId('remote-forge-panel')).toBeVisible();
      await page.getByTestId('remote-forge-owner').fill('acme');
      await page.getByTestId('remote-forge-repository').fill('demo');
      await page.getByTestId('remote-forge-number').fill('7');
      await page.getByTestId('remote-forge-read').click();

      await expect(page.getByTestId('remote-forge-read')).toContainText('Read pull request', { timeout: 20_000 });
      expect(await page.getByTestId('remote-forge-error').allTextContents()).toEqual([]);
      await expect.poll(() => forge.requests.length).toBeGreaterThan(0);
      await expect(page.getByTestId('remote-forge-title')).toContainText('Controlled preview read');
      await expect(page.getByTestId('remote-forge-readiness')).toContainText('Ready');
      await expect(page.getByTestId('remote-forge-completeness')).toContainText('Complete evidence');
      await expect(page.getByTestId('remote-forge-file')).toHaveCount(1);
      await page.getByTestId('remote-forge-file').click();
      await expect(page.getByTestId('remote-forge-diff')).toBeVisible();
      await expect(page.getByTestId('remote-forge-content')).toContainText('export const remote = true;');

      await page.getByTestId('remote-forge-number').fill('8');
      await page.getByTestId('remote-forge-read').click();
      await expect(page.getByTestId('remote-forge-title')).toContainText('Incomplete preview read');
      await expect(page.getByTestId('remote-forge-readiness')).toContainText('Unknown readiness');
      await expect(page.getByTestId('remote-forge-completeness')).toContainText('Incomplete evidence');
      await expect(page.getByTestId('remote-forge-error')).toContainText('Readiness remains fail-closed');
      await expect(page.getByTestId('remote-forge-merge-request')).toBeDisabled();

      expect(forge.requests.length).toBeGreaterThan(0);
      expect(forge.requests.every((request) => request.method === 'GET')).toBe(true);
      expect(forge.requests.every((request) => request.authorization === `Bearer ${FAKE_TOKEN}`)).toBe(true);
      expect(forge.requests.some((request) => request.url.includes('/contents/src/remote.ts?ref=head-sha-7'))).toBe(true);

      const hostCalls = await app.evaluate(() => (
        globalThis as unknown as { __verseClawE2eHostCalls?: Array<{ module?: string; action?: string }> }
      ).__verseClawE2eHostCalls ?? []);
      expect(hostCalls).toEqual(expect.arrayContaining([
        expect.objectContaining({ module: 'remoteForge', action: 'capabilities' }),
        expect.objectContaining({ module: 'remoteForge', action: 'readPullRequest' }),
        expect.objectContaining({ module: 'remoteForge', action: 'readContents' }),
      ]));
      expect(hostCalls.filter((call) => call.module === 'remoteForge' && ![
        'capabilities', 'readPullRequest', 'readContents',
      ].includes(call.action ?? ''))).toEqual([]);
    } finally {
      await closeElectronApp(app);
      await forge.close();
    }
  });

  test('publishes only after exact approval and exposes stale and partial reconciliation states', async ({ launchElectronApp }) => {
    const forge = await startFakeForge();
    const app = await launchElectronApp({
      skipSetup: true,
      env: {
        CLAWX_REMOTE_FORGE_BASE_URL: forge.baseUrl,
        GITHUB_TOKEN: FAKE_TOKEN,
        GH_TOKEN: '',
        NO_PROXY: '127.0.0.1,localhost',
      },
    });

    try {
      const page = await getStableWindow(app);
      const workspace = {
        id: WORKSPACE_ID,
        name: 'Remote Forge Workspace',
        rootPath: 'C:/workspace/remote-forge',
        permissionMode: 'acceptEdits',
        activeSessionKey: SESSION_KEY,
        state: {},
        sessionStates: {},
      };
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
          },
        },
        hostApi: {
          [stableStringify(['agents', 'list', null])]: {
            success: true,
            agents: [{ id: 'main', name: 'Main', isDefault: true, workspace: workspace.rootPath, mainSessionKey: SESSION_KEY, channelTypes: [] }],
            defaultAgentId: 'main',
            configuredChannelTypes: [],
            channelOwners: {},
            channelAccountOwners: {},
          },
          [stableStringify(['workspaces', 'list', null])]: {
            profiles: [workspace], activeWorkspaceId: WORKSPACE_ID, activeWorkspace: workspace,
          },
          [stableStringify(['workspaces', 'getActive', null])]: {
            activeWorkspaceId: WORKSPACE_ID, activeWorkspace: workspace,
          },
          [stableStringify(['git', 'branches', null])]: { success: true, branches: [] },
        },
      });

      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) throw error;
      }

      await page.getByTestId('sidebar-footer-menu-trigger').click();
      await page.getByTestId('sidebar-more-code-review').click();
      await page.getByTestId('workspace-review-view-pull-requests').click();
      await page.getByTestId('remote-forge-owner').fill('acme');
      await page.getByTestId('remote-forge-repository').fill('demo');
      await page.getByTestId('remote-forge-number').fill('7');
      await page.getByTestId('remote-forge-read').click();
      await expect(page.getByTestId('remote-forge-title')).toContainText('Controlled preview read');
      await expect(page.getByTestId('remote-forge-mutation-panel')).toBeVisible();

      await page.getByTestId('remote-forge-mutation-body').fill('Main-path approved review');
      const writesBeforeApproval = forge.requests.filter((request) => ['POST', 'PATCH', 'PUT'].includes(request.method)).length;
      await page.getByTestId('remote-forge-mutation-request').click();
      await expect(page.getByTestId('remote-forge-mutation-approval')).toBeVisible();
      expect(forge.requests.filter((request) => ['POST', 'PATCH', 'PUT'].includes(request.method))).toHaveLength(writesBeforeApproval);
      await page.getByTestId('remote-forge-mutation-approve').click();
      await expect(page.getByTestId('remote-forge-mutation-state')).toContainText('Published');
      const reviewWrites = forge.requests.filter((request) => request.method === 'POST' && request.url === '/repos/acme/demo/pulls/7/reviews');
      expect(reviewWrites).toHaveLength(1);
      expect(reviewWrites[0]?.body).toContain('Main-path approved review');

      await page.getByTestId('remote-forge-mutation-body').fill('This approval must become stale');
      await page.getByTestId('remote-forge-mutation-request').click();
      await expect(page.getByTestId('remote-forge-mutation-approval')).toBeVisible();
      forge.setHead(7, 'head-sha-stale');
      await page.getByTestId('remote-forge-mutation-approve').click();
      await expect(page.getByTestId('remote-forge-mutation-error')).toContainText('head changed');
      expect(forge.requests.filter((request) => request.method === 'POST' && request.url === '/repos/acme/demo/pulls/7/reviews')).toHaveLength(1);
      forge.setHead(7, 'head-sha-7');

      forge.setFailLabels(true);
      await page.getByTestId('remote-forge-mutation-action').selectOption('metadata_update');
      await page.getByTestId('remote-forge-mutation-title').fill('Controlled preview metadata');
      await page.getByTestId('remote-forge-mutation-labels').fill('reviewed');
      await page.getByTestId('remote-forge-mutation-reviewers').fill('reviewer');
      await page.getByTestId('remote-forge-mutation-request').click();
      await expect(page.getByTestId('remote-forge-mutation-approval')).toBeVisible();
      await page.getByTestId('remote-forge-mutation-approve').click();
      await expect(page.getByTestId('remote-forge-mutation-state')).toContainText('Published with follow-up failures');
      await expect(page.getByTestId('remote-forge-mutation-reconciliation')).toContainText('Refresh remote state');
      expect(forge.requests.filter((request) => request.method === 'PATCH' && request.url === '/repos/acme/demo/pulls/7')).toHaveLength(1);
      expect(forge.requests.filter((request) => request.method === 'PUT' && request.url === '/repos/acme/demo/issues/7/labels')).toHaveLength(1);
      expect(forge.requests.every((request) => request.authorization === `Bearer ${FAKE_TOKEN}`)).toBe(true);

      const hostCalls = await app.evaluate(() => (
        globalThis as unknown as { __verseClawE2eHostCalls?: Array<{ module?: string; action?: string }> }
      ).__verseClawE2eHostCalls ?? []);
      expect(hostCalls).toEqual(expect.arrayContaining([
        expect.objectContaining({ module: 'remoteForge', action: 'mutatePullRequest' }),
        expect.objectContaining({ module: 'permissions', action: 'decideApproval' }),
      ]));
    } finally {
      await closeElectronApp(app);
      await forge.close();
    }
  });

  test('merges only after Main re-checks readiness and exposes TOCTOU and refresh reconciliation', async ({ launchElectronApp }) => {
    const forge = await startFakeForge();
    const app = await launchElectronApp({
      skipSetup: true,
      env: {
        CLAWX_REMOTE_FORGE_BASE_URL: forge.baseUrl,
        CLAWX_REMOTE_FORGE_SANDBOX_REPOSITORIES: 'acme/demo',
        GITHUB_TOKEN: FAKE_TOKEN,
        GH_TOKEN: '',
        NO_PROXY: '127.0.0.1,localhost',
      },
    });

    try {
      const page = await getStableWindow(app);
      const workspace = {
        id: WORKSPACE_ID,
        name: 'Remote Forge Workspace',
        rootPath: 'C:/workspace/remote-forge',
        permissionMode: 'acceptEdits',
        activeSessionKey: SESSION_KEY,
        state: {},
        sessionStates: {},
      };
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
          },
        },
        hostApi: {
          [stableStringify(['agents', 'list', null])]: {
            success: true,
            agents: [{ id: 'main', name: 'Main', isDefault: true, workspace: workspace.rootPath, mainSessionKey: SESSION_KEY, channelTypes: [] }],
            defaultAgentId: 'main',
            configuredChannelTypes: [],
            channelOwners: {},
            channelAccountOwners: {},
          },
          [stableStringify(['workspaces', 'list', null])]: {
            profiles: [workspace], activeWorkspaceId: WORKSPACE_ID, activeWorkspace: workspace,
          },
          [stableStringify(['workspaces', 'getActive', null])]: {
            activeWorkspaceId: WORKSPACE_ID, activeWorkspace: workspace,
          },
          [stableStringify(['git', 'branches', null])]: { success: true, branches: [] },
        },
      });

      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) throw error;
      }

      await page.getByTestId('sidebar-footer-menu-trigger').click();
      await page.getByTestId('sidebar-more-code-review').click();
      await page.getByTestId('workspace-review-view-pull-requests').click();
      await page.getByTestId('remote-forge-owner').fill('acme');
      await page.getByTestId('remote-forge-repository').fill('demo');
      await page.getByTestId('remote-forge-number').fill('7');
      await page.getByTestId('remote-forge-read').click();
      await expect(page.getByTestId('remote-forge-title')).toContainText('Controlled preview read');
      await expect(page.getByTestId('remote-forge-merge-panel')).toContainText('Agent merge off');

      const mergeWrites = () => forge.requests.filter((request) => (
        request.method === 'PUT' && request.url === '/repos/acme/demo/pulls/7/merge'
      ));
      await page.getByTestId('remote-forge-merge-request').click();
      await expect(page.getByTestId('remote-forge-merge-approval')).toBeVisible();
      expect(mergeWrites()).toHaveLength(0);
      forge.setHead(7, 'head-sha-toctou');
      await page.getByTestId('remote-forge-merge-approve').click();
      await expect(page.getByTestId('remote-forge-merge-error')).toContainText('head changed');
      expect(mergeWrites()).toHaveLength(0);

      forge.setHead(7, 'head-sha-7');
      await page.getByTestId('remote-forge-merge-request').click();
      await expect(page.getByTestId('remote-forge-merge-approval')).toBeVisible();
      await page.getByTestId('remote-forge-merge-approve').click();
      await expect(page.getByTestId('remote-forge-merge-state')).toContainText('Merged');
      expect(mergeWrites()).toHaveLength(1);
      expect(mergeWrites()[0]?.body).toContain('"sha":"head-sha-7"');
      expect(mergeWrites()[0]?.body).toContain('"merge_method":"squash"');

      forge.setMerged(7, false);
      forge.setFailMergeRefresh(true);
      await page.getByTestId('remote-forge-merge-request').click();
      await expect(page.getByTestId('remote-forge-merge-approval')).toBeVisible();
      await page.getByTestId('remote-forge-merge-approve').click();
      await expect(page.getByTestId('remote-forge-merge-state')).toContainText('Merged with reconciliation required');
      await expect(page.getByTestId('remote-forge-merge-reconciliation')).toContainText('Refresh the provider');
      expect(mergeWrites()).toHaveLength(2);

      const hostCalls = await app.evaluate(() => (
        globalThis as unknown as { __verseClawE2eHostCalls?: Array<{ module?: string; action?: string }> }
      ).__verseClawE2eHostCalls ?? []);
      expect(hostCalls).toEqual(expect.arrayContaining([
        expect.objectContaining({ module: 'remoteForge', action: 'mergePullRequest' }),
        expect.objectContaining({ module: 'permissions', action: 'decideApproval' }),
      ]));
      expect(forge.requests.every((request) => request.authorization === `Bearer ${FAKE_TOKEN}`)).toBe(true);
    } finally {
      await closeElectronApp(app);
      await forge.close();
    }
  });
});
