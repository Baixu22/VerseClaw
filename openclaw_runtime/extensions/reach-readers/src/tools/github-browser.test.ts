import { beforeEach, describe, expect, it, vi } from 'vitest';

const runReachCommand = vi.hoisted(() => vi.fn());

vi.mock('../core/command.js', () => ({
  runReachCommand,
  commandError: () => new Error('gh unavailable'),
}));

import { configureReachBrowserBridge } from '../core/browser-bridge.js';
import { setConfigSnapshot } from '../core/config.js';
import { githubReadTool } from './github.js';

describe('github_read Agent Browser fallback', () => {
  beforeEach(() => {
    runReachCommand.mockResolvedValue({
      code: 1,
      stdout: '',
      stderr: 'gh unavailable',
      termination: null,
    });
    setConfigSnapshot({ browser_fallback: 'auto', browser_profile: 'default' });
  });

  it('returns a Browser page summary after gh fails', async () => {
    const invoke = vi.fn(async ({ action, payload }) => {
      if (action === 'open') return { session: { id: 'github-1' } };
      if (action === 'command') {
        const args = payload.args as string[];
        return { output: args[1] === 'title' ? 'Repository' : args[1] === 'url'
          ? 'https://github.com/openclaw/openclaw'
          : 'Repository README' };
      }
      return { success: true };
    });
    configureReachBrowserBridge(invoke);

    const result = await githubReadTool.execute(
      'github-browser',
      { action: 'readme', owner: 'openclaw', repo: 'openclaw' },
    );

    expect(result.details).toMatchObject({
      status: 'ok',
      success: true,
      backend: 'agent-browser',
      browserFallback: 'used',
      title: 'Repository',
      text: 'Repository README',
    });
  });
});
