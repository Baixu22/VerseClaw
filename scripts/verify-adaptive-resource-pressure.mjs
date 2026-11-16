#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { once } from 'node:events';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: { output: { type: 'string' }, base: { type: 'string' }, development: { type: 'boolean', default: false } } });
assert(values.output && values.base, '--output and --base are required');
const output = resolve(values.output); mkdirSync(output, { recursive: true });
const git = (...args) => {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr); return args[0] === 'show' ? r.stdout : r.stdout.trim();
};
const write = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2) + '\n');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const candidate = { commit: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), dirty: !!git('status', '--porcelain') };
assert(values.development || !candidate.dirty, 'Freeze a clean candidate');
const base = git('rev-parse', values.base);
const replaced = ['shared/resources/adaptive-limit.ts', 'electron/services/resource-fabric.ts'];
const original = new Map(replaced.map(path => [join(root, path).replaceAll('\\', '/'), git('show', `${base}:${path}`)]));
const sources = replaced.map(path => ({ path, before: hash(git('show', `${base}:${path}`)), after: hash(readFileSync(join(root, path))) }));
const servers = [];
const modules = {};
for (const mode of ['before', 'after']) {
  console.log(`Loading ${mode} admission source`);
  const server = await createServer({ root, configFile: false, logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: { server: createHttpServer() }, watch: null }, appType: 'custom',
    plugins: mode === 'before' ? [{ name: 'frozen-admission-source', enforce: 'pre', load(id) { return original.get(id.replaceAll('\\', '/')) ?? null; } }] : [],
  });
  servers.push(server);
  modules[mode] = await server.ssrLoadModule('/electron/services/resource-fabric.ts');
}
const { ProcessTreeSampler } = await servers[1].ssrLoadModule('/openclaw_runtime/src/process/process-tree-sampler.ts');
const { AdaptiveLimit } = await servers[1].ssrLoadModule('/shared/resources/adaptive-limit.ts');
const fixture = Buffer.alloc(512 * 1024);
let seed = 20261108;
for (let i = 0; i < fixture.length; i++) { seed = (1664525 * seed + 1013904223) >>> 0; fixture[i] = seed >>> 24; }
const file = join(output, 'payload.bin'); writeFileSync(file, fixture);
const expected = hash(fixture);
const service = createHttpServer((_req, res) => setTimeout(() => { res.end('remote-receipt'); }, 35));
service.listen(0, '127.0.0.1'); await once(service, 'listening');
const url = `http://127.0.0.1:${service.address().port}`;
const sampler = new ProcessTreeSampler();
const runs = [];
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)];
const childCode = `const fs=require('node:fs'),z=require('node:zlib');const b=fs.readFileSync(process.argv[1]);let n=0;for(let i=0;i<3;i++)n+=z.gzipSync(b).length;process.stdout.write(String(n));`;
try {
  const before = await sampler.sample({ rootPids: [process.pid] });
  write('physical-before.json', before);
  // Fixed signal replay exercises pressure without exhausting the shared host.
  let now = 1000;
  const fabric = new modules.after.ResourceFabric({ now: () => now });
  const pressure = [];
  const stages = [
    { at: 1000, free: 5, commit: 95, event: true },
    { at: 2000, free: 20, commit: 50, event: false },
    { at: 7000, free: 12, commit: 50, event: false },
    { at: 12000, free: 20, commit: 50, event: false },
    { at: 17000, free: 20, commit: 50, event: false },
    { at: 22000, free: 20, commit: 50, event: false },
  ];
  for (const stage of stages) {
    now = stage.at;
    fabric.observeLatency('workspaceExec', 'pressure', 100, 64, 'read');
    fabric.observePressure({ machineMemory: { sampledAt: now, availablePhysicalBytes: stage.free, totalPhysicalBytes: 100 },
      machineCommit: { sampledAt: now, committedBytes: stage.commit, commitLimitBytes: 100 },
      eventLoopPressure: { sampledAt: now, ownerEpoch: 'fixed-input', degraded: stage.event, delayP99Ms: stage.event ? 100 : 1, delayMaxMs: 100, utilization: 0.5 } });
    pressure.push({ input: stage, diagnostics: fabric.getDiagnostics() });
  }
  assert.equal(pressure[0].diagnostics.accounts['workspaceExec:pressure'].limit, 1);
  assert.deepEqual(pressure.at(-1).diagnostics.pressure.reasons, []);
  const curve = new AdaptiveLimit({ initialLimit: 4, minLimit: 1, maxLimit: 8 });
  const latencyTrace = [100, ...Array(8).fill(1000), ...Array(60).fill(100)].map(latency => ({ latency, backlog: 64, limit: curve.sample(latency, 64, 'read') }));
  write('pressure-replay.json', { driven_by: 'agent', actor: 'codex', kind: 'fixed-input-not-host-exhaustion', pressure, latencyTrace });
  for (const cap of [1, 2, 4, 8]) {
    for (const [position, mode] of ['before', 'after', 'after', 'before'].entries()) {
      const owner = new modules[mode].ResourceFabric({ accounts: { workspaceExec: { initialLimit: Math.min(cap, 2), maxLimit: cap } } });
      const events = [];
      const delay = monitorEventLoopDelay({ resolution: 10 }); delay.enable();
      const start = performance.now(); let active = 0, peak = 0, spawnCount = 0;
      const tasks = Array.from({ length: 24 }, (_, id) => {
        const phase = ['read', 'read', 'execution', 'remote-wait'][id % 4];
        const requested = performance.now();
        return owner.runResource('workspaceExec', 'mixed', { phase, tenant: `agent-${id % 4}`, timeoutMs: 30_000 }, async lease => {
          const admitted = performance.now(); peak = Math.max(peak, ++active);
          try {
            if (phase === 'read') assert.equal(hash(await readFile(file)), expected);
            else if (phase === 'remote-wait') assert.equal(await (await fetch(url)).text(), 'remote-receipt');
            else {
              spawnCount += 1;
              const child = spawn(process.execPath, ['-e', childCode, file], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
              let receipt = '', stderr = '';
              child.stdout.on('data', part => { receipt += part; }); child.stderr.on('data', part => { stderr += part; });
              const [code] = await once(child, 'close'); assert.equal(code, 0, stderr); assert(Number(receipt) > fixture.length);
            }
          } finally {
            active -= 1;
            events.push({ id, phase, queuedMs: lease.queuedMs, serviceMs: performance.now() - admitted, totalMs: performance.now() - requested, admittedLimit: lease.limit });
          }
        });
      });
      await Promise.all(tasks); delay.disable();
      const elapsedMs = performance.now() - start;
      const diagnostics = owner.getDiagnostics();
      assert.equal(events.length, 24); assert.equal(active, 0); assert(peak <= cap);
      assert.equal(diagnostics.accounts['workspaceExec:mixed'].queued, 0); assert(owner.isFair());
      const run = { mode, cap, position, elapsedMs, throughputPerSecond: 24_000 / elapsedMs, p50Ms: percentile(events.map(e => e.totalMs), 0.5), p95Ms: percentile(events.map(e => e.totalMs), 0.95),
        peak, spawnCount, eventLoopP99Ms: delay.percentile(99) / 1e6, memory: process.memoryUsage(), diagnostics, events };
      runs.push(run); write('runs.json', runs);
      console.log(`${mode} cap=${cap} run=${position} ${elapsedMs.toFixed(1)}ms`);
    }
  }
  const after = await sampler.sample({ rootPids: [process.pid] });
  write('physical-after.json', after);
  const comparisons = [1, 2, 4, 8].map(cap => {
    const summary = mode => {
      const rows = runs.filter(run => run.cap === cap && run.mode === mode);
      return { throughputPerSecond: rows.reduce((n, row) => n + row.throughputPerSecond, 0) / rows.length, p95Ms: rows.reduce((n, row) => n + row.p95Ms, 0) / rows.length };
    };
    const before = summary('before'), after = summary('after');
    return { cap, before, after, throughputChangePct: (after.throughputPerSecond / before.throughputPerSecond - 1) * 100, p95ChangePct: (after.p95Ms / before.p95Ms - 1) * 100 };
  });
  const report = { driven_by: 'agent', actor: 'codex', candidate, base, sources, workload: { order: 'ABBA at each cap', tasksPerRun: 24, runs: 16, phases: '12 actual file reads, 6 child gzip builds, 6 local HTTP delayed responses', payloadSha256: expected, pressure: 'fixed input replay; no system memory exhaustion', remote: 'local HTTP surrogate, no provider benefit claim' },
    comparisons, physical: { before, after }, passed: runs.length === 16, decision: 'Retain default max=4. Curves characterize this bounded local workload; high-capacity tuning requires the mixed-window package.' };
  assert.equal(git('rev-parse', 'HEAD'), candidate.commit);
  assert(values.development || !git('status', '--porcelain'));
  write('comparison.json', report);
} finally {
  service.closeAllConnections(); await new Promise(resolve => service.close(resolve));
  for (const server of servers) await server.close();
}
