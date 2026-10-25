import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentToolResultMiddlewareEvent } from "../../openclaw_runtime/src/plugins/agent-tool-result-middleware-types";
import type { ExtensionContext } from "../../openclaw_runtime/src/agents/sessions/extensions/types";
import { createReadToolDefinition } from "../../openclaw_runtime/src/agents/sessions/tools/read";
import { createWriteToolDefinition } from "../../openclaw_runtime/src/agents/sessions/tools/write";
import { verseGitSha256 } from "../../openclaw_runtime/src/agents/sessions/tools/versegit-tool-basis";
import { deriveVerseGitToolObservationRequest } from "../../openclaw_runtime/src/agents/harness/versegit-tool-observation";
import {
  VerseGitObservationBridge,
  type ObservationBinding,
} from "../../electron/services/versegit-observation";
import type { VerseGitBindingRecord } from "../../shared/versegit-runtime-contract";
import { VerseGitBindingBridge } from "../../electron/gateway/versegit-bridge";
import { createVerseGitRuntimeBindingPortFromEnv } from "../../openclaw_runtime/src/plugin-sdk/versegit-binding-port";
import { createVerseGitRuntimeObservationPortFromEnv } from "../../openclaw_runtime/src/plugin-sdk/versegit-observation-port";

const roots: string[] = [];
afterEach(async () => {
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});

async function makeWorktrees() {
  const root = await mkdtemp(join(tmpdir(), "versegit-c2-"));
  roots.push(root);
  const a = join(root, "wt-a");
  const b = join(root, "wt-b");
  await mkdir(join(a, "src"), { recursive: true });
  await mkdir(join(b, "src"), { recursive: true });
  const api = [
    "export type User = { id: string; name: string };",
    "export function readUser(id: string): User {",
    "  return { id, name: 'Ada' };",
    "}",
  ].join("\n");
  await writeFile(join(a, "src", "api.ts"), api, "utf8");
  await writeFile(join(b, "src", "api.ts"), api, "utf8");
  await writeFile(join(a, "src", "own.ts"), "export const own = 1;\n", "utf8");
  await writeFile(join(a, "src", "unrelated.ts"), "export const unrelated = 1;\n", "utf8");
  await writeFile(join(b, "src", "other.ts"), "export const other = 1;\n", "utf8");
  return { root, a, b };
}

function binding(runId: string, worktreePath: string, overrides: Partial<ObservationBinding> = {}): ObservationBinding {
  return {
    bindingId: `binding-${runId}`,
    runId,
    sessionKey: `session-${runId}`,
    traceId: `trace-${runId}`,
    requestId: `request-${runId}`,
    repoId: "repo-c2",
    worktreeId: `worktree-${runId}`,
    worktreePath,
    agentSessionId: `agent-${runId}`,
    vgSessionId: `vg-${runId}`,
    ownerId: "agent:codex",
    actor: "agent:codex",
    epoch: 4,
    ...overrides,
  };
}

function bindingRecord(value: ObservationBinding, childRunId: string): VerseGitBindingRecord {
  return {
    schema: "clawx.versegit.runtime-binding/v1",
    bindingId: value.bindingId!,
    authorizationId: value.bindingId!,
    baseOid: 'a'.repeat(40),
    refsDigest: 'sha256:' + 'b'.repeat(64),
    requestId: value.requestId!,
    runId: value.runId,
    traceId: value.traceId,
    repoId: value.repoId,
    worktreeId: value.worktreeId,
    worktreePath: value.worktreePath!,
    agentSessionId: value.agentSessionId,
    vgSessionId: value.vgSessionId,
    ownerId: value.ownerId,
    epoch: value.epoch,
    mode: "M1",
    phase: "attached",
    createdAt: new Date(0).toISOString(),
    childSessionKey: value.sessionKey,
    childRunId,
  };
}

function toolEvent(params: {
  cwd: string;
  toolCallId: string;
  toolName: "read" | "write";
  args: Record<string, unknown>;
  result: { content: unknown[]; details?: unknown };
  isError?: boolean;
}): AgentToolResultMiddlewareEvent {
  return {
    toolCallId: params.toolCallId,
    toolName: params.toolName,
    args: params.args,
    cwd: params.cwd,
    isError: params.isError,
    result: params.result as AgentToolResultMiddlewareEvent["result"],
  };
}

async function observeRead(
  bridge: VerseGitObservationBridge,
  value: ObservationBinding,
  cwd: string,
  path: string,
  toolCallId: string,
  limit?: number,
) {
  const result = await createReadToolDefinition(cwd).execute(
    toolCallId,
    { path, ...(limit === undefined ? {} : { limit }) },
    undefined,
    undefined,
    {} as ExtensionContext,
  );
  const event = toolEvent({ cwd, toolCallId, toolName: "read", args: { path, ...(limit === undefined ? {} : { limit }) }, result });
  const request = deriveVerseGitToolObservationRequest({ event, binding: bindingRecord(value, value.runId), cwd });
  return { result, request, observation: bridge.ingestToolObservation(request, { epoch: 4, ownerId: "agent:codex" }) };
}

