#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = "harness/specs/fixtures/versegit-product-integration/d1";
const PATHS = {
  delivery: `${OUT}/feedback-delivery.json`,
  transcript: `${OUT}/transcript-index.json`,
  nextCall: `${OUT}/next-call-binding.json`,
};
const reportPath = process.argv[2];
const transcriptPath = process.argv[3];
const observationsPath = process.argv[4];
const eventsPath = process.argv[5];
if (!reportPath || !transcriptPath || !observationsPath || !eventsPath) throw new Error("usage: versegit-product-d1-evidence.mts <report> <transcript> <observations> <events>");
function sha(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, stable((value as Record<string, unknown>)[key])]));
  return value;
}
function digest(document: Record<string, any>): string { return sha(JSON.stringify(stable({ ...document, generated_at: undefined, digest: undefined }))); }
function sign<T extends Record<string, any>>(document: T): T & { digest: string } { return Object.assign(document, { digest: digest(document) }); }
function git(args: string[]): string { return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", windowsHide: true }).trim(); }
function source() {
  const dirty = git(["status", "--porcelain=v1", "--untracked-files=normal"]).length > 0;
  return { branch: git(["branch", "--show-current"]) || "detached", commit: git(["rev-parse", "HEAD"]), tree: git(["rev-parse", "HEAD^{tree}"]), dirty };
}
function jsonLines(path: string): Array<Record<string, any>> {
  return readFileSync(path, "utf8").split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
}
function writeJson(path: string, value: unknown): void {
  const full = resolve(ROOT, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
function textContent(message: Record<string, any>): string {
  return Array.isArray(message.content)
    ? message.content.flatMap((entry: Record<string, any>) => entry?.type === "text" ? [String(entry.text ?? "")] : []).join("\n")
    : "";
}

const candidate = source();
if (candidate.dirty) throw new Error("D1 evidence source candidate is dirty before generation");
const report = JSON.parse(readFileSync(reportPath, "utf8"));
const observations = jsonLines(observationsPath);
const bridgeEvents = jsonLines(eventsPath);
const transcriptEntries = jsonLines(transcriptPath);
const nextCallMessages = transcriptEntries.filter((entry) => entry.type === "message").map((entry) => entry.message);
const nextCallDigest = `sha256:${sha(JSON.stringify(stable(nextCallMessages)))}`;
const evidenceId = report.delivery?.evidence_id as string;
const transcriptText = readFileSync(transcriptPath, "utf8");
const nextCallText = nextCallMessages.map(textContent).join("\n");
const deliveryRecords = observations.filter((record) => record.kind === "feedback-delivery" && record.data?.evidenceId === evidenceId);
const producedRecords = observations.filter((record) => record.kind === "tool-observation" && record.data?.feedback?.evidenceId === evidenceId);
const hostRecords = deliveryRecords.filter((record) => record.data.level === "host-delivered" && record.data.accepted === true);
const confirmedRecords = deliveryRecords.filter((record) => record.data.level === "transcript-confirmed" && record.data.accepted === true);
const markerCount = (transcriptText.match(new RegExp(`evidence_id=${evidenceId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "gu")) ?? []).length;
const nextCallMarkerCount = (nextCallText.match(new RegExp(`evidence_id=${evidenceId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "gu")) ?? []).length;
const feedbackEvents = bridgeEvents.filter((event) => ["feedback_produced", "feedback_delivered", "feedback_confirmed"].includes(event.kind) && event.evidenceId === evidenceId);
const rejectedEvents = bridgeEvents.filter((event) => event.kind === "feedback_rejected");
const sourceMessage = nextCallMessages.find((message: Record<string, any>) => message.role === "toolResult" && textContent(message).includes(`evidence_id=${evidenceId}`));
const originalToolResultPreserved = report.tool_result?.original_content_preserved === true && report.tool_result?.original_details_preserved === true && report.tool_result?.is_error === false;
const negatives = report.negatives ?? {};
const passed =
  report.passed === true
  && report.driven_by === "agent"
  && report.actor === "codex"
  && report.delivery?.coverage === "direct"
  && report.delivery?.candidate_id === null
  && producedRecords.length === 1
  && hostRecords.length === 1
  && confirmedRecords.length === 1
  && feedbackEvents.filter((event) => event.kind === "feedback_produced").length === 1
  && feedbackEvents.filter((event) => event.kind === "feedback_delivered").length === 1
  && feedbackEvents.filter((event) => event.kind === "feedback_confirmed").length === 1
  && rejectedEvents.some((event) => event.evidenceId === evidenceId)
  && markerCount === 1
  && nextCallMarkerCount === 1
  && originalToolResultPreserved
  && negatives.duplicate_observation === "duplicate"
  && negatives.duplicate_feedback_emitted === false
  && negatives.duplicate_delivery_rejected === true
  && negatives.wrong_owner_rejected === true
  && negatives.old_epoch_rejected === true
  && negatives.late_after_end_rejected === true
  && negatives.unavailable_original_preserved === true;
const delivery = sign({
  schema: "clawx.versegit.d1-feedback-delivery/v1",
  generated_at: new Date().toISOString(),
  task: "TF-0530",
  driven_by: "agent",
  actor: "codex",
  source: candidate,
  evidence: {
    evidence_id: evidenceId,
    coverage: report.delivery.coverage,
    basis_digest: report.delivery.basis_digest,
    candidate_id: report.delivery.candidate_id,
  },
  tool_result: report.tool_result,
  levels: {
    produced: producedRecords.length,
    host_delivered: hostRecords.length,
    transcript_confirmed: confirmedRecords.length,
    distinct_evidence_ids: new Set(deliveryRecords.map((record) => record.data.evidenceId)).size,
  },
  bridge_events: feedbackEvents.map((event) => ({ kind: event.kind, at: event.at, evidenceId: event.evidenceId, level: event.level ?? null })),
  negatives,
  passed,
});
const transcriptIndex = sign({
  schema: "clawx.versegit.d1-transcript-index/v1",
  generated_at: new Date().toISOString(),
  task: "TF-0530",
  driven_by: "agent",
  actor: "codex",
  source: candidate,
  transcript: {
    relative_path: report.transcript.relative_path,
    entries: transcriptEntries.length,
    messages: nextCallMessages.length,
    roles: nextCallMessages.map((message: Record<string, any>) => message.role),
    marker_count: markerCount,
    evidence_ids: markerCount > 0 ? [evidenceId] : [],
    next_call_digest: nextCallDigest,
  },
  passed: markerCount === 1 && report.transcript?.marker_in_transcript === true,
});
const nextCallBinding = sign({
  schema: "clawx.versegit.d1-next-call-binding/v1",
  generated_at: new Date().toISOString(),
  task: "TF-0530",
  driven_by: "agent",
  actor: "codex",
  source: candidate,
  evidence_id: evidenceId,
  message_count: nextCallMessages.length,
  messages: nextCallMessages.map((message: Record<string, any>) => ({ role: message.role, text: textContent(message), toolName: message.toolName ?? null, isError: message.isError === true })),
  evidence_ids_in_messages: nextCallMarkerCount > 0 ? [evidenceId] : [],
  next_call_digest: nextCallDigest,
  passed: nextCallMarkerCount === 1 && originalToolResultPreserved && Boolean(sourceMessage),
});
if (!delivery.passed || !transcriptIndex.passed || !nextCallBinding.passed) throw new Error("D1 evidence generation failed");
writeJson(PATHS.delivery, delivery);
writeJson(PATHS.transcript, transcriptIndex);
writeJson(PATHS.nextCall, nextCallBinding);
const serialized = JSON.stringify([delivery, transcriptIndex, nextCallBinding]);
if (/[A-Za-z]:[\\/]/u.test(serialized)) throw new Error("D1 evidence contains an absolute path");
console.log(`[versegit-d1] OK evidence=${evidenceId} produced=${producedRecords.length} delivered=${hostRecords.length} confirmed=${confirmedRecords.length} messages=${nextCallMessages.length}`);
