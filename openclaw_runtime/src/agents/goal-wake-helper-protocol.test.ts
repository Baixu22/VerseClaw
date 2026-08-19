// Phase 4 durable helper file protocol contract tests.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  appendDurableHelperOutput,
  createDurableHelperIntent,
  durableOutcomeDigest,
  listDurableHelperRunIds,
  readDurableHelperFiles,
  readDurableHelperTail,
  removeDurableHelperRunDir,
  requestDurableHelperCancellation,
  resolveDurableHelperRoot,
  writeDurableHelperExit,
  writeDurableHelperHeartbeat,
  writeDurableHelperStarted,
} from "./goal-wake-helper-protocol.js";

const tempRoots: string[] = [];
let rootDir = "";

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "goal-wake-protocol-"));
  tempRoots.push(root);
  rootDir = path.join(root, "background-processes");
});

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
  }
});

async function createIntent(runId = "run_protocol") {
  return await createDurableHelperIntent(
    {
      runId,
      commandDigest: "a".repeat(64),
      policyRevision: "runtime-lifecycle-phase4-test-v1",
      ownerEpoch: "epoch-old",
    },
    { rootDir },
  );
}

describe("durable helper file protocol", () => {
  it("persists only the seven allowed intent fields and zero raw argv/cwd/env/command text", async () => {
    await createIntent("run_intent_fields");
    const raw = fs.readFileSync(path.join(rootDir, "run_intent_fields", "intent.json"), "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual([
      "commandDigest",
      "createdAt",
      "nonce",
      "ownerEpoch",
      "policyRevision",
      "protocolVersion",
      "runId",
    ].sort());
    for (const forbidden of ["argv", "cwd", "env", "command", "secret", "password"]) {
      expect(Object.keys(parsed).map((key) => key.toLowerCase())).not.toContain(forbidden);
    }
  });

  it("trusted root is 0700 and protocol files are owner-only 0600", async () => {
    await createIntent("run_permissions");
    await writeDurableHelperStarted(
      {
        runId: "run_permissions",
        runNonce: (await readDurableHelperFiles("run_permissions", { rootDir })).intent!.nonce,
        helperPid: process.pid,
        childPid: process.pid,
        startedAtMs: Date.now(),
        commandDigest: "a".repeat(64),
      },
      { rootDir },
    );
    if (process.platform !== "win32") {
      const rootMode = fs.statSync(rootDir).mode & 0o777;
      expect(rootMode).toBe(0o700);
      for (const name of ["intent.json", "started.json"]) {
        const mode = fs.statSync(path.join(rootDir, "run_permissions", name)).mode & 0o777;
        expect(mode).toBe(0o600);
      }
    }
  });

  it("started.json is an exclusive helper claim and exit.json is terminal first truth", async () => {
    const intent = await createIntent("run_claim");
    const started = await writeDurableHelperStarted(
      {
        runId: "run_claim",
        runNonce: intent.nonce,
        helperPid: process.pid,
        childPid: process.pid,
        startedAtMs: Date.now(),
        commandDigest: intent.commandDigest,
      },
      { rootDir },
    );
    await expect(
      writeDurableHelperStarted(
        {
          runId: "run_claim",
          runNonce: intent.nonce,
          helperPid: process.pid + 1,
          childPid: process.pid + 2,
          startedAtMs: Date.now(),
          commandDigest: intent.commandDigest,
        },
        { rootDir },
      ),
    ).rejects.toThrow(/refusing to overwrite/);
    expect((await readDurableHelperFiles("run_claim", { rootDir })).started?.childPid).toBe(
      started.childPid,
    );

    const exit = await writeDurableHelperExit(
      {
        runId: "run_claim",
        nonce: intent.nonce,
        exitCode: 0,
        signal: null,
        timedOut: false,
        endedAtMs: Date.now(),
        outcomeDigest: durableOutcomeDigest({ exitCode: 0, signal: null, timedOut: false }),
      },
      { rootDir },
    );
    const secondExit = await writeDurableHelperExit(
      {
        runId: "run_claim",
        nonce: intent.nonce,
        exitCode: 9,
        signal: null,
        timedOut: false,
        endedAtMs: Date.now() + 1,
        outcomeDigest: durableOutcomeDigest({ exitCode: 9, signal: null, timedOut: false }),
      },
      { rootDir },
    );
    expect(secondExit).toEqual(exit);
  });

  it("cancel writes control.json only and never overwrites exit.json", async () => {
    const intent = await createIntent("run_cancel");
    const exit = await writeDurableHelperExit(
      {
        runId: "run_cancel",
        nonce: intent.nonce,
        exitCode: 7,
        signal: null,
        timedOut: false,
        endedAtMs: Date.now(),
        outcomeDigest: durableOutcomeDigest({ exitCode: 7, signal: null, timedOut: false }),
      },
      { rootDir },
    );
    const control = await requestDurableHelperCancellation(
      {
        runId: "run_cancel",
        nonce: intent.nonce,
        ownerEpoch: intent.ownerEpoch,
        reason: "session-lifecycle",
      },
      { rootDir },
    );
    expect(control.action).toBe("cancel");
    const files = await readDurableHelperFiles("run_cancel", { rootDir });
    expect(files.control).toEqual(control);
    expect(files.exit).toEqual(exit);
  });

  it("stale owner epoch cannot write a control claim", async () => {
    const intent = await createIntent("run_stale_control");
    await expect(
      requestDurableHelperCancellation(
        {
          runId: "run_stale_control",
          nonce: intent.nonce,
          ownerEpoch: "epoch-new",
          reason: "stale",
        },
        { rootDir },
      ),
    ).rejects.toThrow(/stale/);
  });

  it("keeps tail redacted, bounded, and stdout.log outside runtime_json reads", async () => {
    await createIntent("run_redact");
    const secret = "sk-super-secret-token-1234567890";
    await appendDurableHelperOutput(
      {
        runId: "run_redact",
        output: `api_key=${secret}\nAuthorization: Bearer abcdefghijklmnopqrstuvwxyz123456\nsafe-output\n`,
      },
      { rootDir },
    );
    const tail = await readDurableHelperTail("run_redact", { rootDir });
    expect(tail).not.toContain(secret);
    expect(tail).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
    expect(tail).toContain("safe-output");
    expect(tail.length).toBeLessThanOrEqual(8 * 1024);
    const files = await readDurableHelperFiles("run_redact", { rootDir });
    expect(JSON.stringify(files)).not.toContain(secret);
    expect(JSON.stringify(files)).not.toContain("stdout.log");
  });

  it("heartbeat round-trips only protocol fields", async () => {
    const intent = await createIntent("run_heartbeat");
    await writeDurableHelperHeartbeat(
      {
        runId: "run_heartbeat",
        nonce: intent.nonce,
        helperPid: process.pid,
        childPid: process.pid,
      },
      { rootDir },
    );
    const files = await readDurableHelperFiles("run_heartbeat", { rootDir });
    expect(files.heartbeat?.runNonce).toBe(intent.nonce);
    expect(files.heartbeat?.helperPid).toBe(process.pid);
    expect(files.heartbeat?.childPid).toBe(process.pid);
  });

  it("lists only safe run dirs with a valid intent and removes runDirs idempotently", async () => {
    fs.mkdirSync(path.join(rootDir, "not-a-run"), { recursive: true });
    await createIntent("run_list_a");
    await createIntent("run_list_b");
    expect(await listDurableHelperRunIds({ rootDir })).toEqual(["run_list_a", "run_list_b"]);
    await removeDurableHelperRunDir("run_list_a", { rootDir });
    await removeDurableHelperRunDir("run_list_a", { rootDir });
    expect(await listDurableHelperRunIds({ rootDir })).toEqual(["run_list_b"]);
  });

  it("root resolver stays inside the trusted config directory", async () => {
    expect(resolveDurableHelperRoot("/tmp/openclaw")).toBe(
      path.resolve("/tmp/openclaw/background-processes"),
    );
    await expect(
      createDurableHelperIntent(
        {
          runId: "../escape",
          commandDigest: "a".repeat(64),
          policyRevision: "p",
          ownerEpoch: "e",
        },
        { rootDir },
      ),
    ).rejects.toThrow(/safe|escape/);
  });
});

