#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createReadToolDefinition } from "../openclaw_runtime/src/agents/sessions/tools/read";
import { createWriteToolDefinition } from "../openclaw_runtime/src/agents/sessions/tools/write";
import { verseGitSha256 } from "../openclaw_runtime/src/agents/sessions/tools/versegit-tool-basis";
import { deriveVerseGitToolObservationRequest } from "../openclaw_runtime/src/agents/harness/versegit-tool-observation";
import type { ExtensionContext } from "../openclaw_runtime/src/agents/sessions/extensions/types";
import { createVerseGitRuntimeBindingPortFromEnv } from "../openclaw_runtime/src/plugin-sdk/versegit-binding-port";
import { createVerseGitRuntimeObservationPortFromEnv } from "../openclaw_runtime/src/plugin-sdk/versegit-observation-port";
import { VerseGitBindingBridge } from "../electron/gateway/versegit-bridge";
import { VerseGitObservationBridge } from "../electron/services/versegit-observation";
import type { VerseGitBindingRecord, VerseGitToolObservationRequest } from "../shared/versegit-runtime-contract";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = "harness/specs/fixtures/versegit-product-integration/c2";
const PATHS = {
  links: `${OUT}/observation-links.json`,
  cases: `${OUT}/basis-race-cases.json`,
  coverage: `${OUT}/coverage.json`,
};

