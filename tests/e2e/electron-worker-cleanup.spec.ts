import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';
import { cleanupElectronProcesses } from './fixtures/electron-process-cleanup';

test('reclaims an aborted worker app without closing another run profile', async ({ launchElectronApp }, testInfo) => {
  test.skip(process.platform !== 'win32', 'Windows shell-wrapper process ownership');
  const survivor = await launchElectronApp({ skipSetup: true });
  try {
    const page = await getStableWindow(survivor);
    await expect(page.getByTestId('main-layout')).toBeVisible();
    const nested = testInfo.outputPath('aborted-worker');
    const output = join(nested, 'results');
    await mkdir(nested, { recursive: true });
    const witness = join(nested, 'spawn.json');
    const fixture = resolve('tests/e2e/fixtures/electron').replaceAll('\\', '/');
    const setup = resolve('tests/e2e/fixtures/electron-process-cleanup.ts');
    // Abort before launchProcess registers its cleanup. In particular, do not
    // let the test fixture's finally or Playwright's exit hooks hide the leak.
    await writeFile(join(nested, 'fault.spec.ts'), `
import { writeFileSync } from 'node:fs';
import childProcess from 'node:child_process';
import { test } from ${JSON.stringify(fixture)};
test('injected worker launch abort', async ({ launchElectronApp }) => {
  const originalSpawn = childProcess.spawn;
  childProcess.spawn = function(command, ...args) {
    const child = originalSpawn.call(this, command, ...args);
    if (String(command).toLowerCase().includes('electron.exe')) {
      writeFileSync(${JSON.stringify(witness)}, JSON.stringify({ workerPid: process.pid, wrapperPid: child.pid, runRoot: process.env.CLAWX_E2E_RUN_ROOT }));
      process.abort();
    }
    return child;
  };
  await launchElectronApp({ skipSetup: true });
});
`);
    await writeFile(join(nested, 'config.ts'), `export default ${JSON.stringify({
      testDir: nested, testMatch: 'fault.spec.ts', tsconfig: resolve('tsconfig.test.json'),
      globalSetup: setup, workers: 1, retries: 0, timeout: 30_000,
      reporter: [['json', { outputFile: join(nested, 'tests.json') }]], outputDir: output,
    })};`);
    const env = { ...process.env };
    delete env.PLAYWRIGHT_JSON_OUTPUT_NAME;
    delete env.PLAYWRIGHT_JSON_OUTPUT_FILE;
    delete env.PLAYWRIGHT_JSON_OUTPUT_DIR;
    delete env.NO_COLOR;
    const child = spawn(process.execPath, [resolve('node_modules/@playwright/test/cli.js'), 'test', '--config', join(nested, 'config.ts')], {
      cwd: process.cwd(), windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    child.stdout.on('data', chunk => { log += chunk; });
    child.stderr.on('data', chunk => { log += chunk; });
    try {
      const exitCode = await new Promise<number | null>((done, fail) => {
        const timer = setTimeout(() => { child.kill(); fail(new Error('Aborted worker left the test runner open')); }, 30_000);
        child.once('error', error => { clearTimeout(timer); fail(error); });
        child.once('close', code => { clearTimeout(timer); done(code); });
      });
      expect(exitCode).toBe(1);
      const result = JSON.parse(await readFile(join(nested, 'tests.json'), 'utf8'));
      expect(result.stats.unexpected).toBe(1);
      const record = JSON.parse(await readFile(witness, 'utf8'));
      const cleanupPath = join(output, 'electron-process-cleanup.json');
      const cleanup = JSON.parse(await readFile(cleanupPath, 'utf8'));
      expect(cleanup.runRoot.replace(/[\\/]+$/, '')).toBe(record.runRoot);
      expect(cleanup.owned.length).toBeGreaterThan(0);
      const orphan = cleanup.owned.find((process: { ParentProcessId: number }) => process.ParentProcessId === record.wrapperPid);
      expect(orphan).toBeDefined();
      expect(orphan.ParentAlive).toBe(false);
      expect(cleanup.remaining).toEqual([]);
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await testInfo.attach('runner-owned-cleanup', { path: cleanupPath, contentType: 'application/json' });
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await writeFile(join(nested, 'runner.log'), log);
      // The nested runner may die before global teardown. Its setup record is
      // written before any worker starts, so even a launch failure is covered.
      const run: { runRoot: string } | undefined = await readFile(join(output, 'electron-process-run.json'), 'utf8')
        .then(text => JSON.parse(text))
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return undefined;
          throw error;
        });
      if (run) await cleanupElectronProcesses(run.runRoot, join(nested, 'parent-cleanup'));
    }
  } finally {
    await closeElectronApp(survivor);
  }
});
