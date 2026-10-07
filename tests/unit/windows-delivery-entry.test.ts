// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { transformWithEsbuild } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyBundledNode } from '../../scripts/verify-bundled-node.mjs';
import { RELEASE_INTEGRITY_MANIFEST } from '../../scripts/release-integrity-manifest.mjs';
import { assertWindowsTestNode } from '../../scripts/windows-test-node.mjs';

const root = mkdtempSync(join(tmpdir(), 'clawx-cli-dispatch-'));
const entry = join(root, 'entry.mjs');

beforeAll(async () => {
  // Compile the production dispatcher, replacing only its effectful callees.
  // A top-level Gateway import must fail even if startGatewayServer is not called.
  let source = readFileSync(resolve('openclaw_runtime/src/entry.ts'), 'utf8');
  const stubs = {
    'gateway/server': 'if (!process.env.EXPECT_GATEWAY) throw Error("Gateway loaded by a query"); export async function startGatewayServer(port, options) { console.log(JSON.stringify({port, options})); }',
    version: 'export const VERSION = "2026.5.20";',
    'infra/source-doctor': 'export async function runSourceDoctor(args) { console.log(JSON.stringify(args)); return 0; }',
    'agents/goal-wake-helper-entry': 'export async function runGoalWakeHelperEntry() { console.log("helper"); return 0; }',
  };
  for (const [name, contents] of Object.entries(stubs)) {
    const file = name.replaceAll('/', '-') + '.mjs';
    writeFileSync(join(root, file), contents);
    source = source.replaceAll(`./${name}.js`, `./${file}`);
  }
  writeFileSync(entry, (await transformWithEsbuild(source, 'entry.ts', { target: 'esnext' })).code);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

function probe(args: string[], gateway = false) {
  return spawnSync(process.execPath, [entry, ...args], {
    encoding: 'utf8', timeout: 5_000, windowsHide: true,
    env: { ...process.env, HOME: root, USERPROFILE: root, OPENCLAW_STATE_DIR: join(root, 'state'),
      EXPECT_GATEWAY: gateway ? '1' : '' },
  });
}

describe('source runtime CLI dispatch', () => {
  it.each([['--version'], ['-V'], ['--help'], ['-h'], [], ['gateway', '--help'], ['doctor', '--help']])('answers %j before loading any runtime effects', (...args) => {
    const result = probe(args);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/2026\.5\.20|Usage:/);
    expect(readdirSync(root).every(name => name.endsWith('.mjs'))).toBe(true);
  });
  it.each([['unknown'], ['completion'], ['devices', 'approve', 'id'], ['gateway', 'status'], ['gateway', '--bogus'], ['gateway', '--port', 'oops']])('rejects %j without starting Gateway', (...args) => {
    const result = probe(args);
    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain('Gateway loaded by a query');
    expect(result.stderr).toMatch(/Unsupported|Unknown|Invalid|Unexpected/);
  });
  it('keeps explicit gateway, Doctor and internal helper dispatch', () => {
    const result = probe(['gateway', 'run', '--port', '19876', '--token', 'fixture-token', '--bind', 'loopback', '--tailscale', 'off', '--allow-unconfigured'], true);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ port: 19876, options: { auth: { token: 'fixture-token' } } });
    expect(probe(['doctor', '--json']).stdout.trim()).toBe('["--json"]');
    expect(probe(['goal-wake-helper-run']).stdout.trim()).toBe('helper');
  });
});

it('rejects incompatible pins, old receipts and changed Node executable bytes', () => {
  const resources = mkdtempSync(join(root, 'package-'));
  mkdirSync(join(resources, 'bin'));
  mkdirSync(join(resources, 'openclaw-runtime'));
  const pkg = join(resources, 'openclaw-runtime', 'package.json');
  const node = join(resources, 'bin', 'node.exe');
  const receiptPath = join(resources, 'bin', 'node-runtime.json');
  const version = RELEASE_INTEGRITY_MANIFEST.downloads.node.version;
  const bytes = Buffer.from('checksum-verified archive fixture');
  const receipt = { version, target: 'win32-x64', sha256: createHash('sha256').update(bytes).digest('hex') };
  writeFileSync(pkg, JSON.stringify({ engines: { node: '>=22.19.0' } }));
  writeFileSync(node, bytes);
  writeFileSync(receiptPath, JSON.stringify(receipt));
  expect(verifyBundledNode(resources, 'x64').version).toBe(version);
  writeFileSync(pkg, JSON.stringify({ engines: { node: '>=99.0.0' } }));
  expect(() => verifyBundledNode(resources, 'x64')).toThrow('does not satisfy');
  writeFileSync(pkg, JSON.stringify({ engines: { node: '>=22.19.0' } }));
  writeFileSync(receiptPath, JSON.stringify({ ...receipt, version: '22.16.0' }));
  expect(() => verifyBundledNode(resources, 'x64')).toThrow('does not match');
  writeFileSync(receiptPath, JSON.stringify(receipt));
  writeFileSync(node, 'stale node binary');
  expect(() => verifyBundledNode(resources, 'x64')).toThrow('does not match');
  rmSync(resources, { recursive: true, force: true });
});

it('rejects the affected Windows Node worker before launching Electron', () => {
  expect(() => assertWindowsTestNode('24.15.0', 'win32')).toThrow('24.16.0');
  expect(() => assertWindowsTestNode('24.16.0', 'win32')).not.toThrow();
  expect(() => assertWindowsTestNode('24.15.0', 'linux')).not.toThrow();
});

it.skipIf(process.platform !== 'win32')('distinguishes a running process, confirmed absence and script-loading failure', () => {
  for (const [name, marker] of [['powershell.exe', 'running'], ['clawx-no-such-process-0261.exe', 'absent']] as const) {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File',
      resolve('scripts/check-app-running.ps1'), '-Executable', name], { windowsHide: true, timeout: 5_000 });
    expect(result.status, String(result.stderr)).toBe(0);
    expect(String(result.stdout)).toBe(marker);
  }
  const failure = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File',
    join(root, 'missing-helper.ps1')], { windowsHide: true, timeout: 5_000 });
  expect(failure.status).not.toBe(0);
  expect(String(failure.stdout)).not.toBe('absent');
});
