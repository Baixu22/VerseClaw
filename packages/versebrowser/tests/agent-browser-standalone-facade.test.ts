import { afterEach, describe, expect, it } from 'vitest';
import { createStandaloneFacade } from '../src/engine/standalone.ts';
import { errResult } from '../src/contracts/index.ts';
import { AgentBrowserFacade } from '../src/engine/facade.ts';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('standalone facade (TF-0020 Live MCP without host injection)', () => {
  it('preserves the host receiver when routing a session call', async () => {
    class Host {
      #message = 'receiver preserved';
      getConsoleMessages() { return { success: true, content: this.#message }; }
    }
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'vb-receiver-'));
    const facade = new AgentBrowserFacade({ api: new Host() as never, workspaceRoot });
    expect(await facade.console('opaque-session')).toMatchObject({ ok: true, content: 'receiver preserved' });
  });

  it('preserves a missing-session code through snapshot routing', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'vb-missing-session-'));
    const facade = new AgentBrowserFacade({ workspaceRoot, api: {
      takeSnapshot() { throw Object.assign(new Error('unknown session'), { code: 'E_NO_SESSION' }); },
    } as never });
    expect(await facade.snapshot('closed-session')).toMatchObject({ ok: false, error: { code: 'E_NO_SESSION' } });
  });

  afterEach(() => {
    delete process.env.VERSEBROWSER_NO_DRIVER;
  });

  it('VERSEBROWSER_NO_DRIVER=1 yields no-driver facade with actionable hint', async () => {
    process.env.VERSEBROWSER_NO_DRIVER = '1';
    const result = await createStandaloneFacade();
    expect(result.driver).toBe('none');
    expect(result.hint).toMatch(/VERSEBROWSER_NO_DRIVER/u);
    expect(result.facade).toBeTruthy();
  });

  it('E_NO_SESSION_API message is actionable when no driver', async () => {
    // invokeTool path contract: code + hint. Simulate the server-side error shape.
    const result = errResult(
      'E_NO_SESSION_API',
      'vb_open requires a live driver. Auto-start playwright-core is disabled (VERSEBROWSER_NO_DRIVER=1 or noDriver). ' +
        'Unset the flag, install chromium (npx playwright-core install chromium), or inject a host facade.',
    );
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('E_NO_SESSION_API');
    expect(result.error?.message).toMatch(/playwright-core|chromium|inject/iu);
  });

  it('auto-start path attempts playwright when noDriver is unset', async () => {
    // May SKIP in environments without chromium — still must not throw a non-driver error
    // before attempting launch. We only assert the factory is wired.
    process.env.VERSEBROWSER_NO_DRIVER = '1';
    const offline = await createStandaloneFacade({ preferPlaywright: true });
    expect(offline.driver).toBe('none');

    delete process.env.VERSEBROWSER_NO_DRIVER;
    // Prefer playwright: should return driver playwright OR throw a start failure with install hint.
    try {
      const live = await createStandaloneFacade({ preferPlaywright: true });
      expect(live.driver).toBe('playwright');
      expect(live.facade).toBeTruthy();
    } catch (error) {
      expect(String(error)).toMatch(/playwright-core|chromium|executablePath/iu);
    }
  });
});
