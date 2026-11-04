import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { basename, isAbsolute, parse, resolve } from 'node:path';

let censusBackend = 'pwsh.exe';
export const probeCensusBackend = () => censusBackend;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function ownsProbeCommandLine(runRoot, commandLine) {
  if (!isAbsolute(runRoot) || resolve(runRoot) === parse(resolve(runRoot)).root) return false;
  if (typeof commandLine !== 'string') return false;
  const normalize = value => resolve(value).replaceAll('\\', '/').toLowerCase();
  // A process merely mentioning a run directory is not a browser owner. Match
  // the complete explicit Chromium user-data argument, including quoted paths.
  const expected = normalize(resolve(runRoot, 'ud'));
  return [...commandLine.matchAll(/(?:^|\s)(?:"--user-data-dir=([^"]+)"|--user-data-dir=(?:"([^"]+)"|([^\s"]+)))/gu)]
    .some(match => { const value = match[1] ?? match[2] ?? match[3]; return isAbsolute(value) && normalize(value) === expected; });
}

function runPowerShell(script) {
  const args = ['-NoProfile', '-NonInteractive', '-Command', script];
  const options = { encoding: 'utf8', windowsHide: true, timeout: 15_000, maxBuffer: 64 * 1024 * 1024 };
  let out = spawnSync(censusBackend, args, options);
  if (out.error?.code === 'ENOENT' && censusBackend === 'pwsh.exe') {
    censusBackend = 'powershell.exe'; out = spawnSync(censusBackend, args, options);
  }
  if (out.status !== 0 || !out.stdout) throw new Error(`Process observation failed (exit=${out.status}, signal=${out.signal ?? 'none'}): ${out.error?.message || out.stderr?.trim() || out.stdout?.trim().slice(-2000) || 'empty worker output'}`);
  return JSON.parse(out.stdout);
}

export function readProbeProcesses(runRoot) {
  // WMI filters on the random run suffix before materializing process objects.
  // The complete path is still matched below; the suffix grants no ownership.
  const marker = /[A-Za-z0-9]{6}$/.exec(runRoot)?.[0];
  if (!isAbsolute(runRoot) || resolve(runRoot) === parse(resolve(runRoot)).root) throw new Error('An absolute owned run directory is required');
  const query = 'SELECT ProcessId,Name,CommandLine,WorkingSetSize,CreationDate FROM Win32_Process'
    + (marker ? ` WHERE CommandLine LIKE '%${marker}%'` : '');
  const encodedQuery = Buffer.from(query, 'utf8').toString('base64');
  const script = `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $query=[System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedQuery}')); $rows=@(foreach($row in Get-CimInstance -Query $query) { $live=$null; try { $live=[Diagnostics.Process]::GetProcessById([int]$row.ProcessId); if (!$live.HasExited -and [Math]::Abs(($live.StartTime.ToUniversalTime()-$row.CreationDate.ToUniversalTime()).TotalMilliseconds) -lt 1) { [pscustomobject]@{ProcessId=$row.ProcessId;Name=$row.Name;CommandLine=$row.CommandLine;WorkingSetSize=$row.WorkingSetSize;CreationTimeTicks=[string]$live.StartTime.ToUniversalTime().Ticks} } } catch [System.ArgumentException] {} catch [System.InvalidOperationException] { if($null -eq $live -or !$live.HasExited){throw} } finally { if($null -ne $live){$live.Dispose()} } }); ConvertTo-Json -InputObject $rows -Compress -Depth 3`;
  const processes = runPowerShell(script);
  if (!Array.isArray(processes)) throw new Error('Process census returned no inventory');
  return processes.filter(process => ['verse claw.exe', 'electron.exe', 'cmd.exe'].includes(process.Name?.toLowerCase()) && ownsProbeCommandLine(runRoot, process.CommandLine));
}

async function closeWithin(closing, ms) {
  let timer;
  await Promise.race([closing, new Promise(resolve => { timer = setTimeout(resolve, ms); })]);
  clearTimeout(timer);
}

/** Cleanup cannot suppress the original failure or prevent its receipt being saved. */
export async function cleanupBrowserProbe({ app, runRoot, interrupt = false, removalAttempts = 6, query = readProbeProcesses }) {
  const errors = [];
  let forcedShutdown = false;
  let killed = 0;
  let applicationTerminations = 0;
  const terminationRequests = [];
  const removalErrors = [];
  let closing;
  const close = ms => closeWithin(closing ??= Promise.resolve().then(() => app.close()).catch(() => undefined), ms);
  const record = (target, accepted, detail = {}) => {
    terminationRequests.push({ pid: Number(target.ProcessId), name: target.Name, signal: 'SIGKILL', accepted, ...detail });
    if (accepted) {
      forcedShutdown = true; killed += 1;
      if (target.Name?.toLowerCase() !== 'cmd.exe') applicationTerminations += 1;
    }
  };
  const kill = target => {
    const pid = Number(target.ProcessId);
    if (!Number.isSafeInteger(pid) || pid <= 0) return;
    if (terminationRequests.some(request => request.pid === pid && request.creationTimeTicks === target.CreationTimeTicks && request.accepted)) return;
    try {
      if (!/^\d+$/u.test(target.CreationTimeTicks ?? '')) throw new Error('Observed process identity is missing');
      // Pin the Process handle, verify its birth time, then terminate that same
      // handle. A recycled PID must never inherit an earlier observation.
      const outcome = runPowerShell(`$ErrorActionPreference='Stop'; $live=$null; try { $live=[Diagnostics.Process]::GetProcessById(${pid}); if($live.HasExited){ @{accepted=$false;errorCode='ESRCH'} | ConvertTo-Json -Compress } elseif([string]$live.StartTime.ToUniversalTime().Ticks -ne '${target.CreationTimeTicks}') { @{accepted=$false;errorCode='E_PROCESS_IDENTITY'} | ConvertTo-Json -Compress } else { $live.Kill(); @{accepted=$true} | ConvertTo-Json -Compress } } catch [System.ArgumentException] { @{accepted=$false;errorCode='ESRCH'} | ConvertTo-Json -Compress } finally { if($null -ne $live){$live.Dispose()} }`);
      record(target, outcome.accepted === true, { backend: 'verified-process-handle', creationTimeTicks: target.CreationTimeTicks, ...(outcome.errorCode ? { errorCode: outcome.errorCode } : {}) });
    } catch (error) {
      record(target, false, { errorCode: error.code ?? 'E_TERMINATION', message: String(error.message ?? error) });
    }
  };
  const census = () => {
    try { return query(runRoot); }
    catch (error) { errors.push(String(error.message ?? error)); return null; }
  };
  if (app && !interrupt) await close(8000);
  let residual = census();
  const initialResidual = residual;
  let lastObserved = residual ?? [];
  let attempts = 0;
  while ((residual?.length || (residual === null && lastObserved.length)) && attempts < 5) {
    attempts += 1;
    // Stop the application before its cmd.exe launch wrapper. A tree-kill CLI
    // can return a nonzero aggregate code when one child exits during the kill.
    for (const target of (residual ?? lastObserved).toSorted((a, b) => Number(a.Name?.toLowerCase() === 'cmd.exe') - Number(b.Name?.toLowerCase() === 'cmd.exe'))) kill(target);
    await sleep(1500);
    residual = census();
    if (residual !== null) lastObserved = residual;
  }
  // A failed census grants no authority over a numeric PID that may have been
  // reused. Only the controller's still-owned process handle can be stopped.
  if (residual === null && app) {
    const child = app.process();
    const target = { ProcessId: child.pid, Name: basename(child.spawnfile ?? 'controller') };
    try { if (!terminationRequests.some(request => request.pid === child.pid && request.accepted)) record(target, child.kill('SIGKILL') === true, { backend: 'controller-handle' }); }
    catch (error) { record(target, false, { backend: 'controller-handle', errorCode: error.code, message: String(error.message ?? error) }); }
  }
  if (interrupt && applicationTerminations === 0) errors.push('Controlled interruption did not terminate an owned process');
  if (app) await close(5000);
  let reclaimed = false;
  for (let attempt = 0; attempt < removalAttempts && !reclaimed; attempt += 1) {
    try {
      await rm(runRoot, { recursive: true, force: true }); reclaimed = !existsSync(runRoot);
      if (!reclaimed) { removalErrors.push({code:'E_REMOVAL_INCOMPLETE',message:'Owned run directory still exists after removal'}); await sleep(800); }
    }
    catch (error) { removalErrors.push({ code: error.code, syscall: error.syscall, message: String(error.message ?? error) }); await sleep(800); }
  }
  const finalResidual = census();
  if (finalResidual?.length) errors.push(`Owned processes remain: ${finalResidual.map(process => process.Name).join(', ')}`);
  if (!reclaimed) errors.push('Owned run directory was not reclaimed');
  return {
    appExited: finalResidual?.length === 0, forcedShutdown, killed, terminationRequests,
    ownedProcesses: (initialResidual ?? []).map(target => ({ pid: Number(target.ProcessId), name: target.Name,
      creationTimeTicks: target.CreationTimeTicks, userDataDir: resolve(runRoot, 'ud') })),
    initialResidualProcesses: initialResidual?.length ?? null,
    initialResidualNames: initialResidual?.map(process => process.Name) ?? null,
    residualCleanupAttempts: attempts, residualProcesses: finalResidual?.length ?? null,
    residualNames: finalResidual?.map(process => process.Name) ?? null,
    runDirReclaimed: reclaimed, removalErrors, errors,
  };
}
