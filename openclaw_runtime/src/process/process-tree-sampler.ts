import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { RESOURCE_METRICS_TTL_MS, type ResourceProcessObservation } from "../../../shared/types/resources.js";

const execFileAsync = promisify(execFile);
const PROCESS_TREE_LIMIT = 512;
const PROCESS_PROBE_TIMEOUT_MS = 15_000;
// Main polls every 30s; allow its probe duration without treating a paused owner as current.
const CPU_BASELINE_MAX_INTERVAL_MS = RESOURCE_METRICS_TTL_MS * 2;
const OWNER_EPOCH = randomUUID();

export type ProcessTreeSampleStatus = "ok" | "empty" | "unknown";

export type ProcessTreeSample = {
  status: ProcessTreeSampleStatus;
  sampledAt: number;
  rootPids: number[];
  processCount: number | null;
  treeRssBytes: number | null;
  treeCpuTimeMs: number | null;
  treeCpuPercent: number | null;
  queueDepth: number;
  queueWaitMs: number;
  source: "windows-cim" | "linux-proc" | "none" | "unknown";
  detail?: string;
  ownerEpoch?: string;
  processes?: ResourceProcessObservation[];
};

type ProcessRecord = {
  pid: number;
  parentPid: number;
  token: string;
  rssBytes: number;
  cpuTimeMs: number;
  privateBytes: number | null;
};

type ProcessTableResult =
  | { ok: true; records: Map<number, ProcessRecord>; source: "windows-cim" | "linux-proc" }
  | { ok: false; detail: string };

