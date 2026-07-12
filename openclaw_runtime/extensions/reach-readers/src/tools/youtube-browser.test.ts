import { beforeEach, describe, expect, it, vi } from 'vitest';

const runReachCommand = vi.hoisted(() => vi.fn());

vi.mock('../core/command.js', () => ({
  runReachCommand,
  commandError: () => new Error('yt-dlp unavailable'),
}));

import { configureReachBrowserBridge } from '../core/browser-bridge.js';
import { setConfigSnapshot } from '../core/config.js';
import { youtubeReadTool } from './youtube.js';

describe('youtube_read Agent Browser fallback', () => {
  beforeEach(() => {
    runReachCommand.mockResolvedValue({
      code: 1,
      stdout: '',
      stderr: 'yt-dlp unavailable',
      termination: null,
    });
    setConfigSnapshot({ browser_fallback: 'auto', browser_profile: 'default' });
  });

  it('returns a Browser page summary after yt-dlp fails', async () => {
    const invoke = vi.fn(async ({ action, payload }) => {
      if (action === 'open') return { session: { id: 'youtube-1' } };
      if (action === 'command') {
        const args = payload.args as string[];
        return { output: args[1] === 'title' ? 'Video' : args[1] === 'url'
          ? 'https://www.youtube.com/watch?v=test'
          : 'Video page text' };
      }
      return { success: true };
    });
    configureReachBrowserBridge(invoke);

    const result = await youtubeReadTool.execute(
      'youtube-browser',
      { action: 'info', url: 'https://www.youtube.com/watch?v=test' },
    );

    expect(result.details).toMatchObject({
      status: 'ok',
      success: true,
      backend: 'agent-browser',
      browserFallback: 'used',
      title: 'Video',
      text: 'Video page text',
    });
  });
});