describe("durable helper claim guards", () => {
  it("rejects nonce mismatches for exit and heartbeat claims", async () => {
    await createIntent("run_nonce_guard");
    await expect(
      writeDurableHelperExit(
        {
          runId: "run_nonce_guard",
          nonce: "wrong-nonce",
          exitCode: 0,
          signal: null,
          timedOut: false,
          endedAtMs: Date.now(),
          outcomeDigest: durableOutcomeDigest({ exitCode: 0, signal: null, timedOut: false }),
        },
        { rootDir },
      ),
    ).rejects.toThrow(/nonce/);
    await expect(
      writeDurableHelperHeartbeat(
        {
          runId: "run_nonce_guard",
          nonce: "wrong-nonce",
          helperPid: process.pid,
          childPid: process.pid,
        },
        { rootDir },
      ),
    ).rejects.toThrow(/nonce/);
    expect((await readDurableHelperFiles("run_nonce_guard", { rootDir })).exit).toBeUndefined();
  });

  it("ignores malformed protocol files instead of treating them as truth", async () => {
    await createIntent("run_malformed");
    const runPath = path.join(rootDir, "run_malformed");
    fs.writeFileSync(path.join(runPath, "started.json"), "{not-json", "utf8");
    fs.writeFileSync(
      path.join(runPath, "exit.json"),
      JSON.stringify({ exitCode: 0, signal: null, timedOut: false }),
      "utf8",
    );
    const files = await readDurableHelperFiles("run_malformed", { rootDir });
    expect(files.intent).toBeDefined();
    expect(files.started).toBeUndefined();
    expect(files.exit).toBeUndefined();
  });

  it("control.json can be rewritten by an idempotent retry without changing exit truth", async () => {
    const intent = await createIntent("run_control_retry");
    const first = await requestDurableHelperCancellation(
      {
        runId: "run_control_retry",
        nonce: intent.nonce,
        ownerEpoch: intent.ownerEpoch,
        reason: "retry-one",
      },
      { rootDir },
    );
    const second = await requestDurableHelperCancellation(
      {
        runId: "run_control_retry",
        nonce: intent.nonce,
        ownerEpoch: intent.ownerEpoch,
        reason: "retry-two",
      },
      { rootDir },
    );
    expect(second).toEqual({ ...first, reason: "retry-two" });
    expect((await readDurableHelperFiles("run_control_retry", { rootDir })).exit).toBeUndefined();
  });

});

