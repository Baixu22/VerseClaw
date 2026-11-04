#!/usr/bin/env node
// Packaged-app acceptance: drive release/win-unpacked/Verse Claw.exe through its own host
// bridge to the embedded @verse-claw/versebrowser module. Agent approvals are driven
// through the Main inspector, never supplied as renderer permission claims.
import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { browserBuildIdentity } from './lib/versebrowser-build-identity.mjs';
import { cleanupBrowserProbe } from './lib/versebrowser-probe-cleanup.mjs';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const EXE = 'release/win-unpacked/Verse Claw.exe';


export async function verifyPackagedFlow({ hostRoot = ROOT, exe = EXE, tempRoot = join(hostRoot, '.tmp') } = {}) {
  const exePath = resolve(hostRoot, exe);
  const issues = [];
  if (!existsSync(exePath)) return { schemaVersion: 1, driven_by: 'agent', actor: 'codex', status: 'fail', issues: [{ kind: 'packaged_exe_missing', path: exe }] };
  const build = await browserBuildIdentity(exePath);
  const require = createRequire(join(hostRoot, 'package.json'));
  const electron = require('playwright-core')._electron;

  const fixture = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>M10 Fixture</title><h1 id="h">M10 PACKAGED OK</h1><p>body marker 42</p>');
  });
  await new Promise((done) => fixture.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${fixture.address().port}/`;
  // A fresh checkout has no .tmp directory, so mkdtemp would fail with ENOENT before
  // the app is ever launched (N8 F3).
  await mkdir(tempRoot, { recursive: true });
  const runRoot = await mkdtemp(join(tempRoot, 'm10-packaged-flow-'));
  const userDataDir = join(runRoot, 'ud');
  const homeDir = join(runRoot, 'home');
  const artifactsDir = join(runRoot, 'playwright');
  for (const dir of [userDataDir, homeDir, artifactsDir, join(homeDir, 'AppData/Roaming'), join(homeDir, 'AppData/Local')]) await mkdir(dir, { recursive: true });
  await writeFile(join(userDataDir, 'settings.json'), JSON.stringify({ language: 'en' }));
  const runId = `m10-${Date.now().toString(36)}`;

  const result = { schemaVersion: 1, artifact: 'versebrowser-m10-packaged-flow', driven_by: 'agent', actor: 'codex', exe, build, fixtureUrl: url, runId };
  let app;
  try {
    app = await electron.launch({ executablePath: exePath, artifactsDir, args: ['--no-sandbox', `--user-data-dir=${userDataDir}`, '--lang=en-US', '--disable-gpu'], cwd: hostRoot, timeout: 90_000,
      env: { ...process.env, TEMP: runRoot, TMP: runRoot, HOME: homeDir, USERPROFILE: homeDir,
        APPDATA: join(homeDir, 'AppData/Roaming'), LOCALAPPDATA: join(homeDir, 'AppData/Local'),
        XDG_CONFIG_HOME: join(homeDir, '.config'), OPENCLAW_CONFIG_DIR: join(homeDir, '.openclaw'),
        VERSE_CLAW_REMOTE_DEBUGGING_PORT: '', VERSE_CLAW_E2E: '1', VERSE_CLAW_E2E_SKIP_SETUP: '1', VERSE_CLAW_USER_DATA_DIR: userDataDir } });
    const page = await app.firstWindow({ timeout: 30_000 });
    await page.waitForLoadState('load', { timeout: 30_000 });
    await page.waitForFunction(() => Boolean(window.verseClaw?.hostInvoke), {}, { timeout: 30_000 });
    result.pageTitle = await page.title();
    result.hostBridgePresent = await page.evaluate(() => Boolean(window.verseClaw?.hostInvoke));
    if (!result.hostBridgePresent) throw new Error('hostInvoke bridge missing in packaged renderer');
    result.defaultDeny = await page.evaluate(async ({ url, runId }) => window.verseClaw.hostInvoke({
      id: crypto.randomUUID(), module: 'agentBrowser', action: 'open',
      payload: { url, mode: 'headless', sessionKey: `agent:main:${runId}`, privateNetworkApprovedBy: 'agent', privateNetworkOrigin: new URL(url).origin },
    }), { url, runId });
    result.approval = await app.evaluate((_electron, input) => {
      const modules = process.mainModule.require('node:module')._cache;
      const entry = Object.keys(modules).find((key) => typeof modules[key].exports?.approveBrowserPrivateNetwork === 'function');
      if (!entry) throw new Error('Main private-network approval owner is unavailable');
      return modules[entry].exports.approveBrowserPrivateNetwork(input);
    }, { sessionId: `agent:main:${runId}`, origin: new URL(url).origin });
    result.flow = await page.evaluate(async ({ url, runId }) => {
      const raw = async (action, payload) => window.verseClaw.hostInvoke({ id: crypto.randomUUID(), module: 'agentBrowser', action, ...(payload ? { payload } : {}) });
      const enabled = await raw('setEnabled', { enabled: true });
      const open = await raw('open', {
            url,
            mode: 'headless',
            profile: runId,
            sessionKey: `agent:main:${runId}`,
            agentId: 'main',
          });
      if (!open.ok) return { enabled: enabled.ok, openOk: false, openError: open.error };
      const sessionId = open.data.session.id;
      const blocked = await raw('takeSnapshot', { sessionId });
      const upgrade = await raw('requestModeUpgrade', { sessionId, targetMode: 'full_access', userApproval: true });
      const snap = await raw('takeSnapshot', { sessionId });
      const snapText = JSON.stringify(snap.data ?? '');
      const status = await raw('status');
      const owned = (status.data?.sessions ?? []).filter((s) => String(s.sessionKey ?? '').toLowerCase() === `agent:main:${runId}`.toLowerCase());
      const close = await raw('close', { sessionId });
      return {
        enabled: enabled.ok, openOk: true, sessionId,
        blockedFailsClosed: blocked.ok === false && String(blocked.error?.message ?? '').includes('runtime mode upgrade'),
        upgradeOk: upgrade.ok, upgradeMode: upgrade.data?.runtimeMode ?? null,
        snapshotOk: snap.ok, snapshotHasFixture: snapText.includes('M10 PACKAGED OK') && snapText.includes('body marker 42'),
        ownedSessionCount: owned.length, closed: close.ok,
      };
    }, { url, runId });
  } catch (error) {
    issues.push({ kind: 'packaged_flow_failed', message: String(error?.message ?? error) });
  } finally {
    result.cleanup = await cleanupBrowserProbe({ app, runRoot, removalAttempts: 5 });
    for (const message of result.cleanup.errors) issues.push({ kind: 'packaged_cleanup_failed', message });
    // Never let a lingering client connection hang the verifier (N8 F3).
    fixture.closeAllConnections();
    await new Promise((done) => { const timer = setTimeout(done, 5000); fixture.close(() => { clearTimeout(timer); done(); }); });
  }

  const f = result.flow ?? {};
  const checks = {
    host_bridge_present: result.hostBridgePresent === true,
    private_network_default_deny: result.defaultDeny?.ok === false && String(result.defaultDeny.error?.message ?? '').includes('private-network-default-deny'),
    real_session_opened: f.openOk === true,
    sandbox_fails_closed_without_upgrade: f.blockedFailsClosed === true,
    runtime_mode_upgrade_ok: f.upgradeMode === 'full_access',
    snapshot_returns_fixture_content: f.snapshotOk === true && f.snapshotHasFixture === true,
    session_owned_by_requested_key: f.ownedSessionCount === 1,
    session_closed: f.closed === true,
    processes_closed: result.cleanup?.residualProcesses === 0,
    run_directory_reclaimed: result.cleanup?.runDirReclaimed === true,
  };
  result.checks = checks;
  if ((await browserBuildIdentity(exePath)).digest !== build.digest) issues.push({ kind: 'build_changed_during_run' });
  result.status = issues.length === 0 && Object.values(checks).every(Boolean) ? 'pass' : 'fail';
  result.issues = issues;
  return result;
}

async function main() {
  const { values } = parseArgs({ options: { 'host-root': { type: 'string' }, exe: { type: 'string' }, 'temp-root': { type: 'string' }, output: { type: 'string' } }, allowPositionals: false });
  const report = await verifyPackagedFlow({ hostRoot: values['host-root'], exe: values.exe, tempRoot: values['temp-root'] });
  const text = JSON.stringify(report, null, 2) + '\n';
  if (values.output) await writeFile(resolve(values.output), text, 'utf8');
  process.stdout.write(text);
  process.exitCode = report.status === 'fail' ? 1 : 0;
}

if (isMainEntrypoint(import.meta.url)) main().catch((error) => { process.stderr.write(String(error?.stack ?? error) + '\n'); process.exitCode = 1; });
