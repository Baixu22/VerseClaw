#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { ExtensionContext } from "../openclaw_runtime/src/agents/sessions/extensions/types";
import { createReadToolDefinition } from "../openclaw_runtime/src/agents/sessions/tools/read";
import { createWriteToolDefinition } from "../openclaw_runtime/src/agents/sessions/tools/write";
import { deriveVerseGitToolObservationRequest } from "../openclaw_runtime/src/agents/harness/versegit-tool-observation";
import { enrichToolResultWithVerseGitFeedback } from "../openclaw_runtime/src/agents/harness/versegit-feedback-delivery";
import { extractVerseGitFeedbackMarkers } from "../openclaw_runtime/src/agents/harness/versegit-feedback-marker";
import { guardSessionManager } from "../openclaw_runtime/src/agents/session-tool-result-guard-wrapper";
import { SessionManager } from "../openclaw_runtime/src/agents/sessions/session-manager";
import { createVerseGitRuntimeBindingPortFromEnv } from "../openclaw_runtime/src/plugin-sdk/versegit-binding-port";
import { createVerseGitRuntimeObservationPortFromEnv } from "../openclaw_runtime/src/plugin-sdk/versegit-observation-port";

const repoRoot = process.env.VERSEGIT_D1_REPO_ROOT!;
const reportPath = process.env.VERSEGIT_D1_REPORT_PATH!;
const observationsPath = process.env.CLAWX_VERSGIT_OBSERVATION_EVENTS_PATH!;
const bindingPort = createVerseGitRuntimeBindingPortFromEnv(process.env);
const observationPort = createVerseGitRuntimeObservationPortFromEnv(process.env);
if (!bindingPort || !observationPort) throw new Error("runtime VerseGit ports are unavailable");
function git(args: string[], cwd = repoRoot): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
}
function toolEvent(cwd: string, toolCallId: string, toolName: "read" | "write", args: Record<string, unknown>, result: { content: unknown[]; details?: unknown }) {
  return { toolCallId, toolName, args, cwd, isError: false, result: result as never };
}
async function bind(runId: string, worktreePath: string) {
  const bound = await bindingPort.bind({ requestId: `request-${runId}`, runId, traceId: `trace-${runId}`, worktreePath, agentSessionId: `agent-session-${runId}`, mode: "M1" });
  return await bindingPort.attach({ bindingId: bound.bindingId, childSessionKey: `session-${runId}`, childRunId: runId });
}

const worktreeA = join(repoRoot, "wt-a");
const worktreeB = join(repoRoot, "wt-b");
git(["worktree", "add", "--detach", worktreeA, "HEAD"]);
git(["worktree", "add", "--detach", worktreeB, "HEAD"]);
mkdirSync(join(worktreeA, "src"), { recursive: true });
mkdirSync(join(worktreeB, "src"), { recursive: true });
const source = "export type User = { id: string; name: string };\nexport const readUser = (id: string, name: string): User => ({ id, name });\n";
writeFileSync(join(worktreeA, "src", "api.ts"), source, "utf8");
writeFileSync(join(worktreeB, "src", "api.ts"), source, "utf8");

const reader = await bind("run-reader", worktreeA);
const writer = await bind("run-writer", worktreeB);
const readResult = await createReadToolDefinition(worktreeA).execute("read-api", { path: "src/api.ts", limit: 2 }, undefined, undefined, {} as ExtensionContext);
const readRequest = deriveVerseGitToolObservationRequest({ event: toolEvent(worktreeA, "read-api", "read", { path: "src/api.ts", limit: 2 }, readResult), binding: reader, cwd: worktreeA });
await observationPort.observe(readRequest);
const writeResult = await createWriteToolDefinition(worktreeB).execute("write-api", { path: "src/api.ts", content: "export type User = { id: string };\nexport const readUser = (id: string): User => ({ id });\n" }, undefined, undefined, {} as ExtensionContext);
const writeRequest = deriveVerseGitToolObservationRequest({ event: toolEvent(worktreeB, "write-api", "write", { path: "src/api.ts" }, writeResult), binding: writer, cwd: worktreeB });
const produced = await observationPort.observe(writeRequest);
if (!produced.feedback) throw new Error("feedback was not produced");
const feedback = produced.feedback;