async function observeWrite(
  bridge: VerseGitObservationBridge,
  value: ObservationBinding,
  cwd: string,
  path: string,
  content: string,
  toolCallId: string,
) {
  const result = await createWriteToolDefinition(cwd).execute(
    toolCallId,
    { path, content },
    undefined,
    undefined,
    {} as ExtensionContext,
  );
  const event = toolEvent({ cwd, toolCallId, toolName: "write", args: { path, content }, result });
  const request = deriveVerseGitToolObservationRequest({ event, binding: bindingRecord(value, value.runId), cwd });
  return bridge.ingestToolObservation(request, { epoch: 4, ownerId: "agent:codex" });
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

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
}

describe("C2 VerseGit tool-boundary observation basis", () => {
  it("links real read/write tool results to normalized path/range/basis and detects API drift", async () => {
    const { a, b } = await makeWorktrees();
    const bridge = new VerseGitObservationBridge();
    const reader = binding("run-a", a);
    const writer = binding("run-b", b);
    expect(bridge.bind(reader).status).toBe("attached");
    expect(bridge.bind(writer).status).toBe("attached");

    const read = await observeRead(bridge, reader, a, "src/api.ts", "read-api", 3);
    expect(read.observation.status).toBe("observed");
    expect(read.observation.event).toMatchObject({
      source: "tool-middleware",
      surface: "file.read",
      coverage: "direct",
      path: "src/api.ts",
      lineStart: 1,
      lineEnd: 3,
      basis: { kind: "read", fileSha256: verseGitSha256(await readFile(join(a, "src", "api.ts"))) },
    });
    expect(read.observation.event?.basis?.rangeSha256).toBeTruthy();
    expect(read.observation.event?.inputDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(read.observation.event?.outputDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);

    const write = await observeWrite(
      bridge,
      writer,
      b,
      "src/api.ts",
      "export type User = { id: string };\nexport const readUser = (id: string): User => ({ id });\n",
      "write-api",
    );
    expect(write.status).toBe("observed");
    expect(write.event).toMatchObject({ surface: "file.write", coverage: "direct", path: "src/api.ts" });

    const findings = bridge.staleReadFindings();
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      kind: "api-drift",
      path: "src/api.ts",
      readEventId: read.observation.event?.eventId,
      writeEventId: write.event?.eventId,
      readerSessionId: reader.agentSessionId,
      writerSessionId: writer.agentSessionId,
      host_verdict: "unchanged",
    });
  });

  it("routes a production-derived observation through the typed Main bridge without absolute paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "versegit-c2-bridge-"));
    roots.push(root);
    git(root, ["init", "--initial-branch=main"]);
    git(root, ["config", "user.email", "agent@example.invalid"]);
    git(root, ["config", "user.name", "Agent"]);
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "api.ts"), "export const api = 1;\n", "utf8");
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "base"]);

    const port = await freePort();
    const token = "c2-token";
    const eventsPath = join(root, "bridge-events.jsonl");
    const observationsPath = join(root, "observations.jsonl");
    const bridge = new VerseGitBindingBridge({
      enabled: true,
      port,
      token,
      ownerId: "agent:codex",
      epoch: 4,
      repoRoot: root,
      eventsPath,
      observationsPath,
    });
    const address = await bridge.start();
    const env = {
      CLAWX_VERSGIT_BINDING_ENABLED: "1",
      CLAWX_VERSGIT_RUNTIME_BINDING_URL: address!,
      CLAWX_VERSGIT_BINDING_TOKEN: token,
      CLAWX_VERSGIT_OWNER_ID: "agent:codex",
      CLAWX_VERSGIT_EPOCH: "4",
    };
    const runtime = createVerseGitRuntimeBindingPortFromEnv(env)!;
    const observationPort = createVerseGitRuntimeObservationPortFromEnv(env)!;
    try {
      const bound = await runtime.bind({
        requestId: "request-c2-bridge",
        runId: "run-c2-bridge",
        traceId: "trace-c2-bridge",
        worktreePath: root,
        agentSessionId: "agent-session-c2-bridge",
        mode: "M1",
      });
      const attached = await runtime.attach({
        bindingId: bound.bindingId,
        childSessionKey: "child-session-c2-bridge",
        childRunId: "child-run-c2-bridge",
      });
      const result = await createReadToolDefinition(root).execute(
        "read-c2-bridge",
        { path: "src/api.ts" },
        undefined,
        undefined,
        {} as ExtensionContext,
      );
      const request = deriveVerseGitToolObservationRequest({
        event: toolEvent({ cwd: root, toolCallId: "read-c2-bridge", toolName: "read", args: { path: "src/api.ts" }, result }),
        binding: attached,
        cwd: root,
      });
      const receipt = await observationPort.observe(request);
      expect(receipt).toMatchObject({
        status: "observed",
        event: { path: "src/api.ts", coverage: "direct", surface: "file.read" },
        host_verdict: "unchanged",
      });
      const retained = await readFile(observationsPath, "utf8");
      expect(retained).toContain('"path":"src/api.ts"');
      expect(retained).not.toContain(root.replaceAll("\\", "\\\\"));
      await runtime.end({ bindingId: bound.bindingId, reason: "completed" });
    } finally {
      await bridge.stop();
    }
  });

  it("does not misassociate own writes or unrelated files", async () => {
    const { a, b } = await makeWorktrees();
    const bridge = new VerseGitObservationBridge();
    const reader = binding("run-a", a);
    const writer = binding("run-b", b);
    bridge.bind(reader);
    bridge.bind(writer);
    await observeRead(bridge, reader, a, "src/own.ts", "read-own");
    await observeWrite(bridge, reader, a, "src/own.ts", "export const own = 2;\n", "write-own");
    await observeRead(bridge, reader, a, "src/unrelated.ts", "read-unrelated");
    await observeWrite(bridge, writer, b, "src/other.ts", "export const other = 2;\n", "write-other");
    expect(bridge.staleReadFindings()).toEqual([]);
  });

  it("rejects duplicate, old epoch, wrong owner, traversal and late observations with explicit facts", async () => {
    const { a } = await makeWorktrees();
    const bridge = new VerseGitObservationBridge();
    const reader = binding("run-late", a);
    bridge.bind(reader);
    const read = await observeRead(bridge, reader, a, "src/api.ts", "read-late", 2);
    expect(bridge.ingestToolObservation(read.request, { epoch: 4, ownerId: "agent:codex" }).status).toBe("duplicate");
    expect(bridge.ingestToolObservation(read.request, { epoch: 3, ownerId: "agent:codex" }).status).toBe("stale");
    expect(bridge.ingestToolObservation({ ...read.request, ownerId: "agent:other" }, { epoch: 4, ownerId: "agent:other" }).status).toBe("rejected_by_policy");
    const traversal = bridge.ingestToolObservation({
      ...read.request,
      toolCallId: "read-traversal",
      args: { path: "../../outside.ts" },
      basis: { ...read.request.basis!, path: "../../outside.ts" },
      inputDigest: `sha256:${verseGitSha256("traversal-input")}`,
      outputDigest: `sha256:${verseGitSha256("traversal-output")}`,
    }, { epoch: 4, ownerId: "agent:codex" });
    expect(traversal.status).toBe("partial");
    expect(traversal.issues).toContain("path_outside_bound_worktree");
    expect(bridge.detach(reader.runId, { epoch: 4, ownerId: "agent:codex" }).status).toBe("detached");
    expect(bridge.ingestToolObservation({ ...read.request, toolCallId: "read-after-end" }, { epoch: 4, ownerId: "agent:codex" }).status).toBe("stale");
  });

  it("records bounded-queue drops and cancellation without claiming a successful file effect", async () => {
    const { a } = await makeWorktrees();
    const bridge = new VerseGitObservationBridge({ maxToolRecords: 1 });
    const reader = binding("run-queue", a);
    bridge.bind(reader);
    const first = await observeRead(bridge, reader, a, "src/api.ts", "read-q1", 1);
    const second = await observeRead(bridge, reader, a, "src/api.ts", "read-q2", 2);
    expect(first.observation.status).toBe("observed");
    expect(second.observation.status).toBe("observed");
    const cancelled = bridge.ingestToolObservation({
      ...second.request,
      toolCallId: "write-cancelled",
      toolName: "write",
      args: { path: "src/api.ts" },
      status: "cancelled",
      inputDigest: `sha256:${verseGitSha256("cancel-input")}`,
      outputDigest: `sha256:${verseGitSha256("cancel-output")}`,
      basis: {
        schema: "clawx.versegit.tool-basis/v1",
        kind: "write",
        path: "src/api.ts",
        lineStart: 1,
        lineEnd: 4,
        beforeSha256: first.observation.event?.basis?.fileSha256 ?? null,
        afterSha256: verseGitSha256("not-written"),
      },
    }, { epoch: 4, ownerId: "agent:codex" });
    expect(cancelled).toMatchObject({ status: "partial", issues: expect.arrayContaining(["tool_not_succeeded"]) });
    const snapshot = bridge.snapshot(reader.runId);
    expect(snapshot).toMatchObject({ droppedCount: 2, toolEventCount: 3, values: { fileRead: "direct" } });
    expect(snapshot?.values.fileWrite).not.toBe("direct");
    expect(snapshot?.knownGaps.join(" ")).toContain("bounded_tool_observation_queue_dropped");
  });
});
