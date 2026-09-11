import { createHash } from "node:crypto";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AciExecuteOptions, AciTransport } from "./aci-client.js";
import { VerseShellAciClient } from "./aci-client.js";
import {
  buildReadonlyFacadeCacheKey,
  createVerseShellReadonlyFacadeTools,
  ReadonlyFacadeCache,
  resolveReadonlyWorkspacePath,
  VerseShellReadonlyFacadeAdapter,
} from "./readonly-facade.js";
import type { Observation } from "../../../../shared/verseshell/types.js";
import { createOpenClawCodingTools } from "../agent-tools.js";
import { createDiagnosticTraceContext } from "../../infra/diagnostic-trace-context.js";

const ENABLED_FLAGS = {
  verifiedRuntime: true,
  typedAci: true,
  facade: true,
  governedExec: true,
  artifactResults: true,
};

function config(flags: Record<string, boolean>, killSwitch = false) {
  return {
    tools: { profile: "full" },
    runtime: { verseShellFoundation: { ...flags, killSwitch } },
  } as never;
}

function observation(op: string, data: Record<string, unknown> = {}): Observation {
  return {
    schema: "verseshell.observation/v1",
    id: `${op}-request`,
    op,
    ok: true,
    data: data as Observation["data"],
    meta: { elapsed_ms: 1, profile: "test", token_estimate: 1 },
  };
}

function fakeClient(cwd: string, responses: Record<string, Observation>) {
  const calls: Array<{ op: string; args: Record<string, unknown>; options?: AciExecuteOptions }> = [];
  const transport: AciTransport = {
    key: "test-process",
    workspace: cwd,
    capabilities: ["file.read", "shell.exec"],
    protocolVersion: "verseshell.jsonl/v1",
    catalogDigest: "sha256:test",
    request: async (op, args, options) => {
      calls.push({ op, args, ...(options ? { options } : {}) });
      return responses[op] ?? observation(op);
    },
  };
  return { client: new VerseShellAciClient(transport), calls };
}

function workspaceId(cwd: string): string {
  const canonical = path.resolve(cwd);
  const identity = process.platform === "win32" ? canonical.toLowerCase() : canonical;
  return `ws_sha256_${createHash("sha256").update(identity).digest("hex")}`;
}

