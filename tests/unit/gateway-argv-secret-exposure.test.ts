// @vitest-environment node
/**
 * Regression for issue #130.
 *
 * The Gateway used to receive the shared auth token through `--token` on the
 * command line. A same-user process can read another process's command line, so
 * the token was exposed even though log output was redacted. These tests pin the
 * replacement contract:
 *
 *  - the launch-args builder never emits a secret flag;
 *  - the launcher strips a known Gateway secret from the real spawn args if one
 *    ever reappears (second line of defence), without touching unrelated values;
 *  - a real child process started with the launch args receives an argv that
 *    contains no token, while the env-provided token still reaches it.
 *
 * Environment note: this machine could not read another process's command line
 * (Win32_Process `CommandLine` via CIM returned empty and `wmic` reported no
 * instance), so the probe observes the argv the operating system actually gave
 * the child (`process.argv` written by the child) instead of an external
 * readback. The externally-observable exposure is therefore asserted at the argv
 * content level, not re-measured from a third process here.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildGatewayProcessArgs } from '@electron/gateway/config-sync';
import { stripGatewaySecretArgs } from '@electron/gateway/process-launcher';

const SYNTHETIC_TOKEN = 'synthetic-gateway-token-4f19c2';
const createdRoots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'clawx-argv-probe-'));
  createdRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of createdRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  createdRoots.length = 0;
});

describe('gateway launch args never carry the shared token (#130)', () => {
  it('builds token-free args for the given port', () => {
    const args = buildGatewayProcessArgs(18789);

    expect(args).toEqual(['gateway', '--port', '18789', '--allow-unconfigured']);
    for (const forbidden of ['--token', '--password', '--gateway-token']) {
      expect(args).not.toContain(forbidden);
    }
    expect(args.join(' ')).not.toContain(SYNTHETIC_TOKEN);
  });

  it('strips a known secret flag pair and leaves everything else untouched', () => {
    const args = ['gateway', '--port', '18789', '--token', SYNTHETIC_TOKEN, '--allow-unconfigured'];
    const input = [...args];

    const result = stripGatewaySecretArgs(args, [SYNTHETIC_TOKEN, undefined]);

    expect(result.args).toEqual(['gateway', '--port', '18789', '--allow-unconfigured']);
    expect(result.strippedFlags).toEqual(['--token']);
    expect(args).toEqual(input); // no mutation
  });

  it.each(['--token', '--password', '--gateway-token'])(
    'strips %s when the value matches a known secret',
    (flag) => {
      const result = stripGatewaySecretArgs(['gateway', flag, SYNTHETIC_TOKEN], [undefined, SYNTHETIC_TOKEN]);

      expect(result.args).toEqual(['gateway']);
      expect(result.strippedFlags).toEqual([flag]);
    },
  );

  it('keeps unrelated or valueless arguments', () => {
    expect(stripGatewaySecretArgs(['gateway', '--token', 'not-our-secret'], [SYNTHETIC_TOKEN])).toEqual({
      args: ['gateway', '--token', 'not-our-secret'],
      strippedFlags: [],
    });
    expect(stripGatewaySecretArgs(['gateway', '--token'], [SYNTHETIC_TOKEN])).toEqual({
      args: ['gateway', '--token'],
      strippedFlags: [],
    });
    expect(stripGatewaySecretArgs(['gateway', '--allow-unconfigured'], [])).toEqual({
      args: ['gateway', '--allow-unconfigured'],
      strippedFlags: [],
    });
  });
});

describe('real child argv (#130)', () => {
  const children: ChildProcess[] = [];

  afterEach(() => {
    for (const child of children.splice(0)) {
      try {
        child.kill();
      } catch {
        // already gone
      }
    }
  });

  function spawnProbe(root: string, args: string[], token: string) {
    const tokenFile = join(root, 'child-env-token.txt');
    const argvFile = join(root, 'child-argv.json');
    const script = [
      "const fs = require('fs');",
      'fs.writeFileSync(process.env.PROBE_TOKEN_OUT, process.env.OPENCLAW_GATEWAY_TOKEN || "missing");',
      'fs.writeFileSync(process.env.PROBE_ARGV_OUT, JSON.stringify(process.argv.slice(1)));',
      'setTimeout(() => {}, 4000);',
    ].join('');
    const child = spawn(process.execPath, ['-e', script, ...args], {
      stdio: 'ignore',
      windowsHide: true,
      env: {
        ...process.env,
        OPENCLAW_GATEWAY_TOKEN: token,
        PROBE_TOKEN_OUT: tokenFile,
        PROBE_ARGV_OUT: argvFile,
      },
    });
    children.push(child);
    return { child, tokenFile, argvFile };
  }

  async function waitForFile(path: string) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        const value = readFileSync(path, 'utf8');
        if (value && value !== 'pending') return value;
      } catch {
        // not written yet
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`probe file was not written: ${path}`);
  }

  it('observes the token in argv when a secret flag is passed explicitly (positive control)', async () => {
    const root = makeRoot();
    // The real launch shape starts with the `gateway` positional, so Node stops
    // option parsing there and forwards the secret flag to the child process.
    const { argvFile } = spawnProbe(
      root,
      ['gateway', '--port', '18789', '--token', SYNTHETIC_TOKEN, '--allow-unconfigured'],
      SYNTHETIC_TOKEN,
    );

    const argv = JSON.parse(await waitForFile(argvFile)) as string[];

    expect(argv).toContain('--token');
    expect(argv).toContain(SYNTHETIC_TOKEN);
  });

  it('keeps the token out of the real argv while the child still receives it from the environment', async () => {
    const root = makeRoot();
    // Simulate the hazardous shape (a secret flag reappearing in launch args)
    // plus the launcher's guard, then start a real child with the result.
    const hazardousArgs = [
      'gateway',
      '--port',
      '18789',
      '--token',
      SYNTHETIC_TOKEN,
      '--allow-unconfigured',
    ];
    const { args: safeArgs, strippedFlags } = stripGatewaySecretArgs(hazardousArgs, [SYNTHETIC_TOKEN]);
    expect(strippedFlags).toEqual(['--token']);
    expect(safeArgs).toEqual(buildGatewayProcessArgs(18789));

    const { tokenFile, argvFile } = spawnProbe(root, safeArgs, SYNTHETIC_TOKEN);
    const tokenFromEnv = await waitForFile(tokenFile);
    const argv = JSON.parse(await waitForFile(argvFile)) as string[];

    expect(tokenFromEnv).toBe(SYNTHETIC_TOKEN);
    expect(argv).not.toContain('--token');
    expect(argv.join(' ')).not.toContain(SYNTHETIC_TOKEN);
    expect(argv).toEqual(['gateway', '--port', '18789', '--allow-unconfigured']);
  });
});
