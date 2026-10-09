import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('./check-live-model-evidence.mjs', import.meta.url), 'utf8');
const marker = 'finally {';
assert(source.includes(marker), 'Production cleanup block must exist');
const cleanup = source.slice(source.lastIndexOf(marker) + marker.length, source.lastIndexOf('}'));
const exitCheck = source.match(/^const gatewayHasExited = .*;$/m)?.[0] ?? '';

async function probe(gateway, { sleep = async () => {}, forcedExit = false } = {}) {
  const report = { passed: true, checks: [] };
  const files = new Map();
  const forced = [];
  await vm.runInNewContext('(async () => {' + exitCheck + cleanup + '})()', {
    assert, gateway, client: undefined, relay: undefined, gatewayText: '', key: 'fixture-only-key',
    output: 'fixture', calls: 0, report, sleep,
    path: { join: (...parts) => parts.join('/') },
    fs: { writeFileSync: (file, value) => files.set(file, value), readFileSync: file => files.get(file) },
    save: () => files.set('fixture/report.json', JSON.stringify(report)),
    console: { log: () => {} },
    spawn: (file, args, options) => {
      forced.push({ file, args: Array.from(args), options });
      const killer = new EventEmitter();
      queueMicrotask(() => { if (forcedExit) gateway.signalCode = 'SIGKILL'; killer.emit('close', 0); });
      return killer;
    },
  });
  return { report: JSON.parse(files.get('fixture/report.json')), forced };
}

function child(exitCode, signalCode, afterKill) {
  const gateway = new EventEmitter();
  Object.assign(gateway, { pid: 12345, exitCode, signalCode, kills: 0 });
  gateway.kill = () => {
    gateway.kills++;
    if (afterKill) queueMicrotask(() => { Object.assign(gateway, afterKill); gateway.emit('close'); });
    return true;
  };
  return gateway;
}

for (const [name, gateway] of [
  ['absent Gateway', undefined],
  ['numeric exit', child(0, null)],
  ['signal exit', child(null, 'SIGTERM')],
]) {
  test('cleanup recognizes ' + name + ' without touching an exited PID', async () => {
    const { report, forced } = await probe(gateway);
    assert.equal(report.gatewayExited, true);
    assert.equal(report.forcedCleanup, undefined);
    assert.equal(gateway?.kills ?? 0, 0);
    assert.deepEqual(forced, []);
  });
}

for (const [name, terminal] of [
  ['numeric exit', { exitCode: 0, signalCode: null }],
  ['signal exit', { exitCode: null, signalCode: 'SIGTERM' }],
]) {
  test('graceful cleanup accepts ' + name + ' without taskkill', async () => {
    const gateway = child(null, null, terminal);
    const { report, forced } = await probe(gateway);
    assert.equal(report.gatewayExited, true);
    assert.equal(report.forcedCleanup, undefined);
    assert.equal(gateway.kills, 1);
    assert.deepEqual(forced, []);
  });
}

test('a still-running owned Gateway retains forced tree cleanup', async () => {
  const gateway = child(null, null);
  const { report, forced } = await probe(gateway, { forcedExit: true });
  assert.equal(report.gatewayExited, true);
  assert.equal(report.forcedCleanup, true);
  assert.equal(gateway.kills, 1);
  assert.equal(forced.length, 1);
  assert.equal(forced[0].file, 'taskkill.exe');
  assert.deepEqual(forced[0].args, ['/PID', String(gateway.pid), '/T', '/F']);
  assert.equal(forced[0].options.windowsHide, true);
});

test('production cleanup terminates a real local child without forced PID cleanup', { timeout: 10000 }, async t => {
  const gateway = spawn(process.execPath, ['-e', 'process.send("ready"); setInterval(() => {}, 1000);'], {
    windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  try {
    await once(gateway, 'message');
    const { report, forced } = await probe(gateway, { sleep: ms => delay(ms, undefined, { ref: false }) });
    assert.equal(report.gatewayExited, true);
    assert.equal(report.forcedCleanup, undefined);
    assert.deepEqual(forced, []);
    assert.throws(() => process.kill(gateway.pid, 0), { code: 'ESRCH' });
    t.diagnostic(JSON.stringify({ driven_by: 'agent', actor: 'codex-live-model-cleanup', pid: gateway.pid, exitCode: gateway.exitCode, signalCode: gateway.signalCode, independentProcessProbe: 'ESRCH', realProviderCalls: 0 }));
  } finally {
    if (gateway.exitCode === null && gateway.signalCode === null) gateway.kill();
  }
});
