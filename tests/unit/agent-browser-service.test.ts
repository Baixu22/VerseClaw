import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentBrowserService } from '@electron/services/agent-browser-service';
import { createAgentBrowserApi } from '@electron/services/agent-browser-api';

class FakeWebContents extends EventEmitter {
  url = '';
  title = '';
  scripts: string[] = [];

  getURL() {
    return this.url;
  }

  getTitle() {
    return this.title;
  }

  async executeJavaScript(script: string) {
    this.scripts.push(script);
    if (script.includes('document.body')) return 'sample text';
    if (script.includes('document.querySelector(selector)')) return true;
    if (script.includes('eval(')) return { ok: true };
    return true;
  }

  async capturePage() {
    return { toDataURL: () => 'data:image/png;base64,abc' };
  }
}

class FakeWindow {
  readonly webContents = new FakeWebContents();
  closed = false;
  shown = false;

  async loadURL(url: string) {
    this.webContents.url = url;
    this.webContents.title = 'Loaded page';
    queueMicrotask(() => {
      this.webContents.emit('dom-ready');
      this.webContents.emit('did-finish-load');
    });
  }

  close() {
    this.closed = true;
  }

  isDestroyed() {
    return this.closed;
  }

  show() {
    this.shown = true;
  }

  setBounds() {}
}

