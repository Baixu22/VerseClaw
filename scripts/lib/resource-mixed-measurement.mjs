import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, isAbsolute } from 'node:path';
import { realpathSync } from 'node:fs';

export function resolveMixedToolchain() {
  for (const name of ['ESBUILD_BINARY_PATH', 'ELECTRON_OVERRIDE_DIST_PATH']) {
    assert(!process.env[name] || isAbsolute(process.env[name]), `${name} must be absolute so every workload cwd selects the verified binary`);
  }
  const require = createRequire(import.meta.url);
  const esbuildModule = require.resolve('esbuild');
  const esbuildBinary = process.env.ESBUILD_BINARY_PATH
    ? process.env.ESBUILD_BINARY_PATH
    : require.resolve('@esbuild/win32-x64/esbuild.exe', { paths: [dirname(esbuildModule)] });
  const electronModule = require.resolve('electron'); delete require.cache[electronModule];
  const gitResult = spawnSync('where.exe', ['git.exe'], { encoding: 'utf8', windowsHide: true });
  assert.equal(gitResult.status, 0, gitResult.stderr);
  return Object.entries({ node: process.execPath, electron: String(require('electron')), esbuildModule, esbuildBinary, git: gitResult.stdout.trim().split(/\r?\n/u)[0] })
    .map(([role, path]) => ({ role, path: realpathSync(path) }));
}

export function pinnedMixedEnvironment(executables) {
  const compiler = executables.find(file => file.role === 'esbuildBinary');
  const electron = executables.find(file => file.role === 'electron');
  assert(compiler && electron, 'Missing verified execution binaries');
  // Capture resolves drive-relative Windows overrides to canonical paths.
  // Pass those exact paths through every product and temporary-work cwd.
  return { ESBUILD_BINARY_PATH: compiler.path, ELECTRON_OVERRIDE_DIST_PATH: dirname(electron.path) };
}

export function percentile(values, quantile) {
  assert(values.length > 0 && values.every(value => Number.isFinite(value) && value >= 0), 'Missing or invalid samples');
  assert(quantile > 0 && quantile <= 1, 'Invalid quantile');
  return [...values].sort((a, b) => a - b)[Math.ceil(values.length * quantile) - 1];
}

