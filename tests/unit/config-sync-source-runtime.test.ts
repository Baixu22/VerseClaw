import { describe, expect, it, vi } from 'vitest';

const { mockSpawnSync } = vi.hoisted(() => ({
  mockSpawnSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawnSync: mockSpawnSync,
  default: {
    spawnSync: mockSpawnSync,
  },
}));

describe('applySourceRuntimeSandboxAutoFallback', () => {
  it('forces sandbox off for defaults and per-agent overrides when Docker image is unavailable', async () => {
    mockSpawnSync.mockReturnValue({ status: 1 });

    const { applySourceRuntimeSandboxAutoFallback } = await import('@electron/gateway/config-sync');
    const result = applySourceRuntimeSandboxAutoFallback({
      agents: {
        defaults: {
          sandbox: {
            mode: 'all',
            backend: 'docker',
          },
        },
        list: [
          {
            id: 'main',
            sandbox: {
              mode: 'non-main',
              backend: 'docker',
            },
          },
          {
            id: 'helper',
          },
        ],
      },
    });

    expect(result).toMatchObject({
      agents: {
        defaults: {
          sandbox: {
            mode: 'off',
            backend: 'docker',
          },
        },
        list: [
          {
            id: 'main',
            sandbox: {
              mode: 'off',
              backend: 'docker',
            },
          },
          {
            id: 'helper',
            sandbox: {
              mode: 'off',
            },
          },
        ],
      },
    });
  });

  it('leaves config untouched when Docker image is available', async () => {
    mockSpawnSync.mockReturnValue({ status: 0 });

    const { applySourceRuntimeSandboxAutoFallback } = await import('@electron/gateway/config-sync');
    const input = {
      agents: {
        defaults: {
          sandbox: {
            mode: 'all',
            backend: 'docker',
          },
        },
      },
    };

    expect(applySourceRuntimeSandboxAutoFallback(input)).toBe(input);
  });

  it('removes stale ClawX-only sandbox diagnostics from source runtime config', async () => {
    mockSpawnSync.mockReturnValue({ status: 1 });

    const { applySourceRuntimeSandboxAutoFallback } = await import('@electron/gateway/config-sync');
    const result = applySourceRuntimeSandboxAutoFallback({
      agents: {
        defaults: {
          sandbox: {
            mode: 'all',
            backend: 'docker',
            autoDisabledReason: 'previous diagnostic',
          },
        },
        list: [
          {
            id: 'main',
            sandbox: {
              mode: 'non-main',
              autoDisabledReason: 'previous diagnostic',
            },
          },
        ],
      },
    });

    expect(result).toMatchObject({
      agents: {
        defaults: {
          sandbox: {
            mode: 'off',
            backend: 'docker',
          },
        },
        list: [
          {
            id: 'main',
            sandbox: {
              mode: 'off',
            },
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain('autoDisabledReason');
  });
});