describe('agent browser service', () => {
  it('prefers the bundled agent-browser CLI runner when available', async () => {
    const createWindow = vi.fn(() => {
      throw new Error('BrowserWindow fallback should not be used');
    });
    const runner = {
      isAvailable: vi.fn(() => true),
      open: vi.fn(async () => ({ url: 'https://example.com/', title: 'CLI page' })),
      navigate: vi.fn(async () => ({ url: 'https://vercel.com/', title: 'Vercel' })),
      waitForSelector: vi.fn(async () => ({ title: 'Ready' })),
      click: vi.fn(async () => ({ title: 'Clicked' })),
      type: vi.fn(async () => ({ title: 'Typed' })),
      evaluate: vi.fn(async () => ({ session: { title: 'Evaluated' }, value: 42 })),
      screenshot: vi.fn(async () => ({ session: { title: 'Shot' }, dataUrl: 'data:image/png;base64,cli' })),
      command: vi.fn(async () => ({
        session: { title: 'Snapshot' },
        data: { tree: [] },
        stdout: '{"success":true,"data":{"tree":[]}}',
        stderr: '',
        command: ['--json', 'snapshot'],
      })),
      textSample: vi.fn(async () => 'cli text'),
      close: vi.fn(async () => undefined),
    };
    const service = new AgentBrowserService({
      cliRunner: runner,
      createWindow: createWindow as never,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });

    const opened = await service.open({ url: 'example.com', profile: 'Work' });

    expect(createWindow).not.toHaveBeenCalled();
    expect(runner.open).toHaveBeenCalledWith({
      session: expect.objectContaining({
        id: opened.session.id,
        profile: 'work',
        authPersistence: 'session-name',
        authStateName: 'work',
        connection: { mode: 'managed' },
      }),
      url: 'https://example.com/',
      width: 1280,
      height: 900,
    });
    expect(opened).toMatchObject({
      session: {
        profile: 'work',
        mode: 'headless',
        authPersistence: 'session-name',
        authStateName: 'work',
        connection: { mode: 'managed' },
        url: 'https://example.com/',
        title: 'CLI page',
      },
      textSample: 'cli text',
    });

    await expect(service.navigate({ sessionId: opened.session.id, url: 'vercel.com' }))
      .resolves.toMatchObject({ title: 'Vercel' });
    await expect(service.click({ sessionId: opened.session.id, selector: '#submit' }))
      .resolves.toMatchObject({ title: 'Clicked' });
    await expect(service.type({ sessionId: opened.session.id, selector: '#name', text: 'Ada', clear: false }))
      .resolves.toMatchObject({ title: 'Typed' });
    await expect(service.evaluate({ sessionId: opened.session.id, expression: '21 * 2' }))
      .resolves.toMatchObject({ session: { title: 'Evaluated' }, value: 42 });
    await expect(service.screenshot({ sessionId: opened.session.id }))
      .resolves.toMatchObject({ dataUrl: 'data:image/png;base64,cli', format: 'png' });
    await expect(service.command({ sessionId: opened.session.id, args: ['snapshot', '-i'] }))
      .resolves.toMatchObject({
        session: { title: 'Snapshot' },
        data: { tree: [] },
        command: ['--json', 'snapshot'],
      });
    expect(runner.command).toHaveBeenCalledWith({
      session: expect.objectContaining({
        id: opened.session.id,
        authPersistence: 'session-name',
        authStateName: 'work',
      }),
      args: ['snapshot', '-i'],
      globalOptions: undefined,
      timeoutMs: undefined,
      maxOutput: undefined,
    });
    await expect(service.command({ sessionId: opened.session.id, args: ['snapshot', '--session', 'other'] }))
      .rejects.toThrow('managed CLI flag');
    await expect(service.command({ sessionId: opened.session.id, args: ['snapshot'], globalOptions: ['--auto-connect'] }))
      .rejects.toThrow('managed CLI flag');
    await expect(service.command({ args: ['snapshot'], connectionMode: 'auto-connect' }))
      .rejects.toThrow('allowExternalBrowser=true');
    await expect(service.command({ args: ['profiles'], profile: 'Work', mode: 'visible' }))
      .resolves.toMatchObject({
        session: {
          profile: 'work',
          mode: 'visible',
          authPersistence: 'session-name',
          authStateName: 'work',
          connection: { mode: 'managed' },
        },
      });
    expect(runner.command).toHaveBeenLastCalledWith({
      session: expect.objectContaining({
        profile: 'work',
        mode: 'visible',
        authPersistence: 'session-name',
        authStateName: 'work',
      }),
      args: ['profiles'],
      globalOptions: undefined,
      timeoutMs: undefined,
      maxOutput: undefined,
    });
    await expect(service.command({
      args: ['snapshot'],
      profile: 'Mail',
      authStateName: 'gmail-account',
      connectionMode: 'auto-connect',
      allowExternalBrowser: true,
    })).resolves.toMatchObject({
      session: {
        profile: 'mail',
        authStateName: 'gmail-account',
        connection: { mode: 'auto-connect' },
      },
    });
    expect(runner.command).toHaveBeenLastCalledWith({
      session: expect.objectContaining({
        profile: 'mail',
        authStateName: 'gmail-account',
        connection: { mode: 'auto-connect' },
      }),
      args: ['snapshot'],
      globalOptions: undefined,
      timeoutMs: undefined,
      maxOutput: undefined,
    });

    service.close(opened.session.id);
    expect(runner.close).toHaveBeenCalledWith(expect.objectContaining({ id: opened.session.id }));
  });

  it('drives a hidden BrowserWindow session', async () => {
    const windows: FakeWindow[] = [];
    const service = new AgentBrowserService({
      createWindow: (options) => {
        expect(options.show).toBe(false);
        expect(options.webPreferences?.partition).toBe('persist:agent-browser-work');
        const win = new FakeWindow();
        windows.push(win);
        return win as never;
      },
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });

    const opened = await service.open({
      url: 'example.com',
      profile: 'Work',
      mode: 'headless',
    });

    expect(opened.session).toMatchObject({
      profile: 'work',
      mode: 'headless',
      url: 'https://example.com/',
      title: 'Loaded page',
    });
    expect(opened.textSample).toBe('sample text');

    await expect(service.click({ sessionId: opened.session.id, selector: '#submit' }))
      .resolves.toMatchObject({ id: opened.session.id });
    await expect(service.type({ sessionId: opened.session.id, selector: '#name', text: 'Ada' }))
      .resolves.toMatchObject({ id: opened.session.id });
    await expect(service.evaluate({ sessionId: opened.session.id, expression: '({ ok: true })' }))
      .resolves.toMatchObject({ value: { ok: true } });
    await expect(service.screenshot({ sessionId: opened.session.id }))
      .resolves.toMatchObject({ dataUrl: 'data:image/png;base64,abc', format: 'png' });

    expect(service.list()).toHaveLength(1);
    service.close(opened.session.id);
    expect(windows[0].closed).toBe(true);
    expect(service.list()).toHaveLength(0);
  });

  it('lists and saves reusable browser profiles', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'agent-browser-profiles-'));
    try {
      await mkdir(join(userDataPath, 'agent-browser', 'profiles', 'work'), { recursive: true });
      const service = new AgentBrowserService({
        userDataPath,
        now: () => new Date('2026-01-01T00:00:00.000Z'),
      });

      await expect(service.listProfiles()).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ profile: 'default', authStateName: 'default' }),
        expect.objectContaining({ profile: 'work', source: 'profile-dir' }),
      ]));

      await expect(service.saveProfile({
        profile: 'Work Mail',
        label: 'Work Mail',
        description: 'Gmail login',
        authStateName: 'gmail-main',
      })).resolves.toMatchObject({
        profile: 'work-mail',
        label: 'Work Mail',
        description: 'Gmail login',
        authStateName: 'gmail-main',
        source: 'metadata',
      });

      await expect(service.listProfiles()).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({
          profile: 'work-mail',
          label: 'Work Mail',
          authStateName: 'gmail-main',
        }),
      ]));
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  });

  it('validates a browser task and cleans up the temporary session', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'agent-browser-validate-'));
    const windows: FakeWindow[] = [];
    const service = new AgentBrowserService({
      userDataPath,
      createWindow: () => {
        const win = new FakeWindow();
        windows.push(win);
        return win as never;
      },
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });

    try {
      const result = await service.validate({
        url: 'https://example.com/check-in',
        expectedDomains: ['example.com'],
        diagnostics: { snapshot: true, screenshot: true },
      });

      expect(result).toMatchObject({
        success: true,
        ok: true,
        url: 'https://example.com/check-in',
        title: 'Loaded page',
        textSample: 'sample text',
        screenshotDataUrl: 'data:image/png;base64,abc',
        runResult: {
          schemaVersion: 1,
          status: 'success',
          finalUrl: 'https://example.com/check-in',
          loginState: 'unknown',
        },
      });
      expect(result.diagnostics).toHaveProperty('snapshot');
      expect(result.runResult?.steps.map((step) => step.id)).toEqual(expect.arrayContaining(['open', 'domain', 'snapshot', 'screenshot']));
      expect(result.runResult?.evidence.artifacts.map((artifact) => artifact.kind)).toEqual(expect.arrayContaining(['snapshot', 'screenshot']));
      const manifestPath = join(userDataPath, 'agent-browser', 'run-artifacts', result.runResult!.runId, 'manifest.json');
      await expect(readFile(manifestPath, 'utf8')).resolves.toContain('"schemaVersion": 1');
      expect(windows[0].closed).toBe(true);
      expect(service.list()).toHaveLength(0);
    } finally {
      await rm(userDataPath, { recursive: true, force: true });
    }
  });

  it('returns validation failures without keeping the session open', async () => {
    const windows: FakeWindow[] = [];
    const service = new AgentBrowserService({
      createWindow: () => {
        const win = new FakeWindow();
        windows.push(win);
        return win as never;
      },
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });

    const result = await service.validate({
      url: 'https://evil.example/',
      expectedDomains: ['example.com'],
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('outside allowed domains');
    expect(windows[0].closed).toBe(true);
    expect(service.list()).toHaveLength(0);
  });

  it('exposes the service through the host api adapter', async () => {
    const service = {
      open: vi.fn(async () => ({ session: { id: 's1' }, textSample: 'ok' })),
      list: vi.fn(() => [{ id: 's1' }]),
      listProfiles: vi.fn(async () => [{ profile: 'default', source: 'metadata' }]),
      saveProfile: vi.fn(async () => ({ profile: 'work', source: 'metadata' })),
      validate: vi.fn(async () => ({ success: true, ok: true, title: 'Ready' })),
      navigate: vi.fn(async () => ({ id: 's1' })),
      waitForSelector: vi.fn(async () => ({ id: 's1' })),
      click: vi.fn(async () => ({ id: 's1' })),
      type: vi.fn(async () => ({ id: 's1' })),
      evaluate: vi.fn(async () => ({ session: { id: 's1' }, value: 1 })),
      screenshot: vi.fn(async () => ({ session: { id: 's1' }, dataUrl: 'data:image/png;base64,abc', format: 'png' as const })),
      command: vi.fn(async () => ({
        session: { id: 's1' },
        data: { ok: true },
        stdout: '{"success":true,"data":{"ok":true}}',
        stderr: '',
        command: ['--json', 'snapshot'],
      })),
      close: vi.fn(),
    };

    const api = createAgentBrowserApi(service as never);

    await expect(api.open({ url: 'https://example.com' })).resolves.toMatchObject({
      success: true,
      session: { id: 's1' },
    });
    expect(api.status()).toMatchObject({ success: true, sessions: [{ id: 's1' }] });
    await expect(api.profiles()).resolves.toMatchObject({
      success: true,
      profiles: [{ profile: 'default' }],
    });
    await expect(api.saveProfile({ profile: 'Work' })).resolves.toMatchObject({
      success: true,
      profile: { profile: 'work' },
    });
    await expect(api.validate({ url: 'https://example.com' })).resolves.toMatchObject({
      success: true,
      ok: true,
      title: 'Ready',
    });
    await expect(api.evaluate({ sessionId: 's1', expression: '1' })).resolves.toMatchObject({
      success: true,
      value: 1,
    });
    await expect(api.command({ sessionId: 's1', args: ['snapshot'] })).resolves.toMatchObject({
      success: true,
      data: { ok: true },
    });
    expect(api.close({ sessionId: 's1' })).toEqual({ success: true });
    expect(service.command).toHaveBeenCalledWith({ sessionId: 's1', args: ['snapshot'] });
    expect(service.saveProfile).toHaveBeenCalledWith({ profile: 'Work' });
    expect(service.validate).toHaveBeenCalledWith({ url: 'https://example.com' });
    expect(service.close).toHaveBeenCalledWith('s1');
  });
});
