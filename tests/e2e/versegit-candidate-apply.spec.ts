import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from './fixtures/electron';

const execFileAsync = promisify(execFile);
const binaryPath = join(process.cwd(), 'resources/bin/win32-x64/ae.exe');
const tempRoot = process.env.VERSEGIT_E3_TMP_ROOT ?? (process.platform === 'win32' ? 'D:/tmp' : tmpdir());

test.describe('verified candidate host apply', () => {
  test('runs completion, candidate verification, permission gate and journaled apply in order', async () => {
    test.skip(!existsSync(binaryPath), 'requires the qualified ae.exe');
    const root = mkdtempSync(join(tempRoot, 'versegit-e3-e2e-'));
    const reportPath = join(root, 'report.json');
    try {
      await execFileAsync(process.execPath, [
        join(process.cwd(), 'openclaw_runtime/node_modules/tsx/dist/cli.mjs'),
        '--tsconfig', 'tsconfig.node.json', 'scripts/versegit-candidate-apply-probe.mts',
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TEMP: tempRoot,
          TMP: tempRoot,
          VERSEGIT_E3_REPORT_PATH: reportPath,
          VERSEGIT_E3_RAW_ROOT: join(root, 'raw'),
        },
        timeout: 180_000,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      });
      const report = JSON.parse(readFileSync(reportPath, 'utf8'));
      expect(report.source).toMatchObject({ dirty: false });
      expect(report.individual_workers).toHaveLength(2);
      expect(report.individual_workers.every((worker: { verdict: string }) => worker.verdict === 'passed')).toBe(true);
      expect(report.combined_failure).toMatchObject({
        status: 'verification-failed',
        main_unchanged: true,
        first_write_started: false,
        passed: true,
      });
      expect(report.combined_success).toMatchObject({
        status: 'applied',
        head_unchanged: true,
        refs_unchanged: true,
        passed: true,
      });
      expect(report.ordering_trace).toMatchObject({
        verification_before_first_write: true,
        passed: true,
      });
      expect(report.toctou_negative.cases).toHaveLength(5);
      expect(report.toctou_negative.cases.every((entry: { passed: boolean }) => entry.passed)).toBe(true);
      expect(report.write_journal).toMatchObject({ recovery_restored_base: true, passed: true });
      expect(report.boundaries).toMatchObject({
        real_human_evidence: false,
        default_off: true,
        m4_authorized: false,
        vg_landing_authority: false,
      });
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
    }
  });
});
