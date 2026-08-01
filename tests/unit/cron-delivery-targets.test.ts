// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pathsMock = vi.hoisted(() => ({
  configDir: '',
}));

vi.mock('@electron/utils/paths', () => ({
  getOpenClawConfigDir: () => pathsMock.configDir,
}));

describe('cron deliveryTargets (P3-2)', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cron-delivery-targets-'));
    pathsMock.configDir = root;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeConfig(channels: Record<string, unknown>) {
    await writeFile(
      join(root, 'openclaw.json'),
      JSON.stringify({ channels }, null, 2),
      'utf8',
    );
  }

  it('returns configured channel groups with default account markers', async () => {
    await writeConfig({
      telegram: {
        accounts: {
          default: { botToken: 'x' },
          secondary: { botToken: 'y' },
        },
      },
      discord: {
        accounts: {
          main: { token: 'z' },
        },
      },
    });
    const { createCronApi } = await import('@electron/services/cron-api');
    const api = createCronApi({ gatewayManager: { rpc: vi.fn() } as never });

    const result = await api.deliveryTargets();
    expect(result.success).toBe(true);
    expect(result.targets).toHaveLength(2);
    const telegram = result.targets.find((t) => t.channelType === 'telegram');
    expect(telegram).toBeDefined();
    expect(telegram!.defaultAccountId).toBe('default');
    expect(telegram!.accounts).toEqual([
      { accountId: 'default', name: 'default', isDefault: true },
      { accountId: 'secondary', name: 'secondary', isDefault: false },
    ]);
    const discord = result.targets.find((t) => t.channelType === 'discord');
    expect(discord).toBeDefined();
    expect(discord!.accounts).toHaveLength(1);
  });

  it('returns empty targets when no channels are configured', async () => {
    await writeConfig({});
    const { createCronApi } = await import('@electron/services/cron-api');
    const api = createCronApi({ gatewayManager: { rpc: vi.fn() } as never });

    const result = await api.deliveryTargets();
    expect(result.success).toBe(true);
    expect(result.targets).toEqual([]);
  });

  it('returns empty targets without throwing when config is unreadable', async () => {
    const { createCronApi } = await import('@electron/services/cron-api');
    const api = createCronApi({ gatewayManager: { rpc: vi.fn() } as never });

    const result = await api.deliveryTargets();
    expect(result.success).toBe(true);
    expect(result.targets).toEqual([]);
  });
});
