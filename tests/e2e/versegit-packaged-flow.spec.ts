import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { ElectronApplication, Page } from '@playwright/test';
import { closeElectronApp, expect, test } from './fixtures/electron';

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const tempRoot = process.platform === 'win32' ? 'D:/tmp' : tmpdir();
const manifest = JSON.parse(readFileSync(join(repoRoot, 'resources/versegit/manifest.json'), 'utf8'));
const binding = {
  workspaceId: 'f4-workspace',
  sessionId: 'f4-session',
  worktreeId: 'f4-worktree',
  ownerId: 'agent:codex',
  epoch: 7,
  mode: 'M1',
};
const env = {
  CLAWX_VERSGIT_DIAGNOSTICS: '1',
  CLAWX_VERSGIT_APP_PATH: repoRoot,
  CLAWX_VERSGIT_PROVIDER_ROOT: repoRoot,
  CLAWX_VERSGIT_REPO_ID: 'repo-f4',
  CLAWX_VERSGIT_ALLOWED_WORKSPACE_ID: binding.workspaceId,
  CLAWX_VERSGIT_ALLOWED_SESSION_ID: binding.sessionId,
  CLAWX_VERSGIT_ALLOWED_WORKTREE_ID: binding.worktreeId,
  CLAWX_VERSGIT_OWNER_ID: binding.ownerId,
  CLAWX_VERSGIT_EPOCH: String(binding.epoch),
  CLAWX_VERSGIT_AUTHORIZATION_ID: 'grant-f4',
  CLAWX_VERSGIT_GRANT_EXPIRES_AT: '2099-01-01T00:00:00.000Z',
  CLAWX_VERSGIT_WORKTREE_COUNT: '2',
  CLAWX_VERSGIT_ACTIVE_SESSION_COUNT: '2',
};

async function hostStatus(page: Page) {
  return page.evaluate(async (payload) => {
    const bridge = (window as unknown as {
      verseClaw?: { hostInvoke: (request: Record<string, unknown>) => Promise<unknown> };
    }).verseClaw?.hostInvoke;
    if (!bridge) throw new Error('hostInvoke bridge is missing');
    return bridge({
      id: 'versegit-packaged-flow-' + crypto.randomUUID(),
      module: 'versegit',
      action: 'status',
      payload,
    });
  }, binding);
}

async function coldStart(
  launchElectronApp: (options?: { skipSetup?: boolean; env?: Record<string, string> }) => Promise<ElectronApplication>,
  index: number,
) {
  const started = Date.now();
  const app = await launchElectronApp({ skipSetup: true, env });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    const response = await hostStatus(page);
    const status = (response as { ok?: boolean; data?: { status?: string; identity?: { binarySha256?: string; version?: string } } }).data;
    return {
      index,
      coldStartMs: Date.now() - started,
      status: status?.status,
      binarySha256: status?.identity?.binarySha256,
      version: status?.identity?.version,
      hostInvokeOk: (response as { ok?: boolean }).ok === true,
    };
  } finally {
    await closeElectronApp(app);
  }
}

