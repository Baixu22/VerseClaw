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
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const DEFAULT_EXE = 'release/win-unpacked/Verse Claw.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function issue(kind, detail) { return { kind, ...detail }; }

function listProcesses() {
  const ps = [
    "$ErrorActionPreference='SilentlyContinue'",
    'Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine,WorkingSetSize | ConvertTo-Json -Compress -Depth 3',
  ].join('; ');
  const out = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  if (out.status !== 0 || !out.stdout) return [];
  try {
    const parsed = JSON.parse(out.stdout);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function processesFor(runDir) {
  const needle = runDir.toLowerCase();
  return listProcesses().filter((p) => typeof p.CommandLine === 'string' && p.CommandLine.toLowerCase().includes(needle));
}

function rssMbFor(runDir) {
  const bytes = processesFor(runDir).reduce((sum, p) => sum + (Number(p.WorkingSetSize) || 0), 0);
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

async function waitCdp(port, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const body = await res.json();
        if (body.webSocketDebuggerUrl) return body.webSocketDebuggerUrl;
      }
    } catch { /* not ready */ }
    await sleep(500);
  }
  throw new Error(`CDP endpoint on ${port} not ready within ${ms}ms`);
}

export async function runProbe({ hostRoot = ROOT, exe = DEFAULT_EXE, coldStarts = 10, loops = 30, interrupts = 3, output } = {}) {
  const exePath = resolve(hostRoot, exe);
  const require = createRequire(join(hostRoot, 'package.json'));
  const chromium = require('playwright-core').chromium;
  const issues = [];
  const rows = [];
  if (!existsSync(exePath)) {
    return { schemaVersion: 1, artifact: 'versebrowser-n9-stability', driven_by: 'agent', actor: 'codex', status: 'fail', issues: [issue('packaged_exe_missing', { exe })] };
  }

  const fixture = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><title>N9 Fixture</title><h1 id="h">N9 STABILITY OK</h1>
      <input id="name" aria-label="Name"><button id="submit" onclick="document.querySelector('#result').textContent='Saved '+document.querySelector('#name').value">Save</button>
      <p id="result">Not saved</p>`);
  });
  await new Promise((done) => fixture.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${fixture.address().port}/`;
  await mkdir(join(hostRoot, '.tmp'), { recursive: true });

  async function withInstance(kind, index, body) {
    const runRoot = await mkdtemp(join(hostRoot, '.tmp', `n9-${kind}-`));
    const userDataDir = join(runRoot, 'ud');
    await mkdir(userDataDir, { recursive: true });
    await writeFile(join(userDataDir, 'settings.json'), JSON.stringify({ language: 'en' }));
    const port = 9200 + Math.floor(Math.random() * 700);
    const runId = `n9-${kind}-${index}-${Date.now().toString(36)}`;
    const startedAt = Date.now();
    const child = spawn(exePath, ['--no-sandbox', `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`, '--lang=en-US', '--disable-gpu'], {
      cwd: hostRoot,
      windowsHide: true,
      env: { ...process.env, VERSE_CLAW_E2E: '1', VERSE_CLAW_E2E_SKIP_SETUP: '1', VERSE_CLAW_USER_DATA_DIR: userDataDir },
    });
    let exited = false;
    child.on('exit', () => { exited = true; });
    let browser;
    const row = { kind, index, runId, runRoot, status: 'fail' };
    try {
      const wsUrl = await waitCdp(port, 90_000);
      row.launchMs = Date.now() - startedAt;
      browser = await chromium.connectOverCDP(wsUrl);
      let page = null;
      const pageDeadline = Date.now() + 30_000;
      while (Date.now() < pageDeadline && page === null) {
        const pages = browser.contexts().flatMap((c) => c.pages());
        if (pages.length > 0) page = pages[0];
        else await sleep(500);
      }
      if (page === null) throw new Error('renderer produced no page within 30s');
      row.rendererReadyMs = Date.now() - startedAt;
      row.pageTitle = await page.title();
      Object.assign(row, await body(page, runId, { runRoot, userDataDir }));
      row.status = 'pass';
    } catch (error) {
      row.error = String((error && error.message) || error);
      issues.push(issue('round_failed', { kind, index, message: row.error }));
    } finally {
      if (browser) await browser.close().catch(() => undefined);
      // Every round tears the app tree down; for `interrupt` rounds this kill happens with a
      // live browser session still open, which is the controlled-interrupt case.
      if (!exited) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      const exitDeadline = Date.now() + 10_000;
      while (!exited && Date.now() < exitDeadline) await sleep(200);
      row.appExited = exited;
      let residual = processesFor(runRoot);
      row.initialResidualProcesses = residual.length;
      row.initialResidualNames = residual.slice(0, 5).map((p) => p.Name);
      let cleanupAttempts = 0;
      while (residual.length > 0 && cleanupAttempts < 5) {
        cleanupAttempts += 1;
        for (const processInfo of residual) {
          try { process.kill(Number(processInfo.ProcessId), 'SIGKILL'); } catch { /* already exited */ }
          spawnSync('taskkill', ['/PID', String(processInfo.ProcessId), '/T', '/F'], { windowsHide: true });
        }
        await sleep(1500);
        residual = processesFor(runRoot);
      }
      row.residualCleanupAttempts = cleanupAttempts;
      row.residualProcesses = residual.length;
      row.residualNames = residual.slice(0, 5).map((p) => p.Name);
      let reclaimed = false;
      for (let attempt = 0; attempt < 6 && !reclaimed; attempt += 1) {
        try { await rm(runRoot, { recursive: true, force: true }); reclaimed = !existsSync(runRoot); }
        catch { await sleep(800); }
      }
      row.runDirReclaimed = reclaimed;
      row.durationMs = Date.now() - startedAt;
    }
    rows.push(row);
    return row;
  }

  const statusOnly = async (page, _runId, ctx) => {
    const status = await page.evaluate(async () => window.verseClaw.hostInvoke({ id: crypto.randomUUID(), module: 'agentBrowser', action: 'status' }));
    return { hostStatusOk: status.ok === true, capabilityCliAvailable: status.data?.capabilities?.cliAvailable ?? null, rssMbAfterStatus: rssMbFor(ctx.runRoot) };
  };

  const fullLoop = async (page, runId, ctx) => {
    const measured = await page.evaluate(async ({ url, runId }) => {
      const raw = async (action, payload) => window.verseClaw.hostInvoke({ id: crypto.randomUUID(), module: 'agentBrowser', action, ...(payload ? { payload } : {}) });
      const out = { enabled: false, privateNetworkDenied: false, openOk: false, blockedFailsClosed: false, upgradeOk: false, typed: false, clicked: false, snapshotOk: false, snapshotHasFixture: false, ownedSessionCount: -1, closed: false, sessionsAfterClose: -1 };
      out.enabled = (await raw('setEnabled', { enabled: true })).ok === true;
      const denied = await raw('open', { url, mode: 'headless', profile: `${runId}-denied`, sessionKey: `agent:main:${runId}-denied`, agentId: 'main' });
      out.privateNetworkDenied =
        denied.ok === false && String(denied.error?.message ?? '').includes('private-network-default-deny');
      const open = await raw('open', {
        url,
        mode: 'headless',
        profile: `${runId}-p`,
        sessionKey: `agent:main:${runId}`,
        agentId: 'main',
        privateNetworkApprovedBy: 'agent',
        privateNetworkOrigin: new URL(url).origin,
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
    measured.rssMbAfterLoop = rssMbFor(ctx.runRoot);
    return measured;
  };

  const interruptOpen = async (page, runId, ctx) => {
    const opened = await page.evaluate(async ({ url, runId }) => {
      const raw = async (action, payload) => window.verseClaw.hostInvoke({ id: crypto.randomUUID(), module: 'agentBrowser', action, ...(payload ? { payload } : {}) });
      await raw('setEnabled', { enabled: true });
      const denied = await raw('open', { url, mode: 'headless', profile: `${runId}-denied`, sessionKey: `agent:main:${runId}-denied`, agentId: 'main' });
      const privateNetworkDenied =
        denied.ok === false && String(denied.error?.message ?? '').includes('private-network-default-deny');
      const open = await raw('open', {
        url,
        mode: 'headless',
        profile: `${runId}-p`,
        sessionKey: `agent:main:${runId}`,
        agentId: 'main',
        privateNetworkApprovedBy: 'agent',
        privateNetworkOrigin: new URL(url).origin,
      });
      return { privateNetworkDenied, openOk: open.ok === true };
    }, { url, runId });
    return { interruptedPrivateNetworkDenied: opened.privateNetworkDenied, interruptedOpenOk: opened.openOk, interruptedWithLiveSession: opened.openOk === true, rssMbAtInterrupt: rssMbFor(ctx.runRoot) };
  };

  for (let i = 1; i <= coldStarts; i += 1) await withInstance('cold', i, statusOnly);
  for (let i = 1; i <= loops; i += 1) await withInstance('loop', i, fullLoop);
  for (let i = 1; i <= interrupts; i += 1) {
    await withInstance('interrupt', i, interruptOpen);
    await withInstance('recovery', i, fullLoop);
  }

  await new Promise((done) => { const timer = setTimeout(done, 5000); fixture.close(() => { clearTimeout(timer); done(); }); });

  // Some packaged-app children can exit just after the per-round observation. Keep
  // the first residue in each row, then perform one final deterministic sweep so the
  // whole batch reports the actual end state instead of a transient shutdown race.
  const tmpRoot = join(hostRoot, '.tmp');
  let finalSweepRemoved = 0;
  let finalSweepKilled = 0;
  if (existsSync(tmpRoot)) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const leftovers = processesFor(tmpRoot);
      if (leftovers.length === 0) break;
      for (const processInfo of leftovers) {
        try { process.kill(Number(processInfo.ProcessId), 'SIGKILL'); } catch { /* already exited */ }
        spawnSync('taskkill', ['/PID', String(processInfo.ProcessId), '/T', '/F'], { windowsHide: true });
        finalSweepKilled += 1;
      }
      await sleep(1000);
    }
    const leftovers = readdirSync(tmpRoot).filter((name) => name.startsWith('n9-'));
    for (const name of leftovers) {
      const target = join(tmpRoot, name);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try { await rm(target, { recursive: true, force: true }); break; }
        catch { await sleep(1000); }
      }
      if (!existsSync(target)) finalSweepRemoved += 1;
    }
  }

  for (const row of rows) {
    const finalResidual = row.runRoot ? processesFor(row.runRoot) : [];
    row.finalResidualProcesses = finalResidual.length;
    row.finalResidualNames = finalResidual.slice(0, 5).map((p) => p.Name);
    row.runDirReclaimedFinal = !row.runRoot || !existsSync(row.runRoot);
    if (row.finalResidualProcesses !== 0) {
      issues.push(issue('residual_processes_after_sweep', { kind: row.kind, index: row.index, names: row.finalResidualNames }));
    }
    if (!row.runDirReclaimedFinal) {
      issues.push(issue('run_dir_not_reclaimed_after_sweep', { kind: row.kind, index: row.index, runRoot: row.runRoot }));
    }
  }

  const byKind = (kind) => rows.filter((r) => r.kind === kind);
  const durations = (kind) => byKind(kind).map((r) => r.durationMs).sort((a, b) => a - b);
  const pct = (list, p) => (list.length === 0 ? null : list[Math.min(list.length - 1, Math.floor((p / 100) * list.length))]);
  const maxOf = (list) => (list.length === 0 ? 0 : Math.max(...list));
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
      killedWithLiveSession: byKind('interrupt').filter((r) => r.interruptedWithLiveSession === true).length,
      recoveryRounds: byKind('recovery').length,
      recoveryPassed: byKind('recovery').filter((r) => r.status === 'pass' && r.snapshotHasFixture === true).length,
    },
    runDirsReclaimed: rows.filter((r) => r.runDirReclaimedFinal).length,
    totalRounds: rows.length,
  };

  const report = {
    schemaVersion: 1,
    artifact: 'versebrowser-n9-stability',
    driven_by: 'agent',
    actor: 'codex',
    scope: `packaged app repeat runs: ${coldStarts} cold starts, ${loops} full loops, ${interrupts} interrupt+recovery pairs (Windows x64, this build)`,
    finalSweepRemoved,
    finalSweepKilled,
    exe,
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