const wrongOwner = createVerseGitRuntimeObservationPortFromEnv({ ...process.env, CLAWX_VERSGIT_OWNER_ID: "agent:other" })!;
let wrongOwnerRejected = false;
try { await wrongOwner.reportDelivery({ bindingId: writer.bindingId, childRunId: writer.childRunId!, toolCallId: "write-api", evidenceId: feedback.evidenceId, level: "host-delivered", observedAt: new Date().toISOString() }); } catch (error) { wrongOwnerRejected = (error as { code?: string }).code === "FEEDBACK_DELIVERY_REJECTED"; }
const oldEpoch = createVerseGitRuntimeObservationPortFromEnv({ ...process.env, CLAWX_VERSGIT_EPOCH: "3" })!;
let oldEpochRejected = false;
try { await oldEpoch.reportDelivery({ bindingId: writer.bindingId, childRunId: writer.childRunId!, toolCallId: "write-api", evidenceId: feedback.evidenceId, level: "host-delivered", observedAt: new Date().toISOString() }); } catch (error) { oldEpochRejected = (error as { code?: string }).code === "FEEDBACK_DELIVERY_REJECTED"; }

const enriched = await enrichToolResultWithVerseGitFeedback({
  result: { content: writeResult.content, details: writeResult.details } as never,
  observe: async () => produced,
  reportDelivery: (delivery) => observationPort.reportDelivery({ bindingId: writer.bindingId, childRunId: writer.childRunId!, toolCallId: "write-api", evidenceId: delivery.evidenceId, level: "host-delivered", observedAt: new Date().toISOString() }),
});
let duplicateDeliveryRejected = false;
try { await observationPort.reportDelivery({ bindingId: writer.bindingId, childRunId: writer.childRunId!, toolCallId: "write-api", evidenceId: feedback.evidenceId, level: "host-delivered", observedAt: new Date().toISOString() }); } catch (error) { duplicateDeliveryRejected = (error as { code?: string }).code === "FEEDBACK_DELIVERY_REJECTED"; }

const sessionDir = join(repoRoot, "sessions");
const manager = SessionManager.create(worktreeB, sessionDir);
guardSessionManager(manager, { agentId: "agent", sessionKey: "session-run-writer" });
manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "Starting write" }], timestamp: Date.now() } as never);
manager.appendMessage({ role: "toolResult", toolCallId: "write-api", toolName: "write", isError: false, content: enriched.result.content, timestamp: Date.now() });
const transcriptPath = manager.getSessionFile()!;
const transcript = readFileSync(transcriptPath, "utf8");
const nextCallMessages = manager.buildSessionContext().messages;
const nextCallText = nextCallMessages
  .flatMap((message) => "content" in message && Array.isArray(message.content)
    ? message.content.filter((entry): entry is { type: "text"; text: string } => entry.type === "text").map((entry) => entry.text)
    : [])
  .join("\n");
let transcriptConfirmed = false;
for (let attempt = 0; attempt < 100; attempt += 1) {
  const records = readFileSync(observationsPath, "utf8").trim().split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
  transcriptConfirmed = records.some((record) => record.kind === "feedback-delivery" && record.data.level === "transcript-confirmed" && record.data.evidenceId === feedback.evidenceId && record.data.accepted);
  if (transcriptConfirmed) break;
  await delay(20);
}

