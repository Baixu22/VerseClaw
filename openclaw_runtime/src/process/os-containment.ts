// OS process-tree containment evidence shared by lifecycle drain and
// supervisor restart reconciliation. Single source of truth for platform
// process tables, PID-reuse token guards, and tree capture/verification.
import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const OS_PROCESS_TREE_LIMIT = 512;
const OS_PROCESS_PROBE_TIMEOUT_MS = 5_000;
const OS_RESIDUAL_SETTLE_MS = 5_000;
const OS_RESIDUAL_POLL_MS = 100;

export type OsProcessRecord = {
  pid: number;
  parentPid: number;
  token: string;
  zombie: boolean;
};

export type OsProcessTreeCapture = {
  status: "ok" | "unknown";
  detail?: string;
  rootPids: number[];
  capturedPids: Map<number, string>;
};

export type OsContainmentCheck =
  | { status: "empty" }
  | { status: "residual"; detail: string }
  | { status: "unknown"; detail: string };

async function runProcessProbe(
  file: string,
  args: string[],
): Promise<{ ok: true; stdout: string } | { ok: false; detail: string }> {
  try {
    const result = await execFileAsync(file, args, {
      windowsHide: true,
      timeout: OS_PROCESS_PROBE_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { ok: true, stdout: result.stdout };
  } catch (error) {
    return { ok: false, detail: String(error) };
  }
}

async function readWindowsProcessMap(): Promise<
  { ok: true; processes: Map<number, OsProcessRecord> } | { ok: false; detail: string }
> {
  const parseProcessRows = (
    rows: string[],
    separator: string,
    source: string,
  ): { ok: true; processes: Map<number, OsProcessRecord> } | { ok: false; detail: string } => {
    if (rows.length === 0) {
      return { ok: false, detail: `${source} returned an empty process table` };
    }
    const processes = new Map<number, OsProcessRecord>();
    for (const line of rows) {
      const columns = line.split(separator);
      const pid = Number.parseInt(columns[0] ?? "", 10);
      const parentPid = Number.parseInt(columns[1] ?? "", 10);
      const token = (columns[2] ?? "").trim();
      if (!Number.isInteger(pid) || pid <= 0 || !token) {
        continue;
      }
      processes.set(pid, {
        pid,
        parentPid: Number.isInteger(parentPid) ? parentPid : -1,
        token,
        zombie: false,
      });
    }
    return { ok: true, processes };
  };

  // WMIC was removed from newer Windows installations. Prefer the supported
  // CIM cmdlet and emit invariant, tab-separated values so locale-specific
  // DateTime formatting cannot corrupt the process token.
  const powershell = await runProcessProbe("powershell", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "$ErrorActionPreference = 'Stop'; Get-CimInstance -ClassName Win32_Process | ForEach-Object { \"{0}`t{1}`t{2}\" -f $_.ProcessId, $_.ParentProcessId, $_.CreationDate.ToFileTimeUtc() }",
  ]);
  if (powershell.ok) {
    const parsed = parseProcessRows(
      powershell.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
      "\t",
      "PowerShell Get-CimInstance",
    );
    if (parsed.ok && parsed.processes.size > 0) {
      return parsed;
    }
  }

  const wmic = await runProcessProbe("wmic", [
    "process",
    "get",
    "ProcessId,ParentProcessId,CreationDate",
    "/format:csv",
  ]);
  if (wmic.ok) {
    const lines = wmic.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const header = lines[0]?.split(",") ?? [];
    const pidIndex = header.findIndex((column) => column.trim().toLowerCase() === "processid");
    const parentIndex = header.findIndex((column) => column.trim().toLowerCase() === "parentprocessid");
    const tokenIndex = header.findIndex((column) => column.trim().toLowerCase() === "creationdate");
    if (pidIndex >= 0 && parentIndex >= 0 && tokenIndex >= 0) {
      const rows = lines.slice(1).map((line) => {
        const columns = line.split(",");
        return [columns[pidIndex] ?? "", columns[parentIndex] ?? "", columns[tokenIndex] ?? ""].join("\t");
      });
      const parsed = parseProcessRows(rows, "\t", "wmic");
      if (parsed.ok) {
        return parsed;
      }
    }
  }

  const powershellDetail = powershell.ok ? "empty process table" : powershell.detail;
  const wmicDetail = wmic.ok ? "empty process table" : wmic.detail;
  return { ok: false, detail: `PowerShell: ${powershellDetail}; WMIC: ${wmicDetail}` };
}

function parseLinuxProcStat(
  pid: number,
): { parentPid: number; token: string; zombie: boolean } | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const commEndIndex = stat.lastIndexOf(")");
    if (commEndIndex < 0) {
      return null;
    }
    const afterComm = stat.slice(commEndIndex + 1).trimStart();
    const fields = afterComm.split(/\s+/);
    const state = fields[0];
    const parentPid = Number.parseInt(fields[1] ?? "", 10);
    const token = fields[19] ?? "";
    if (!Number.isInteger(parentPid) || !token) {
      return null;
    }
    return { parentPid, token, zombie: state === "Z" };
  } catch {
    return null;
  }
}