function sha(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, stable((value as Record<string, unknown>)[key])]));
  }
  return value;
}
function digest(document: Record<string, unknown>): string {
  return sha(JSON.stringify(stable({ ...document, generated_at: undefined, digest: undefined })));
}
function sign<T extends Record<string, unknown>>(document: T): T & { digest: string } {
  return Object.assign(document, { digest: digest(document) });
}
function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
}
function source() {
  const dirty = git(ROOT, ["status", "--porcelain=v1", "--untracked-files=normal"]).length > 0;
  return { branch: git(ROOT, ["branch", "--show-current"]) || "detached", commit: git(ROOT, ["rev-parse", "HEAD"]), tree: git(ROOT, ["rev-parse", "HEAD^{tree}"]), dirty };
}
async function freePort(): Promise<number> {
  return await new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return rejectPort(new Error("no port"));
      server.close((error) => error ? rejectPort(error) : resolvePort(address.port));
    });
  });
}
function writeJson(path: string, value: unknown): void {
  const full = resolve(ROOT, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
function toolEvent(cwd: string, toolCallId: string, toolName: "read" | "write", args: Record<string, unknown>, result: { content: unknown[]; details?: unknown }) {
  return {
    toolCallId,
    toolName,
    args,
    cwd,
    isError: false,
    result: result as never,
  };
}

const candidate = source();
if (candidate.dirty) throw new Error("C2 evidence source candidate is dirty before generation");
const fixtureRoot = mkdtempSync(join(tmpdir(), "versegit-c2-evidence-"));
const repoRoot = join(fixtureRoot, "repo");
const worktreeA = join(repoRoot, "wt-a");
const worktreeB = join(repoRoot, "wt-b");
mkdirSync(repoRoot, { recursive: true });
git(repoRoot, ["init", "--initial-branch=main"]);
git(repoRoot, ["config", "user.email", "agent@example.invalid"]);
git(repoRoot, ["config", "user.name", "Agent"]);
writeFileSync(join(repoRoot, "base.txt"), "base\n", "utf8");
git(repoRoot, ["add", "."]);
git(repoRoot, ["commit", "-m", "base"]);
for (const worktree of [worktreeA, worktreeB]) git(repoRoot, ["worktree", "add", "--detach", worktree, "HEAD"]);

const apiSource = [
  "export type User = { id: string; name: string };",
  "export function readUser(id: string): User {",
  "  return { id, name: 'Ada' };",
  "}",
].join("\n");
for (const worktree of [worktreeA, worktreeB]) {
  mkdirSync(join(worktree, "src"), { recursive: true });
  writeFileSync(join(worktree, "src", "api.ts"), apiSource, "utf8");
}
writeFileSync(join(worktreeA, "src", "own.ts"), "export const own = 1;\n", "utf8");
writeFileSync(join(worktreeA, "src", "unrelated.ts"), "export const unrelated = 1;\n", "utf8");
writeFileSync(join(worktreeB, "src", "other.ts"), "export const other = 1;\n", "utf8");

const observationBridge = new VerseGitObservationBridge({ maxToolRecords: 100 });
const port = await freePort();
const token = "c2-evidence-token";
const bridgeEventsPath = join(fixtureRoot, "bridge-events.jsonl");
const observationsPath = join(fixtureRoot, "observations.jsonl");
const bridge = new VerseGitBindingBridge({
  enabled: true,
  port,
  token,
  ownerId: "agent:codex",
  epoch: 4,
  repoRoot,
  eventsPath: bridgeEventsPath,
  observationsPath,
  observationBridge,
});
const address = await bridge.start();
const env = {
  CLAWX_VERSGIT_BINDING_ENABLED: "1",
  CLAWX_VERSGIT_RUNTIME_BINDING_URL: address!,
  CLAWX_VERSGIT_BINDING_TOKEN: token,
  CLAWX_VERSGIT_OWNER_ID: "agent:codex",
  CLAWX_VERSGIT_EPOCH: "4",
};
const bindingPort = createVerseGitRuntimeBindingPortFromEnv(env)!;
const observationPort = createVerseGitRuntimeObservationPortFromEnv(env)!;

async function bindOne(runId: string, worktreePath: string, worktreeId: string): Promise<VerseGitBindingRecord> {
  const bound = await bindingPort.bind({
    requestId: `request-${runId}`,
    runId,
    traceId: `trace-${runId}`,
    worktreePath,
    agentSessionId: `agent-session-${runId}`,
    mode: "M1",
  });
  return await bindingPort.attach({
    bindingId: bound.bindingId,
    childSessionKey: `session-${runId}`,
    childRunId: runId,
  });
}

async function readRequest(binding: VerseGitBindingRecord, worktreePath: string, path: string, toolCallId: string, limit?: number): Promise<VerseGitToolObservationRequest> {
  const result = await createReadToolDefinition(worktreePath).execute(
    toolCallId,
    { path, ...(limit === undefined ? {} : { limit }) },
    undefined,
    undefined,
    {} as ExtensionContext,
  );
  return deriveVerseGitToolObservationRequest({
    event: toolEvent(worktreePath, toolCallId, "read", { path, ...(limit === undefined ? {} : { limit }) }, result),
    binding,
    cwd: worktreePath,
  });
}

async function writeRequest(binding: VerseGitBindingRecord, worktreePath: string, path: string, content: string, toolCallId: string): Promise<VerseGitToolObservationRequest> {
  const result = await createWriteToolDefinition(worktreePath).execute(
    toolCallId,
    { path, content },
    undefined,
    undefined,
    {} as ExtensionContext,
  );
  return deriveVerseGitToolObservationRequest({
    event: toolEvent(worktreePath, toolCallId, "write", { path, content }, result),
    binding,
    cwd: worktreePath,
  });
}

const bindingA = await bindOne("run-a", worktreeA, "worktree-a");
const bindingB = await bindOne("run-b", worktreeB, "worktree-b");
const apiRead = await readRequest(bindingA, worktreeA, "src/api.ts", "read-api", 3);
const apiReadReceipt = await observationPort.observe(apiRead);
const duplicateRead = await observationPort.observe(apiRead);
const apiWrite = await writeRequest(
  bindingB,
  worktreeB,
  "src/api.ts",
  "export type User = { id: string };\nexport const readUser = (id: string): User => ({ id });\n",
  "write-api",
);
const apiWriteReceipt = await observationPort.observe(apiWrite);

const ownRead = await readRequest(bindingA, worktreeA, "src/own.ts", "read-own");
await observationPort.observe(ownRead);
const ownWrite = await writeRequest(bindingA, worktreeA, "src/own.ts", "export const own = 2;\n", "write-own");
await observationPort.observe(ownWrite);
const unrelatedRead = await readRequest(bindingA, worktreeA, "src/unrelated.ts", "read-unrelated");
await observationPort.observe(unrelatedRead);
const unrelatedWrite = await writeRequest(bindingB, worktreeB, "src/other.ts", "export const other = 2;\n", "write-other");
await observationPort.observe(unrelatedWrite);

const cancelledRequest: VerseGitToolObservationRequest = {
  ...apiWrite,
  toolCallId: "write-cancelled",
  status: "cancelled",
  inputDigest: `sha256:${sha("cancel-input")}`,
  outputDigest: `sha256:${sha("cancel-output")}`,
};
const cancelledReceipt = await observationPort.observe(cancelledRequest);

const wrongOwnerPort = createVerseGitRuntimeObservationPortFromEnv({ ...env, CLAWX_VERSGIT_OWNER_ID: "agent:other" })!;
let wrongOwnerRejected = false;
try {
  await wrongOwnerPort.observe({ ...apiRead, toolCallId: "read-wrong-owner", inputDigest: `sha256:${sha("wrong-owner")}` });
} catch (error) { wrongOwnerRejected = (error as { code?: string }).code === "BINDING_MISMATCH"; }
const staleEpochPort = createVerseGitRuntimeObservationPortFromEnv({ ...env, CLAWX_VERSGIT_EPOCH: "3" })!;
let staleEpochRejected = false;
try {
  await staleEpochPort.observe({ ...apiRead, toolCallId: "read-old-epoch", inputDigest: `sha256:${sha("old-epoch")}` });
} catch (error) { staleEpochRejected = (error as { code?: string }).code === "BINDING_MISMATCH"; }

const queueBridge = new VerseGitObservationBridge({ maxToolRecords: 1 });
queueBridge.bind({
  bindingId: "binding-queue",
  runId: "run-queue",
  sessionKey: "session-queue",
  traceId: "trace-queue",
  requestId: "request-queue",
  repoId: bindingA.repoId,
  worktreeId: "worktree-queue",
  worktreePath: worktreeA,
  agentSessionId: "agent-session-queue",
  vgSessionId: "vg-session-queue",
  ownerId: "agent:codex",
  actor: "codex",
  epoch: 4,
});
queueBridge.ingestToolObservation({ ...apiRead, bindingId: "binding-queue", childRunId: "run-queue", toolCallId: "queue-read-1" }, { epoch: 4, ownerId: "agent:codex" });
queueBridge.ingestToolObservation({ ...apiRead, bindingId: "binding-queue", childRunId: "run-queue", toolCallId: "queue-read-2", inputDigest: `sha256:${sha("queue-read-2")}` }, { epoch: 4, ownerId: "agent:codex" });
const queueSnapshot = queueBridge.snapshot("run-queue")!;

const findingsBeforeDetach = observationBridge.staleReadFindings();
const snapshotA = observationBridge.snapshot("run-a")!;
const snapshotB = observationBridge.snapshot("run-b")!;
const linksBeforeDetach = observationBridge.recentToolObservations(undefined, 100);
await bindingPort.end({ bindingId: bindingA.bindingId, reason: "orchestration_completed" });
const lateRequest = await readRequest(bindingA, worktreeA, "src/api.ts", "read-after-end", 1);
const lateReceipt = await observationPort.observe(lateRequest);
await bindingPort.end({ bindingId: bindingB.bindingId, reason: "orchestration_completed" });
await bridge.stop();

const worktreeByRun = new Map([["run-a", worktreeA], ["run-b", worktreeB], ["run-queue", worktreeA]]);
const links = linksBeforeDetach
  .filter((record) => record.event.path)
  .map((record) => {
    const worktree = worktreeByRun.get(record.runId)!;
    const actual = readFileSync(resolve(worktree, record.event.path!));
    const pathRecomputed = relative(worktree, resolve(worktree, record.event.path!)).replaceAll("\\", "/") === record.event.path;
    const actualFileSha = verseGitSha256(actual);
    const basisFileSha = record.event.basis?.fileSha256 ?? null;
    return {
      link_id: `vgl_${record.event.eventId.replace(/^vge_/u, "")}`,
      tool: { call_id: record.toolCallId, name: record.toolName },
      normalized_event: {
        event_id: record.event.eventId,
        surface: record.event.surface,
        status: record.event.status,
        coverage: record.event.coverage,
        path: record.event.path,
        line_start: record.event.lineStart ?? null,
        line_end: record.event.lineEnd ?? null,
        basis: record.basis,
        input_digest: record.event.inputDigest,
        output_digest: record.event.outputDigest,
      },
      provider_fact: {
        identity: {
          repo_id: record.event.repoId,
          worktree_id: record.event.worktreeId,
          agent_session_id: record.event.agentSessionId,
          vg_session_id: record.event.vgSessionId,
          run_id: record.runId,
          epoch: record.event.epoch,
        },
        kind: record.event.surface === "file.read" ? "repository-read-basis" : "repository-write-basis",
      },
      replay: {
        path_recomputed: pathRecomputed,
        actual_file_sha256: actualFileSha,
        basis_file_sha256: basisFileSha,
        basis_matches_current_file: basisFileSha === null ? null : basisFileSha === actualFileSha,
        input_digest_well_formed: /^sha256:[a-f0-9]{64}$/u.test(record.event.inputDigest),
        output_digest_well_formed: /^sha256:[a-f0-9]{64}$/u.test(record.event.outputDigest),
      },
    };
  });

const apiFinding = findingsBeforeDetach.find((finding) => finding.kind === "api-drift" && finding.path === "src/api.ts") ?? null;
const ownFinding = findingsBeforeDetach.some((finding) => finding.path === "src/own.ts");
const unrelatedFinding = findingsBeforeDetach.some((finding) => finding.path === "src/other.ts" || finding.path === "src/unrelated.ts");
const cases = sign({
  schema: "clawx.versegit.c2-basis-race-cases/v1",
  generated_at: new Date().toISOString(),
  task: "TF-0529",
  driven_by: "agent",
  actor: "codex",
  source: candidate,
  cases: {
    producer_consumer_api_drift: { passed: Boolean(apiFinding), finding: apiFinding },
    own_write_negative: { passed: !ownFinding },
    unrelated_file_negative: { passed: !unrelatedFinding },
    read_then_file_change: { passed: Boolean(apiFinding), finding_id: apiFinding?.findingId ?? null },
    duplicate_rejected: { passed: duplicateRead.status === "duplicate", status: duplicateRead.status },
    late_after_detach_rejected: { passed: lateReceipt.status === "stale", status: lateReceipt.status, issues: lateReceipt.issues },
    old_epoch_rejected: { passed: staleEpochRejected },
    wrong_owner_rejected: { passed: wrongOwnerRejected },
    bounded_queue_drop: { passed: queueSnapshot.droppedCount > 0, dropped_count: queueSnapshot.droppedCount },
    cancelled_tool_partial: { passed: cancelledReceipt.status === "partial" && cancelledReceipt.issues.includes("tool_not_succeeded"), status: cancelledReceipt.status, issues: cancelledReceipt.issues },
  },
  passed: Boolean(apiFinding) && !ownFinding && !unrelatedFinding && duplicateRead.status === "duplicate" && lateReceipt.status === "stale" && staleEpochRejected && wrongOwnerRejected && queueSnapshot.droppedCount > 0 && cancelledReceipt.status === "partial",
});

const coverage = sign({
  schema: "clawx.versegit.c2-observation-coverage/v1",
  generated_at: new Date().toISOString(),
  task: "TF-0529",
  driven_by: "agent",
  actor: "codex",
  source: candidate,
  windows: {
    "run-a": snapshotA,
    "run-b": snapshotB,
    queue: queueSnapshot,
  },
  declared_unobserved: {
    shell_read: "unobserved",
    shell_write: "inferred",
    mcp_read: "partial",
    mcp_write: "partial",
    network: "partial",
    browser: "partial",
    direct_fs: "unobserved",
  },
  passed: snapshotA.values.fileRead === "direct" && snapshotB.values.fileWrite === "direct" && snapshotA.values.shellRead === "unobserved" && snapshotA.values.directFs === "unobserved" && queueSnapshot.droppedCount > 0,
});

const observationLinks = sign({
  schema: "clawx.versegit.c2-observation-links/v1",
  generated_at: new Date().toISOString(),
  task: "TF-0529",
  driven_by: "agent",
  actor: "codex",
  source: candidate,
  production_caller: "embedded-agent-runner tool_result -> VerseGit tool observation derivation -> plugin-sdk observation port -> Electron Main VerseGitObservationBridge",
  bridge: {
    events_path: "raw:bridge-events.jsonl",
    observations_path: "raw:observations.jsonl",
    binding_a_events: readFileSync(bridgeEventsPath, "utf8").split(/\r?\n/u).filter(Boolean).length,
    observation_records: readFileSync(observationsPath, "utf8").split(/\r?\n/u).filter(Boolean).length,
  },
  links,
  passed: links.length >= 4 && links.every((link) => link.replay.path_recomputed && link.replay.input_digest_well_formed && link.replay.output_digest_well_formed),
});

if (!observationLinks.passed || !cases.passed || !coverage.passed) {`n  console.error(JSON.stringify({ linksPassed: observationLinks.passed, casesPassed: cases.passed, coveragePassed: coverage.passed, cases: cases.cases, linkSummaries: links.map((link) => ({ id: link.link_id, path: link.normalized_event.path, replay: link.replay })), findings: findingsBeforeDetach, snapshotA, snapshotB, queueSnapshot, apiReadReceipt, apiWriteReceipt, cancelledReceipt, lateReceipt }, null, 2));`n  throw new Error("C2 evidence generation failed");`n}
writeJson(PATHS.links, observationLinks);
writeJson(PATHS.cases, cases);
writeJson(PATHS.coverage, coverage);
const serialized = JSON.stringify([observationLinks, cases, coverage]);
if (/[A-Za-z]:[\\/]/u.test(serialized)) throw new Error("C2 evidence contains an absolute path");
console.log(`[versegit-c2] OK links=${links.length} findings=${findingsBeforeDetach.length} read=${snapshotA.values.fileRead} write=${snapshotB.values.fileWrite} dropped=${queueSnapshot.droppedCount}`);
