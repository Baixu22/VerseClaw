// Process-incarnation probes for local journal lock recovery. Unknown is never
// treated as dead; a successful PID probe alone cannot distinguish PID reuse.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export function readTaskLedgerProcessIncarnation(pid: number): string | null {
  if (!Number.isSafeInteger(pid) || pid < 1) return null;
  try {
    if (process.platform === 'linux') {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const start = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/u)[19];
      return start ? `${readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()}:${start}` : null;
    }
    if (process.platform === 'win32') {
      const value = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `$ErrorActionPreference='Stop'; [System.Diagnostics.Process]::GetProcessById(${pid}).StartTime.ToFileTimeUtc().ToString([System.Globalization.CultureInfo]::InvariantCulture)`],
      { windowsHide: true, timeout: 5000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 4096 }).trim();
      return /^\d+$/u.test(value) ? value : null;
    }
    const value = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='],
      { timeout: 2000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 4096 }).trim();
    return value || null;
  } catch { return null; }
}

let ownIncarnation: string | null | undefined;
const observed = new Map<number, { value: string | null; at: number }>();

export function taskLedgerOwnIncarnation(): string {
  if (!ownIncarnation) ownIncarnation = readTaskLedgerProcessIncarnation(process.pid);
  if (!ownIncarnation) throw Object.assign(new Error('Task Ledger cannot identify this process incarnation'), { code: 'LOCK_IDENTITY_UNAVAILABLE' });
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
