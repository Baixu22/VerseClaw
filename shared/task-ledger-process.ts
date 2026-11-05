// Process-incarnation probes for local journal lock recovery. Unknown is never
// treated as dead; a successful PID probe alone cannot distinguish PID reuse.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';

function hostProcessProbeShell(): string {
  // A project cwd must not supply the OS identity probe. The installed Core
  // host reads the same FILETIME and avoids repeated legacy CLR startup.
  for (const directory of (process.env.PATH ?? process.env.Path ?? '').split(delimiter)) {
    if (!isAbsolute(directory)) continue;
    const executable = join(directory, 'pwsh.exe');
    try { if (statSync(executable).isFile()) return executable; } catch { /* Next host PATH entry. */ }
  }
  return join(process.env.SystemRoot ?? process.env.windir ?? 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

export function readTaskLedgerProcessIncarnation(pid: number, onFailure?: (error: unknown) => void): string | null {
  if (!Number.isSafeInteger(pid) || pid < 1) return null;
  try {
    if (process.platform === 'linux') {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const start = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/u)[19];
      return start ? `${readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()}:${start}` : null;
    }
    if (process.platform === 'win32') {
      const value = execFileSync(hostProcessProbeShell(), ['-NoProfile', '-NonInteractive', '-Command',
        `$ErrorActionPreference='Stop'; [System.Diagnostics.Process]::GetProcessById(${pid}).StartTime.ToFileTimeUtc().ToString([System.Globalization.CultureInfo]::InvariantCulture)`],
      { windowsHide: true, timeout: 5000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 4096 }).trim();
      if (!/^\d+$/u.test(value)) throw Object.assign(new Error('Process probe returned no birth identity'), { code: 'LOCK_PROBE_INVALID_OUTPUT' });
      return value;
    }
    const value = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='],
      { timeout: 2000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 4096 }).trim();
    return value || null;
  } catch (error) { onFailure?.(error); return null; }
}

let ownIncarnation: string | null | undefined;
const observed = new Map<number, { value: string | null; at: number }>();

export function taskLedgerOwnIncarnation(): string {
  // Retry the same OS fact once before publishing any ticket. A transient shell
  // startup failure cannot invent an incarnation or evict any live participant.
  let failure: unknown;
  for (let attempt = 0; !ownIncarnation && attempt < 2; attempt++) {
    ownIncarnation = readTaskLedgerProcessIncarnation(process.pid, error => { failure = error; });
  }
  if (!ownIncarnation) {
    const code = (failure as NodeJS.ErrnoException | undefined)?.code;
    const detail = typeof code === 'string' && /^[A-Z_0-9]+$/u.test(code) ? code : 'unavailable';
    throw Object.assign(new Error('Task Ledger cannot identify this process incarnation (OS probe: ' + detail + ')'),
      { code: 'LOCK_IDENTITY_UNAVAILABLE', cause: failure });
  }
  return ownIncarnation;
}

export function taskLedgerOwnerWasReplaced(owner: { pid: number; incarnation: string; publishedAt: number }): boolean {
  if (owner.pid === process.pid) return owner.incarnation !== taskLedgerOwnIncarnation();
  // Short-lived tickets avoid a process spawn on every poll. Age only decides
  // when to probe birth identity, never whether to evict a live process.
  if (Date.now() - owner.publishedAt < 1000) return false;
  let current = observed.get(owner.pid);
  if (!current || Date.now() - current.at >= 250) {
    current = { value: readTaskLedgerProcessIncarnation(owner.pid), at: Date.now() };
    observed.set(owner.pid, current);
    if (observed.size > 256) observed.delete(observed.keys().next().value!);
  }
  return current.value !== null && current.value !== owner.incarnation;
}
