import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { verifyBundledNode } from './verify-bundled-node.mjs';

if (process.platform !== 'win32') throw Error('Run on Windows against a test-only unpacked app.');
const [appArg, outputArg] = process.argv.slice(2);
if (!appArg || !outputArg) throw Error('Usage: node scripts/check-packaged-windows-cli.mjs <test-app-dir> <output-dir>');
const app = resolve(appArg), output = resolve(outputArg);
mkdirSync(output, { recursive: true });
const resources = join(app, 'resources');
const node = join(resources, 'bin', 'node.exe');
const heldNode = node + '.cli-probe-held';
assert(!existsSync(heldNode), 'An earlier fallback probe needs recovery');
const receipt = verifyBundledNode(resources, 'x64');
const expectedVersion = JSON.parse(readFileSync(join(resources, 'openclaw-runtime', 'package.json'))).version;
const home = mkdtempSync(join(output, 'isolated-home-'));
mkdirSync(join(home, '.openclaw'));
// Information queries must work even when runtime configuration cannot be parsed.
writeFileSync(join(home, '.openclaw', 'openclaw.json'), 'intentionally invalid runtime config\n');
const env = { ...process.env, HOME: home, USERPROFILE: home, OPENCLAW_HOME: home,
  APPDATA: join(home, 'AppData/Roaming'), LOCALAPPDATA: join(home, 'AppData/Local'),
  XDG_CONFIG_HOME: join(home, '.config'), OPENCLAW_STATE_DIR: join(home, '.openclaw'),
  OPENCLAW_CONFIG_PATH: join(home, '.openclaw/openclaw.json'),
  CLAWX_TEST_CLI: join(resources, 'cli/openclaw.cmd') };
delete env.NODE_OPTIONS;
function snapshot(dir = home, prefix = '') {
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(e => {
    const name = prefix + e.name, file = join(dir, e.name);
    return e.isDirectory() ? [{ directory: name }, ...snapshot(file, name + '/')]
      : [{ file: name, sha256: createHash('sha256').update(readFileSync(file)).digest('hex') }];
  });
}
const before = snapshot(), probes = [];
async function run(executable, args, label) {
  const startedAt = new Date().toISOString();
  const child = spawn(executable, args, { env, cwd: home, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', timedOut = false;
  child.stdout.on('data', c => { stdout += c; });
  child.stderr.on('data', c => { stderr += c; });
  const timer = setTimeout(() => {
    timedOut = true;
    // PowerShell stays alive while the wrapper is running, retaining tree ownership.
    spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  }, 20_000);
  try {
    const exitCode = await new Promise((res, rej) => { child.once('error', rej); child.once('close', res); });
    const row = { label, pid: child.pid, startedAt, completedAt: new Date().toISOString(), exitCode, timedOut, stdout, stderr };
    probes.push(row);
    assert(!timedOut, label + ' timed out');
    return row;
  } finally { clearTimeout(timer); }
}
let result;
try {
  for (const fallback of [false, true]) {
    if (fallback) renameSync(node, heldNode);
    for (const shell of ['cmd', 'bash']) {
      for (const arg of ['--version', '--help', 'not-a-command']) {
        const executable = shell === 'cmd' ? 'powershell.exe' : join(process.env.ProgramFiles, 'Git/bin/bash.exe');
        const args = shell === 'cmd'
          ? ['-NoProfile', '-NonInteractive', '-Command', `& $env:CLAWX_TEST_CLI ${arg}; exit $LASTEXITCODE`]
          : [join(resources, 'cli/openclaw'), arg];
        const row = await run(executable, args, `${fallback ? 'electron-fallback' : 'bundled-node'}/${shell}/${arg}`);
        assert.equal(row.exitCode, arg === 'not-a-command' ? 1 : 0, JSON.stringify(row));
        if (arg === '--version') assert.equal(row.stdout.trim(), expectedVersion);
        if (arg === '--help') assert.match(row.stdout, /Usage: openclaw/);
        assert.deepEqual(snapshot(), before, 'CLI query changed isolated state');
      }
    }
    if (fallback) renameSync(heldNode, node);
  }
  result = { status: 'pass', receipt, expectedVersion, stateBefore: before, stateAfter: snapshot() };
} catch (error) {
  result = { status: 'fail', error: String(error) };
  process.exitCode = 1;
} finally {
  if (existsSync(heldNode)) renameSync(heldNode, node);
  writeFileSync(join(output, 'report.json'), JSON.stringify({ driven_by: 'agent', actor: 'packaged-cli-probe', app, ...result, probes }, null, 2) + '\n');
}
console.log(JSON.stringify({ status: result.status, probes: probes.length, report: join(output, 'report.json') }));
