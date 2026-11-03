import { describe, expect, it } from "vitest";
import { resolveSessionTaskScope, type SessionTaskScopeInput } from "../../shared/session-task-scope";

function input(overrides: Partial<SessionTaskScopeInput> = {}): SessionTaskScopeInput {
  return {
    sessionKey: "agent:main:session",
    workspaceId: "workspace-a",
    generation: "generation-1",
    activeTaskNodeId: "task-1",
    coordinatorSessionKey: "agent:main:session",
    bindingRevision: 3,
    bindingState: "active",
    links: [{ id: "link-1", sessionKey: "agent:main:session", nodeId: "task-1" }],
    task: { nodeId: "task-1", workspaceId: "workspace-a", nodeKind: "task", status: "doing", generation: "generation-1" },
    ...overrides,
  };
}

describe("A4 session task scope", () => {
  it("resolves a ready read-only binding only from an explicit task link", () => {
    expect(resolveSessionTaskScope(input())).toMatchObject({
      status: "ready",
      taskRef: "task-1",
      workspaceId: "workspace-a",
      generation: "generation-1",
      bindingRevision: 3,
      readOnly: true,
      writeClaim: "not-granted",
    });
  });

  it("keeps discussion containers empty rather than inferring a task from a title or link", () => {
    expect(resolveSessionTaskScope(input({ activeTaskNodeId: null, task: null }))).toEqual({
      status: "empty",
      reason: "discussion-no-task",
    });
  });

  it.each([
    ["coordinator-missing", { coordinatorSessionKey: null }],
    ["binding-not-ready", { bindingState: "invalid" as const }],
    ["task-ref-missing", { links: [] }],
    ["task-not-found", { task: null }],
    ["task-workspace-mismatch", { task: { nodeId: "task-1", workspaceId: "workspace-b", nodeKind: "task", status: "doing" } }],
    ["task-generation-stale", { task: { nodeId: "task-1", workspaceId: "workspace-a", nodeKind: "task", status: "doing", generation: "generation-0" } }],
  ])("rejects %s", (reason, overrides) => {
    expect(resolveSessionTaskScope(input(overrides))).toEqual({ status: "unavailable", reason });
  });

  it("does not reuse a stale session link from an earlier generation", () => {
    const stale = input({
      links: [{ id: "old-link", sessionKey: "agent:main:session", sessionGeneration: "generation-0", nodeId: "task-1" }],
    });
    expect(resolveSessionTaskScope(stale)).toEqual({ status: "unavailable", reason: "task-ref-missing" });
  });

  it("allows a fork to read the linked task but does not claim write inheritance", () => {
    const fork = input({
      sessionKey: "agent:main:fork",
      links: [{ id: "fork-link", sessionKey: "agent:main:fork", nodeId: "task-1", relation: "forked_from", sourceSessionKey: "agent:main:session" }],
    });
    expect(resolveSessionTaskScope(fork)).toMatchObject({ status: "ready", taskRef: "task-1", readOnly: true, writeClaim: "not-granted" });
  });

  it("does not let an external execution reference become Task Ledger completion authority", () => {
    const result = resolveSessionTaskScope(input({
      activeTaskNodeId: "external:forest:TF-9999",
      task: { nodeId: "external:forest:TF-9999", workspaceId: "workspace-a", nodeKind: "external", status: "done" },
      links: [{ id: "external-link", sessionKey: "agent:main:session", nodeId: "external:forest:TF-9999" }],
    }));
    expect(result).toEqual({ status: "unavailable", reason: "external-ref-not-task" });
  });

  it("rejects a task link from another session instead of borrowing its task", () => {
    expect(resolveSessionTaskScope(input({
      links: [{ id: "other", sessionKey: "agent:main:other", nodeId: "task-1" }],
    }))).toEqual({ status: "unavailable", reason: "task-ref-missing" });
  });
});


describe("A4 evidence boundary", () => {
  it("keeps the A4 evidence manifest and contract bound on disk", async () => {
    const { readFile } = await import("node:fs/promises");
    const { createHash } = await import("node:crypto");
    const { join } = await import("node:path");
    const dir = join(process.cwd(), "harness/specs/fixtures/autonomy-session-task-scope");
    const manifest = await readFile(join(dir, "SHA256SUMS"), "utf8");
    for (const line of manifest.trim().split(/\r?\n/)) {
      const [expected, file] = line.trim().split(/\s+/);
      expect(createHash("sha256").update(await readFile(join(dir, file))).digest("hex")).toBe(expected);
    }
    const contract = await readFile(join(process.cwd(), "harness/specs/tasks/autonomy-session-task-scope.md"), "utf8");
    expect(contract).toContain("discussion 允许为空");
    expect(contract).toContain("external task ref 不能冒充 Task Ledger 完成权威");
  });
});
