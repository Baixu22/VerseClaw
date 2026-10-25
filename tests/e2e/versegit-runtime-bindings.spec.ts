import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { closeElectronApp, expect, test } from './fixtures/electron';

const execFileAsync = promisify(execFile);
async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('no port'));
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}
function git(cwd: string, args: string[]) { return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim(); }
async function waitForBridge(url: string, token: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try { const response = await fetch(`${url}/health`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(1000) }); if (response.ok) return; } catch { /* bridge is starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('VerseGit binding bridge did not become ready');
}

test.describe('VerseGit runtime binding lifecycle', () => {
  test('runs two real worktree workers through the product orchestrator and typed Main bridge', async ({ launchElectronApp }) => {
    const configuredRoot = process.env.VERSEGIT_C1_E2E_ROOT?.trim();
    const root = configuredRoot ? configuredRoot : mkdtempSync(join(tmpdir(), 'versegit-c1-e2e-'));
    if (configuredRoot) mkdirSync(root, { recursive: true });
    const port = await freePort();
    const token = `c1-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const eventsPath = join(root, 'bridge-events.jsonl');
    const reportPath = join(root, 'probe-report.json');
    const bridgeUrl = `http://127.0.0.1:${port}`;
    try {
      git(root, ['init', '--initial-branch=main']);
      git(root, ['config', 'user.email', 'agent@example.invalid']);
      git(root, ['config', 'user.name', 'Agent']);
      writeFileSync(join(root, 'base.txt'), 'base\n');
      git(root, ['add', '.']);
      git(root, ['commit', '-m', 'base']);

      const app = await launchElectronApp({
        skipSetup: true,
        env: {
          CLAWX_VERSGIT_BINDING_ENABLED: '1',
          CLAWX_VERSGIT_BINDING_PORT: String(port),
          CLAWX_VERSGIT_BINDING_TOKEN: token,
          CLAWX_VERSGIT_BINDING_EVENTS_PATH: eventsPath,
          CLAWX_VERSGIT_OWNER_ID: 'agent:codex',
          CLAWX_VERSGIT_EPOCH: '4',
          CLAWX_VERSGIT_ALLOWED_REPO_ROOT: root,
        },
      });
      try {
        await waitForBridge(bridgeUrl, token);
        const probeEnv = {
          ...process.env,
          CLAWX_VERSGIT_BINDING_ENABLED: '1',
          CLAWX_VERSGIT_RUNTIME_BINDING_URL: bridgeUrl,
          CLAWX_VERSGIT_BINDING_TOKEN: token,
          CLAWX_VERSGIT_OWNER_ID: 'agent:codex',
          CLAWX_VERSGIT_EPOCH: '4',
          VERSEGIT_C1_REPO_ROOT: root,
          VERSEGIT_C1_REPORT_PATH: reportPath,
        };
        await execFileAsync(process.execPath, [
          join(process.cwd(), 'openclaw_runtime/node_modules/tsx/dist/cli.mjs'),
          '--tsconfig', 'tsconfig.node.json', 'scripts/versegit-runtime-bindings-probe.mts',
        ], { cwd: process.cwd(), env: probeEnv, timeout: 120_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });

        expect(existsSync(reportPath)).toBe(true);
        const report = JSON.parse(readFileSync(reportPath, 'utf8'));
        expect(report).toMatchObject({
          passed: true,
          orchestration: { failures: 0, spawned: expect.any(Number), bindings: expect.any(Number) },
          retry: { sameBinding: true },
          duplicateSession: true,
          duplicateEndRejected: true,
          attach: true,
          cancelled: true,
          childBindingsEnded: true,
          authority: { vgUnavailableDegradesHost: true, degradationRecorded: true },
          negatives: { crossRepoRejected: true, wrongOwnerRejected: true, staleEpochRejected: true, sameRepoAcrossJunction: true },
        });
        expect(report.orchestration.spawned).toBeGreaterThanOrEqual(2);
        expect(report.orchestration.bindings).toBeGreaterThanOrEqual(2);

        const events = readFileSync(eventsPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
        expect(events.filter((event) => event.kind === 'bound').length).toBeGreaterThanOrEqual(2);
        expect(events.filter((event) => event.kind === 'attach_requested').length).toBeGreaterThanOrEqual(2);
        expect(events.filter((event) => event.kind === 'attached').length).toBeGreaterThanOrEqual(2);
        expect(events.filter((event) => event.kind === 'end_requested').length).toBeGreaterThanOrEqual(2);
        expect(events.filter((event) => event.kind === 'ended').length).toBeGreaterThanOrEqual(2);
        expect(events.every((event) => event.driven_by === 'agent' && event.actor === 'electron-main')).toBe(true);
      } finally {
        await closeElectronApp(app);
      }
    } finally {
      if (!configuredRoot) rmSync(root, { recursive: true, force: true });
    }
  });
});
