import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AgentBrowserCliRunner } from '@electron/services/agent-browser-cli-runner';
import type { AgentBrowserSession } from '@shared/host-api/contract';

describe('agent browser CLI runner', () => {
  it('forms isolated agent-browser commands with a persistent profile path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'clawx-agent-browser-test-'));
    const calls: Array<{ file: string; args: string[]; cwd?: string }> = [];
    const execFileMock = vi.fn((file, args, options, callback) => {
      calls.push({ file, args, cwd: options.cwd });
      const command = args.slice(-2).join(' ');
      if (command === 'get url') {
        callback(null, '{"success":true,"data":{"url":"https://example.com/"}}', '');
        return;
      }
      if (command === 'get title') {
        callback(null, '{"success":true,"data":{"title":"Example Domain"}}', '');
        return;
      }
      callback(null, '{"success":true,"data":{"ok":true}}', '');
    });
    const runner = new AgentBrowserCliRunner({
      binPath: join(root, 'agent-browser.exe'),
      cwd: join(root, 'work'),
      userDataPath: join(root, 'user-data'),
      execFile: execFileMock as never,
    });
    const session: AgentBrowserSession = {
      id: 'session-1',
      profile: 'work',
      mode: 'headless',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    await expect(runner.open({ session, url: 'https://example.com/', width: 1024, height: 768 }))
      .resolves.toMatchObject({
        url: 'https://example.com/',
        title: 'Example Domain',
      });

    expect(calls[0]).toMatchObject({
      file: join(root, 'agent-browser.exe'),
      cwd: join(root, 'work'),
    });
    expect(calls[0].args).toEqual([
      '--json',
      '--session',
      'session-1',
      '--profile',
      join(root, 'user-data', 'agent-browser', 'profiles', 'work'),
      'open',
      'https://example.com/',
    ]);
    expect(calls[1].args.slice(-4)).toEqual(['set', 'viewport', '1024', '768']);
  });

  it('reads CLI screenshots back as PNG data URLs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'clawx-agent-browser-test-'));
    const png = Buffer.from('png-bytes');
    const execFileMock = vi.fn(async (file, args, options, callback) => {
      if (args.includes('screenshot')) {
        await writeFile(args.at(-1)!, png);
      }
      if (args.at(-1) === 'url') {
        callback(null, '{"success":true,"data":{"url":"https://example.com/"}}', '');
        return;
      }
      if (args.at(-1) === 'title') {
        callback(null, '{"success":true,"data":{"title":"Example Domain"}}', '');
        return;
      }
      callback(null, '{"success":true,"data":{"ok":true}}', '');
    });
    const runner = new AgentBrowserCliRunner({
      binPath: join(root, 'agent-browser.exe'),
      cwd: join(root, 'work'),
      userDataPath: join(root, 'user-data'),
      execFile: execFileMock as never,
    });
    const session: AgentBrowserSession = {
      id: 'session-1',
      profile: 'work',
      mode: 'headless',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    await expect(runner.screenshot(session)).resolves.toMatchObject({
      dataUrl: `data:image/png;base64,${png.toString('base64')}`,
      session: { url: 'https://example.com/', title: 'Example Domain' },
    });
  });

  it('runs advanced CLI commands within the managed session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'clawx-agent-browser-test-'));
    const calls: Array<{ args: string[] }> = [];
    const execFileMock = vi.fn((file, args, options, callback) => {
      calls.push({ args });
      if (args.at(-2) === 'get' && args.at(-1) === 'url') {
        callback(null, '{"success":true,"data":{"url":"https://example.com/"}}', '');
        return;
      }
      if (args.at(-2) === 'get' && args.at(-1) === 'title') {
        callback(null, '{"success":true,"data":{"title":"Example Domain"}}', '');
        return;
      }
      callback(null, '{"success":true,"data":{"snapshot":"ok"}}', 'debug');
    });
    const runner = new AgentBrowserCliRunner({
      binPath: join(root, 'agent-browser.exe'),
      cwd: join(root, 'work'),
      userDataPath: join(root, 'user-data'),
      execFile: execFileMock as never,
    });
    const session: AgentBrowserSession = {
      id: 'session-1',
      profile: 'work',
      mode: 'headless',
      authPersistence: 'session-name',
      authStateName: 'mail',
      connection: { mode: 'cdp', cdpEndpoint: '9222' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    await expect(runner.command({
      session,
      args: ['snapshot', '-i'],
      globalOptions: ['--ignore-https-errors'],
      maxOutput: 2000,
    })).resolves.toMatchObject({
      data: { snapshot: 'ok' },
      stderr: 'debug',
      session: { url: 'https://example.com/', title: 'Example Domain' },
    });

    expect(calls[0].args).toEqual([
      '--json',
      '--session',
      'session-1',
      '--profile',
      join(root, 'user-data', 'agent-browser', 'profiles', 'work'),
      '--session-name',
      'mail',
      '--cdp',
      '9222',
      '--max-output',
      '2000',
      '--ignore-https-errors',
      'snapshot',
      '-i',
    ]);
  });
});
