/**
 * TF-0097 live：CLI 的 live 会话要能跨进程接力。
 *
 * 这里用**三个独立的 host api 实例**模拟三条 CLI 命令（每个进程各自新建
 * facade，内存里都没有对方的会话）：靠 <workspace>/.ae/sessions 的记录 + CDP
 * 附件接上同一个浏览器。无 Chromium 时 SKIP，不红 CI。
 */
import { describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPlaywrightHostApi } from '../src/engine/playwright-host-api.ts';
import {
  loadSessionRecord,
  loadWindow,
  probeEndpoint,
  sessionDir,
} from '../src/engine/persistent-sessions.ts';
import { setWorkspaceRoot } from '../src/host/workspace-paths.ts';
import type { AgentBrowserHostApi } from '../src/types/host-api.ts';

const OK_PAGE = '<!doctype html><html><body><h1 id="ok">ok page</h1></body></html>';

async function startFixture(): Promise<{ base: string; server: Server }> {
  const server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0] ?? '/';
    if (url === '/ok') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(OK_PAGE);
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{"error":"missing"}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { base: `http://127.0.0.1:${port}`, server };
}

async function tryPersistentApi(): Promise<AgentBrowserHostApi | null> {
  try {
    return await createPlaywrightHostApi({ persistent: true });
  } catch {
    return null;
  }
}

describe('persistent sessions survive the process (TF-0097)', () => {
  it(
    'second instance attaches over CDP, the window follows the current page, close really kills the browser',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'vb-persist-'));
      setWorkspaceRoot(root);
      const fixture = await startFixture();
      const apis: AgentBrowserHostApi[] = [];
      let sessionId = '';
      let endpoint = '';

      try {
        const apiA = await tryPersistentApi();
        if (!apiA) {
          console.warn('SKIP: playwright-core / chromium unavailable');
          return;
        }
        apis.push(apiA);

        const opened = await apiA.open({ url: `${fixture.base}/ok`, mode: 'headless' });
        expect(opened.success).toBe(true);
        sessionId = opened.session.id;

        const record = await loadSessionRecord(sessionId);
        expect(record?.endpoint).toBeTruthy();
        endpoint = record?.endpoint ?? '';
        expect(await probeEndpoint(endpoint)).toBe(true);

        // ── second "process": a brand-new api with no in-memory session ──
        const apiB = await tryPersistentApi();
        if (!apiB) throw new Error('could not create a second persistent host api');
        apis.push(apiB);

        const navigated = await apiB.navigate({ sessionId, url: `${fixture.base}/missing` });
        expect(navigated.success).toBe(true);
        const snapshot = await apiB.takeSnapshot({ sessionId });
        expect(snapshot.success).toBe(true);

        // The persisted window is what a later `verify --session` will judge.
        const missingWindow = await loadWindow(sessionId);
        expect(missingWindow?.url).toContain('/missing');
        expect(missingWindow?.requests.some((row) => row.status === 404)).toBe(true);

        // ── third "process": navigating again resets the window to the new page ──
        const apiC = await tryPersistentApi();
        if (!apiC) throw new Error('could not create a third persistent host api');
        apis.push(apiC);

        await apiC.navigate({ sessionId, url: `${fixture.base}/ok` });
        const okWindow = await loadWindow(sessionId);
        expect(okWindow?.url).toContain('/ok');
        expect(okWindow?.requests.some((row) => row.status === 404)).toBe(false);

        // close must terminate the detached browser, not merely disconnect from it.
        await apiC.close({ sessionId });
        expect(await probeEndpoint(endpoint, 1500)).toBe(false);
        // The record is the authoritative "session is gone" signal.
        expect(await loadSessionRecord(sessionId)).toBeNull();
        // Successful close includes profile cleanup; exhaustion is a retryable error.
        expect(existsSync(sessionDir(sessionId))).toBe(false);
      } finally {
        for (const api of apis) {
          if (sessionId) {
            await Promise.resolve(api.close({ sessionId })).catch(() => undefined);
          }
        }
        await new Promise<void>((resolve) => fixture.server.close(() => resolve()));
        setWorkspaceRoot(undefined);
        // Same best-effort stance as the profile note above: `force: true` only
        // suppresses ENOENT, not EBUSY, and Node retries only when maxRetries is
        // set (default 0). Without this the teardown threw `EBUSY … profile\lockfile`
        // under full-suite load on Windows and failed a test whose assertions had
        // already passed. The temp dir is OS-reaped anyway.
        await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(
          () => undefined,
        );
      }
    },
    90_000,
  );
});
