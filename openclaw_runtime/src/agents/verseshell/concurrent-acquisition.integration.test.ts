import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { VerseShellProcessManager, type AciChildProcess } from "./process-manager.js";
import {
  resolveVerseShellPolicyProfile,
  VERSESHELL_GOVERNED_EXEC_PROFILE_ID,
} from "./policy-profile.js";

const childSource = String.raw`
const readline = require('node:readline');
const input = readline.createInterface({ input: process.stdin });
input.on('line', line => {
  if (line === 'SHUTDOWN') { input.close(); process.exit(0); }
  const request = JSON.parse(line);
  process.stdout.write(JSON.stringify({
    schema: 'verseshell.observation/v1', id: request.id, op: request.op,
    ok: true, status: 'ok', data: request.op === 'runtime.handshake'
      ? JSON.parse(process.env.ACI_TEST_HANDSHAKE) : { pid: process.pid },
    meta: { elapsed_ms: 1, profile: 'test', token_estimate: 1 }
  }) + '\n');
});
`;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

describe("concurrent acquisition with real ACI protocol children", () => {
  it("reuses one owned Node child and leaves zero owned PIDs after repeated shutdown", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "clawx-aci-acquisition-"));
    const script = path.join(workspace, "aci-child.cjs");
    await writeFile(script, childSource);
    let canonical = await realpath(workspace);
    if (process.platform === "win32") canonical = canonical.replace(/\\/g, "/").toLowerCase();
    const profile = resolveVerseShellPolicyProfile(VERSESHELL_GOVERNED_EXEC_PROFILE_ID);
    const config = {
      workspace,
      policyProfile: VERSESHELL_GOVERNED_EXEC_PROFILE_ID,
      expectedBinaryVersion: "1.0.0",
      expectedProtocolVersion: "verseshell.jsonl/v1",
      expectedCatalogDigest: `sha256:${"a".repeat(64)}`,
      expectedCatalogCount: 26,
      handshakeTimeoutMs: 5_000,
      requestTimeoutMs: 2_000,
    };
    const handshake = {
      crate_version: "1.0.0",
      runtime_version: "1.0.0",
      server_protocol: config.expectedProtocolVersion,
      observation_schema: "verseshell.observation/v1",
      operation_catalog_schema: "verseshell.operation-catalog/v1",
      workspace: {
        id: `ws_sha256_${createHash("sha256").update(canonical).digest("hex")}`,
        canonical: true,
      },
      capabilities: { mode: "allow_list", granted: [...profile.capabilities].sort() },
      policy_mode: "agent_strict",
      policy_profile: { id: profile.id, digest: profile.digest },
      artifact_defaults: { ttl_seconds: 86_400, max_total_bytes: 536_870_912 },
      max_concurrency: 4,
      operation_catalog: {
        digest: config.expectedCatalogDigest,
        count: config.expectedCatalogCount,
      },
      features: ["typed_operations", "result_artifacts", "bound_approvals", "legacy_cmd"],
    };
    const children: ChildProcess[] = [];
    const closed: Promise<void>[] = [];
    const managers: VerseShellProcessManager[] = [];
    try {
      for (let cycle = 0; cycle < 3; cycle++) {
        const manager = new VerseShellProcessManager({
          maxProcesses: 1,
          shutdownGraceMs: 1_000,
          resolveBinary: async () => ({ path: process.execPath, source: "test", verified: true }),
          spawnProcess: (_binary, args, options) => {
            const child = spawn(process.execPath, [script, ...args], {
              ...options,
              env: { ...options.env, ACI_TEST_HANDSHAKE: JSON.stringify(handshake) },
            });
            children.push(child);
            closed.push(new Promise((resolve) => child.once("close", () => resolve())));
            return child as AciChildProcess;
          },
        });
        managers.push(manager);
        const clients = await Promise.all(
          Array.from({ length: 16 }, () => manager.getClient(config)),
        );
        expect(children).toHaveLength(cycle + 1);
        expect(new Set(clients.map((client) => client.processKey)).size).toBe(1);
        const read = await clients[0].execute("file.view", { path: "fixture" });
        expect(read.data).toEqual({ pid: children[cycle].pid });
        await Promise.all([manager.shutdownAll(), manager.shutdownAll()]);
        await closed[cycle];
        expect(manager.list()).toEqual([]);
        expect(isAlive(children[cycle].pid!)).toBe(false);
      }
      const observations = children.map((child) => ({
        pid: child.pid,
        exitCode: child.exitCode,
        alive: isAlive(child.pid!),
      }));
      expect(observations.every((entry) => entry.exitCode === 0 && !entry.alive)).toBe(true);
      if (process.env.PERFORMANCE_LIFECYCLE_REPORT_DIR) {
        await writeFile(
          path.join(process.env.PERFORMANCE_LIFECYCLE_REPORT_DIR, "owned-processes.json"),
          JSON.stringify(
            {
              schema: "clawx.aci-acquisition-owned-processes/v1",
              driven_by: "agent",
              actor: "codex",
              cycles: 3,
              callersPerCycle: 16,
              spawnCount: children.length,
              fixture: "real-node-aci-protocol-child",
              observations,
              ownedResidualPids: 0,
            },
            null,
            2,
          ) + "\n",
        );
      }
    } finally {
      await Promise.allSettled(managers.map((manager) => manager.shutdownAll()));
      for (const child of children)
        if (child.exitCode === null && child.signalCode === null) child.kill();
      await Promise.all(closed);
      await rm(workspace, { recursive: true, force: true });
    }
  }, 20_000);
});
