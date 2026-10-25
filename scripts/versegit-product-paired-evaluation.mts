#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionContext } from "../openclaw_runtime/src/agents/sessions/extensions/types";
import { createReadToolDefinition } from "../openclaw_runtime/src/agents/sessions/tools/read";
import { createWriteToolDefinition } from "../openclaw_runtime/src/agents/sessions/tools/write";
import { deriveVerseGitToolObservationRequest } from "../openclaw_runtime/src/agents/harness/versegit-tool-observation";
import { enrichToolResultWithVerseGitFeedback } from "../openclaw_runtime/src/agents/harness/versegit-feedback-delivery";
import { createVerseGitRuntimeBindingPortFromEnv } from "../openclaw_runtime/src/plugin-sdk/versegit-binding-port";
import { createVerseGitRuntimeObservationPortFromEnv } from "../openclaw_runtime/src/plugin-sdk/versegit-observation-port";
import { isMainEntrypoint } from "./lib/entrypoint.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TASK = "Update the API consumer in the same change while preserving the current contract.";
const BASE_API = "export type User = { id: string; name: string };\nexport function readUser(id: string, name: string): User {\n  return { id, name };\n}\n";
const BROKEN_API = "export type User = { id: string };\nexport function readUser(id: string): User {\n  return { id };\n}\n";
const BASE_CONSUMER = "import { readUser } from './api.js';\nconst user = readUser('1', 'Ada');\nconsole.log(user.id);\n";
const FIXED_CONSUMER = "import { readUser } from './api.js';\nconst user = readUser('1');\nconsole.log(user.id);\n";

export type PairedArm = {
  arm: "off" | "on";
  feedback_delivered: boolean;
  feedback_evidence_id: string | null;
  reread_count: number;
  rework_count: number;
  validation_exit_code: number;
  validation_status: "passed" | "failed";
  validation_output_sha256: string;
};

export type PairedTrial = {
  kind: "positive" | "negative";
  trial: number;
  off: PairedArm;
  on: PairedArm;
};