export function summarizeMixedRun(run, fixture) {
  assert.equal(run.driven_by, 'agent');
  assert.equal(run.status, 'pass');
  assert.equal(run.fixtureId, fixture.id);
  assert.equal(run.work.events.length, fixture.tasks);
  assert.equal(new Set(run.work.events.map(event => event.id)).size, fixture.tasks);
  assert.deepEqual(run.work.events.map(event => event.id).sort((a, b) => a - b), Array.from({ length: fixture.tasks }, (_, id) => id));
  assert(run.work.events.every(event => event.status === 'success' && event.receiptVerified));
  let services = 0;
  for (const event of run.work.events) {
    assert.equal(event.kind, fixture.phases[event.id % fixture.phases.length]);
    if (event.kind === 'read') assert.equal(event.receipt, run.expected.corpus);
    else if (event.kind === 'retrieval') assert.equal(event.receipt, run.expected.retrieval);
    else if (event.kind === 'remote-wait') assert.equal(event.receipt, 'remote-receipt');
    else if (event.kind === 'log') assert.equal(event.receipt, fixture.logBytes);
    else if (event.kind === 'git') assert(event.receipt.includes('corpus.txt'));
    else if (event.kind === 'build') {
      assert.equal(event.receipt.digest, run.expected.build);
      assert(event.receipt.services.length > 0 && event.receipt.services.every(service => service.closed && service.pid > 0));
      services += event.receipt.services.length;
    } else assert.fail('Unknown phase');
  }
  assert.equal(run.work.active, 0); assert.equal(run.work.queued, 0);
  assert.equal(run.work.ownedChildren, run.work.exitedChildren);
  assert(run.cleanup.mainExited && run.cleanup.launcherExited, 'Electron cleanup incomplete');
  assert(run.renderer.inputRetained && run.renderer.finalTextCorrect && run.renderer.terminalCompleted);
  assert(run.renderer.samples.inputLatencies.length > 0);
  assert(run.renderer.inputStartedAt >= run.work.startedAt && run.renderer.inputStartedAt < run.work.endedAt, 'Input did not overlap work');
  assert(run.renderer.scrolls.some(sample => sample.at >= run.work.startedAt && sample.at < run.work.endedAt), 'Scroll did not overlap work');
  assert.equal(run.renderer.scrolls.length, fixture.scrolls);
  assert(new Set(run.renderer.scrolls.map(sample => sample.top)).size > 2, 'Scrolling did not move');
  assert(Number.isFinite(run.work.elapsedMs) && run.work.elapsedMs > 0);
  const during = sample => sample.at >= run.work.startedAt && sample.at < run.work.endedAt;
  const inputDuring = run.renderer.samples.inputEvents.filter(during);
  const scrollDuring = run.renderer.scrolls.filter(during);
  const resourcesDuring = run.work.samples.filter(during);
  const timing = values => ({ p50: percentile(values, 0.5), p95: percentile(values, 0.95) });
  const privateBytes = snapshot => snapshot.tree.processes?.length && snapshot.tree.processes.every(process => process.privateBytes != null)
    ? snapshot.tree.processes.reduce((sum, process) => sum + process.privateBytes, 0) : null;
  return {
    workers: run.workers, windows: run.windows,
    throughputPerSecond: fixture.tasks * 1000 / run.work.elapsedMs,
    queuedMs: timing(run.work.events.map(event => event.queuedMs)),
    serviceMs: timing(run.work.events.map(event => event.serviceMs)),
    totalMs: timing(run.work.events.map(event => event.totalMs)),
    inputMs: timing(inputDuring.map(sample => sample.durationMs)),
    scrollMs: timing(scrollDuring.map(sample => sample.durationMs)),
    inputSamplesDuringWork: inputDuring.length, scrollSamplesDuringWork: scrollDuring.length,
    longTasks: run.renderer.samples.longTaskEvents.filter(during).map(sample => sample.durationMs),
    directChildStarts: run.work.ownedChildren, buildServiceStarts: services, observedChildStarts: run.work.ownedChildren + services,
    processBefore: run.processBefore, processAfter: run.processAfter,
    resources: {
      rssBeforeBytes: run.processBefore.tree?.treeRssBytes ?? null, rssAfterBytes: run.processAfter.tree?.treeRssBytes ?? null,
      privateBeforeBytes: run.processBefore.tree ? privateBytes(run.processBefore) : null, privateAfterBytes: run.processAfter.tree ? privateBytes(run.processAfter) : null,
      systemCommitBefore: run.processBefore.tree?.machineCommit ?? null, systemCommitAfter: run.processAfter.tree?.machineCommit ?? null,
      handlesBefore: run.processBefore.handles ?? null, handlesAfter: run.processAfter.handles ?? null,
      mainRssPeakBytes: resourcesDuring.length ? Math.max(...resourcesDuring.map(sample => sample.memory.rss)) : null,
      mainCpuCoreRatio: run.work.cpu ? (run.work.cpu.user + run.work.cpu.system) / (run.work.elapsedMs * 1000) : null,
      treeCpuObservation: {
        cpuPercent: run.processAfter.tree?.treeCpuPercent ?? null,
        from: run.processBefore.tree?.sampledAt ?? null, to: run.processAfter.tree?.sampledAt ?? null,
        intervalMs: run.processBefore.tree && run.processAfter.tree ? run.processAfter.tree.sampledAt - run.processBefore.tree.sampledAt : null,
        scope: 'Whole-trial process-tree observation, including UI preparation, stream completion and terminal checks',
      },
    },
    counters: resourcesDuring,
  };
}

export function compareMixedRuns(runs, fixture) {
  assert.equal(runs.length, fixture.workers.length * fixture.windows.length * fixture.order.length);
  const results = [];
  for (const windows of fixture.windows) for (const workers of fixture.workers) {
    const group = runs.filter(run => run.windows === windows && run.workers === workers);
    assert.deepEqual(group.map(run => run.variant), fixture.order, 'ABBA order mismatch');
    const summaries = group.map(run => ({ ...summarizeMixedRun(run, fixture), variant: run.variant }));
    const mean = (mode, value) => { const selected = summaries.filter(run => run.variant === mode); return selected.reduce((n, run) => n + value(run), 0) / selected.length; };
    const metric = value => {
      const before = mean('before', value), after = mean('after', value);
      return { before, after, changePct: before === 0 ? null : (after / before - 1) * 100 };
    };
    results.push({ windows, workers, throughput: metric(run => run.throughputPerSecond), p95Total: metric(run => run.totalMs.p95), p95Input: metric(run => run.inputMs.p95), p95Scroll: metric(run => run.scrollMs.p95), samples: summaries });
  }
  return results;
}