describe("Phase 4 secret persistence gate", () => {
  it("persisted protocol metadata contains zero raw command/env/secret fields", async () => {
    const findings: string[] = [];
    await createIntent("run_secret_gate");
    const runDir = path.join(rootDir, "run_secret_gate");
    await appendDurableHelperOutput(
      {
        runId: "run_secret_gate",
        output: 'password=hunter2 secret=raw-secret-value TOKEN="raw-token-value"',
      },
      { rootDir },
    );
    for (const name of ["intent.json", "started.json", "exit.json", "control.json", "heartbeat.json"]) {
      const file = path.join(runDir, name);
      if (!fs.existsSync(file)) continue;
      const raw = fs.readFileSync(file, "utf8");
      if (/raw-secret-value|raw-token-value|hunter2/iu.test(raw)) findings.push(`${name}:raw-secret`);
      if (/\b(?:argv|cwd|command)\b/iu.test(raw)) findings.push(`${name}:raw-command-field`);
    }
    if (fs.existsSync(path.join(runDir, "tail.txt"))) {
      const tail = fs.readFileSync(path.join(runDir, "tail.txt"), "utf8");
      if (/raw-secret-value|raw-token-value|hunter2/iu.test(tail)) findings.push("tail.txt:raw-secret");
    }
    console.log(`[runtime-lifecycle-audit] secretPersistenceFindings=${findings.length}`);
    expect(findings).toEqual([]);
  });
});