test.describe('F4 packaged controlled stability', () => {
  test.setTimeout(600_000);
  test('runs three cold starts and ten packaged task loops with interruption/revocation/undo evidence', async ({ launchElectronApp }) => {
    const runRoot = mkdtempSync(join(tempRoot, 'versegit-f4-e2e-'));
    const coldStartsPath = join(runRoot, 'cold-starts.json');
    const artifactRoot = join(runRoot, 'artifacts');
    const samplesPath = join(repoRoot, 'harness/specs/fixtures/versegit-product-integration/f4/stability-samples.jsonl');
    const reportPath = join(repoRoot, 'harness/specs/fixtures/versegit-product-integration/f4/stability-report.json');
    const survivorsPath = join(repoRoot, 'harness/specs/fixtures/versegit-product-integration/f4/resource-survivors.json');
    const packagedFlowPath = join(repoRoot, 'harness/specs/fixtures/versegit-product-integration/f4/packaged-flow.json');
    mkdirSync(artifactRoot, { recursive: true });
    try {
      const coldStarts = [];
      for (let index = 0; index < 3; index += 1) coldStarts.push(await coldStart(launchElectronApp, index));
      expect(coldStarts).toHaveLength(3);
      for (const entry of coldStarts) {
        expect(entry).toMatchObject({
          status: 'observed',
          hostInvokeOk: true,
          binarySha256: manifest.artifact.sha256,
          version: manifest.artifact.version,
        });
        expect(entry.coldStartMs).toBeGreaterThan(0);
      }
      writeFileSync(coldStartsPath, JSON.stringify(coldStarts, null, 2) + '\n', 'utf8');
      await execFileAsync(process.execPath, [
        join(repoRoot, 'openclaw_runtime/node_modules/tsx/dist/cli.mjs'),
        '--tsconfig', 'tsconfig.node.json', 'scripts/versegit-product-stability.mts',
        '--loops', '10',
        '--cold-starts', coldStartsPath,
        '--artifact-root', artifactRoot,
        '--samples', samplesPath,
        '--report', reportPath,
        '--survivors', survivorsPath,
        '--packaged-flow', packagedFlowPath,
      ], {
        cwd: repoRoot,
        env: { ...process.env, TEMP: tempRoot, TMP: tempRoot },
        timeout: 600_000,
        windowsHide: true,
        maxBuffer: 24 * 1024 * 1024,
      });

      const packagedFlow = JSON.parse(readFileSync(packagedFlowPath, 'utf8'));
      const report = JSON.parse(readFileSync(reportPath, 'utf8'));
      const survivors = JSON.parse(readFileSync(survivorsPath, 'utf8'));
      const samples = readFileSync(samplesPath, 'utf8').trim().split(/\r?\n/u).map((line) => JSON.parse(line));
      expect(packagedFlow).toMatchObject({
        schema: 'clawx.versegit.f4-packaged-flow/v1',
        driven_by: 'agent',
        actor: 'codex',
        passed: true,
        noProviderSourceReference: true,
        undoRecovered: true,
        revokedGrantRejected: true,
        restartRecovery: true,
        activeInterruptionCleanup: true,
      });
      expect(packagedFlow.coldStarts).toHaveLength(3);
      expect(report).toMatchObject({
        schema: 'clawx.versegit.f4-stability-report/v1',
        passed: true,
        package: { packageId: manifest.packageId, artifactSha256: manifest.artifact.sha256 },
        aggregate: { sampleCount: 10, successes: 10, failures: 0, duplicateApplyCount: 0 },
        coverage: { observedPlatforms: ['win32-x64'], observedModes: ['M1'], coldStarts: 3 },
      });
      expect(report.aggregate.p50LoopMs).toBeGreaterThan(0);
      expect(report.aggregate.p95LoopMs).toBeGreaterThanOrEqual(report.aggregate.p50LoopMs);
      expect(report.aggregate.peakRssMb).toBeGreaterThan(0);
      expect(samples).toHaveLength(10);
      expect(samples.every((entry) => entry.passed === true && entry.processSurvivors === 0)).toBe(true);
      expect(new Set(samples.map((entry) => entry.loopId)).size).toBe(10);
      expect(samples.every((entry) => typeof entry.candidateId === 'string' && entry.candidateId.length > 0)).toBe(true);
      expect(survivors).toMatchObject({
        passed: true,
        totals: { processes: 0, managers: 0, worktrees: 0, tempRoots: 0 },
      });
      const evidenceDigest = createHash('sha256').update(readFileSync(reportPath)).digest('hex');
      writeFileSync(join(artifactRoot, 'curated-digests.json'), JSON.stringify({
        reportDigest: evidenceDigest,
        sampleDigest: createHash('sha256').update(readFileSync(samplesPath)).digest('hex'),
        packagedFlowDigest: createHash('sha256').update(readFileSync(packagedFlowPath)).digest('hex'),
      }, null, 2) + '\n', 'utf8');
    } finally {
      rmSync(runRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
    }
  });
});
