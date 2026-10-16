/**
 * TF-0105：`vb_runtime_read`（inspect-globals）成为真能力 —— 薄驱动上用**固定模板**
 * 读公开全局对象的形状，深度 / 条数 / 字节有界，键值脱敏，accessor 不触发。
 *
 * 覆盖：未提权时显式失败（`E_RUNTIME_MODE`）、提权后可读、敏感键脱敏、长串与深对象
 * 截断、危险路径拒绝、不存在的路径如实 `exists: false`、revoke 后立即回到拒绝。
 * 无 Chromium 时 SKIP，不红 CI。
 */
import { describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentBrowserFacade } from '../src/engine/facade.ts';
import { createPlaywrightHostApi } from '../src/engine/playwright-host-api.ts';
import { TOOL_CATALOG } from '../src/mcp/server.ts';
import { TOOL_AVAILABILITY } from '../src/mcp/tool-availability.ts';
import { PLAYWRIGHT_DRIVER_METHODS } from '../src/engine/driver-profile.ts';
import { requiredCapability, toolGroup } from '../src/mcp/capability-policy.ts';
import type { AgentBrowserHostApi } from '../src/types/host-api.ts';

const PAGE = `<!doctype html><html><body><h1>fixture</h1>
<script>
  window.__VAULT__ = {
    private_key: 'PRIVATE-MATERIAL-VALUE',
    otp: '482915',
    pin: '7788',
    sid: 'sid-abcdef123456'
  };
  window.__APP_CONFIG__ = {
    apiKey: 'sk-live-very-secret-value',
    region: 'us-east-1',
    nested: { deep: { deeper: { value: 'too-deep-to-return' } } },
    long: new Array(2000).join('x')
  };
</script>
</body></html>`;

async function startFixture(): Promise<{ base: string; server: Server }> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { base: `http://127.0.0.1:${port}`, server };
}

describe('vb_runtime_read 接口面（TF-0105，静态）', () => {
  it('只声明 inspect-globals，且已接线并登记驱动方法', () => {
    const tool = TOOL_CATALOG.find((entry) => entry.name === 'vb_runtime_read');
    expect(tool).toBeTruthy();
    const properties = (tool?.inputSchema as { properties?: Record<string, { enum?: string[] }> })
      .properties;
    expect(properties?.action?.enum).toEqual(['inspect-globals']);
    expect((tool?.inputSchema as { required?: string[] }).required).toEqual(['sessionId', 'paths']);

    expect(TOOL_AVAILABILITY.vb_runtime_read?.wired).toBe(true);
    expect(TOOL_AVAILABILITY.vb_runtime_read?.requiresDriverMethods).toEqual([
      'runtimeInspectGlobals',
    ]);
    expect(PLAYWRIGHT_DRIVER_METHODS).toContain('runtimeInspectGlobals');
    expect(toolGroup('vb_runtime_read')).toBe('debug');
    expect(requiredCapability('vb_runtime_read')).toBe('debug.runtime');
  });
});

describe('vb_runtime_read（TF-0105）', () => {
  it('live：未提权拒绝、提权后读形状并脱敏截断、危险路径拒绝、revoke 后立即拒绝', async () => {
    let api: AgentBrowserHostApi | null = null;
    try {
      api = await createPlaywrightHostApi();
    } catch {
      console.warn('SKIP: playwright-core / chromium unavailable');
      return;
    }
    const fixture = await startFixture();
    const root = await mkdtemp(join(tmpdir(), 'vb-runtime-read-'));
    const facade = new AgentBrowserFacade({
      api,
      evidenceRoot: root,
      driverProfile: { kind: 'playwright', methods: new Set(PLAYWRIGHT_DRIVER_METHODS) },
    });
    const opened = await facade.open({ url: `${fixture.base}/`, mode: 'headless' });
    const sessionId = (opened.data as { session?: { id?: string } } | undefined)?.session?.id as string;

    try {
      // Deep read is not a normal-mode observation (same rule as the host engine).
      const before = await facade.runtimeRead({
        sessionId,
        paths: ['window.__APP_CONFIG__'],
      });
      expect(before.ok).toBe(false);
      expect(before.error?.code).toBe('E_RUNTIME_MODE');
      expect(String(before.error?.message)).toContain('controlled_enhanced');

      const upgraded = await facade.requestModeUpgrade({
        sessionId,
        target: 'controlled_enhanced',
        confirmed: true,
      });
      expect(upgraded.ok).toBe(true);

      const read = await facade.runtimeRead({
        sessionId,
        paths: ['window.__APP_CONFIG__'],
      });
      expect(read.ok).toBe(true);
      expect(String(read.content)).toContain('运行时全局摘要');
      expect(String(read.content)).toContain('region');
      // Sensitive key + long value are handled before the value leaves the page.
      expect(String(read.content)).toContain('[REDACTED]');
      expect(String(read.content)).not.toContain('sk-live-very-secret-value');
      const data = read.data as { action?: string; redacted?: boolean; truncated?: boolean };
      expect(data.action).toBe('inspect-globals');
      expect(data.redacted).toBe(true);
      expect(data.truncated).toBe(true);

      // C96/#129: the key list must also cover the field-family names (private_key / otp / pin).
      // Measured 2026-10-14: all three came back verbatim while the read still reported redacted:true.
      const vault = await facade.runtimeRead({ sessionId, paths: ['window.__VAULT__'] });
      expect(vault.ok).toBe(true);
      const vaultText = String(vault.content);
      for (const secret of ['PRIVATE-MATERIAL-VALUE', '482915', '7788', 'sid-abcdef123456']) {
        expect(vaultText, secret).not.toContain(secret);
      }
      expect((vault.data as { redacted?: boolean }).redacted).toBe(true);

      // Arbitrary JavaScript stays rejected: the template only accepts dotted paths.
      const injected = await facade.runtimeRead({
        sessionId,
        paths: ["window.fetch('https://evil.example')"],
      });
      expect(injected.ok).toBe(false);
      expect(injected.error?.code).toBe('E_RUNTIME_READ');
      expect(String(injected.error?.message)).toContain('不能传入 JavaScript 表达式');

      // A missing global is a fact, not an error.
      const missing = await facade.runtimeRead({
        sessionId,
        paths: ['__NOT_DEFINED_ANYWHERE__'],
      });
      expect(missing.ok).toBe(true);
      expect(String(missing.content)).toContain('__NOT_DEFINED_ANYWHERE__');
      expect(String(missing.content)).toContain('"exists": false');

      const revoked = await facade.revokeMode(sessionId);
      expect(revoked.ok).toBe(true);
      const after = await facade.runtimeRead({ sessionId, paths: ['window.__APP_CONFIG__'] });
      expect(after.ok).toBe(false);
      expect(after.error?.code).toBe('E_RUNTIME_MODE');
    } finally {
      await facade.close(sessionId).catch(() => undefined);
      await new Promise<void>((resolve) => fixture.server.close(() => resolve()));
    }
  }, 90_000);
});
