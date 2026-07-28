// @vitest-environment node
/**
 * FP-P0-01: locks the Electron launch-layer contract for VToken assembly.
 *
 * Product default is OFF (opt-in) per docs/dev/default-config-matrix.md.  The
 * launch layer must pass the operator's env through verbatim and must never
 * synthesize a value, because the runtime resolver distinguishes three states:
 *   unset            -> OFF (product default)
 *   explicit truthy  -> canary opt-in
 *   explicit 0/false -> kill, outranks every enable source
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn(() => process.cwd()),
  },
  utilityProcess: {
    fork: vi.fn(),
  },
}));

const ASSEMBLY_ENV = 'VERSE_VTOKEN_ASSEMBLY_ENABLED';
const REPO_ROOT = process.cwd();

async function buildEnv(
  input: Record<string, string | undefined>,
): Promise<Record<string, string | undefined>> {
  const { buildGatewayRuntimeEnv } = await import('@electron/gateway/process-launcher');
  return buildGatewayRuntimeEnv(input, { existsSync: () => false });
}

describe('FP-P0-01 VToken launch-layer default OFF', () => {
  it('does not inject the assembly env when the operator did not opt in', async () => {
    const env = await buildEnv({ PATH: '/usr/bin' });
    expect(ASSEMBLY_ENV in env).toBe(false);
    expect(env[ASSEMBLY_ENV]).toBeUndefined();
  });

  it('does not resurrect the key from an empty/whitespace inherited value', async () => {
    const blank = await buildEnv({ [ASSEMBLY_ENV]: '' });
    expect(blank[ASSEMBLY_ENV]).toBe('');
    const spaces = await buildEnv({ [ASSEMBLY_ENV]: '   ' });
    expect(spaces[ASSEMBLY_ENV]).toBe('   ');
  });

  it('passes an explicit opt-in through unchanged', async () => {
    for (const value of ['1', 'true', 'on', 'yes']) {
      const env = await buildEnv({ [ASSEMBLY_ENV]: value });
      expect(env[ASSEMBLY_ENV]).toBe(value);
    }
  });

  it('passes an explicit kill through unchanged (never upgraded to enable)', async () => {
    for (const value of ['0', 'false', 'off']) {
      const env = await buildEnv({ [ASSEMBLY_ENV]: value });
      expect(env[ASSEMBLY_ENV]).toBe(value);
    }
  });

  it('still applies the unrelated unconditional launch-layer env', async () => {
    const env = await buildEnv({ PATH: '/usr/bin' });
    expect(env.OPENCLAW_DISABLE_BONJOUR).toBe('1');
    expect(env.CLAWX_AGENT_BROWSER_BRIDGE).toBe('1');
  });

  // config-sync's forkEnv is assembled inside prepareGatewayLaunchContext(), which
  // needs a full Electron app + settings store.  A source-level guard is the honest
  // regression fence here: it fails if anyone re-adds a default assignment.
  it('config-sync.ts contains no assignment of the assembly env', () => {
    const source = readFileSync(join(REPO_ROOT, 'electron/gateway/config-sync.ts'), 'utf-8');
    const assignments = source
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .filter((line) => new RegExp(`${ASSEMBLY_ENV}\\s*[:=]`).test(line));
    expect(assignments).toEqual([]);
  });

  it('process-launcher.ts contains no assignment of the assembly env', () => {
    const source = readFileSync(join(REPO_ROOT, 'electron/gateway/process-launcher.ts'), 'utf-8');
    const assignments = source
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .filter((line) => new RegExp(`${ASSEMBLY_ENV}\\s*[:=]`).test(line));
    expect(assignments).toEqual([]);
  });
});
