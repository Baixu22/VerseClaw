import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PROCESS_TREE_LIMIT = 512;
const PROCESS_PROBE_TIMEOUT_MS = 15_000;
const LINUX_CLOCK_TICKS_PER_SECOND = 100;
const LINUX_DEFAULT_PAGE_SIZE_BYTES = 4_096;

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
};

type ProcessRecord = {
  pid: number;
  parentPid: number;
  token: string;
  rssBytes: number;
  cpuTimeMs: number;
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
    "$ErrorActionPreference = 'Stop'; Get-CimInstance -ClassName Win32_Process | ForEach-Object { \"{0}|{1}|{2}|{3}|{4}|{5}\" -f $_.ProcessId, $_.ParentProcessId, $_.WorkingSetSize, $_.KernelModeTime, $_.UserModeTime, $_.CreationDate.ToFileTimeUtc() }",
  ]);
  if (!probe.ok) {
    return { ok: false, detail: probe.detail };
  }
  const records = new Map<number, ProcessRecord>();
  for (const line of probe.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
    const [pidRaw, parentRaw, rssRaw, kernelRaw, userRaw, token] = line.split("|");
    const pid = parsePositiveInt(pidRaw ?? "");
    const parentPid = parsePositiveInt(parentRaw ?? "");
    const rssBytes = Number.parseInt((rssRaw ?? "").trim(), 10);
    const kernel = Number.parseInt((kernelRaw ?? "").trim(), 10);
    const user = Number.parseInt((userRaw ?? "").trim(), 10);
    if (pid === null || parentPid === null || !token || !Number.isFinite(rssBytes)) continue;
    records.set(pid, {
      pid,
      parentPid,
      token: token.trim(),
      rssBytes: Math.max(0, rssBytes),
      cpuTimeMs: Math.max(0, (Number.isFinite(kernel) ? kernel : 0) + (Number.isFinite(user) ? user : 0)) / 10_000,
    });
  }
  return records.size > 0
    ? { ok: true, records, source: "windows-cim" }
    : { ok: false, detail: "Windows process probe returned an empty process table" };
}

function readLinuxProcessTable(): ProcessTableResult {
  try {
    const records = new Map<number, ProcessRecord>();
    for (const entry of fs.readdirSync("/proc", { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
      const pid = Number.parseInt(entry.name, 10);
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
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
        rssBytes: Number.isFinite(rssPages) ? Math.max(0, rssPages) * LINUX_DEFAULT_PAGE_SIZE_BYTES : 0,
        cpuTimeMs:
          ((Number.isFinite(utime) ? Math.max(0, utime) : 0) +
            (Number.isFinite(stime) ? Math.max(0, stime) : 0)) /
            LINUX_CLOCK_TICKS_PER_SECOND *
            1_000,
      });
    }
    return records.size > 0
      ? { ok: true, records, source: "linux-proc" }
      : { ok: false, detail: "Linux process probe returned an empty process table" };
  } catch (error) {
    return { ok: false, detail: String(error) };
  }
}

async function readProcessTable(): Promise<ProcessTableResult> {
  if (process.platform === "win32") return await readWindowsProcessTable();
  if (process.platform === "linux") return readLinuxProcessTable();
  return { ok: false, detail: `process-tree sampling is unavailable on ${process.platform}` };
}

function tokenNotBefore(candidate: string, parent: string): boolean {
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
  const sampledAt = params.sampledAt ?? Date.now();
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
  if (collected.records.length === 0) {
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
    queueDepth,
    queueWaitMs,
    source: table.source,
  };
}

export class ProcessTreeSampler {
  private readonly now: () => number;
  private readonly readSample: typeof readProcessTreeSample;
  private readonly lastCpu = new Map<string, { at: number; cpuTimeMs: number }>();

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
    const sampledAt = this.now();
    const sample = await this.readSample({ ...params, sampledAt });
    if (sample.status !== "ok" || sample.treeCpuTimeMs === null) {
      return sample;
    }
    const key = [...sample.rootPids].sort((a, b) => a - b).join(",");
    const previous = this.lastCpu.get(key);
    this.lastCpu.set(key, { at: sampledAt, cpuTimeMs: sample.treeCpuTimeMs });
    if (!previous || sampledAt <= previous.at || sample.treeCpuTimeMs < previous.cpuTimeMs) {
      return { ...sample, treeCpuPercent: 0 };
    }
    return {
      ...sample,
      treeCpuPercent: Math.round(((sample.treeCpuTimeMs - previous.cpuTimeMs) / (sampledAt - previous.at)) * 100 * 100) / 100,
    };
  }

  reset(): void {
    this.lastCpu.clear();
  }
}