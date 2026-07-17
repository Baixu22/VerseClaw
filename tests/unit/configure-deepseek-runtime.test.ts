import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('configure-deepseek-runtime formal entry point', () => {
  it('exposes the DeepSeek runtime configuration helper as a package script', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.['provider:deepseek:configure']).toBe(
      'node scripts/configure-deepseek-runtime.mjs',
    );
  });

  it('configures DeepSeek flash against isolated app data without printing secrets', async () => {
    const appData = await mkdtemp(join(tmpdir(), 'clawx-deepseek-config-'));
    const fakeKey = 'sk-test-p0-17-must-not-leak';

    try {
      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        ['scripts/configure-deepseek-runtime.mjs'],
        {
          env: {
            ...process.env,
            APPDATA: appData,
            DEEPSEEK_API_KEY: fakeKey,
            CLAWX_DEEPSEEK_API_KEY: fakeKey,
          },
        },
      );

      expect(stdout).not.toContain(fakeKey);
      expect(stderr).not.toContain(fakeKey);

      const providerStore = JSON.parse(
        await readFile(join(appData, 'Electron', 'clawx-providers.json'), 'utf8'),
      );
      const runtimeConfig = JSON.parse(
        await readFile(join(appData, 'Electron', 'openclaw-source-state', 'openclaw.json'), 'utf8'),
      );

      expect(providerStore.defaultProviderAccountId).toBe('deepseek');
      expect(providerStore.providerAccounts.deepseek.model).toBe('deepseek/deepseek-v4-flash');
      expect(runtimeConfig.agents.defaults.model.primary).toBe('deepseek/deepseek-v4-flash');
      expect(runtimeConfig.agents.list[0].model.primary).toBe('deepseek/deepseek-v4-flash');
      expect(runtimeConfig.models.providers.deepseek.models[0].id).toBe('deepseek-v4-flash');
      expect(providerStore.apiKeys?.deepseek).toBeUndefined();
      expect(providerStore.providerSecrets.deepseek).toEqual({
        type: 'api_key',
        accountId: 'deepseek',
        apiKey: fakeKey,
      });
      expect(runtimeConfig.models.providers.deepseek.apiKey).toBe(fakeKey);
    } finally {
      await rm(appData, { recursive: true, force: true });
    }
  });
});
