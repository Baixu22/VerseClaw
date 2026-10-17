/**
 * 快照不得泄漏密钥值（C96）。
 *
 * 实测（真实 Chromium）：填了值的 `<input type="password">` 曾是
 *   - [e2] textbox | "password" | value="SuperSecret-Passw0rd!"
 * 而且这个值能穿透**每一层** —— facade 载荷、`includeText`、`diagnose_page`、
 * 以及 MCP 信封（其脱敏正则只匹配 `key=value` / `key: value`，不匹配这种
 * `name | value=` 形状）。这与产品自己「凭据会被 redact」的承诺直接冲突。
 * `page_text` 从不受影响（它不读 value）。
 *
 * 修复：密码框与「名字像密钥」的字段保留字段名 + 共享标记，值永不出页面。
 * 非密钥字段的值**逐字节不变**（本文件最后一条对照）。
 *
 * 页面用**本机 HTTP** 提供而非 data: URL：否则密文会出现在 `- url:` 行里，
 * 让 `includes(SECRET)` 变成假阳性（我第一版探针就是这样误报的）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPlaywrightHostApi } from '../src/engine/playwright-host-api.ts';
import { AgentBrowserFacade } from '../src/engine/facade.ts';
import {
  buildCollectInteractiveExpression,
  formatActionableSnapshot,
} from '../src/engine/interactive-snapshot.ts';
import { renderToolResultText } from '../src/mcp/result-envelope.ts';
import { REDACTED } from '../src/security/redact-secrets.ts';
import { chromium } from 'playwright-core';

const SECRET = 'SuperSecret-Passw0rd!';
const API_KEY = 'sk-live-ABC123';
const CSRF = 'csrf-token-9f3a1c';
const SID = 'sid-value-4b2d';
const SESSION = 'session-value-77aa';
const XSRF = 'xsrf-value-1c9e';

const HTML = `<!doctype html><html><body>
  <form>
    <label>Email <input id="email" type="email" name="email" value="user@example.com"></label>
    <label>Password <input id="pw" type="password" name="password"></label>
    <input id="token" type="text" name="api_key">
    <input id="csrf" type="text" name="csrf">
    <input id="sid" type="text" name="sid">
    <input id="session" type="text" name="session">
    <input id="xsrf" type="text" name="xsrf">
    <input id="search" type="text" name="q" value="ordinary text">
    <button type="submit">Sign in</button>
  </form>
  <script>
    document.getElementById('pw').value = ${JSON.stringify(SECRET)};
    document.getElementById('token').value = ${JSON.stringify(API_KEY)};
    document.getElementById('csrf').value = ${JSON.stringify(CSRF)};
    document.getElementById('sid').value = ${JSON.stringify(SID)};
    document.getElementById('session').value = ${JSON.stringify(SESSION)};
    document.getElementById('xsrf').value = ${JSON.stringify(XSRF)};
  </script>
</body></html>`;

let server: Server;
let url = '';
beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(HTML);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/login`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });

async function hasChromium(): Promise<boolean> {
  try { return chromium.executablePath().length > 0; } catch { return false; }
}

function skip(reason: string): void {
  console.warn(`SKIP: ${reason}`);
}

describe('snapshot must not leak secret values (C96)', () => {
  it('redacts password and secret-looking field values in the collected items', async () => {
    if (!(await hasChromium())) return skip('playwright-core / chromium unavailable');
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    try {
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'load' });
      const items = await page.evaluate(buildCollectInteractiveExpression({ clickable: 'off' })) as
        Array<{ name: string; value?: string; valueRedacted?: boolean }>;

      for (const item of items) {
        expect(item.value, `item "${item.name}" leaked its value`).not.toBe(SECRET);
        expect(item.value).not.toBe(API_KEY);
      }
      const password = items.find(item => item.name === 'password');
      expect(password?.value).toBe(REDACTED);
      expect(password?.valueRedacted).toBe(true);
      const token = items.find(item => item.name === 'api_key');
      expect(token?.value).toBe(REDACTED);
      expect(token?.valueRedacted).toBe(true);

      // The network alias names (session cookie / CSRF token) were missing from the field list.
      for (const [name, secret] of [['csrf', CSRF], ['sid', SID], ['session', SESSION], ['xsrf', XSRF]] as const) {
        const item = items.find(entry => entry.name === name);
        expect(item?.value, `${name} leaked its value`).toBe(REDACTED);
        expect(item?.valueRedacted, `${name} not marked redacted`).toBe(true);
        expect(item?.value).not.toBe(secret);
      }

      // A non-secret field keeps its real value, and says nothing about redaction.
      const search = items.find(item => item.name === 'q');
      expect(search?.value).toBe('ordinary text');
      expect(search?.valueRedacted).toBeUndefined();

      const snapshot = formatActionableSnapshot(
        { title: 't', url, htmlBytes: 1, textChars: 1 },
        items as never,
      );
      expect(snapshot).not.toContain(SECRET);
      expect(snapshot).not.toContain(API_KEY);
      for (const secret of [CSRF, SID, SESSION, XSRF]) expect(snapshot).not.toContain(secret);
      expect(snapshot).toContain('value_redacted');
    } finally {
      await browser.close();
    }
  }, 30_000);

  it('the secret never reaches the MCP envelope the model reads', async () => {
    if (!(await hasChromium())) return skip('playwright-core / chromium unavailable');
    const root = await mkdtemp(join(tmpdir(), 'vb-snap-secret-'));
    const api = await createPlaywrightHostApi();
    const facade = new AgentBrowserFacade({ api, evidenceRoot: root });
    try {
      const opened = await facade.open({ url, mode: 'headless' });
      const sessionId = (opened.data as { session?: { id?: string } } | undefined)?.session?.id as string;

      const snap = await facade.snapshot(sessionId);
      expect(String(snap.content)).not.toContain(SECRET);
      expect(JSON.stringify(snap.data)).not.toContain(SECRET);

      const envelope = renderToolResultText({
        ok: true,
        content: String(snap.content),
        data: snap.data,
      } as never);
      expect(envelope).not.toContain(SECRET);
      expect(envelope).not.toContain(API_KEY);
      for (const secret of [CSRF, SID, SESSION, XSRF]) expect(envelope).not.toContain(secret);

      const withText = await facade.snapshot(sessionId, { includeText: true, textChars: 5000 });
      expect(String(withText.content)).not.toContain(SECRET);

      const diag = await facade.diagnosePage({ sessionId });
      expect(String(diag.content) + JSON.stringify(diag.data)).not.toContain(SECRET);
    } finally {
      await Promise.resolve(facade.close?.('x')).catch(() => undefined);
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => undefined);
    }
  }, 60_000);
});