const duplicateObservation = await observationPort.observe(writeRequest);
const original = { content: [{ type: "text" as const, text: "Original success" }], details: { status: "ok" } };
const fallback = await enrichToolResultWithVerseGitFeedback({ result: original, observe: async () => { throw new Error("VG unavailable"); }, reportDelivery: async () => undefined });
let lateAfterEndRejected = false;
await bindingPort.end({ bindingId: writer.bindingId, reason: "completed" });
try { await observationPort.reportDelivery({ bindingId: writer.bindingId, childRunId: writer.childRunId!, toolCallId: "write-api", evidenceId: feedback.evidenceId, level: "transcript-confirmed", observedAt: new Date().toISOString() }); } catch (error) { lateAfterEndRejected = (error as { code?: string }).code === "FEEDBACK_DELIVERY_REJECTED"; }

const markers = extractVerseGitFeedbackMarkers({ content: enriched.result.content });
const markerInTranscript = transcript.includes(`evidence_id=${feedback.evidenceId}`);
const markerInNextCall = nextCallText.includes(`evidence_id=${feedback.evidenceId}`);
const originalContent = JSON.stringify(writeResult.content);
const enrichedPrefix = JSON.stringify(enriched.result.content.slice(0, writeResult.content.length));
const originalDetails = writeResult.details && typeof writeResult.details === "object" ? writeResult.details as Record<string, unknown> : {};
const enrichedDetails = enriched.result.details && typeof enriched.result.details === "object" ? enriched.result.details as Record<string, unknown> : {};
const originalDetailsPreserved = Object.entries(originalDetails).every(([key, value]) => JSON.stringify(enrichedDetails[key]) === JSON.stringify(value));
const originalToolResultPreserved = fallback.appended === false && JSON.stringify(fallback.result) === JSON.stringify(original);
const passed = Boolean(
  feedback.evidenceId
  && feedback.coverage === "direct"
  && feedback.candidateId === null
  && markers.length === 1
  && enriched.appended
  && enriched.error === null
  && originalContent === enrichedPrefix
  && originalDetailsPreserved
  && markerInTranscript
  && markerInNextCall
  && transcriptConfirmed
  && duplicateObservation.status === "duplicate"
  && duplicateObservation.feedback === undefined
  && duplicateDeliveryRejected
  && wrongOwnerRejected
  && oldEpochRejected
  && lateAfterEndRejected
  && originalToolResultPreserved
);
const report = {
  schema: "clawx.versegit.d1-runtime-probe/v1",
  generated_at: new Date().toISOString(),
  driven_by: "agent",
  actor: "codex",
  tool_result: {
    original_content_blocks: writeResult.content.length,
    enriched_content_blocks: enriched.result.content.length,
    original_content_preserved: originalContent === enrichedPrefix,
    original_details_preserved: originalDetailsPreserved,
    is_error: false,
  },
  delivery: {
    evidence_id: feedback.evidenceId,
    coverage: feedback.coverage,
    basis_digest: feedback.basisDigest,
    candidate_id: feedback.candidateId,
    produced: true,
    host_delivered: enriched.appended && enriched.error === null,
    transcript_confirmed: transcriptConfirmed,
    produced_count: 1,
    host_delivered_count: 1,
    transcript_confirmed_count: transcriptConfirmed ? 1 : 0,
  },
  transcript: {
    relative_path: relative(repoRoot, transcriptPath).replaceAll("\\", "/"),
    marker_in_transcript: markerInTranscript,
    marker_in_next_call: markerInNextCall,
    next_call_message_count: nextCallMessages.length,
    next_call_text_sha256: createHash("sha256").update(nextCallText).digest("hex"),
  },
  negatives: {
    duplicate_observation: duplicateObservation.status,
    duplicate_feedback_emitted: Boolean(duplicateObservation.feedback),
    duplicate_delivery_rejected: duplicateDeliveryRejected,
    wrong_owner_rejected: wrongOwnerRejected,
    old_epoch_rejected: oldEpochRejected,
    late_after_end_rejected: lateAfterEndRejected,
    unavailable_original_preserved: originalToolResultPreserved,
  },
  boundaries: {
    external_model_provider_claimed: false,
    new_agent_loop: false,
    new_steering_bus: false,
    host_verdict: "unchanged",
    m4_authorized: false,
  },
  passed,
};
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report)}\n`);
if (!passed) process.exitCode = 1;
