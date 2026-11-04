import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';

let censusBackend = 'pwsh.exe';
export const probeCensusBackend = () => censusBackend;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function readProbeProcesses(runRoot) {
  // WMI filters on the random run suffix before materializing process objects.
  // The complete path is still matched below; the suffix grants no ownership.
  const marker = /[A-Za-z0-9]{6}$/.exec(runRoot)?.[0];
  const query = 'SELECT ProcessId,Name,CommandLine,WorkingSetSize FROM Win32_Process'
    + (marker ? ` WHERE CommandLine LIKE '%${marker}%'` : '');
  const encodedQuery = Buffer.from(query, 'utf8').toString('base64');
  const script = `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $query=[System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedQuery}')); $rows=@(Get-CimInstance -Query $query | Select-Object ProcessId,Name,CommandLine,WorkingSetSize); ConvertTo-Json -InputObject $rows -Compress -Depth 3`;
  const args = ['-NoProfile', '-NonInteractive', '-Command', script];
  const options = { encoding: 'utf8', windowsHide: true, timeout: 15_000, maxBuffer: 64 * 1024 * 1024 };
  let out = spawnSync(censusBackend, args, options);
  if (out.error?.code === 'ENOENT' && censusBackend === 'pwsh.exe') {
    censusBackend = 'powershell.exe'; out = spawnSync(censusBackend, args, options);
  }
  if (out.status !== 0 || !out.stdout) throw new Error(`Process census failed: ${out.error?.message ?? out.stderr ?? out.status}`);
  const processes = JSON.parse(out.stdout);
  if (!Array.isArray(processes)) throw new Error('Process census returned no inventory');
  return processes.filter(process => typeof process.CommandLine === 'string' && process.CommandLine.toLowerCase().includes(runRoot.toLowerCase()));
}

async function closeWithin(app, ms) {
  let timer;
  await Promise.race([app.close().catch(() => undefined), new Promise(resolve => { timer = setTimeout(resolve, ms); })]);
  clearTimeout(timer);
}

/** Cleanup cannot suppress the original failure or prevent its receipt being saved. */
export async function cleanupBrowserProbe({ app, mainPid, runRoot, interrupt = false, removalAttempts = 6, query = readProbeProcesses }) {
  const errors = [];
  let forcedShutdown = false;
  let killed = 0;
  const kill = pid => {
    if (!Number.isSafeInteger(pid) || pid <= 0) return;
    const result = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 15_000 });
    if (result.status === 0) { forcedShutdown = true; killed += 1; }
  };
  const census = () => {
    try { return query(runRoot); }
    catch (error) { errors.push(String(error.message ?? error)); return null; }
  };
  if (app && !interrupt) await closeWithin(app, 8000);
  if (interrupt) { kill(mainPid); kill(app?.process().pid); }
  let residual = census();
  const initialResidual = residual;
  let attempts = 0;
  while (residual?.length && attempts < 5) {
    attempts += 1;
    for (const process of residual) kill(Number(process.ProcessId));
    await sleep(1500);
    residual = census();
  }
  // A failed census grants no new PID authority. The captured launch handles
  // still identify this probe's Main process and Playwright wrapper.
  if (residual === null) { kill(mainPid); kill(app?.process().pid); }
  if (app) await closeWithin(app, 5000);
  let reclaimed = false;
  for (let attempt = 0; attempt < removalAttempts && !reclaimed; attempt += 1) {
    try { await rm(runRoot, { recursive: true, force: true }); reclaimed = !existsSync(runRoot); }
    catch { await sleep(800); }
  }
  const finalResidual = census();
  if (finalResidual?.length) errors.push(`Owned processes remain: ${finalResidual.map(process => process.Name).join(', ')}`);
  if (!reclaimed) errors.push('Owned run directory was not reclaimed');
  return {
    appExited: finalResidual?.length === 0, forcedShutdown, killed,
    initialResidualProcesses: initialResidual?.length ?? null,
    initialResidualNames: initialResidual?.map(process => process.Name) ?? null,
    residualCleanupAttempts: attempts, residualProcesses: finalResidual?.length ?? null,
    residualNames: finalResidual?.map(process => process.Name) ?? null,
    runDirReclaimed: reclaimed, errors,
  };
}
