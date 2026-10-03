import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { completeSetup, expect, test } from './fixtures/electron';

const TOOL_NAMES = [
  'web_read',
  'rss_read',
  'v2ex_read',
  'xueqiu_read',
  'bilibili_read',
  'youtube_read',
  'github_read',
  'twitter_read',
  'xiaohongshu_read',
];

test.describe('Reach Readers packaged plugin', () => {
  test('ships enabled with readonly tool contracts and a credential-safe handoff skill', async ({ page }) => {
    await completeSetup(page);
    await expect(page.getByTestId('main-layout')).toBeVisible();

    // The packaged `build/openclaw-runtime/` tree is produced only by the
    // electron-builder bundle step (scripts/bundle-openclaw-runtime.mjs), which
    // copies the runtime workspace verbatim and does not run during e2e. Read the
    // authoritative runtime source that the bundle ships and that the app loads.
    const pluginDir = join(
      process.cwd(),
      'openclaw_runtime',
      'extensions',
      'reach-readers',
    );
    const manifest = JSON.parse(await readFile(
      join(pluginDir, 'openclaw.plugin.json'),
      'utf8',
    )) as {
      enabledByDefault?: boolean;
      activation?: { onStartup?: boolean };
      contracts?: { tools?: string[] };
    };
    const skill = await readFile(
      join(pluginDir, 'skills', 'agent-reach-login-handoff', 'SKILL.md'),
      'utf8',
    );

    expect(manifest.enabledByDefault).toBe(true);
    expect(manifest.activation?.onStartup).toBe(true);
    expect(manifest.contracts?.tools).toEqual(TOOL_NAMES);
    expect(skill).toContain('browser_login_required');
    expect(skill).toContain('sessionId');
    expect(skill).toContain('retryTool');
    expect(skill).toContain('Never');

    const body = page.locator('body');
    await expect(body).not.toContainText('TWITTER_AUTH_TOKEN');
    await expect(body).not.toContainText('xq_a_token');
  });
});
