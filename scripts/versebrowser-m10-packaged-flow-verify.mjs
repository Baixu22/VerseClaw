#!/usr/bin/env node
// Packaged-app acceptance: drive release/win-unpacked/Verse Claw.exe through its own host
// bridge to the embedded @verse-claw/versebrowser module. Uses CDP because Playwright's
// electron.launch firstWindow() does not attach to the packaged exe on every host.
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isMainEntrypoint } from './lib/entrypoint.mjs';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const EXE = 'release/win-unpacked/Verse Claw.exe';


const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForCdp(port, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const body = await res.json();
        if (body.webSocketDebuggerUrl) return body.webSocketDebuggerUrl;
      }
    } catch { /* not ready */ }
    await sleep(500);
  }
  throw new Error(`CDP endpoint on ${port} not ready within ${deadlineMs}ms`);
}

export async function verifyPackagedFlow({ hostRoot = ROOT, exe = EXE } = {}) {
  const exePath = resolve(hostRoot, exe);
  const issues = [];
  if (!existsSync(exePath)) return { schemaVersion: 1, driven_by: 'agent', actor: 'codex', status: 'fail', issues: [{ kind: 'packaged_exe_missing', path: exe }] };
  const require = createRequire(join(hostRoot, 'package.json'));
  const chromium = require('playwright-core').chromium;

  const fixture = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>M10 Fixture</title><h1 id="h">M10 PACKAGED OK</h1><p>body marker 42</p>');
  });
  await new Promise((done) => fixture.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${fixture.address().port}/`;
  // A fresh checkout has no .tmp directory, so mkdtemp would fail with ENOENT before
  // the app is ever launched (N8 F3).
  await mkdir(join(hostRoot, '.tmp'), { recursive: true });
  const runRoot = await mkdtemp(join(hostRoot, '.tmp', 'm10-packaged-flow-'));
  const userDataDir = join(runRoot, 'ud');
  await mkdir(userDataDir, { recursive: true });
  await writeFile(join(userDataDir, 'settings.json'), JSON.stringify({ language: 'en' }));
  const port = 9300 + Math.floor(Math.random() * 600);
  const runId = `m10-${Date.now().toString(36)}`;

  const child = spawn(exePath, ['--no-sandbox', `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`, '--lang=en-US', '--disable-gpu'], {
    cwd: hostRoot, windowsHide: true,
    env: { ...process.env, VERSE_CLAW_E2E: '1', VERSE_CLAW_E2E_SKIP_SETUP: '1', VERSE_CLAW_USER_DATA_DIR: userDataDir },
  });
  let childExited = false;
  child.on('exit', () => { childExited = true; });
  const result = { schemaVersion: 1, artifact: 'versebrowser-m10-packaged-flow', driven_by: 'agent', actor: 'codex', exe, fixtureUrl: url, runId };
  let browser;
  try {
    const wsUrl = await waitForCdp(port, 90_000);
    browser = await chromium.connectOverCDP(wsUrl);
    // The CDP endpoint can be live before the renderer registers its page, so wait for
    // one instead of failing the run on a race (N8 F3).
    let page = null;
    const pageDeadline = Date.now() + 30_000;
    while (Date.now() < pageDeadline && page === null) {
      const pages = browser.contexts().flatMap((c) => c.pages());
      if (pages.length > 0) page = pages[0];
      else await sleep(500);
    }
    if (page === null) throw new Error('packaged renderer produced no page within 30s');
    result.pageTitle = await page.title();
    result.hostBridgePresent = await page.evaluate(() => Boolean(window.verseClaw?.hostInvoke));
    if (!result.hostBridgePresent) throw new Error('hostInvoke bridge missing in packaged renderer');
    result.flow = await page.evaluate(async ({ url, runId }) => {
      const raw = async (action, payload) => window.verseClaw.hostInvoke({ id: crypto.randomUUID(), module: 'agentBrowser', action, ...(payload ? { payload } : {}) });
      const enabled = await raw('setEnabled', { enabled: true });
      const privateNetworkOpen = await raw('open', { url, mode: 'headless', profile: runId, sessionKey: `agent:main:${runId}`, agentId: 'main' });
      const privateNetworkDenied =
        privateNetworkOpen.ok === false &&
        String(privateNetworkOpen.error?.message ?? '').includes('private-network-default-deny');
      const open = enabled.ok === true
        ? await raw('open', {
            url,
            mode: 'headless',
            profile: runId,
            sessionKey: `agent:main:${runId}`,
            agentId: 'main',
            privateNetworkApprovedBy: 'agent',
            privateNetworkOrigin: new URL(url).origin,
          })
        : privateNetworkOpen;
      if (!open.ok) return { enabled: enabled.ok, privateNetworkDenied, openOk: false, openError: open.error };
      const sessionId = open.data.session.id;
      const blocked = await raw('takeSnapshot', { sessionId });
      const upgrade = await raw('requestModeUpgrade', { sessionId, targetMode: 'full_access', userApproval: true });
      const snap = await raw('takeSnapshot', { sessionId });
      const snapText = JSON.stringify(snap.data ?? '');
      const status = await raw('status');
      const owned = (status.data?.sessions ?? []).filter((s) => String(s.sessionKey ?? '').toLowerCase() === `agent:main:${runId}`.toLowerCase());
      const close = await raw('close', { sessionId });
      return {
        enabled: enabled.ok, privateNetworkDenied, openOk: true, sessionId,
        blockedFailsClosed: blocked.ok === false && String(blocked.error?.message ?? '').includes('runtime mode upgrade'),
        upgradeOk: upgrade.ok, upgradeMode: upgrade.data?.runtimeMode ?? null,
        snapshotOk: snap.ok, snapshotHasFixture: snapText.includes('M10 PACKAGED OK') && snapText.includes('body marker 42'),
        ownedSessionCount: owned.length, closed: close.ok,
      };
    }, { url, runId });
  } catch (error) {
    issues.push({ kind: 'packaged_flow_failed', message: String(error?.message ?? error) });
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    try { child.kill(); } catch { /* best effort */ }
    // Never let a lingering client connection hang the verifier (N8 F3).
    await new Promise((done) => { const timer = setTimeout(done, 5000); fixture.close(() => { clearTimeout(timer); done(); }); });
    // The app's own child processes can still be shutting down and hold files under the
    // run directory, which made a single rm() fail silently and leave the run root behind
    // (N8 F3). Wait for the renderer process to exit, then retry the cleanup.
    if (!childExited) {
      await new Promise((done) => { const timer = setTimeout(done, 10_000); child.once('exit', () => { clearTimeout(timer); done(); }); });
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try { await rm(runRoot, { recursive: true, force: true }); break; } catch { await sleep(1000); }
    }
  }

  const f = result.flow ?? {};
  const checks = {
    host_bridge_present: result.hostBridgePresent === true,
    private_network_default_deny: f.privateNetworkDenied === true,
    real_session_opened: f.openOk === true,
    sandbox_fails_closed_without_upgrade: f.blockedFailsClosed === true,
    runtime_mode_upgrade_ok: f.upgradeMode === 'full_access',
    snapshot_returns_fixture_content: f.snapshotOk === true && f.snapshotHasFixture === true,
    session_owned_by_requested_key: f.ownedSessionCount === 1,
    session_closed: f.closed === true,
  };
  result.checks = checks;
  result.status = issues.length === 0 && Object.values(checks).every(Boolean) ? 'pass' : 'fail';
  result.issues = issues;
  return result;
}

async function main() {
  const { values } = parseArgs({ options: { 'host-root': { type: 'string' }, exe: { type: 'string' }, output: { type: 'string' } }, allowPositionals: false });
  const report = await verifyPackagedFlow({ hostRoot: values['host-root'], exe: values.exe });
  const text = JSON.stringify(report, null, 2) + '\n';
  if (values.output) await writeFile(resolve(values.output), text, 'utf8');
  process.stdout.write(text);
  process.exitCode = report.status === 'fail' ? 1 : 0;
}

if (isMainEntrypoint(import.meta.url)) main().catch((error) => { process.stderr.write(String(error?.stack ?? error) + '\n'); process.exitCode = 1; });