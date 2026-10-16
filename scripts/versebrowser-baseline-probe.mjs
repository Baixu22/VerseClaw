import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

// Read-only startup baseline. The same frozen controller is used for both trees.
// A completed receipt is NOT a passing startup; failed startup exits nonzero.
const { values } = parseArgs({ options: {
  root: { type: 'string' }, electron: { type: 'string' }, output: { type: 'string' },
  'diagnostic-no-sandbox': { type: 'boolean', default: false },
}, allowPositionals: false });
if (!values.root || !values.electron || !values.output) throw new Error('--root, --electron and --output are required');
const root = resolve(values.root);
const output = resolve(values.output);
await mkdir(output, { recursive: true });
const runRoot = await mkdtemp(join(tmpdir(), 'verse-claw-e2e-run-'));
const home = join(runRoot, 'home');
const userData = join(runRoot, 'user-data');
for (const dir of [home, userData, join(home, '.openclaw'), join(home, '.config'), join(home, 'AppData/Local'), join(home, 'AppData/Roaming')]) await mkdir(dir, { recursive: true });
await writeFile(join(userData, 'settings.json'), JSON.stringify({ language: 'en' }));
async function port() {
  const server = createServer();
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const value = server.address().port;
  await new Promise((done) => server.close(done));
  return value;
}
const git = (...args) => execFileSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8' }).trim();
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const entry = join(root, 'dist-electron/main/index.js');
const args = [
  ...(values['diagnostic-no-sandbox'] ? ['--no-sandbox'] : []),
  `--user-data-dir=${userData}`, '--lang=en-US', '--disable-gpu', '--disable-gpu-compositing',
  '--disable-software-rasterizer', '--in-process-gpu', '--disable-features=Vulkan,UseSkiaRenderer,CanvasOopRasterization', entry,
];
const receipt = {
  schemaVersion: 1, driven_by: 'agent', actor: 'codex', scope: 'startup and read-only host status; not browser business acceptance',
  root, runRoot, candidate: { commit: git('rev-parse', 'HEAD'), dirty: Boolean(git('status', '--porcelain')), tree: git('rev-parse', 'HEAD^{tree}') },
  controllerSha256: hash(await readFile(new URL(import.meta.url))),
  toolchain: { node: process.version, uv: process.versions.uv, nodePath: process.execPath, electronBinary: values.electron, electronSha256: hash(await readFile(values.electron)) },
  conditions: { diagnosticNoSandbox: values['diagnostic-no-sandbox'], firstWindowDeadlineMs: 30000, launchDeadlineMs: 90000, isolatedHome: true, copiedUserCredentials: false, args },
  entrySha256: hash(await readFile(entry)), startedAt: new Date().toISOString(), stage: 'launch', startupOutcome: 'not_run',
};
process.env.DEBUG = 'pw:browser'; // Capture launch-time output before firstWindow exists.
const require = createRequire(join(root, 'package.json'));
const { _electron } = require('@playwright/test');
const { cleanupElectronProcesses } = await import(pathToFileURL(join(root, 'tests/e2e/fixtures/electron-process-cleanup.ts')).href);
let app;
const env = Object.fromEntries(Object.entries({
  ...process.env, HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData/Roaming'), LOCALAPPDATA: join(home, 'AppData/Local'), XDG_CONFIG_HOME: join(home, '.config'),
  LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', LANGUAGE: 'en', VERSE_CLAW_E2E: '1', CLAWX_AGENT_DEV: '1', VERSE_CLAW_USER_DATA_DIR: userData,
  VERSE_CLAW_PORT_CLAWX_HOST_API: String(await port()), VERSE_CLAW_REMOTE_DEBUGGING_PORT: String(await port()),
}).filter(([, v]) => v !== undefined));
delete env.ELECTRON_RUN_AS_NODE;
try {
  app = await _electron.launch({ executablePath: resolve(values.electron), args, cwd: root, env, timeout: 90000 });
  receipt.pid = app.process().pid;
  receipt.mainState = await app.evaluate(({ app, BrowserWindow }) => ({ ready: app.isReady(), appPath: app.getAppPath(), userData: app.getPath('userData'), versions: process.versions, windowCount: BrowserWindow.getAllWindows().length }));
  receipt.stage = 'first-window';
  const page = await app.firstWindow({ timeout: 30000 });
  receipt.stage = 'host-bridge';
  await page.waitForFunction(() => Boolean(window.verseClaw?.hostInvoke), undefined, { timeout: 15000 });
  receipt.hostStatus = await page.evaluate(async () => await window.verseClaw.hostInvoke({ id: 'baseline-status', module: 'agentBrowser', action: 'status' }));
  receipt.url = page.url();
  receipt.startupOutcome = receipt.hostStatus.ok ? 'pass' : 'fail';
} catch (error) {
  receipt.startupOutcome = 'fail';
  receipt.error = { name: error.name, message: error.message, stack: error.stack };
  if (app) receipt.failureMainState = await app.evaluate(({ app, BrowserWindow }) => ({ ready: app.isReady(), userData: app.getPath('userData'), windowCount: BrowserWindow.getAllWindows().length })).catch((e) => ({ error: String(e) }));
} finally {
  if (app) {
    let timer;
    await Promise.race([app.close().catch(() => undefined), new Promise((done) => { timer = setTimeout(done, 8000); })]);
    clearTimeout(timer);
  }
  try {
    await cleanupElectronProcesses(runRoot, output);
    receipt.cleanup = JSON.parse(await readFile(join(output, 'electron-process-cleanup.json'), 'utf8'));
  } catch (error) { receipt.cleanup = { error: String(error) }; }
  receipt.endedAt = new Date().toISOString();
  receipt.candidateDirtyAfter = Boolean(git('status', '--porcelain'));
  receipt.ok = receipt.startupOutcome === 'pass' && receipt.cleanup.remaining?.length === 0;
  await writeFile(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
}
console.log(JSON.stringify({ startupOutcome: receipt.startupOutcome, stage: receipt.stage, remainingOwnedProcesses: receipt.cleanup.remaining?.length, receipt: join(output, 'receipt.json') }));
process.exitCode = receipt.ok ? 0 : 1;
