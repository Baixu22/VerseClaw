#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = "harness/specs/fixtures/versegit-product-integration/d1";
const PATHS = { delivery: `${OUT}/feedback-delivery.json`, transcript: `${OUT}/transcript-index.json`, nextCall: `${OUT}/next-call-binding.json`, independent: `${OUT}/independent-review.json`, sums: `${OUT}/SHA256SUMS` };
function sha(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function stable(value: unknown): unknown { if (Array.isArray(value)) return value.map(stable); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, stable((value as Record<string, unknown>)[key])])); return value; }
function digest(document: Record<string, any>): string { return sha(JSON.stringify(stable({ ...document, generated_at: undefined, digest: undefined }))); }
function readJson(path: string): Record<string, any> { return JSON.parse(readFileSync(resolve(ROOT, path), "utf8")); }
function leaks(value: unknown): number { return (JSON.stringify(value).match(/[A-Za-z]:[\\/]/gu) ?? []).length; }
function buildReview(generatedAt: string): Record<string, any> {
  const delivery = readJson(PATHS.delivery);
  const transcript = readJson(PATHS.transcript);
  const nextCall = readJson(PATHS.nextCall);
  const checks: Array<{ id: string; passed: boolean; issues: string[] }> = [];
  const deliveryIssues: string[] = [];
  if (delivery.schema !== "clawx.versegit.d1-feedback-delivery/v1") deliveryIssues.push("delivery schema mismatch");
  if (delivery.passed !== true) deliveryIssues.push("delivery evidence is not passed");
  if (delivery.digest !== digest(delivery)) deliveryIssues.push("delivery evidence digest is not reproducible");
  if (leaks(delivery) > 0) deliveryIssues.push("delivery evidence contains an absolute path");
  if (delivery.levels?.produced !== 1 || delivery.levels?.host_delivered !== 1 || delivery.levels?.transcript_confirmed !== 1) deliveryIssues.push("delivery levels are not exactly one each");
  if (delivery.tool_result?.original_content_preserved !== true || delivery.tool_result?.original_details_preserved !== true || delivery.tool_result?.is_error !== false) deliveryIssues.push("original tool-result semantics were not preserved");
  for (const key of ["duplicate_delivery_rejected", "wrong_owner_rejected", "old_epoch_rejected", "revoked_after_end_rejected", "timeout_after_ttl_rejected", "unavailable_original_preserved"]) if (delivery.negatives?.[key] !== true) deliveryIssues.push(`negative case did not pass: ${key}`);
  if (delivery.negatives?.duplicate_feedback_emitted !== false || delivery.negatives?.duplicate_observation !== "duplicate") deliveryIssues.push("duplicate feedback was not suppressed");
  checks.push({ id: "feedback-delivery", passed: deliveryIssues.length === 0, issues: deliveryIssues });

  const transcriptIssues: string[] = [];
  if (transcript.schema !== "clawx.versegit.d1-transcript-index/v1") transcriptIssues.push("transcript schema mismatch");
  if (transcript.passed !== true) transcriptIssues.push("transcript evidence is not passed");
  if (transcript.digest !== digest(transcript)) transcriptIssues.push("transcript evidence digest is not reproducible");
  if (transcript.transcript?.marker_count !== 1 || transcript.transcript?.evidence_ids?.[0] !== delivery.evidence?.evidence_id) transcriptIssues.push("transcript evidence id is missing or ambiguous");
  if (transcript.transcript?.next_call_digest !== nextCall.next_call_digest) transcriptIssues.push("next-call digest differs between transcript and binding");
  if (leaks(transcript) > 0) transcriptIssues.push("transcript evidence contains an absolute path");
  checks.push({ id: "transcript-index", passed: transcriptIssues.length === 0, issues: transcriptIssues });

  const nextIssues: string[] = [];
  if (nextCall.schema !== "clawx.versegit.d1-next-call-binding/v1") nextIssues.push("next-call schema mismatch");
  if (nextCall.passed !== true) nextIssues.push("next-call evidence is not passed");
  if (nextCall.digest !== digest(nextCall)) nextIssues.push("next-call evidence digest is not reproducible");
  if (nextCall.evidence_id !== delivery.evidence?.evidence_id || nextCall.evidence_ids_in_messages?.[0] !== delivery.evidence?.evidence_id) nextIssues.push("next-call evidence id does not match delivery");
  if (!Array.isArray(nextCall.messages) || !nextCall.messages.some((message: Record<string, any>) => String(message.text ?? "").includes(`evidence_id=${delivery.evidence?.evidence_id}`))) nextIssues.push("next-call messages do not contain the risk evidence id");
  if (leaks(nextCall) > 0) nextIssues.push("next-call evidence contains an absolute path");
  checks.push({ id: "next-call-binding", passed: nextIssues.length === 0, issues: nextIssues });

  const source = delivery.source;
  if (!transcript.source || transcript.source.commit !== source?.commit || nextCall.source?.commit !== source?.commit) checks.push({ id: "source-identity", passed: false, issues: ["evidence source identities differ"] });
  const passed = checks.every((check) => check.passed);
  return {
    schema: "clawx.versegit.d1-independent-review/v1",
    generated_at: generatedAt,
    task: "TF-0530",
    driven_by: "agent",
    actor: "codex",
    reviewer_role: "independent-d1-verifier-process",
    status: passed ? "passed" : "failed",
    checks,
    evidence_digests: Object.fromEntries([PATHS.delivery, PATHS.transcript, PATHS.nextCall].map((path) => [path, sha(readFileSync(resolve(ROOT, path)))])),
    boundaries: { real_human_evidence: false, default_off: true, m4_authorized: false, host_authority: "unchanged", external_model_provider_claimed: false },
    passed,
    digest: "",
  };
}
function sign(document: Record<string, any>): Record<string, any> { const next = { ...document }; delete next.digest; next.digest = digest(next); return next; }
function writeSums(): void { const paths = [PATHS.delivery, PATHS.transcript, PATHS.nextCall, PATHS.independent]; const body = paths.map((path) => `${sha(readFileSync(resolve(ROOT, path)))}  ${path}`).sort().join("\n"); writeFileSync(resolve(ROOT, PATHS.sums), `${body}\n`, "utf8"); }
function checkSums(): string[] { const issues: string[] = []; const expected = new Set([PATHS.delivery, PATHS.transcript, PATHS.nextCall, PATHS.independent]); const lines = readFileSync(resolve(ROOT, PATHS.sums), "utf8").trim().split(/\r?\n/u).filter(Boolean); for (const line of lines) { const match = /^([a-f0-9]{64})  (.+)$/u.exec(line); if (!match) { issues.push("malformed SHA256SUMS line"); continue; } const [, expectedDigest, path] = match; if (!expected.has(path)) { issues.push(`unexpected SHA256SUMS path: ${path}`); continue; } expected.delete(path); if (sha(readFileSync(resolve(ROOT, path))) !== expectedDigest) issues.push(`SHA256SUMS mismatch: ${path}`); } if (expected.size > 0) issues.push(`SHA256SUMS missing: ${[...expected].join(", ")}`); return issues; }
function main(): void { const checkMode = process.argv.includes("--check"); if (![PATHS.delivery, PATHS.transcript, PATHS.nextCall].every((path) => existsSync(resolve(ROOT, path)))) throw new Error("D1 evidence inputs are incomplete"); if (checkMode) { const review = readJson(PATHS.independent); const rebuilt = sign(buildReview(review.generated_at)); const issues = [...(review.digest === digest(review) ? [] : ["independent review digest is not reproducible"]), ...(rebuilt.digest === review.digest ? [] : ["independent review result drifted"]), ...checkSums()]; if (review.status !== "passed" || review.passed !== true) issues.push("independent review did not pass"); if (issues.length > 0) throw new Error(issues.join("; ")); console.log("[versegit-d1-review] CHECK OK"); return; } const review = sign(buildReview(new Date().toISOString())); writeFileSync(resolve(ROOT, PATHS.independent), `${JSON.stringify(review, null, 2)}\n`, "utf8"); writeSums(); if (review.passed !== true) throw new Error(JSON.stringify(review.checks)); console.log("[versegit-d1-review] WRITE OK"); }
try { main(); } catch (error) { console.error(`[versegit-d1-review] FAIL: ${String((error as Error)?.stack ?? error)}`); process.exitCode = 1; }
