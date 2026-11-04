#!/usr/bin/env node
/**
 * N9 stability / repeat-run probe (versebrowser-invocation-maturity).
 *
 * Runs the packaged app from the candidate build and records:
 *   - cold starts: fresh instance per start, renderer ready + hostInvoke status ok;
 *   - loops: fresh instance per loop doing open -> observe -> act -> re-observe -> close;
 *   - interrupts: open a session and kill the app tree mid-flow, then prove the next run
 *     recovers end to end without residue.
 *
 * Every round records the owned session count, fixture observation, run-directory
 * reclamation, residual processes for that run, and wall-clock / RSS samples that are
 * actually measured. A pass is a scoped repeat-run result for Windows x64 on this build;
 * it is not a product GA claim.
 */
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rmdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { browserBuildIdentity } from './lib/versebrowser-build-identity.mjs';
import { cleanupBrowserProbe, probeCensusBackend, readProbeProcesses } from './lib/versebrowser-probe-cleanup.mjs';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const DEFAULT_EXE = 'release/win-unpacked/Verse Claw.exe';

function issue(kind, detail) { return { kind, ...detail }; }

function rssMbFor(runDir) {
  const bytes = readProbeProcesses(runDir).reduce((sum, p) => sum + (Number(p.WorkingSetSize) || 0), 0);
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

export async function runProbe({ hostRoot = ROOT, exe = DEFAULT_EXE, tempRoot = join(hostRoot, '.tmp'), coldStarts = 10, loops = 30, interrupts = 3, output } = {}) {
  const exePath = resolve(hostRoot, exe);
  const require = createRequire(join(hostRoot, 'package.json'));
  const electron = require('playwright-core')._electron;
  const issues = [];
  const rows = [];
  if (!existsSync(exePath)) {
    return { schemaVersion: 1, artifact: 'versebrowser-n9-stability', driven_by: 'agent', actor: 'codex', status: 'fail', issues: [issue('packaged_exe_missing', { exe })] };
  }
  const build = await browserBuildIdentity(exePath);

  const fixture = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><title>N9 Fixture</title><h1 id="h">N9 STABILITY OK</h1>
      <input id="name" aria-label="Name"><button id="submit" onclick="document.querySelector('#result').textContent='Saved '+document.querySelector('#name').value">Save</button>
      <p id="result">Not saved</p>`);
  });
  await new Promise((done) => fixture.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${fixture.address().port}/`;
  await mkdir(tempRoot, { recursive: true });
  const batchRoot = await mkdtemp(join(tempRoot, 'n9-batch-'));

  async function withInstance(kind, index, body) {
    const runRoot = await mkdtemp(join(batchRoot, `n9-${kind}-`));
    const userDataDir = join(runRoot, 'ud');
    const homeDir = join(runRoot, 'home');
    const artifactsDir = join(runRoot, 'playwright');
    for (const dir of [userDataDir, homeDir, artifactsDir, join(homeDir, 'AppData/Roaming'), join(homeDir, 'AppData/Local')]) await mkdir(dir, { recursive: true });
    await writeFile(join(userDataDir, 'settings.json'), JSON.stringify({ language: 'en' }));
    const runId = `n9-${kind}-${index}-${Date.now().toString(36)}`;
    const startedAt = Date.now();
    let app;
    const row = { kind, index, runId, runRoot, status: 'fail' };
    try {
      app = await electron.launch({ executablePath: exePath, artifactsDir, args: ['--no-sandbox', `--user-data-dir=${userDataDir}`, '--lang=en-US', '--disable-gpu'], cwd: hostRoot, timeout: 90_000,
        env: { ...process.env, TEMP: runRoot, TMP: runRoot, HOME: homeDir, USERPROFILE: homeDir,
          APPDATA: join(homeDir, 'AppData/Roaming'), LOCALAPPDATA: join(homeDir, 'AppData/Local'),
          XDG_CONFIG_HOME: join(homeDir, '.config'), OPENCLAW_CONFIG_DIR: join(homeDir, '.openclaw'),
          VERSE_CLAW_REMOTE_DEBUGGING_PORT: '', VERSE_CLAW_E2E: '1', VERSE_CLAW_E2E_SKIP_SETUP: '1', VERSE_CLAW_USER_DATA_DIR: userDataDir } });
      row.launchMs = Date.now() - startedAt;
      const page = await app.firstWindow({ timeout: 30_000 });
      await page.waitForLoadState('load', { timeout: 30_000 });
      await page.waitForFunction(() => Boolean(window.verseClaw?.hostInvoke), {}, { timeout: 30_000 });
      row.rendererReadyMs = Date.now() - startedAt;
      row.pageTitle = await page.title();
      Object.assign(row, await body(page, runId, { runRoot, userDataDir, app }));
      const complete = kind === 'cold' ? row.hostStatusOk === true
        : kind === 'interrupt' ? row.interruptedPrivateNetworkDenied === true && row.interruptedWithLiveSession === true
        : row.privateNetworkDenied === true && row.openOk === true && row.blockedFailsClosed === true
          && row.upgradeOk === true && row.typed === true && row.clicked === true
          && row.snapshotHasFixture === true && row.ownedSessionCount === 1
          && row.closed === true && row.sessionsAfterClose === 0;
      if (!complete) throw new Error(`Incomplete ${kind} browser round`);
      row.status = 'pass';
    } catch (error) {
      row.error = String((error && error.message) || error);
      issues.push(issue('round_failed', { kind, index, message: row.error }));
    } finally {
      const cleanup = await cleanupBrowserProbe({ app, runRoot, interrupt: kind === 'interrupt' });
      Object.assign(row, cleanup);
      for (const message of cleanup.errors) issues.push(issue('round_cleanup_failed', { kind, index, message }));
      if (cleanup.errors.length) row.status = 'fail';
      row.durationMs = Date.now() - startedAt;
    }
    rows.push(row);
    if (output) await writeFile(resolve(hostRoot, output), JSON.stringify({ schemaVersion: 1, artifact: 'versebrowser-n9-stability', driven_by: 'agent', actor: 'codex', status: 'in_progress', build, processCensusBackend: probeCensusBackend(), rows, issues }, null, 2) + '\n', 'utf8');
    process.stdout.write(JSON.stringify({ kind, index, status: row.status, error: row.error, residualProcesses: row.residualProcesses, residualNames: row.residualNames, runDirReclaimed: row.runDirReclaimed }) + '\n');
    return row;
  }

  const statusOnly = async (page, _runId, ctx) => {
    const status = await page.evaluate(async () => window.verseClaw.hostInvoke({ id: crypto.randomUUID(), module: 'agentBrowser', action: 'status' }));
    return { hostStatusOk: status.ok === true, capabilityCliAvailable: status.data?.capabilities?.cliAvailable ?? null, rssMbAfterStatus: rssMbFor(ctx.runRoot) };
  };

  const fullLoop = async (page, runId, ctx) => {
    const denied = await page.evaluate(async ({ url, runId }) => window.verseClaw.hostInvoke({
      id: crypto.randomUUID(), module: 'agentBrowser', action: 'open',
      payload: { url, mode: 'headless', sessionKey: `agent:main:${runId}`, privateNetworkApprovedBy: 'agent', privateNetworkOrigin: new URL(url).origin },
    }), { url, runId });
    const approval = await ctx.app.evaluate((_electron, input) => {
      const modules = process.mainModule.require('node:module')._cache;
      const entry = Object.keys(modules).find((key) => typeof modules[key].exports?.approveBrowserPrivateNetwork === 'function');
      if (!entry) throw new Error('Main private-network approval owner is unavailable');
      return modules[entry].exports.approveBrowserPrivateNetwork(input);
    }, { sessionId: `agent:main:${runId}`, origin: new URL(url).origin });
    const measured = await page.evaluate(async ({ url, runId }) => {
      const raw = async (action, payload) => window.verseClaw.hostInvoke({ id: crypto.randomUUID(), module: 'agentBrowser', action, ...(payload ? { payload } : {}) });
      const out = { enabled: false, privateNetworkDenied: false, openOk: false, blockedFailsClosed: false, upgradeOk: false, typed: false, clicked: false, snapshotOk: false, snapshotHasFixture: false, ownedSessionCount: -1, closed: false, sessionsAfterClose: -1 };
      out.enabled = (await raw('setEnabled', { enabled: true })).ok === true;
      const open = await raw('open', {
        url,
        mode: 'headless',
        profile: `${runId}-p`,
        sessionKey: `agent:main:${runId}`,
        agentId: 'main',
      });
      out.openOk = open.ok === true;
      if (!open.ok) return out;
      const sessionId = open.data.session.id;
      const blocked = await raw('takeSnapshot', { sessionId });
      out.blockedFailsClosed = blocked.ok === false && String(blocked.error?.message ?? '').includes('runtime mode upgrade');
      out.upgradeOk = (await raw('requestModeUpgrade', { sessionId, targetMode: 'full_access', userApproval: true })).ok === true;
      out.typed = (await raw('type', { sessionId, selector: '#name', text: 'Agent proof', clear: true })).ok === true;
      out.clicked = (await raw('click', { sessionId, selector: '#submit' })).ok === true;
      const snap = await raw('takeSnapshot', { sessionId });
      const text = JSON.stringify(snap.data ?? '');
      out.snapshotOk = snap.ok === true;
      out.snapshotHasFixture = text.includes('N9 STABILITY OK') && text.includes('Saved Agent proof');
      const status = await raw('status');
      out.ownedSessionCount = (status.data?.sessions ?? []).filter((s) => String(s.sessionKey ?? '').toLowerCase() === `agent:main:${runId}`.toLowerCase()).length;
      out.closed = (await raw('close', { sessionId })).ok === true;
      const after = await raw('status');
      out.sessionsAfterClose = (after.data?.sessions ?? []).length;
      return out;
    }, { url, runId });
    measured.privateNetworkDenied = denied.ok === false && String(denied.error?.message ?? '').includes('private-network-default-deny');
    measured.approval = approval;
    measured.rssMbAfterLoop = rssMbFor(ctx.runRoot);
    return measured;
  };

  const interruptOpen = async (page, runId, ctx) => {
    const denied = await page.evaluate(async ({ url, runId }) => window.verseClaw.hostInvoke({
      id: crypto.randomUUID(), module: 'agentBrowser', action: 'open',
      payload: { url, mode: 'headless', sessionKey: `agent:main:${runId}`, privateNetworkApprovedBy: 'agent', privateNetworkOrigin: new URL(url).origin },
    }), { url, runId });
    const approval = await ctx.app.evaluate((_electron, input) => {
      const modules = process.mainModule.require('node:module')._cache;
      const entry = Object.keys(modules).find((key) => typeof modules[key].exports?.approveBrowserPrivateNetwork === 'function');
      if (!entry) throw new Error('Main private-network approval owner is unavailable');
      return modules[entry].exports.approveBrowserPrivateNetwork(input);
    }, { sessionId: `agent:main:${runId}`, origin: new URL(url).origin });
    const opened = await page.evaluate(async ({ url, runId }) => {
      const raw = async (action, payload) => window.verseClaw.hostInvoke({ id: crypto.randomUUID(), module: 'agentBrowser', action, ...(payload ? { payload } : {}) });
      await raw('setEnabled', { enabled: true });
      const open = await raw('open', {
        url,
        mode: 'headless',
        profile: `${runId}-p`,
        sessionKey: `agent:main:${runId}`,
        agentId: 'main',
      });
      return { openOk: open.ok === true };
    }, { url, runId });
    return { interruptedPrivateNetworkDenied: denied.ok === false && String(denied.error?.message ?? '').includes('private-network-default-deny'), approval, interruptedOpenOk: opened.openOk, interruptedWithLiveSession: opened.openOk === true, rssMbAtInterrupt: rssMbFor(ctx.runRoot) };
  };

  try {
    for (let i = 1; i <= coldStarts; i += 1) await withInstance('cold', i, statusOnly);
    for (let i = 1; i <= loops; i += 1) await withInstance('loop', i, fullLoop);
    for (let i = 1; i <= interrupts; i += 1) {
      await withInstance('interrupt', i, interruptOpen);
      await withInstance('recovery', i, fullLoop);
    }
  } finally {
    fixture.closeAllConnections();
    await new Promise((done) => { const timer = setTimeout(done, 5000); fixture.close(() => { clearTimeout(timer); done(); }); });
  }

  // Some packaged-app children can exit just after the per-round observation. Keep
  // the first residue in each row, then perform one final deterministic sweep so the
  // whole batch reports the actual end state instead of a transient shutdown race.
  let finalSweepRemoved = 0;
  let finalSweepKilled = 0;
  // The shared temp root can contain another running probe. Reclaim only the
  // exact per-round directories allocated by this invocation.
  for (const row of rows) {
    const existed = existsSync(row.runRoot);
    const cleanup = await cleanupBrowserProbe({ runRoot: row.runRoot, removalAttempts: 5 });
    finalSweepKilled += cleanup.killed;
    if (existed && cleanup.runDirReclaimed) finalSweepRemoved += 1;
    row.finalResidualProcesses = cleanup.residualProcesses;
    row.finalResidualNames = cleanup.residualNames;
    row.runDirReclaimedFinal = cleanup.runDirReclaimed;
    for (const message of cleanup.errors) issues.push(issue('final_cleanup_failed', { kind: row.kind, index: row.index, message }));
    if (row.finalResidualProcesses !== 0) {
      issues.push(issue('residual_processes_after_sweep', { kind: row.kind, index: row.index, names: row.finalResidualNames }));
    }
    if (!row.runDirReclaimedFinal) {
      issues.push(issue('run_dir_not_reclaimed_after_sweep', { kind: row.kind, index: row.index, runRoot: row.runRoot }));
    }
  }
  await rmdir(batchRoot).catch((error) => issues.push(issue('batch_dir_not_reclaimed', { message: String(error.message) })));

  const byKind = (kind) => rows.filter((r) => r.kind === kind);
  const durations = (kind) => byKind(kind).map((r) => r.durationMs).sort((a, b) => a - b);
  const pct = (list, p) => (list.length === 0 ? null : list[Math.min(list.length - 1, Math.floor((p / 100) * list.length))]);
  const maxOf = (list) => (list.some(value => value == null) ? null : list.length === 0 ? 0 : Math.max(...list));
  const loopRows = byKind('loop');
  const summary = {
    coldStarts: { rounds: byKind('cold').length, passed: byKind('cold').filter((r) => r.status === 'pass').length, p50Ms: pct(durations('cold'), 50), maxMs: maxOf(durations('cold')), maxResidual: maxOf(byKind('cold').map((r) => r.finalResidualProcesses ?? r.residualProcesses)) },
    loops: {
      rounds: loopRows.length,
      passed: loopRows.filter((r) => r.status === 'pass').length,
      fullLoops: loopRows.filter((r) => r.snapshotHasFixture === true && r.closed === true).length,
      p50Ms: pct(durations('loop'), 50),
      p95Ms: pct(durations('loop'), 95),
      maxMs: maxOf(durations('loop')),
      maxResidual: maxOf(loopRows.map((r) => r.finalResidualProcesses ?? r.residualProcesses)),
      rssMbMax: maxOf(loopRows.map((r) => r.rssMbAfterLoop ?? 0)),
    },
    interrupts: {
      rounds: byKind('interrupt').length,
      killedWithLiveSession: byKind('interrupt').filter((r) => r.interruptedWithLiveSession === true && r.forcedShutdown === true && r.status === 'pass').length,
      recoveryRounds: byKind('recovery').length,
      recoveryPassed: byKind('recovery').filter((r) => r.status === 'pass' && r.snapshotHasFixture === true).length,
    },
    runDirsReclaimed: rows.filter((r) => r.runDirReclaimedFinal).length,
    totalRounds: rows.length,
  };

  if ((await browserBuildIdentity(exePath)).digest !== build.digest) issues.push(issue('build_changed_during_run', {}));
  const report = {
    schemaVersion: 1,
    artifact: 'versebrowser-n9-stability',
    driven_by: 'agent',
    actor: 'codex',
    scope: `packaged app repeat runs: ${coldStarts} cold starts, ${loops} full loops, ${interrupts} interrupt+recovery pairs (Windows x64, this build)`,
    finalSweepRemoved,
    finalSweepKilled,
    processCensusBackend: probeCensusBackend(),
    exe,
    build,
    fixtureUrl: url,
    url,
    status: issues.length === 0 ? 'pass' : 'fail',
    summary,
    rows,
    issues,
  };
  if (output) await writeFile(resolve(hostRoot, output), JSON.stringify(report, null, 2) + '\n', 'utf8');
  return report;
}

async function main() {
  const { values } = parseArgs({
    options: {
      'host-root': { type: 'string' },
      exe: { type: 'string' },
      'temp-root': { type: 'string' },
      'cold-starts': { type: 'string' },
      loops: { type: 'string' },
      interrupts: { type: 'string' },
      output: { type: 'string' },
    },
    allowPositionals: false,
  });
  const report = await runProbe({
    hostRoot: values['host-root'],
    exe: values.exe,
    tempRoot: values['temp-root'],
    coldStarts: Number(values['cold-starts'] ?? 10),
    loops: Number(values.loops ?? 30),
    interrupts: Number(values.interrupts ?? 3),
    output: values.output,
  });
  if (!values.output) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  else process.stdout.write(JSON.stringify({ status: report.status, summary: report.summary, issues: report.issues }, null, 2) + '\n');
  process.exitCode = report.status === 'fail' ? 1 : 0;
}

if (isMainEntrypoint(import.meta.url)) main().catch((error) => { process.stderr.write(String((error && error.stack) || error) + '\n'); process.exitCode = 1; });
