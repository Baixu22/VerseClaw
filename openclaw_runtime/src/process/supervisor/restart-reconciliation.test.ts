/**
 * TF-0081 supervisor restart reconciliation tests.
 *
 * Proves the persisted run manifest identifies orphaned runs from a previous
 * owner process, kills them with OS containment evidence, and stays strictly
 * fail-closed: live owners are never touched, unverifiable containment never
 * kills, and corrupt manifests are left untouched.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isPidDefinitelyDead } from "../../shared/pid-alive.js";
import type { OsProcessTreeCapture } from "../os-containment.js";
import { createProcessSupervisor } from "./supervisor.js";
import {
  createSupervisorRunManifestStore,
  type SupervisorRunManifestEntry,
} from "./run-manifest.js";

let rootDir: string;

function makeEntry(params: {
  runId: string;
  pid: number;
  ownerPid: number;
}): SupervisorRunManifestEntry {
  return {
    runId: params.runId,
    pid: params.pid,
    ownerPid: params.ownerPid,
    sessionId: "session-reconcile",
    scopeKey: "agent:reconcile:main",
    lifecycle: {
      agentId: "reconcile",
      canonicalSessionKey: "agent:reconcile:main",
      expectedSessionId: "session-reconcile",
    },
    startedAtMs: Date.now(),
  };
}

function buildChildTreeScript(): string {
  return [
    'const { spawn } = require("node:child_process");',
    'const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {',
    '  stdio: "ignore",',
    "});",
    "console.log(`child-pid=${child.pid}`);",
    "setInterval(() => {}, 1000);",
  ].join("\n");
}

type SpawnedTree = {
  parentPid: number;
  childPid: number;
  kill: () => void;
};

async function spawnTree(): Promise<SpawnedTree> {
  const proc = spawn(process.execPath, ["-e", buildChildTreeScript()], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  proc.stdout.setEncoding("utf8");
  const firstLine = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("tree stdout timeout")), 10_000);
    proc.stdout.once("data", (chunk: string) => {
      clearTimeout(timer);
      resolve(String(chunk));
    });
    proc.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("tree exited before announcing child"));
    });
  });
  const match = firstLine.match(/child-pid=(\d+)/u);
  const childPid = match ? Number(match[1]) : -1;
  if (childPid <= 0) {
    throw new Error(`child pid not captured: ${firstLine}`);
  }
  return {
    parentPid: proc.pid ?? -1,
    childPid,
    kill: () => {
      proc.kill("SIGKILL");
    },
  };
}

async function spawnDeadPid(): Promise<number> {
  const proc = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
  const pid = proc.pid ?? -1;
  await new Promise<void>((resolve) => {
    proc.once("exit", () => resolve());
  });
  const deadline = Date.now() + 5_000;
  while (!isPidDefinitelyDead(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return pid;
}

async function waitForPidDeath(pid: number, timeoutMs = 12_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isPidDefinitelyDead(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "supervisor-reconcile-"));
});

afterEach(() => {
  fs.rmSync(rootDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

describe("supervisor restart reconciliation", () => {
  it(
    "mirrors active runs into the manifest and clears them after exit",
    async () => {
      const store = createSupervisorRunManifestStore(rootDir);
      const supervisor = createProcessSupervisor({ manifest: store });
      const run = await supervisor.spawn({
        sessionId: "session-reconcile",
        backendId: "reconcile-test",
        scopeKey: "agent:reconcile:main",
        lifecycleAgentId: "reconcile",
        lifecycleCanonicalSessionKey: "agent:reconcile:main",
        lifecycleExpectedSessionId: "session-reconcile",
        mode: "child",
        argv: [process.execPath, "-e", "setTimeout(() => process.exit(0), 400)"],
        captureOutput: false,
      });
      expect(store.load()).toMatchObject({ status: "ok" });
      const loaded = store.load();
      expect(loaded.status === "ok" && loaded.entries.some((e) => e.runId === run.runId)).toBe(
        true,
      );
      const exit = await run.wait();
      expect(exit.reason).toBe("exit");
      const after = store.load();
      expect(
        after.status === "ok" &&
          !after.entries.some((e) => e.runId === run.runId),
      ).toBe(true);
    },
    30_000,
  );

  it(
    "kills a previous-boot orphan tree with OS containment evidence",
    async () => {
      const deadOwnerPid = await spawnDeadPid();
      expect(isPidDefinitelyDead(deadOwnerPid)).toBe(true);
      const tree = await spawnTree();
      const store = createSupervisorRunManifestStore(rootDir);
      expect(
        store.add(makeEntry({ runId: "orphan-run", pid: tree.parentPid, ownerPid: deadOwnerPid })),
      ).toBe(true);

      const supervisor = createProcessSupervisor({ manifest: store });
      const result = await supervisor.reconcileOrphans();

      expect(result).toMatchObject({
        status: "ok",
        reconciled: 1,
        lost: 0,
        ours: 0,
        foreignOwner: 0,
        containmentUnknown: 0,
        residual: 0,
      });
      expect(await waitForPidDeath(tree.parentPid)).toBe(true);
      expect(await waitForPidDeath(tree.childPid)).toBe(true);
      const after = store.load();
      expect(after.status === "ok" && after.entries.length).toBe(0);
    },
    45_000,
  );

  it(
    "never touches a run whose owner process is still alive",
    async () => {
      const tree = await spawnTree();
      const store = createSupervisorRunManifestStore(rootDir);
      // ppid is alive and is not this store's owner: another live gateway.
      const foreignOwnerPid = process.ppid ?? 1;
      expect(
        store.add(makeEntry({ runId: "foreign-run", pid: tree.parentPid, ownerPid: foreignOwnerPid })),
      ).toBe(true);

      const supervisor = createProcessSupervisor({ manifest: store });
      const result = await supervisor.reconcileOrphans();

      expect(result).toMatchObject({
        status: "ok",
        foreignOwner: 1,
        reconciled: 0,
        containmentUnknown: 0,
        residual: 0,
      });
      expect(isPidDefinitelyDead(tree.parentPid)).toBe(false);
      const after = store.load();
      expect(after.status === "ok" && after.entries.length).toBe(1);
      tree.kill();
      await waitForPidDeath(tree.parentPid);
      if (!isPidDefinitelyDead(tree.childPid)) {
        process.kill(tree.childPid, "SIGKILL");
      }
    },
    30_000,
  );

  it(
    "removes entries whose run already exited",
    async () => {
      const deadOwnerPid = await spawnDeadPid();
      const deadRunPid = await spawnDeadPid();
      const store = createSupervisorRunManifestStore(rootDir);
      expect(
        store.add(makeEntry({ runId: "lost-run", pid: deadRunPid, ownerPid: deadOwnerPid })),
      ).toBe(true);

      const supervisor = createProcessSupervisor({ manifest: store });
      const result = await supervisor.reconcileOrphans();

      expect(result).toMatchObject({ status: "ok", lost: 1, reconciled: 0 });
      const after = store.load();
      expect(after.status === "ok" && after.entries.length).toBe(0);
    },
    30_000,
  );

  it(
    "keeps a live orphan untouched when OS containment evidence is unverifiable",
    async () => {
      const deadOwnerPid = await spawnDeadPid();
      const tree = await spawnTree();
      const store = createSupervisorRunManifestStore(rootDir);
      expect(
        store.add(makeEntry({ runId: "unknown-cap", pid: tree.parentPid, ownerPid: deadOwnerPid })),
      ).toBe(true);

      const captureCalls: number[][] = [];
      const supervisor = createProcessSupervisor({ manifest: store });
      const result = await supervisor.reconcileOrphans({
        capture: async (roots: number[]) => {
          captureCalls.push(roots);
          const unknown: OsProcessTreeCapture = {
            status: "unknown",
            detail: "fixture: process table unavailable",
            rootPids: roots,
            capturedPids: new Map(),
          };
          return unknown;
        },
      });

      expect(result).toMatchObject({
        status: "partial",
        containmentUnknown: 1,
        reconciled: 0,
        residual: 0,
      });
      expect(captureCalls).toEqual([[tree.parentPid]]);
      expect(isPidDefinitelyDead(tree.parentPid)).toBe(false);
      const after = store.load();
      expect(after.status === "ok" && after.entries.length).toBe(1);

      // A later boot with working evidence can still reconcile the orphan.
      const second = createProcessSupervisor({ manifest: store });
      const secondResult = await second.reconcileOrphans();
      expect(secondResult).toMatchObject({ status: "ok", reconciled: 1 });
      expect(await waitForPidDeath(tree.parentPid)).toBe(true);
      expect(await waitForPidDeath(tree.childPid)).toBe(true);
    },
    60_000,
  );

  it(
    "fails closed on a corrupt manifest without touching the file",
    async () => {
      fs.mkdirSync(rootDir, { recursive: true });
      fs.writeFileSync(path.join(rootDir, "active-runs.json"), "{not-json", "utf8");
      const store = createSupervisorRunManifestStore(rootDir);
      const supervisor = createProcessSupervisor({ manifest: store });

      const result = await supervisor.reconcileOrphans();
      expect(result.status).toBe("corrupt");
      // Mutations refuse to overwrite the corrupt evidence file.
      expect(store.add(makeEntry({ runId: "x", pid: 1, ownerPid: 2 }))).toBe(false);
      expect(fs.readFileSync(path.join(rootDir, "active-runs.json"), "utf8")).toBe("{not-json");
    },
    15_000,
  );

  it(
    "is a no-op without a manifest and idempotent after reconciliation",
    async () => {
      const plain = createProcessSupervisor();
      const disabled = await plain.reconcileOrphans();
      expect(disabled).toMatchObject({ status: "disabled" });

      const deadOwnerPid = await spawnDeadPid();
      const tree = await spawnTree();
      const store = createSupervisorRunManifestStore(rootDir);
      store.add(makeEntry({ runId: "once", pid: tree.parentPid, ownerPid: deadOwnerPid }));
      const supervisor = createProcessSupervisor({ manifest: store });
      const first = await supervisor.reconcileOrphans();
      expect(first).toMatchObject({ status: "ok", reconciled: 1 });
      const second = await supervisor.reconcileOrphans();
      expect(second).toMatchObject({
        status: "ok",
        reconciled: 0,
        lost: 0,
        containmentUnknown: 0,
        residual: 0,
      });
      expect(await waitForPidDeath(tree.childPid)).toBe(true);
    },
    60_000,
  );
});