describe("VerseShell read-only facade", () => {
  it("rejects traversal, absolute paths, NULs, and unbounded inputs", () => {
    const cwd = process.cwd();
    expect(() => resolveReadonlyWorkspacePath(cwd, "../outside.txt")).toThrow(/workspace/u);
    expect(() => resolveReadonlyWorkspacePath(cwd, path.resolve(cwd, "file.txt"))).toThrow(/relative/u);
    expect(() => resolveReadonlyWorkspacePath(cwd, "safe\0name")).toThrow(/bounded|invalid/u);
    expect(() => resolveReadonlyWorkspacePath(cwd, "a/../../outside.txt")).toThrow(/workspace/u);
  });

  it("maps read and search facade calls to bounded ACI operations and caches by identity", async () => {
    const cwd = process.cwd();
    const fake = fakeClient(cwd, {
      "file.view": observation("file.view", { text: "hello" }),
      "repo.search": observation("repo.search", { matches: [] }),
    });
    const adapter = new VerseShellReadonlyFacadeAdapter({
      cwd,
      revision: "rev-a",
      client: fake.client,
    });

    await adapter.readFile({ path: "src/index.ts", cursor: 2, window: 12 });
    await adapter.readFile({ path: "src/index.ts", cursor: 2, window: 12 });
    await adapter.searchContent({ query: "needle", glob: "src/**/*.ts", context_lines: 2, max_items: 7 });

    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0]).toMatchObject({
      op: "file.view",
      args: { path: "src/index.ts", cursor: 2, window: 12 },
    });
    expect(fake.calls[1]).toMatchObject({
      op: "repo.search",
      args: { query: "needle", glob: "src/**/*.ts", context_lines: 2, max_items: 7 },
    });
  });

  it("passes one host trace through read, search, and result queries", async () => {
    const cwd = process.cwd();
    const trace = createDiagnosticTraceContext({
      traceId: "3".repeat(32),
      spanId: "4".repeat(16),
    });
    const fake = fakeClient(cwd, {
      "file.view": observation("file.view", { text: "hello" }),
      "repo.search": observation("repo.search", { matches: [] }),
      "result.query": observation("result.query", { matches: [] }),
    });
    const adapter = new VerseShellReadonlyFacadeAdapter({ cwd, client: fake.client, trace });

    await adapter.readFile({ path: "src/index.ts" });
    await adapter.searchContent({ query: "needle" });
    await adapter.resultQuery({
      handle: `result://sha256/${"a".repeat(64)}`,
      mode: "meta",
    });

    expect(fake.calls.map((call) => call.op)).toEqual(["file.view", "repo.search", "result.query"]);
    expect(fake.calls.map((call) => call.options?.traceId)).toEqual([
      trace.traceId,
      trace.traceId,
      trace.traceId,
    ]);
  });

  it("isolates cache entries by workspace, revision, policy, operation, and args", () => {
    const args = { path: "src/index.ts", window: 40 } as const;
    const base = buildReadonlyFacadeCacheKey({
      workspace: process.cwd(),
      revision: "rev-a",
      policyDigest: "sha256:policy-a",
      op: "file.view",
      args,
    });
    expect(base).not.toBe(buildReadonlyFacadeCacheKey({
      workspace: path.join(process.cwd(), "other"),
      revision: "rev-a",
      policyDigest: "sha256:policy-a",
      op: "file.view",
      args,
    }));
    expect(base).not.toBe(buildReadonlyFacadeCacheKey({
      workspace: process.cwd(), revision: "rev-b", policyDigest: "sha256:policy-a", op: "file.view", args,
    }));
    expect(base).not.toBe(buildReadonlyFacadeCacheKey({
      workspace: process.cwd(), revision: "rev-a", policyDigest: "sha256:policy-b", op: "file.view", args,
    }));
    expect(base).not.toBe(buildReadonlyFacadeCacheKey({
      workspace: process.cwd(), revision: "rev-a", policyDigest: "sha256:policy-a", op: "repo.search", args,
    }));
    expect(base).not.toBe(buildReadonlyFacadeCacheKey({
      workspace: process.cwd(), revision: "rev-a", policyDigest: "sha256:policy-a", op: "file.view", args: { ...args, window: 41 },
    }));
  });

  it("validates result handles and artifact ownership", async () => {
    const cwd = process.cwd();
    const handle = `result://sha256/${"a".repeat(64)}`;
    const descriptor = {
      handle,
      digest: `sha256:${"a".repeat(64)}`,
      stream: "stdout",
      raw_bytes: 10,
      retained_bytes: 10,
      omitted_bytes: 0,
      created_at: 1,
      expires_at: Date.now() + 60_000,
      owner: { workspace_id: workspaceId(cwd), runtime_id: "rt", process_id: "p", request_id: "r" },
      query: { modes: ["meta", "head"], max_bytes: 64_000, max_tokens: 4_000, max_lines: 500, max_matches: 200 },
    };
    const fake = fakeClient(cwd, {
      "result.query": observation("result.query", { artifacts: [descriptor] }),
    });
    const adapter = new VerseShellReadonlyFacadeAdapter({ cwd, client: fake.client });
    await expect(adapter.resultQuery({ handle: "result://sha256/not-valid", mode: "meta" })).rejects.toThrow(/valid result artifact/u);
    await expect(adapter.resultQuery({ handle, mode: "meta" })).resolves.toMatchObject({ op: "result.query" });

    const drifted = { ...descriptor, owner: { ...descriptor.owner, workspace_id: "ws_sha256_wrong" } };
    const driftClient = fakeClient(cwd, { "result.query": observation("result.query", { artifacts: [drifted] }) });
    const driftAdapter = new VerseShellReadonlyFacadeAdapter({ cwd, client: driftClient.client });
    await expect(driftAdapter.resultQuery({ handle, mode: "meta" })).rejects.toThrow(/owner/u);
  });

  it("keeps facade tools default-off and fail-closed on kill switch", () => {
    expect(createVerseShellReadonlyFacadeTools({ cwd: process.cwd(), config: {} })).toBeNull();
    expect(createVerseShellReadonlyFacadeTools({
      cwd: process.cwd(),
      config: config(ENABLED_FLAGS, true),
    })).toBeNull();
    const enabled = createVerseShellReadonlyFacadeTools({ cwd: process.cwd(), config: config(ENABLED_FLAGS) });
    expect(enabled?.map((tool) => tool.name)).toEqual(["read_file", "search_content", "result_query"]);
    for (const tool of enabled ?? []) {
      expect((tool.parameters as { additionalProperties?: boolean }).additionalProperties).toBe(false);
    }
  });

  it("adds the three facade tools only to an explicitly enabled shell tool surface", () => {
    const disabled = createOpenClawCodingTools({ cwd: process.cwd(), config: config({}) });
    expect(disabled.map((tool) => tool.name)).not.toEqual(expect.arrayContaining(["read_file", "search_content", "result_query"]));
    const enabled = createOpenClawCodingTools({
      cwd: process.cwd(),
      workspaceRevision: "rev-a",
      config: config(ENABLED_FLAGS),
    });
    expect(enabled.map((tool) => tool.name)).toEqual(expect.arrayContaining(["read_file", "search_content", "result_query"]));
  });

  it("expires and bounds cache entries", () => {
    let now = 100;
    const cache = new ReadonlyFacadeCache(10, 1, () => now);
    const first = observation("file.view", { text: "first" });
    const second = observation("repo.search", { matches: [] });
    cache.set("a", first);
    expect(cache.get("a")).toBe(first);
    cache.set("b", second);
    expect(cache.get("a")).toBeUndefined();
    now = 111;
    expect(cache.get("b")).toBeUndefined();
  });
});
