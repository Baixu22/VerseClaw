// @vitest-environment node
import { copyFileSync, mkdirSync, mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { afterEach, expect, it } from 'vitest';

const roots: string[] = [];
const scratch = () => {
  const root = mkdtempSync(join(tmpdir(), 'rc10-entry-'));
  roots.push(root);
  return root;
};
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it.each(['H-00', 'H-07', 'H-99', 'unknown'])(
  'rejects unsupported %s before credentials, filesystem writes or Electron', (scenario) => {
    const root = scratch();
    const dataRoot = join(root, 'must-not-exist');
    const result = spawnSync(process.execPath, [
      resolve('scripts/rc10/driver.mjs'),
      '--scenario', scenario, '--data-root', dataRoot, '--repo', join(root, 'missing-repo'),
    ], { encoding: 'utf8', windowsHide: true, timeout: 5000, env: { ...process.env, RC10_PROVIDER_KEY: '' } });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unsupported RC-10 scenario: ' + scenario);
    expect(result.stderr).not.toContain('Supply RC10_PROVIDER_KEY');
    expect(existsSync(dataRoot)).toBe(false);
  },
);

it.each([
  ['--scenario'],
  ['--scenaro', 'H-02'],
  ['--timeout-min', 'NaN'],
  ['--timeout-min', '0'],
])('fails closed for malformed driver arguments %j', (...args) => {
  const result = spawnSync(process.execPath, [resolve('scripts/rc10/driver.mjs'), ...args], {
    encoding: 'utf8', windowsHide: true, timeout: 5000, env: { ...process.env, RC10_PROVIDER_KEY: '' },
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stderr).not.toContain('Supply RC10_PROVIDER_KEY');
});

it('starts the real IRC peer CLI through a directory junction', async () => {
  const alias = join(scratch(), 'repo');
  symlinkSync(resolve('.'), alias, process.platform === 'win32' ? 'junction' : 'dir');
  const child = spawn(process.execPath, [join(alias, 'scripts/rc10/irc-server.mjs')], {
    windowsHide: true,
    env: { ...process.env, IRC_SERVER_PORT: '0', IRC_SERVER_HOST: '127.0.0.1', IRC_SERVER_LOG: '', IRC_SERVER_VERBOSE: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exit = once(child, 'exit');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const output = await Promise.race([
      once(child.stdout!, 'data').then(([data]) => String(data)),
      exit.then(([code]) => { throw new Error('IRC peer exited before ready: ' + code); }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('IRC peer startup timeout')), 5000); }),
    ]);
    const ready = JSON.parse(output.trim());
    expect(ready.ready).toBe(true);
    expect(ready.port).toBeGreaterThan(0);
  } finally {
    clearTimeout(timer);
    child.kill();
    await exit;
  }
});

it('refuses to overwrite an existing evidence directory before writing run files', () => {
  const dataRoot = scratch();
  const evidence = join(dataRoot, 'evidence');
  mkdirSync(evidence);
  writeFileSync(join(evidence, 'events.jsonl'), 'preserved previous run\n');
  const result = spawnSync(process.execPath, [resolve('scripts/rc10/driver.mjs'),
    '--scenario', 'H-01', '--data-root', dataRoot, '--repo', resolve('.')], {
    encoding: 'utf8', windowsHide: true, timeout: 5000,
    env: { ...process.env, RC10_PROVIDER_KEY: 'fixture-key-not-real' },
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Evidence directory must be empty');
  expect(readFileSync(join(evidence, 'events.jsonl'), 'utf8')).toBe('preserved previous run\n');
  expect(existsSync(join(evidence, 'candidate.json'))).toBe(false);
});

it('imports the relocated operator and IRC modules without archived artifacts or Electron', () => {
  const root = scratch();
  // A minimal fresh layout prevents ignored legacy drivers from hiding a stale
  // import. Plain Node must resolve the real .mjs -> .ts fixture chain as well;
  // node --check alone never loads those dependencies.
  for (const relativePath of [
    'scripts/rc10/driver.mjs',
    'scripts/rc10/operator-driver.mjs',
    'scripts/rc10/irc-server.mjs',
    'scripts/rc10/irc-server.d.mts',
    'scripts/lib/entrypoint.mjs',
    'scripts/lib/rc10-evidence.mjs',
    'tests/e2e/fixtures/fp-p1-harness.ts',
  ]) {
    const target = join(root, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(resolve(relativePath), target);
  }
  const result = spawnSync(process.execPath, [
    '--input-type=module', '--eval',
    [
      'const operator = await import(process.argv[1]);',
      'const irc = await import(process.argv[2]);',
      'console.log(JSON.stringify({ operator: typeof operator.runOperatorDriver, irc: typeof irc.startIrcServer }));',
    ].join('\n'),
    pathToFileURL(join(root, 'scripts/rc10/operator-driver.mjs')).href,
    pathToFileURL(join(root, 'scripts/rc10/irc-server.mjs')).href,
  ], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 5000,
    env: { ...process.env, RC10_PROVIDER_KEY: '', IRC_SERVER_LOG: '' },
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ operator: 'function', irc: 'function' });
  expect(existsSync(join(root, 'artifacts'))).toBe(false);
  expect(existsSync(join(root, 'node_modules'))).toBe(false);
});

it('lists implemented scenarios without launching Electron or needing credentials', () => {
  const result = spawnSync(process.execPath, [resolve('scripts/rc10/driver.mjs'), '--list-scenarios'], { encoding: 'utf8', windowsHide: true, timeout: 5000, env: { ...process.env, RC10_PROVIDER_KEY: '' } });
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual(['H-01', 'H-02', 'H-03', 'H-04', 'H-05', 'H-06', 'OPERATOR-ALL', 'CHANNEL-PROBE']);
});
