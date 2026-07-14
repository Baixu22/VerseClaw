import { beforeEach, describe, expect, it, vi } from 'vitest';

const runReachCommand = vi.hoisted(() => vi.fn());

vi.mock('../core/command.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../core/command.js')>(),
  runReachCommand,
}));

import { configureReachBrowserBridge } from '../core/browser-bridge.js';
import { setConfigSnapshot } from '../core/config.js';
import { twitterReadTool } from './twitter.js';
import { xiaohongshuReadTool } from './xiaohongshu.js';

const SYNTHETIC_SECRET = 'synthetic-auth-token-value';

describe('authenticated reader Browser handoff', () => {
  beforeEach(() => {
    runReachCommand.mockReset();
    runReachCommand.mockResolvedValue({
      code: 1,
      stdout: '',
      stderr: `Authorization: Bearer ${SYNTHETIC_SECRET}`,
      termination: null,
    });
    setConfigSnapshot({ browser_fallback: 'auto', browser_profile: 'work' });
    configureReachBrowserBridge(async () => ({ session: { id: 'login-session' } }));
  });

  it.each([
    {
      tool: twitterReadTool,
      id: 'twitter',
      args: { action: 'search', query: 'openclaw' },
      loginUrl: 'https://x.com/i/flow/login',
      retryName: 'twitter_read',
    },
    {
      tool: xiaohongshuReadTool,
      id: 'xiaohongshu',
      args: { action: 'search', keyword: 'openclaw' },
      loginUrl: 'https://www.xiaohongshu.com/login',
      retryName: 'xiaohongshu_read',
    },
  ])('returns a stable $id login handoff without CLI diagnostics', async ({
    tool,
    id,
    args,
    loginUrl,
    retryName,
  }) => {
    const result = await tool.execute(`handoff-${id}`, args);

    expect(result.details).toMatchObject({
      status: 'browser_login_required',
      success: false,
      profile: 'work',
      sessionId: 'login-session',
      loginUrl,
      retryTool: { name: retryName, arguments: args },
    });
    expect(JSON.stringify(result)).not.toContain(SYNTHETIC_SECRET);
  });

  it('redacts CLI credential material when Browser is unavailable', async () => {
    configureReachBrowserBridge(undefined);

    const result = await twitterReadTool.execute(
      'twitter-unavailable',
      { action: 'search', query: 'openclaw' },
    );

    expect(result.details).toMatchObject({
      status: 'error',
      browserFallback: 'unavailable',
    });
    expect(JSON.stringify(result)).not.toContain(SYNTHETIC_SECRET);
    expect(JSON.stringify(result)).not.toContain(`Bearer ${SYNTHETIC_SECRET}`);
  });
});
