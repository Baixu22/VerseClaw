import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionContext } from "../../openclaw_runtime/src/agents/sessions/extensions/types";
import { createReadToolDefinition } from "../../openclaw_runtime/src/agents/sessions/tools/read";
import { createWriteToolDefinition } from "../../openclaw_runtime/src/agents/sessions/tools/write";
import { deriveVerseGitToolObservationRequest } from "../../openclaw_runtime/src/agents/harness/versegit-tool-observation";
import { enrichToolResultWithVerseGitFeedback } from "../../openclaw_runtime/src/agents/harness/versegit-feedback-delivery";
import { extractVerseGitFeedbackMarkers } from "../../openclaw_runtime/src/agents/harness/versegit-feedback-marker";
import { guardSessionManager } from "../../openclaw_runtime/src/agents/session-tool-result-guard-wrapper";
import { SessionManager } from "../../openclaw_runtime/src/agents/sessions/session-manager";
import { createVerseGitRuntimeBindingPortFromEnv } from "../../openclaw_runtime/src/plugin-sdk/versegit-binding-port";
import { createVerseGitRuntimeObservationPortFromEnv } from "../../openclaw_runtime/src/plugin-sdk/versegit-observation-port";
import { VerseGitBindingBridge } from "../../electron/gateway/versegit-bridge";
import { VerseGitObservationBridge } from "../../electron/services/versegit-observation";

const roots: string[] = [];
const bridges: Array<{ stop: () => Promise<void> }> = [];
const originalEnv = { ...process.env };
afterEach(async () => {
  process.env = { ...originalEnv };
  while (bridges.length) await bridges.pop()!.stop();
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
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
async function fixture(feedbackTtlMs?: number) {
  const root = await mkdtemp(join(tmpdir(), "versegit-d1-"));
  roots.push(root);
  const repo = join(root, "repo");
  const a = join(repo, "wt-a");
  const b = join(repo, "wt-b");
  await mkdir(repo, { recursive: true });
  git(repo, ["init", "--initial-branch=main"]);
  git(repo, ["config", "user.email", "agent@example.invalid"]);
  git(repo, ["config", "user.name", "Agent"]);
  await writeFile(join(repo, "base.txt"), "base\n", "utf8");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "base"]);
  for (const worktree of [a, b]) git(repo, ["worktree", "add", "--detach", worktree, "HEAD"]);
  await mkdir(join(a, "src"), { recursive: true });
  await mkdir(join(b, "src"), { recursive: true });
  const source = "export type User = { id: string; name: string };\nexport const readUser = (id: string, name: string): User => ({ id, name });\n";
  await writeFile(join(a, "src", "api.ts"), source, "utf8");
  await writeFile(join(b, "src", "api.ts"), source, "utf8");

  const port = await freePort();
  const token = `d1-${port}`;
  const eventsPath = join(root, "bridge-events.jsonl");
  const observationsPath = join(root, "observations.jsonl");
  const observationBridge = new VerseGitObservationBridge();
  const bridge = new VerseGitBindingBridge({ enabled: true, port, token, ownerId: "agent:codex", epoch: 4, repoRoot: repo, eventsPath, observationsPath, observationBridge, feedbackTtlMs });
  const address = await bridge.start();
  bridges.push(bridge);
  const env = { CLAWX_VERSGIT_BINDING_ENABLED: "1", CLAWX_VERSGIT_RUNTIME_BINDING_URL: address!, CLAWX_VERSGIT_BINDING_TOKEN: token, CLAWX_VERSGIT_OWNER_ID: "agent:codex", CLAWX_VERSGIT_EPOCH: "4" };
  Object.assign(process.env, env);
  const bindingPort = createVerseGitRuntimeBindingPortFromEnv(env)!;
  const observationPort = createVerseGitRuntimeObservationPortFromEnv(env)!;
  async function bind(runId: string, worktreePath: string) {
    const bound = await bindingPort.bind({ requestId: `request-${runId}`, runId, traceId: `trace-${runId}`, worktreePath, agentSessionId: `agent-session-${runId}`, mode: "M1" });
    return await bindingPort.attach({ bindingId: bound.bindingId, childSessionKey: `session-${runId}`, childRunId: runId });
  }
  return { root, repo, a, b, eventsPath, observationsPath, bindingPort, observationPort, bind };
}
function toolEvent(cwd: string, toolCallId: string, toolName: "read" | "write", args: Record<string, unknown>, result: { content: unknown[]; details?: unknown }) {
  return { toolCallId, toolName, args, cwd, isError: false, result: result as never };
}
async function createFeedback() {
  const f = await fixture();
  const reader = await f.bind("run-reader", f.a);
  const writer = await f.bind("run-writer", f.b);
  const readResult = await createReadToolDefinition(f.a).execute("read-api", { path: "src/api.ts", limit: 2 }, undefined, undefined, {} as ExtensionContext);
  const readRequest = deriveVerseGitToolObservationRequest({ event: toolEvent(f.a, "read-api", "read", { path: "src/api.ts", limit: 2 }, readResult), binding: reader, cwd: f.a });
  expect((await f.observationPort.observe(readRequest)).status).toBe("observed");
  const writeResult = await createWriteToolDefinition(f.b).execute("write-api", { path: "src/api.ts", content: "export type User = { id: string };\nexport const readUser = (id: string): User => ({ id });\n" }, undefined, undefined, {} as ExtensionContext);
  const writeRequest = deriveVerseGitToolObservationRequest({ event: toolEvent(f.b, "write-api", "write", { path: "src/api.ts" }, writeResult), binding: writer, cwd: f.b });
  const writeReceipt = await f.observationPort.observe(writeRequest);
  if (!writeReceipt.feedback) throw new Error("test fixture did not produce feedback");
  return { ...f, reader, writer, writeResult, writeRequest, writeReceipt, feedback: writeReceipt.feedback };
}