export function normalizeArm(arm: PairedArm): Record<string, unknown> {
  return {
    arm: arm.arm,
    feedback_delivered: arm.feedback_delivered,
    reread_count: arm.reread_count,
    rework_count: arm.rework_count,
    validation_status: arm.validation_status,
  };
}
export function normalizeTrial(trial: PairedTrial): Record<string, unknown> {
  return { kind: trial.kind, off: normalizeArm(trial.off), on: normalizeArm(trial.on) };
}
export function summarizeTrials(trials: PairedTrial[]) {
  const positive = trials.filter((trial) => trial.kind === "positive");
  const negative = trials.filter((trial) => trial.kind === "negative");
  const stable = (kind: "positive" | "negative", arm: "off" | "on") => {
    const values = trials.filter((trial) => trial.kind === kind).map((trial) => JSON.stringify(normalizeTrial({ ...trial, off: trial.off, on: trial.on }))).length > 0
      && new Set(trials.filter((trial) => trial.kind === kind).map((trial) => JSON.stringify(normalizeTrial(trial)))).size === 1;
    return values;
  };
  const behaviorShiftCount = positive.filter((trial) => trial.off.validation_status === "failed" && trial.on.validation_status === "passed" && trial.on.reread_count > 0 && trial.on.rework_count > 0 && trial.on.feedback_delivered).length;
  const falsePositives = negative.filter((trial) => trial.on.feedback_delivered || trial.on.reread_count > 0 || trial.on.rework_count > 0 || trial.on.validation_status !== "passed").length;
  return {
    positive_trials: positive.length,
    negative_trials: negative.length,
    positive_off_fail_count: positive.filter((trial) => trial.off.validation_status === "failed").length,
    positive_on_pass_count: positive.filter((trial) => trial.on.validation_status === "passed").length,
    behavior_shift_count: behaviorShiftCount,
    negative_false_positive_count: falsePositives,
    stable_normalized_outcomes: stable("positive", "off") && stable("positive", "on") && stable("negative", "off") && stable("negative", "on"),
    passed: positive.length >= 1 && negative.length >= 1 && behaviorShiftCount === positive.length && falsePositives === 0 && stable("positive", "off") && stable("positive", "on") && stable("negative", "off") && stable("negative", "on"),
  };
}
function sha(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function git(cwd: string, args: string[]): string { return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim(); }
function toolEvent(cwd: string, toolCallId: string, toolName: "read" | "write", args: Record<string, unknown>, result: { content: unknown[]; details?: unknown }) {
  return { toolCallId, toolName, args, cwd, isError: false, result: result as never };
}
function validation(cwd: string): { status: "passed" | "failed"; code: number; outputSha256: string } {
  const result = spawnSync(process.execPath, [join(ROOT, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json", "--pretty", "false"], { cwd, encoding: "utf8", windowsHide: true, timeout: 30_000 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return { status: result.status === 0 ? "passed" : "failed", code: result.status ?? -1, outputSha256: sha(output) };
}

export async function runPairedEvaluation(): Promise<Record<string, any>> {
  const repoRoot = process.env.VERSEGIT_D2_REPO_ROOT!;
  const reportPath = process.env.VERSEGIT_D2_REPORT_PATH!;
  const bindingPort = createVerseGitRuntimeBindingPortFromEnv(process.env);
  const observationPort = createVerseGitRuntimeObservationPortFromEnv(process.env);
  if (!bindingPort || !observationPort) throw new Error("D2 requires the host-injected VerseGit ports");
  const hostBindingPort = bindingPort;
  const hostObservationPort = observationPort;
  const tempRoot = mkdtempSync(join(tmpdir(), "versegit-d2-paired-"));
  git(repoRoot, ["init", "--initial-branch=main"]);
  git(repoRoot, ["config", "user.email", "agent@example.invalid"]);
  git(repoRoot, ["config", "user.name", "Agent"]);
  mkdirSync(join(repoRoot, "src"), { recursive: true });
  writeFileSync(join(repoRoot, "src", "api.ts"), BASE_API, "utf8");
  writeFileSync(join(repoRoot, "src", "consumer.ts"), BASE_CONSUMER, "utf8");
  writeFileSync(join(repoRoot, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext" }, include: ["src/**/*.ts"] }, null, 2), "utf8");
  git(repoRoot, ["add", "."]);
  git(repoRoot, ["commit", "-m", "paired-base"]);
  const baseCommit = git(repoRoot, ["rev-parse", "HEAD"]);
  const inputHashes = {
    api: sha(BASE_API),
    consumer: sha(BASE_CONSUMER),
    task: sha(TASK),
    tsconfig: sha(readFileSync(join(repoRoot, "tsconfig.json"))),
    base_commit: baseCommit,
  };

  async function bind(runId: string, worktreePath: string, agentSessionId: string) {
    const bound = await hostBindingPort.bind({ requestId: `request-${runId}`, runId, traceId: `trace-${runId}`, worktreePath, agentSessionId, mode: "M1" });
    return await hostBindingPort.attach({ bindingId: bound.bindingId, childSessionKey: `session-${runId}`, childRunId: runId });
  }
  async function read(binding: Record<string, any>, cwd: string, path: string, callId: string, observe: boolean) {
    const result = await createReadToolDefinition(cwd).execute(callId, { path }, undefined, undefined, {} as ExtensionContext);
    if (observe) {
      const request = deriveVerseGitToolObservationRequest({ event: toolEvent(cwd, callId, "read", { path }, result), binding: binding as never, cwd });
      await hostObservationPort.observe(request);
    }
    return result;
  }
  async function write(binding: Record<string, any>, cwd: string, path: string, content: string, callId: string, observe: boolean) {
    const result = await createWriteToolDefinition(cwd).execute(callId, { path, content }, undefined, undefined, {} as ExtensionContext);
    let feedback = null as null | Record<string, any>;
    let delivered = false;
    if (observe) {
      const request = deriveVerseGitToolObservationRequest({ event: toolEvent(cwd, callId, "write", { path }, result), binding: binding as never, cwd });
      const enrichment = await enrichToolResultWithVerseGitFeedback({
        result: { content: result.content, details: result.details } as never,
        observe: () => hostObservationPort.observe(request),
        reportDelivery: (item) => hostObservationPort.reportDelivery({ bindingId: binding.bindingId, childRunId: binding.childRunId!, toolCallId: callId, evidenceId: item.evidenceId, level: "host-delivered", observedAt: new Date().toISOString() }),
      });
      feedback = enrichment.feedback as unknown as Record<string, any> | null;
      delivered = enrichment.appended && enrichment.error === null;
    }
    return { result, feedback, delivered };
  }

  const trials: PairedTrial[] = [];
  async function runArm(kind: "positive" | "negative", trial: number, arm: "off" | "on"): Promise<PairedArm> {
    const worktreePath = join(tempRoot, `${kind}-${trial}-${arm}`);
    git(repoRoot, ["worktree", "add", "--detach", worktreePath, baseCommit]);
    const suffix = `${kind}-${trial}-${arm}`;
    const reader = await bind(`reader-${suffix}`, worktreePath, `reader-session-${suffix}`);
    const producer = await bind(`producer-${suffix}`, worktreePath, `producer-session-${suffix}`);
    try {
      await read(reader, worktreePath, "src/api.ts", `baseline-read-${suffix}`, arm === "on");
      const change = kind === "positive"
        ? { path: "src/api.ts", content: BROKEN_API, callId: `break-api-${suffix}` }
        : { path: "src/unrelated.ts", content: "export const unrelated = 1;\n", callId: `write-unrelated-${suffix}` };
      const producerWrite = await write(producer, worktreePath, change.path, change.content, change.callId, arm === "on");
      let rereadCount = 0;
      let reworkCount = 0;
      if (arm === "on" && producerWrite.delivered && producerWrite.feedback) {
        await read(producer, worktreePath, "src/api.ts", `reread-api-${suffix}`, true);
        rereadCount += 1;
        await write(producer, worktreePath, "src/consumer.ts", FIXED_CONSUMER, `repair-consumer-${suffix}`, true);
        reworkCount += 1;
      }
      const checked = validation(worktreePath);
      return {
        arm,
        feedback_delivered: producerWrite.delivered,
        feedback_evidence_id: producerWrite.feedback?.evidenceId ?? null,
        reread_count: rereadCount,
        rework_count: reworkCount,
        validation_exit_code: checked.code,
        validation_status: checked.status,
        validation_output_sha256: checked.outputSha256,
      };
    } finally {
      await hostBindingPort.end({ bindingId: reader.bindingId, reason: "completed" });
      await hostBindingPort.end({ bindingId: producer.bindingId, reason: "completed" });
    }
  }

  for (let trial = 1; trial <= 3; trial += 1) trials.push({ kind: "positive", trial, off: await runArm("positive", trial, "off"), on: await runArm("positive", trial, "on") });
  for (let trial = 1; trial <= 2; trial += 1) trials.push({ kind: "negative", trial, off: await runArm("negative", trial, "off"), on: await runArm("negative", trial, "on") });
  const summary = summarizeTrials(trials);
  const report = {
    schema: "clawx.versegit.d2-paired-evaluation/v1",
    generated_at: new Date().toISOString(),
    driven_by: "agent",
    actor: "codex",
    execution_class: { driver: "deterministic-simulated-agent", effects: "actual-read-write-tools-and-host-git-tsc", external_model_provider: false, real_human: false },
    task: TASK,
    input: { base_commit: baseCommit, hashes: inputHashes },
    trials,
    summary,
    boundaries: { supported_language_only: "typescript", cjs_claim: false, transcript_presence_is_behavior_shift: false, cost_measured: false, external_model_quality_measured: false, host_verdict: "unchanged", m4_authorized: false },
  };
  writeFileSync(reportPath, `${JSON.stringify({ ...report, passed: summary.passed }, null, 2)}\n`, "utf8");
  if (!summary.passed) throw new Error("paired evaluation failed");
  return { ...report, passed: summary.passed };
}

if (isMainEntrypoint(import.meta.url)) {
  runPairedEvaluation().then((report) => process.stdout.write(`${JSON.stringify({ passed: report.passed, trials: report.trials.length, summary: report.summary })}\n`)).catch((error) => { console.error(String((error as Error)?.stack ?? error)); process.exitCode = 1; });
}
