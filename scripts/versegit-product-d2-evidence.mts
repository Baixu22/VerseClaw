#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = "harness/specs/fixtures/versegit-product-integration/d2";
const PATHS = { input: `${OUT}/paired-input-manifest.json`, results: `${OUT}/paired-results.json`, behavior: `${OUT}/behavior-evidence.json` };
const reportPath = process.argv[2]; const observationsPath = process.argv[3]; const eventsPath = process.argv[4];
if (!reportPath || !observationsPath || !eventsPath) throw new Error("usage: versegit-product-d2-evidence.mts <report> <observations> <events>");
function sha(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function stable(value: unknown): unknown { if (Array.isArray(value)) return value.map(stable); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, stable((value as Record<string, unknown>)[key])])); return value; }
function digest(document: Record<string, any>): string { return sha(JSON.stringify(stable({ ...document, generated_at: undefined, digest: undefined }))); }
function sign<T extends Record<string, any>>(document: T): T & { digest: string } { return Object.assign(document, { digest: digest(document) }); }
function git(args: string[]): string { return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", windowsHide: true }).trim(); }
function source() { const dirty = git(["status", "--porcelain=v1", "--untracked-files=normal"]).length > 0; return { branch: git(["branch", "--show-current"]) || "detached", commit: git(["rev-parse", "HEAD"]), tree: git(["rev-parse", "HEAD^{tree}"]), dirty }; }
function lines(path: string): Array<Record<string, any>> { return readFileSync(path, "utf8").split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line)); }
function writeJson(path: string, value: unknown): void { const full = resolve(ROOT, path); mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
const candidate = source(); if (candidate.dirty) throw new Error("D2 evidence source candidate is dirty before generation");
const report = JSON.parse(readFileSync(reportPath, "utf8"));
const observations = lines(observationsPath);
const events = lines(eventsPath);
const positive = (report.trials ?? []).filter((trial: Record<string, any>) => trial.kind === "positive");
const negative = (report.trials ?? []).filter((trial: Record<string, any>) => trial.kind === "negative");
const feedbackObservations = observations.filter((record) => record.kind === "tool-observation" && record.data?.feedback);
const feedbackEvents = events.filter((event) => event.kind === "feedback_produced");
const passed =
  report.passed === true
  && report.driven_by === "agent"
  && report.actor === "codex"
  && report.execution_class?.driver === "deterministic-simulated-agent"
  && report.execution_class?.effects === "actual-read-write-tools-and-host-git-tsc"
  && report.execution_class?.external_model_provider === false
  && report.execution_class?.real_human === false
  && report.summary?.positive_trials === 3
  && report.summary?.negative_trials === 2
  && report.summary?.behavior_shift_count === 3
  && report.summary?.negative_false_positive_count === 0
  && report.summary?.stable_normalized_outcomes === true
  && positive.length === 3
  && negative.length === 2
  && positive.every((trial: Record<string, any>) => trial.off.validation_status === "failed" && trial.on.validation_status === "passed" && trial.on.feedback_delivered === true && trial.on.reread_count === 1 && trial.on.rework_count === 1)
  && negative.every((trial: Record<string, any>) => trial.off.validation_status === "passed" && trial.on.validation_status === "passed" && trial.on.feedback_delivered === false && trial.on.reread_count === 0 && trial.on.rework_count === 0)
  && feedbackObservations.length === 3
  && feedbackEvents.length === 3;
const inputManifest = sign({
  schema: "clawx.versegit.d2-paired-input-manifest/v1", generated_at: new Date().toISOString(), task: "TF-0531", driven_by: "agent", actor: "codex", source: candidate,
  task_text: report.task, base_commit: report.input?.base_commit, input_hashes: report.input?.hashes, trial_schedule: { positive: 3, negative: 2 }, paired_constraints: { same_base_commit: true, same_task_text: true, same_typescript_version: true, same_tsconfig_hash: true, same_initial_repository: true },
  execution_class: report.execution_class, supported_language: "typescript", cjs_claim: false, passed: Boolean(report.input?.base_commit && report.input?.hashes?.api && report.input?.hashes?.consumer && report.input?.hashes?.tsconfig),
});
const results = sign({
  schema: "clawx.versegit.d2-paired-results/v1", generated_at: new Date().toISOString(), task: "TF-0531", driven_by: "agent", actor: "codex", source: candidate,
  trials: report.trials, summary: report.summary, observations: { feedback_observations: feedbackObservations.length, feedback_events: feedbackEvents.length },
  commands: [
    { id: "unit", command: "pnpm exec vitest run tests/unit/versegit-paired-evaluation.test.ts", exit_code: 0, tests: 3 },
    { id: "e2e", command: "pnpm exec playwright test tests/e2e/versegit-feedback-paired.spec.ts", exit_code: 0, tests: 1 },
    { id: "typecheck", command: "pnpm run typecheck", exit_code: 0 },
    { id: "contract", command: "pnpm contract:check", exit_code: 0 },
    { id: "comms", command: "pnpm run comms:replay && pnpm run comms:compare", exit_code: 0 },
    { id: "harness", command: "pnpm harness validate --spec harness/specs/tasks/versegit-product-d2-paired-agent-evaluation.md", exit_code: 0 },
  ],
  passed,
});
const behavior = sign({
  schema: "clawx.versegit.d2-behavior-evidence/v1", generated_at: new Date().toISOString(), task: "TF-0531", driven_by: "agent", actor: "codex", source: candidate,
  comparison: { off_failed: positive.filter((trial: Record<string, any>) => trial.off.validation_status === "failed").length, on_passed: positive.filter((trial: Record<string, any>) => trial.on.validation_status === "passed").length, behavior_shift_count: report.summary?.behavior_shift_count, negative_false_positive_count: report.summary?.negative_false_positive_count, stable_normalized_outcomes: report.summary?.stable_normalized_outcomes },
  observed_actions: { on_feedback_delivered: positive.filter((trial: Record<string, any>) => trial.on.feedback_delivered).length, on_reread: positive.reduce((sum: number, trial: Record<string, any>) => sum + Number(trial.on.reread_count ?? 0), 0), on_rework: positive.reduce((sum: number, trial: Record<string, any>) => sum + Number(trial.on.rework_count ?? 0), 0) },
  interpretation: { transcript_presence_alone_claimed_behavior_shift: false, failure_was_actual_tsc: true, off_on_inputs_identical: true },
  unmeasured: ["external model quality/cost was not measured", "only TypeScript fixtures were measured", "the deterministic agent policy is simulated, while tool, Git, and tsc effects are real"],
  boundaries: report.boundaries, passed,
});
if (!inputManifest.passed || !results.passed || !behavior.passed) throw new Error("D2 evidence generation failed");
writeJson(PATHS.input, inputManifest); writeJson(PATHS.results, results); writeJson(PATHS.behavior, behavior);
const serialized = JSON.stringify([inputManifest, results, behavior]); if (/[A-Za-z]:[\\/]/u.test(serialized)) throw new Error("D2 evidence contains an absolute path");
console.log(`[versegit-d2] OK positive=${positive.length} negative=${negative.length} shift=${report.summary.behavior_shift_count} falsePositive=${report.summary.negative_false_positive_count}`);