describe("D1 VerseGit feedback delivery", () => {
  it("appends one bounded risk to the real tool result and confirms transcript timing", async () => {
    const f = await createFeedback();
    const enriched = await enrichToolResultWithVerseGitFeedback({
      result: { content: f.writeResult.content, details: f.writeResult.details } as never,
      observe: async () => f.writeReceipt,
      reportDelivery: (feedback) => f.observationPort.reportDelivery({
        bindingId: f.writer.bindingId,
        childRunId: f.writer.childRunId!,
        toolCallId: "write-api",
        evidenceId: feedback.evidenceId,
        level: "host-delivered",
        observedAt: new Date().toISOString(),
      }),
    });
    expect(enriched.appended).toBe(true);
    expect(enriched.error).toBeNull();
    expect(enriched.result.content).toHaveLength(f.writeResult.content.length + 1);
    expect(enriched.result.details).toMatchObject({ versegit_feedback: { evidence_id: f.feedback.evidenceId, delivery_level: "host-delivered" } });
    expect(extractVerseGitFeedbackMarkers({ content: enriched.result.content })).toEqual([
      expect.objectContaining({ evidenceId: f.feedback.evidenceId, bindingId: f.writer.bindingId, childRunId: f.writer.childRunId, toolCallId: "write-api", candidateId: null }),
    ]);
    const second = await enrichToolResultWithVerseGitFeedback({
      result: enriched.result,
      observe: async () => f.writeReceipt,
      reportDelivery: async () => { throw new Error("must not report twice"); },
    });
    expect(second.appended).toBe(false);

    const sessionDir = join(f.root, "sessions");
    const manager = SessionManager.create(f.b, sessionDir);
    guardSessionManager(manager, { agentId: "agent", sessionKey: "session-run-writer" });
    manager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Starting write" }],
      timestamp: Date.now(),
    } as never);
    manager.appendMessage({
      role: "toolResult",
      toolCallId: "write-api",
      toolName: "write",
      isError: false,
      content: enriched.result.content,
      timestamp: Date.now(),
    });
    const transcriptPath = manager.getSessionFile()!;
    const transcript = await readFile(transcriptPath, "utf8");
    expect(transcript).toContain(f.feedback.evidenceId);
    const nextCallMessages = manager.buildSessionContext().messages;
    const nextCallMarker = nextCallMessages
      .flatMap((message) => "content" in message && Array.isArray(message.content)
        ? message.content.filter((entry): entry is { type: "text"; text: string } => entry.type === "text").map((entry) => entry.text)
        : [])
      .join("\n");
    expect(nextCallMarker).toContain(`evidence_id=${f.feedback.evidenceId}`);
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const lines = (await readFile(f.observationsPath, "utf8")).trim().split(/\r?\n/u);
      if (lines.some((line) => line.includes('"level":"transcript-confirmed"') && line.includes(f.feedback.evidenceId))) break;
      await delay(20);
    }
    const records = (await readFile(f.observationsPath, "utf8")).trim().split(/\r?\n/u).map((line) => JSON.parse(line));
    expect(records.some((record) => record.kind === "feedback-delivery" && record.data.level === "host-delivered" && record.data.accepted)).toBe(true);
    expect(records.some((record) => record.kind === "feedback-delivery" && record.data.level === "transcript-confirmed" && record.data.accepted)).toBe(true);
  });

  it("rejects duplicate delivery and preserves cross-owner, old-epoch and late-ended rules", async () => {
    const f = await createFeedback();
    await f.observationPort.reportDelivery({ bindingId: f.writer.bindingId, childRunId: f.writer.childRunId!, toolCallId: "write-api", evidenceId: f.feedback.evidenceId, level: "host-delivered", observedAt: new Date().toISOString() });
    await expect(f.observationPort.reportDelivery({ bindingId: f.writer.bindingId, childRunId: f.writer.childRunId!, toolCallId: "write-api", evidenceId: f.feedback.evidenceId, level: "host-delivered", observedAt: new Date().toISOString() })).rejects.toMatchObject({ code: "FEEDBACK_DELIVERY_REJECTED" });
    const wrongOwner = createVerseGitRuntimeObservationPortFromEnv({ ...process.env, CLAWX_VERSGIT_OWNER_ID: "agent:other" })!;
    await expect(wrongOwner.reportDelivery({ bindingId: f.writer.bindingId, childRunId: f.writer.childRunId!, toolCallId: "write-api", evidenceId: f.feedback.evidenceId, level: "transcript-confirmed", observedAt: new Date().toISOString() })).rejects.toBeTruthy();
    const oldEpoch = createVerseGitRuntimeObservationPortFromEnv({ ...process.env, CLAWX_VERSGIT_EPOCH: "3" })!;
    await expect(oldEpoch.reportDelivery({ bindingId: f.writer.bindingId, childRunId: f.writer.childRunId!, toolCallId: "write-api", evidenceId: f.feedback.evidenceId, level: "transcript-confirmed", observedAt: new Date().toISOString() })).rejects.toBeTruthy();
    const duplicateObservation = await f.observationPort.observe(f.writeRequest);
    expect(duplicateObservation.status).toBe("duplicate");
    expect(duplicateObservation.feedback).toBeUndefined();
    await f.bindingPort.end({ bindingId: f.writer.bindingId, reason: "completed" });
    await expect(f.observationPort.reportDelivery({ bindingId: f.writer.bindingId, childRunId: f.writer.childRunId!, toolCallId: "write-api", evidenceId: f.feedback.evidenceId, level: "transcript-confirmed", observedAt: new Date().toISOString() })).rejects.toMatchObject({ code: "FEEDBACK_DELIVERY_REJECTED" });
  });

  it("keeps the original tool result when VG is unavailable and rejects an expired delivery proof", async () => {
    const original = { content: [{ type: "text" as const, text: "Successfully wrote 3 bytes" }], details: { status: "ok" } };
    const fallback = await enrichToolResultWithVerseGitFeedback({ result: original, observe: async () => { throw new Error("VG unavailable"); }, reportDelivery: async () => undefined });
    expect(fallback).toMatchObject({ appended: false, feedback: null, error: "VG unavailable" });
    expect(fallback.result).toEqual(original);

    const f = await fixture(0);
    const reader = await f.bind("run-expired-reader", f.a);
    const writer = await f.bind("run-expired-writer", f.b);
    const readResult = await createReadToolDefinition(f.a).execute("read-expired", { path: "src/api.ts" }, undefined, undefined, {} as ExtensionContext);
    await f.observationPort.observe(deriveVerseGitToolObservationRequest({ event: toolEvent(f.a, "read-expired", "read", { path: "src/api.ts" }, readResult), binding: reader, cwd: f.a }));
    const writeResult = await createWriteToolDefinition(f.b).execute("write-expired", { path: "src/api.ts", content: "export const api = 2;\n" }, undefined, undefined, {} as ExtensionContext);
    const writeReceipt = await f.observationPort.observe(deriveVerseGitToolObservationRequest({ event: toolEvent(f.b, "write-expired", "write", { path: "src/api.ts" }, writeResult), binding: writer, cwd: f.b }));
    expect(writeReceipt.feedback).toBeTruthy();
    await delay(5);
    await expect(f.observationPort.reportDelivery({ bindingId: writer.bindingId, childRunId: writer.childRunId!, toolCallId: "write-expired", evidenceId: writeReceipt.feedback!.evidenceId, level: "host-delivered", observedAt: new Date().toISOString() })).rejects.toMatchObject({ code: "FEEDBACK_DELIVERY_REJECTED" });
  });
});
