import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

test('RC-10 real Cron, Inbox, IRC and recovery scenarios', async ({ browserName: _browserName }, testInfo) => {
  test.setTimeout(600_000);
  const dataRoot = testInfo.outputPath('rc10-operator');
  await new Promise<void>((done, fail) => {
    const child = execFile(process.execPath, [
      resolve('artifacts/runtime-authority-convergence/rc-10/driver.mjs'),
      '--repo', process.cwd(), '--development', '--scenario', 'OPERATOR-ALL',
      '--data-root', dataRoot, '--timeout-min', '8',
    ], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      clearTimeout(timer);
      if (error) fail(new Error(stdout + '\n' + stderr + '\n' + error.message));
      else done();
    });
    const timer = setTimeout(() => {
      if (process.platform === 'win32' && child.pid) {
        execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      } else child.kill('SIGKILL');
      fail(new Error('RC-10 driver exceeded its eight-minute execution bound'));
    }, 540_000);
  });
  const reportPath = join(dataRoot, 'evidence', 'report.json');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  await testInfo.attach('rc10-scenarios', { path: reportPath, contentType: 'application/json' });
  expect(report.failures).toEqual([]);
  expect(report.scenarios.map((s: { id: string; result: string }) => [s.id, s.result])).toEqual(
    ['H-02', 'H-03', 'H-04', 'H-05', 'H-06'].map((id) => [id, 'pass']),
  );
  for (const scenario of report.scenarios) {
    expect(scenario.runIds.length).toBeGreaterThan(0);
    expect(Array.isArray(scenario.receiptIds)).toBe(true);
    expect(scenario.note.length).toBeGreaterThan(0);
    expect(scenario.recoveryObservation.length).toBeGreaterThan(0);
  }
  expect(report.scenarios.find((s: { id: string }) => s.id === 'H-06').handoffTransfer.runId).toBeTruthy();
  expect(report.driven_by).toBe('agent');
  expect(report.formalAcceptance).toBe(false);
});
