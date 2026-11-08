// @vitest-environment node
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { expect, test, vi } from 'vitest';
import { checkWindowsProcesses, discoverWindowsElectronProcesses } from '../e2e/fixtures/windows-process';
import { cleanupElectronProcesses, ELECTRON_PID_LEDGER } from '../e2e/fixtures/electron-process-cleanup';

test.skipIf(process.platform !== 'win32')('cleanup preserves a reused PID and terminates only its recorded process identity', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
  await once(child, 'spawn');
  const exited = once(child, 'exit');
  try {
    const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '([DateTimeOffset]([Diagnostics.Process]::GetProcessById([int]$env:CLAWX_TEST_PID).StartTime)).ToUnixTimeMilliseconds()',
    ], { windowsHide: true, timeout: 10_000, env: { ...process.env, CLAWX_TEST_PID: String(child.pid) } });
    const identity = { pid: child.pid!, creationTime: Number(stdout.trim()) };
    expect(await checkWindowsProcesses([identity])).toEqual([{ ...identity, status: 'alive' }]);
    expect(await checkWindowsProcesses([identity, { ...identity, creationTime: identity.creationTime - 1000 }]))
      .toEqual([{ ...identity, status: 'alive' }, { ...identity, creationTime: identity.creationTime - 1000, status: 'replaced' }]);
    expect(await checkWindowsProcesses([{ ...identity, creationTime: identity.creationTime - 1000 }], true))
      .toEqual([{ ...identity, creationTime: identity.creationTime - 1000, status: 'replaced' }]);
    expect(child.exitCode).toBeNull();
    const root = await mkdtemp(join(tmpdir(), 'verse-claw-e2e-run-'));
    try {
      await writeFile(join(root, ELECTRON_PID_LEDGER), JSON.stringify({ ...identity,
        creationTime: identity.creationTime - 1000, userDataDir: join(root, 'profile') }) + '\n');
      await cleanupElectronProcesses(root, root);
      const report = JSON.parse(await readFile(join(root, 'electron-process-cleanup.json'), 'utf8'));
      expect(report).toMatchObject({ status: 'passed', survivors: [], checks: [{ status: 'replaced' }] });
      expect(child.exitCode).toBeNull();
      await writeFile(join(root, ELECTRON_PID_LEDGER), JSON.stringify({ pid: identity.pid, userDataDir: root }) + '\n');
      await expect(cleanupElectronProcesses(root, root)).rejects.toThrow('creation time');
      expect(JSON.parse(await readFile(join(root, 'electron-process-cleanup.json'), 'utf8')).status).toBe('failed');
      expect(child.exitCode).toBeNull();
    } finally { await rm(root, { recursive: true, force: true }); }
    expect(await checkWindowsProcesses([identity], true)).toEqual([{ ...identity, status: 'terminated' }]);
    await exited;
    expect(await checkWindowsProcesses([identity])).toEqual([{ ...identity, status: 'exited' }]);
    await expect(checkWindowsProcesses([{ pid: identity.pid, creationTime: Number.NaN }], true))
      .rejects.toThrow('creation time');
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
  }
}, 30_000);

test.skipIf(process.platform !== 'win32')('Electron creation time matches the native process identity', async () => {
  // Windows Electron cannot write the low-integrity D:\tmp test profile.
  const base = process.env.CLAWX_E2E_RUN_ROOT_BASE ?? join(process.cwd(), '.tmp', 'electron-identity-tests');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, 'electron-identity-'));
  const otherRoot = await mkdtemp(join(base, 'electron-unrelated-'));
  const entry = join(root, 'main.cjs');
  const output = join(root, 'identity.json');
  await writeFile(entry, `const { app } = require('electron');
    app.setPath('userData', ${JSON.stringify(root)}); app.disableHardwareAcceleration();
    app.whenReady().then(() => require('node:fs').writeFileSync(${JSON.stringify(output)},
      JSON.stringify(app.getAppMetrics().find(({ pid }) => pid === process.pid))));
    setInterval(() => {}, 1000);`);
  const electronBinaryPath = createRequire(import.meta.url)('electron') as string;
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronBinaryPath, ['--no-sandbox',
    `--user-data-dir=${otherRoot}\\..\\${basename(root)}\\profile`,
    `--log-file=${join(otherRoot, 'electron.log')}`, entry], { stdio: 'ignore', windowsHide: true, env });
  await once(child, 'spawn');
  const exited = once(child, 'exit');
  try {
    const identity = await vi.waitFor(async () => {
      const metric = JSON.parse(await readFile(output, 'utf8'));
      return { pid: metric.pid as number, creationTime: metric.creationTime as number };
    }, { timeout: 10_000, interval: 100 });
    expect(identity.pid).toBe(child.pid);
    expect(await discoverWindowsElectronProcesses(root)).toEqual(expect.arrayContaining([
      expect.objectContaining({ pid: identity.pid, creationTime: Math.floor(identity.creationTime), ParentAlive: true }),
    ]));
    expect(await discoverWindowsElectronProcesses(otherRoot)).toEqual([]);
    expect(child.exitCode).toBeNull();
    expect((await checkWindowsProcesses([identity]))[0]).toMatchObject({ pid: identity.pid, status: 'alive' });
    expect((await checkWindowsProcesses([identity], true))[0].status).toBe('terminated');
    await exited;
    expect(['exited', 'replaced']).toContain((await checkWindowsProcesses([identity]))[0].status);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
    await rm(root, { recursive: true, force: true });
    await rm(otherRoot, { recursive: true, force: true });
  }
}, 30_000);