function parsePositiveInt(value: string): number | null {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function runProbe(file: string, args: string[]): Promise<{ ok: true; stdout: string } | { ok: false; detail: string }> {
  try {
    const result = await execFileAsync(file, args, {
      windowsHide: true,
      timeout: PROCESS_PROBE_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { ok: true, stdout: result.stdout };
  } catch (error) {
    return { ok: false, detail: String(error) };
  }
}

async function readWindowsProcessTable(): Promise<ProcessTableResult> {
  const probe = await runProbe("powershell", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "$ErrorActionPreference = 'Stop'; Get-CimInstance -ClassName Win32_Process | Where-Object { $_.ProcessId -ne $PID } | ForEach-Object { \"{0}|{1}|{2}|{3}|{4}|{5}|{6}\" -f $_.ProcessId, $_.ParentProcessId, $_.WorkingSetSize, $_.KernelModeTime, $_.UserModeTime, $_.CreationDate.ToFileTimeUtc(), $_.PrivatePageCount }",
  ]);
  if (!probe.ok) {
    return { ok: false, detail: probe.detail };
  }
  const records = new Map<number, ProcessRecord>();
  for (const line of probe.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
    const [pidRaw, parentRaw, rssRaw, kernelRaw, userRaw, token, privateRaw] = line.split("|");
    const pid = parsePositiveInt(pidRaw ?? "");
    const parentPid = Number(parentRaw);
    const rssBytes = Number.parseInt((rssRaw ?? "").trim(), 10);
    const kernel = Number.parseInt((kernelRaw ?? "").trim(), 10);
    const user = Number.parseInt((userRaw ?? "").trim(), 10);
    if (pid === null || !Number.isInteger(parentPid) || !token || !Number.isFinite(rssBytes)) continue;
    records.set(pid, {
      pid,
      parentPid,
      token: token.trim(),
      rssBytes: Math.max(0, rssBytes),
      cpuTimeMs: Math.max(0, (Number.isFinite(kernel) ? kernel : 0) + (Number.isFinite(user) ? user : 0)) / 10_000,
      privateBytes: privateRaw && Number.isFinite(Number(privateRaw)) ? Math.max(0, Number(privateRaw)) : null,
    });
  }
  return records.size > 0
    ? { ok: true, records, source: "windows-cim" }
    : { ok: false, detail: "Windows process probe returned an empty process table" };
}

let linuxUnits: Promise<{ ticks: number; pageSize: number }> | undefined;
async function readLinuxProcessTable(): Promise<ProcessTableResult> {
  try {
    linuxUnits ??= Promise.all([runProbe("getconf", ["CLK_TCK"]), runProbe("getconf", ["PAGESIZE"])]).then(([ticks, pages]) => {
      if (!ticks.ok || !pages.ok || Number(ticks.stdout) <= 0 || Number(pages.stdout) <= 0
        || !Number.isFinite(Number(ticks.stdout)) || !Number.isFinite(Number(pages.stdout))) throw new Error("Process counter units unavailable");
      return { ticks: Number(ticks.stdout), pageSize: Number(pages.stdout) };
    });
    const { ticks, pageSize } = await linuxUnits;
    const records = new Map<number, ProcessRecord>();
    for (const entry of fs.readdirSync("/proc", { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
      const pid = Number.parseInt(entry.name, 10);
      let stat: string;
      try { stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8"); }
      catch { continue; } // A process may exit between enumeration and reading.
      const commEnd = stat.lastIndexOf(")");
      if (commEnd < 0) continue;
      const fields = stat.slice(commEnd + 1).trim().split(/\s+/);
      const parentPid = Number.parseInt(fields[1] ?? "", 10);
      const utime = Number.parseInt(fields[11] ?? "", 10);
      const stime = Number.parseInt(fields[12] ?? "", 10);
      const startTime = fields[19] ?? "";
      const rssPages = Number.parseInt(fields[21] ?? "", 10);
      if (!Number.isInteger(pid) || !Number.isInteger(parentPid) || !startTime) continue;
      records.set(pid, {
        pid,
        parentPid,
        token: startTime,
        rssBytes: Number.isFinite(rssPages) ? Math.max(0, rssPages) * pageSize : 0,
        privateBytes: null,
        cpuTimeMs:
          ((Number.isFinite(utime) ? Math.max(0, utime) : 0) +
            (Number.isFinite(stime) ? Math.max(0, stime) : 0)) /
            ticks *
            1_000,
      });
    }
    return records.size > 0
      ? { ok: true, records, source: "linux-proc" }
      : { ok: false, detail: "Linux process probe returned an empty process table" };
  } catch (error) {
    linuxUnits = undefined;
    return { ok: false, detail: String(error) };
  }
}

async function readProcessTable(): Promise<ProcessTableResult> {
  if (process.platform === "win32") return await readWindowsProcessTable();
  if (process.platform === "linux") return readLinuxProcessTable();
  return { ok: false, detail: `process-tree sampling is unavailable on ${process.platform}` };
}

function tokenNotBefore(candidate: string, parent: string): boolean {
  if (/^\d+$/.test(candidate) && /^\d+$/.test(parent)) return BigInt(candidate) >= BigInt(parent);
  return candidate >= parent;
}

function collectTreeRecords(
  records: Map<number, ProcessRecord>,
  roots: readonly number[],
): { records: ProcessRecord[]; truncated: boolean } {
  const collected = new Map<number, ProcessRecord>();
  const queue: ProcessRecord[] = [];
  for (const root of roots) {
    const record = records.get(root);
    if (!record) continue;
    collected.set(record.pid, record);
    queue.push(record);
  }
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const record of records.values()) {
      if (record.parentPid !== current.pid || !tokenNotBefore(record.token, current.token)) continue;
      if (collected.has(record.pid)) continue;
      collected.set(record.pid, record);
      queue.push(record);
      if (collected.size >= PROCESS_TREE_LIMIT) {
        return { records: [...collected.values()], truncated: true };
      }
    }
  }
  return { records: [...collected.values()], truncated: false };
}

export async function readProcessTreeSample(params: {
  rootPids: readonly number[];
  sampledAt?: number;
  queueDepth?: number;
  queueWaitMs?: number;
}): Promise<ProcessTreeSample> {
  let sampledAt = params.sampledAt ?? Date.now();
  const rootPids = [...new Set(params.rootPids.filter((pid) => Number.isInteger(pid) && pid > 0))];
  const queueDepth = Math.max(0, Math.floor(params.queueDepth ?? 0));
  const queueWaitMs = Math.max(0, Math.floor(params.queueWaitMs ?? 0));
  if (rootPids.length === 0) {
    return {
      status: "empty",
      sampledAt,
      rootPids,
      processCount: 0,
      treeRssBytes: 0,
      treeCpuTimeMs: 0,
      treeCpuPercent: null,
      queueDepth,
      queueWaitMs,
      source: "none",
      detail: "no root PIDs supplied",
    };
  }
  const table = await readProcessTable();
  sampledAt = params.sampledAt ?? Date.now();
  if (!table.ok) {
    return {
      status: "unknown",
      sampledAt,
      rootPids,
      processCount: null,
      treeRssBytes: null,
      treeCpuTimeMs: null,
      treeCpuPercent: null,
      queueDepth,
      queueWaitMs,
      source: "unknown",
      detail: table.detail,
    };
  }
  const collected = collectTreeRecords(table.records, rootPids);
  if (collected.truncated) {
    return {
      status: "unknown",
      sampledAt,
      rootPids,
      processCount: null,
      treeRssBytes: null,
      treeCpuTimeMs: null,
      treeCpuPercent: null,
      queueDepth,
      queueWaitMs,
      source: table.source,
      detail: `process tree reached the ${PROCESS_TREE_LIMIT}-PID safety limit`,
    };
  }
  if (collected.records.length === 0 || rootPids.some(pid => !table.records.has(pid))) {
    return {
      status: "unknown",
      sampledAt,
      rootPids,
      processCount: null,
      treeRssBytes: null,
      treeCpuTimeMs: null,
      treeCpuPercent: null,
      queueDepth,
      queueWaitMs,
      source: table.source,
      detail: "root PIDs were not present in the process table",
    };
  }
  return {
    status: "ok",
    sampledAt,
    rootPids,
    processCount: collected.records.length,
    treeRssBytes: collected.records.reduce((sum, record) => sum + record.rssBytes, 0),
    treeCpuTimeMs: collected.records.reduce((sum, record) => sum + record.cpuTimeMs, 0),
    treeCpuPercent: null,
    ownerEpoch: OWNER_EPOCH,
    processes: collected.records.map(record => ({
      pid: record.pid, parentPid: record.parentPid, creationToken: record.token,
      rssBytes: record.rssBytes, privateBytes: record.privateBytes, cpuTimeMs: record.cpuTimeMs, cpuPercent: null,
    })),
    queueDepth,
    queueWaitMs,
    source: table.source,
  };
}

export class ProcessTreeSampler {
  private readonly now: () => number;
  private readonly readSample: typeof readProcessTreeSample;
  private lastCpu = new Map<string, { at: number; cpuTimeMs: number }>();
  private lastEpoch: string | undefined;

  constructor(options?: {
    now?: () => number;
    readSample?: typeof readProcessTreeSample;
  }) {
    this.now = options?.now ?? (() => Date.now());
    this.readSample = options?.readSample ?? readProcessTreeSample;
  }

  async sample(params: {
    rootPids: readonly number[];
    queueDepth?: number;
    queueWaitMs?: number;
  }): Promise<ProcessTreeSample> {
    const sample = await this.readSample(params);
    const now = this.now();
    if (sample.ownerEpoch !== this.lastEpoch) this.lastCpu.clear();
    this.lastEpoch = sample.ownerEpoch;
    if (sample.status !== "ok" || !sample.processes?.length || !Number.isFinite(sample.sampledAt)
      || sample.sampledAt > now || now - sample.sampledAt > RESOURCE_METRICS_TTL_MS) {
      this.lastCpu.clear();
      if (sample.status === "ok") return { ...sample, status: "unknown", treeCpuPercent: null, detail: "process sample lacks fresh identities" };
      return { ...sample, ownerEpoch: sample.ownerEpoch ?? OWNER_EPOCH, processes: [], treeCpuPercent: null };
    }
    const next = new Map<string, { at: number; cpuTimeMs: number }>();
    const processes = sample.processes.map(record => {
      const key = `${record.pid}:${record.creationToken}`;
      const previous = this.lastCpu.get(key);
      next.set(key, { at: sample.sampledAt, cpuTimeMs: record.cpuTimeMs });
      const elapsed = previous ? sample.sampledAt - previous.at : 0;
      const cpuPercent = previous && elapsed > 0 && elapsed <= CPU_BASELINE_MAX_INTERVAL_MS && record.cpuTimeMs >= previous.cpuTimeMs
        ? Math.round((record.cpuTimeMs - previous.cpuTimeMs) / elapsed * 10_000) / 100 : null;
      return { ...record, cpuPercent };
    });
    this.lastCpu = next;
    return {
      ...sample, ownerEpoch: sample.ownerEpoch ?? OWNER_EPOCH, processes,
      treeCpuPercent: processes.every(record => record.cpuPercent !== null)
        ? processes.reduce((sum, record) => sum + (record.cpuPercent ?? 0), 0) : null,
    };
  }

  reset(): void {
    this.lastCpu.clear();
    this.lastEpoch = undefined;
  }
}