function readLinuxProcessMap():
  | { ok: true; processes: Map<number, OsProcessRecord> }
  | { ok: false; detail: string } {
  try {
    const entries = fs.readdirSync("/proc", { withFileTypes: true });
    const processes = new Map<number, OsProcessRecord>();
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pid = Number.parseInt(entry.name, 10);
      if (!Number.isInteger(pid) || pid <= 0) continue;
      const parsed = parseLinuxProcStat(pid);
      if (!parsed) continue;
      processes.set(pid, {
        pid,
        parentPid: parsed.parentPid,
        token: parsed.token,
        zombie: parsed.zombie,
      });
    }
    return { ok: true, processes };
  } catch (error) {
    return { ok: false, detail: String(error) };
  }
}

async function readProcessMap(): Promise<
  { ok: true; processes: Map<number, OsProcessRecord> } | { ok: false; detail: string }
> {
  if (process.platform === "win32") {
    return await readWindowsProcessMap();
  }
  if (process.platform === "linux") {
    return readLinuxProcessMap();
  }
  return {
    ok: false,
    detail: `OS containment evidence is unavailable on ${process.platform}`,
  };
}

function tokenIsAfter(token: string, parentToken: string): boolean {
  const numericToken = Number(token);
  const numericParentToken = Number(parentToken);
  if (Number.isFinite(numericToken) && Number.isFinite(numericParentToken)) {
    return numericToken > numericParentToken;
  }
  // Windows CIM datetime tokens (YYYYMMDDHHmmss.uuuuuu+mmm) compare
  // lexicographically for processes from the same machine/timezone.
  return token > parentToken;
}

type TreeCollection = { captured: Map<number, string>; truncated: boolean };

function collectTreePids(
  processes: Map<number, OsProcessRecord>,
  roots: number[],
): TreeCollection {
  const captured = new Map<number, string>();
  const queue: Array<{ pid: number; token: string }> = [];
  for (const root of roots) {
    const record = processes.get(root);
    if (!record) continue;
    captured.set(root, record.token);
    queue.push({ pid: root, token: record.token });
  }
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    for (const record of processes.values()) {
      if (record.parentPid !== current.pid) continue;
      // A child cannot be older than its parent. Windows ParentProcessId is
      // not cleared when the original parent dies, so a reused root PID can
      // otherwise capture a stale unrelated child (for example csrss.exe).
      if (!tokenIsAfter(record.token, current.token)) continue;
      if (captured.has(record.pid)) continue;
      captured.set(record.pid, record.token);
      queue.push({ pid: record.pid, token: record.token });
      if (captured.size >= OS_PROCESS_TREE_LIMIT) {
        return { captured, truncated: true };
      }
    }
  }
  return { captured, truncated: false };
}

/** Captures the OS process trees rooted at the given PIDs with reuse tokens. */
export async function captureProcessTrees(roots: number[]): Promise<OsProcessTreeCapture> {
  if (roots.length === 0) {
    return { status: "ok", rootPids: roots, capturedPids: new Map() };
  }
  const probe = await readProcessMap();
  if (!probe.ok) {
    return { status: "unknown", detail: probe.detail, rootPids: roots, capturedPids: new Map() };
  }
  const collection = collectTreePids(probe.processes, roots);
  if (collection.truncated) {
    return {
      status: "unknown",
      detail: `process tree capture reached the ${OS_PROCESS_TREE_LIMIT}-PID safety limit`,
      rootPids: roots,
      capturedPids: collection.captured,
    };
  }
  return {
    status: "ok",
    rootPids: roots,
    capturedPids: collection.captured,
  };
}

function findLiveCapturedProcess(
  processes: Map<number, OsProcessRecord>,
  capture: OsProcessTreeCapture,
): { pid: number; reused: boolean } | undefined {
  for (const [pid, capturedToken] of capture.capturedPids) {
    const current = processes.get(pid);
    if (!current || current.zombie) {
      continue;
    }
    if (current.token !== capturedToken) {
      return { pid, reused: true };
    }
    return { pid, reused: false };
  }
  return undefined;
}

/** Verifies every captured PID is gone, with PID-reuse inconclusiveness. */
export async function verifyProcessTreesTerminated(
  capture: OsProcessTreeCapture,
): Promise<OsContainmentCheck> {
  if (capture.capturedPids.size === 0) {
    return { status: "empty" };
  }
  const settleDeadline = Date.now() + OS_RESIDUAL_SETTLE_MS;
  while (true) {
    const probe = await readProcessMap();
    if (!probe.ok) {
      return { status: "unknown", detail: probe.detail };
    }
    const live = findLiveCapturedProcess(probe.processes, capture);
    if (!live) {
      return { status: "empty" };
    }
    if (live.reused) {
      return {
        status: "unknown",
        detail: `PID ${live.pid} was reused after cancellation; OS containment evidence is inconclusive`,
      };
    }
    if (Date.now() >= settleDeadline) {
      return {
        status: "residual",
        detail: `process tree still contains live PID ${live.pid} after drain wait`,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, OS_RESIDUAL_POLL_MS));
  }
}
