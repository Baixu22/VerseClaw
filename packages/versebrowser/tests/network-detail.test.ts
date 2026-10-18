/**
 * TF-0103：`vb_network_detail` 成为真能力 —— agent 在真实站点调试时最缺的一块。
 *
 * 覆盖：拿到响应体、拿到请求/响应头、**敏感字段始终脱敏**（薄驱动无 full_access 通道）、
 * 未捕获/未知 id 如实报告。无 Chromium 时 SKIP，不红 CI。
 */
import { describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentBrowserFacade } from '../src/engine/facade.ts';
import { createPlaywrightHostApi } from '../src/engine/playwright-host-api.ts';
import type { AgentBrowserHostApi } from '../src/types/host-api.ts';

const PAGE = `<!doctype html><html><body><h1>fixture</h1>
<script>
  fetch('/api/data', { headers: { authorization: 'Bearer supersecret', 'x-trace': 'abc' } })
    .then((r) => r.json())
    .then((data) => { document.body.setAttribute('data-loaded', String(data.ok)); });
</script>
</body></html>`;

async function startFixture(): Promise<{ base: string; server: Server }> {
  const server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0] ?? '/';
    if (url === '/api/data') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, note: 'hello from the fixture' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { base: `http://127.0.0.1:${port}`, server };
}

type Detail = {
  id: string;
  url: string;
  status?: number;
  mimeType?: string;
  requestHeaders?: Array<{ name: string; value: string }>;
  responseHeaders?: Array<{ name: string; value: string }>;
  responseBody?: string;
  truncated?: boolean;
  redacted?: boolean;
};

describe('vb_network_detail (TF-0103)', () => {
  it('live：拿到响应体与头，且敏感请求头始终脱敏；未知 id 如实报告', async () => {
    let api: AgentBrowserHostApi;
    try {
      api = await createPlaywrightHostApi();
    } catch {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    const fixture = await startFixture();
    const root = await mkdtemp(join(tmpdir(), 'vb-netdetail-'));
    const facade = new AgentBrowserFacade({ api, evidenceRoot: root });
    const opened = await facade.open({ url: `${fixture.base}/`, mode: 'headless' });
    const sessionId = (opened.data as { session?: { id?: string } } | undefined)?.session?.id as string;

    try {
      // Wait until the page's fetch has been observed.
      await facade.wait({ sessionId, selector: 'body[data-loaded="true"]', timeoutMs: 5_000 });
      const listed = await facade.networkList(sessionId);
      const rows = (listed.data as { requests?: Array<{ id: string; url: string }> }).requests ?? [];
      const target = rows.find((row) => row.url.includes('/api/data'));
      expect(target).toBeTruthy();

      const result = await facade.networkDetail(sessionId, [target!.id, 'n-does-not-exist']);
      expect(result.ok).toBe(true);
      expect(String(result.content)).toContain('1/2 request(s) detailed');
      expect(String(result.content)).toContain('missing: n-does-not-exist');

      const data = result.data as { details: Detail[]; missing?: string[] };
      expect(data.missing).toEqual(['n-does-not-exist']);
      const detail = data.details[0] as Detail;
      expect(detail.url).toContain('/api/data');
      expect(detail.status).toBe(200);
      expect(detail.mimeType).toBe('application/json');
      expect(detail.responseBody).toContain('hello from the fixture');
      expect(detail.truncated).toBe(false);
      expect(detail.redacted).toBe(true);

      const authorization = detail.requestHeaders?.find(
        (header) => header.name.toLowerCase() === 'authorization',
      );
      expect(authorization?.value).toBe('[REDACTED]');
      const trace = detail.requestHeaders?.find((header) => header.name.toLowerCase() === 'x-trace');
      expect(trace?.value).toBe('abc');
      expect(detail.responseHeaders?.some((header) => header.name.toLowerCase() === 'content-type')).toBe(true);
    } finally {
      await facade.close(sessionId).catch(() => undefined);
      await new Promise<void>((resolve) => fixture.server.close(() => resolve()));
    }
  }, 90_000);

  it('空 id 列表直接拒绝，不静默返回空', async () => {
    let api: AgentBrowserHostApi;
    try {
      api = await createPlaywrightHostApi();
    } catch {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    const root = await mkdtemp(join(tmpdir(), 'vb-netdetail-empty-'));
    const facade = new AgentBrowserFacade({ api, evidenceRoot: root });
    const result = await facade.networkDetail('s-none', []);
    expect(result.ok).toBe(false);
    expect(String(result.error?.message)).toContain('at least one request id');
  }, 60_000);
});
