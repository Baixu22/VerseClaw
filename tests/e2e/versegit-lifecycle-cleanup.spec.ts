import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { closeElectronApp, expect, test } from './fixtures/electron';

const execFileAsync = promisify(execFile);
const tempRoot = process.platform === 'win32' ? 'D:/tmp' : tmpdir();

async function freePort(): Promise<number> {
  return await new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once('error', rejectPort);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        rejectPort(new Error('no loopback port'));
        return;
      }
      server.close((error) => error ? rejectPort(error) : resolvePort(address.port));
    });
  });
}

async function waitForBridge(url: string, token: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/health`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) return;
    } catch {
      // Electron Main is still starting the bridge.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error('VerseGit binding bridge did not become ready');
}

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore', windowsHide: true });
}

test.describe('VerseGit cleanup barrier lifecycle', () => {
  test.skip(process.platform !== 'win32', 'F2 requires the real Windows worktree/PID cleanup path');
  test('seals normal, failure and continuation cleanup before deleting owned resources', async ({ launchElectronApp }) => {
    const root = mkdtempSync(join(tempRoot, 'versegit-f2-e2e-harness-'));
    const repoRoot = join(root, 'repo');
    const cleanupRoot = join(root, 'cleanup');
    const eventsPath = join(root, 'bridge-events.jsonl');
    const reportPath = join(root, 'report.json');
    const port = await freePort();
    const token = `f2-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const bridgeUrl = `http://127.0.0.1:${port}`;
    mkdirSync(repoRoot, { recursive: true });
    git(repoRoot, ['init', '--initial-branch=main']);
    git(repoRoot, ['config', 'user.email', 'agent@example.invalid']);
    git(repoRoot, ['config', 'user.name', 'Agent']);
    writeFileSync(join(repoRoot, '.gitignore'), '.openclaw/\n', 'utf8');
    writeFileSync(join(repoRoot, 'owned.txt'), 'base\n', 'utf8');
    git(repoRoot, ['add', '.']);
    git(repoRoot, ['commit', '-m', 'base']);

    const app = await launchElectronApp({
      skipSetup: true,
      env: {
        CLAWX_VERSGIT_BINDING_ENABLED: '1',
        CLAWX_VERSGIT_BINDING_PORT: String(port),
        CLAWX_VERSGIT_BINDING_TOKEN: token,
        CLAWX_VERSGIT_BINDING_EVENTS_PATH: eventsPath,
        CLAWX_VERSGIT_CLEANUP_ROOT: cleanupRoot,
        CLAWX_VERSGIT_OWNER_ID: 'agent:codex',
        CLAWX_VERSGIT_EPOCH: '4',
        CLAWX_VERSGIT_ALLOWED_REPO_ROOT: repoRoot,
      },
    });
    try {
      await waitForBridge(bridgeUrl, token);
      await execFileAsync(process.execPath, [
        join(process.cwd(), 'openclaw_runtime/node_modules/tsx/dist/cli.mjs'),
        '--tsconfig', 'tsconfig.node.json', 'scripts/versegit-product-f2-cleanup-probe.mts',
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TEMP: tempRoot,
          TMP: tempRoot,
          CLAWX_VERSGIT_BINDING_ENABLED: '1',
          CLAWX_VERSGIT_RUNTIME_BINDING_URL: bridgeUrl,
          CLAWX_VERSGIT_BINDING_TOKEN: token,
          CLAWX_VERSGIT_OWNER_ID: 'agent:codex',
          CLAWX_VERSGIT_EPOCH: '4',
          CLAWX_VERSGIT_CLEANUP_ROOT: cleanupRoot,
          VERSEGIT_F2_REPO_ROOT: repoRoot,
          VERSEGIT_F2_REPORT_PATH: reportPath,
        },
        timeout: 180_000,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      });

      const report = JSON.parse(readFileSync(reportPath, 'utf8'));
      expect(report).toMatchObject({
        schema: 'clawx.versegit.f2-cleanup-e2e/v1',
        driven_by: 'agent',
        actor: 'codex',
        platform: 'win32',
        cleanupRoot,
        passed: true,
        negative: { rejected: true, status: 'rejected', worktreeSurvived: true },
        boundaries: {
          bindingExplicitlyEnabled: true,
          liveReady: false,
          productApproved: false,
          m4Authorized: false,
          realHumanEvidence: false,
        },
      });
      expect(report.cases).toHaveLength(3);
      expect(report.cases.map((entry: { label: string }) => entry.label)).toEqual(['normal', 'failure', 'continuation']);
      for (const entry of report.cases) {
        expect(entry.result).toMatchObject({ ok: true, barriered: true, status: 'deleted', issues: [] });
        expect(entry.ownedProcess.exited).toBe(true);
        expect(entry.managerPresent).toBe(false);
        expect(entry.worktreeSurvived).toBe(false);
        expect(entry.attachmentsSurvived).toBe(false);
        expect(entry.transcriptSurvived).toBe(false);
        expect(entry.baseRootPreserved).toBe(true);
        expect(entry.inventoryAfter).toMatchObject({ observed: true, processes: 0, managers: 0, worktrees: 0, tempRoots: 0, survivors: [] });
        expect(entry.barrierStatusBeforeLateEvent).toBe('deleted');
        expect(entry.lateEvent).toMatchObject({ accepted: false, status: 'deleted' });
      }

      const events = readFileSync(eventsPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
      expect(events.filter((event) => event.kind === 'attached')).toHaveLength(3);
      expect(events.filter((event) => event.kind === 'end_requested')).toHaveLength(3);
      expect(events.filter((event) => event.kind === 'ended')).toHaveLength(3);
      expect(events.every((event) => event.driven_by === 'agent' && event.actor === 'electron-main')).toBe(true);
      const artifactDir = process.env.VERSEGIT_F2_E2_ARTIFACT_DIR?.trim();
      if (artifactDir) {
        mkdirSync(artifactDir, { recursive: true });
        writeFileSync(join(artifactDir, 'e2-report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
        writeFileSync(join(artifactDir, 'bridge-events.jsonl'), events.map((event) => JSON.stringify(event)).join('\n') + '\n', 'utf8');
      }
    } finally {
      await closeElectronApp(app);
      rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
    }
  });
});
