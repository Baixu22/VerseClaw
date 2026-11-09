import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { upsertSessionEntry } from "../config/sessions/store.js";
import { closeSqliteSessionStoreDatabase } from "../config/sessions/store-sqlite.js";
import { clearMemoryCards, setMemoryStorePath, storeMemoryCard } from "../memory/memory-store.js";
import { KnowledgeStore } from "../knowledge/sekb/knowledge-store.js";
import { closeOpenClawStateDatabase } from "../state/openclaw-state-db.js";
import { digestOwnerReadContent } from "../runtime-core/knowledge-owner-read.js";
import {
  createProductionChatKnowledgeSourceAdapters,
  MemoryWikiChatKnowledgeSourceAdapter,
  revalidateChatKnowledgeRefs,
  RoleMemoryChatKnowledgeSourceAdapter,
  SekbChatKnowledgeSourceAdapter,
} from "./chat-knowledge-source-adapters.js";
import {
  normalizeChatKnowledgeReferences,
  packResolvedChatKnowledgeRef,
  resolveChatKnowledgeIntent,
} from "./chat-knowledge-intent.js";
import { Value } from "typebox/value";
import { ChatSendParamsSchema } from "../../packages/gateway-protocol/src/schema/logs-chat.js";
import { buildEmbeddedExtensionFactories } from "../agents/embedded-agent-runner/extensions.js";
import { buildEmbeddedRunBaseParams } from "../auto-reply/reply/agent-runner-run-params.js";
import type { FollowupRun } from "../auto-reply/reply/queue.js";
import { Assembler } from "./assembler.js";

describe("Project RAG production owner adapters", () => {
  let root: string, cfg: OpenClawConfig;
  const sessionKey = "agent:rag-test:owner-read";
  const generation = "10000000-0000-4000-8000-000000000001";
  const identity = () => ({
    agentSessionKey: sessionKey,
    workspaceId: "rag-workspace",
    workspaceDir: join(root, "workspace"),
    egressProviderRefs: ["agent-fixture"],
  });
  const ref = { id: "owner", title: "Owner", lookup: "concepts/owner.md", corpus: "wiki" as const };
  const body = "Owner read contract 中文😀.\n".repeat(100);
  const save = (metadata = "", content = body) =>
    writeFile(
      join(root, "vault", "concepts", "owner.md"),
      `---\ntitle: Owner\nrevision: 1\ntrust: confirmed\nverifiedAt: "2026-11-09T00:00:00Z"\n${metadata}---\n${content}`,
      "utf8",
    );
  const read = () =>
    resolveChatKnowledgeIntent({
      scope: "wiki",
      references: [ref],
      adapters: createProductionChatKnowledgeSourceAdapters(cfg, { identity: identity() }),
    });

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "project-rag-adapters-"));
    await mkdir(join(root, "vault", "concepts"), { recursive: true });
    await mkdir(join(root, "workspace"), { recursive: true });
    cfg = {
      agents: {
        defaults: { workspace: join(root, "workspace") },
        list: [{ id: "rag-test", default: true }],
      },
      runtime: { contextBlock: { sekb: { enabled: true } } },
      session: { store: join(root, "sessions.json") },
      plugins: {
        entries: {
          "memory-wiki": {
            enabled: true,
            config: {
              vault: { path: join(root, "vault") },
              search: { backend: "local", corpus: "wiki" },
            },
          },
        },
      },
    };
    await upsertSessionEntry({
      agentId: "rag-test",
      storePath: cfg.session!.store,
      sessionKey,
      entry: {
        sessionId: generation,
        updatedAt: Date.now(),
        workspaceDir: join(root, "workspace"),
      },
    });
    await save();
    setMemoryStorePath(join(root, "role-memory.sqlite"));
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    closeSqliteSessionStoreDatabase(cfg.session!.store!);
    clearMemoryCards();
    setMemoryStorePath(undefined);
    closeOpenClawStateDatabase();
    await rm(root, { recursive: true, force: true });
  });

  it("retains complete source identity through normalization, Gateway schema and prompt packing", async () => {
    const result = await read(),
      admitted = result.admitted[0]!;
    const snapshot = admitted.ownerSnapshot!;
    expect(snapshot.source.sourceDigest).toBe(
      digestOwnerReadContent(await readFile(join(root, "vault", "concepts", "owner.md"))),
    );
    expect(snapshot.context).toMatchObject({
      sessionId: generation,
      workspaceId: "rag-workspace",
      agentId: "rag-test",
    });
    expect(admitted.content.length).toBeLessThanOrEqual(1200);
    expect(admitted.contentDigest).toBe(snapshot.contentDigest);
    const typed = normalizeChatKnowledgeReferences([
      {
        ...ref,
        sourceRef: snapshot.source,
        revision: admitted.revision,
        contentDigest: admitted.contentDigest,
        acl: { read: ["*"] },
        scope: "all",
        content: "FORGED",
      },
    ]);
    expect(typed[0]!.sourceRef).toEqual(snapshot.source);
    expect(typed[0]).not.toHaveProperty("acl");
    expect(typed[0]).not.toHaveProperty("content");
    expect(
      Value.Check(ChatSendParamsSchema, {
        sessionKey,
        message: "Owner?",
        idempotencyKey: "rag-test",
        knowledgeReferences: typed,
      }),
    ).toBe(true);
    expect(packResolvedChatKnowledgeRef(admitted)).toContain(JSON.stringify(snapshot.source));
    const range = snapshot.source.locator!,
      bytes = await readFile(join(root, "vault", "concepts", "owner.md"));
    expect(bytes.subarray(range.startByte, range.endByteExclusive).toString("utf8")).toBe(
      admitted.content,
    );
  });

  it.each([
    "status: revoked\n",
    "privacyTier: secret\n",
    "acl:\n  read: [another-principal]\n",
    "scope:\n  workspaceId: other\n",
    "retention:\n  expiresAt: invalid\n",
  ])(
    "rejects owner policy before a forged high-score reference can be materialized: %s",
    async (metadata) => {
      await save(metadata);
      const result = await resolveChatKnowledgeIntent({
        scope: "all",
        references: [
          {
            ...ref,
            score: 999,
            confidence: 1,
            acl: { read: ["operator"] },
            freshnessLevel: "fresh",
            matchedClaimStatus: "confirmed",
          },
        ],
        adapters: createProductionChatKnowledgeSourceAdapters(cfg, { identity: identity() }),
      });
      expect(result.admitted).toEqual([]);
      expect(result.denied).toHaveLength(1);
      expect(JSON.stringify(result)).not.toContain(body);
    },
  );

  it("refuses a changed tail below the old 80-line window and never falls back to another owner", async () => {
    const original = (await read()).admitted[0]!;
    await save("", body + "Changed tail");
    const result = await resolveChatKnowledgeIntent({
      scope: "all",
      references: [{ ...ref, corpus: "all", sourceRef: original.ownerSnapshot!.source }],
      adapters: createProductionChatKnowledgeSourceAdapters(cfg, { identity: identity() }),
    });
    expect(result.admitted).toEqual([]);
    expect(result.denied[0]!.reason).toBe("digest_mismatch");
  });

  it("rechecks revocation, session generation and workspace at prompt preparation", async () => {
    const refs = (await read()).admitted;
    expect(await revalidateChatKnowledgeRefs({ refs, cfg, identity: identity() })).toHaveLength(1);
    await upsertSessionEntry({
      agentId: "rag-test",
      storePath: cfg.session!.store,
      sessionKey,
      entry: { sessionId: "20000000-0000-4000-8000-000000000002", updatedAt: Date.now() },
    });
    expect(await revalidateChatKnowledgeRefs({ refs, cfg, identity: identity() })).toEqual([]);
    expect(
      await revalidateChatKnowledgeRefs({
        refs,
        cfg,
        identity: { ...identity(), workspaceId: "other" },
      }),
    ).toEqual([]);
    await save("status: revoked\n");
    expect(await revalidateChatKnowledgeRefs({ refs, cfg, identity: identity() })).toEqual([]);
  });

  it("releases a cancelled read and discards a later production adapter response", async () => {
    const owner = new MemoryWikiChatKnowledgeSourceAdapter(cfg, { identity: identity() });
    let release!: () => void, started!: () => void, completed!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const dispatched = new Promise<void>((resolve) => {
      started = resolve;
    });
    const finished = new Promise<void>((resolve) => {
      completed = resolve;
    });
    const controller = new AbortController();
    const request = resolveChatKnowledgeIntent({
      references: [ref],
      signal: controller.signal,
      adapters: [
        {
          owner: "memory-wiki",
          async resolve(value) {
            started();
            await waiting;
            const result = await owner.resolve(value);
            completed();
            return result;
          },
        },
      ],
    });
    await dispatched;
    controller.abort();
    const result = await request;
    expect(result.admitted).toEqual([]);
    expect(result.denied[0]!.reason).toBe("cancelled");
    release();
    await finished;
    expect(result.admitted).toEqual([]);
  });

  it("uses the actual Role Memory owner version, namespace, retention and scope", async () => {
    const now = new Date().toISOString();
    storeMemoryCard({
      id: "role-card",
      type: "fact",
      scope: "workspace",
      scopeKey: "rag-workspace",
      roleTags: [],
      content: "A retained owner fact",
      evidence: [],
      confidence: 1,
      importance: 1,
      lastAccessedAt: now,
      createdAt: now,
      updatedAt: now,
      accessCount: 0,
      version: 3,
      status: "active",
      sensitivity: "normal",
    });
    const adapter = new RoleMemoryChatKnowledgeSourceAdapter({ cfg, identity: identity() });
    const value = await adapter.resolve({
      id: "role-card",
      title: "Card",
      lookup: "role-card",
      corpus: "memory",
    });
    expect(value.status).toBe("resolved");
    if (value.status !== "resolved") throw new Error("Role owner read failed");
    expect(value.resolved.ownerSnapshot!.source).toMatchObject({
      authorityId: "memory-slot",
      revision: "3",
      domain: "role-memory",
    });
    const changed = new RoleMemoryChatKnowledgeSourceAdapter({
      cfg,
      identity: { ...identity(), workspaceId: "other" },
    });
    expect(
      (await changed.resolve({ id: "role-card", title: "Card", lookup: "role-card" })).status,
    ).toBe("denied");
  });

  it("does not read globally disabled Wiki or SEKB owners", async () => {
    cfg.plugins = { ...cfg.plugins, enabled: false };
    expect((await read()).admitted).toEqual([]);
    const store = new KnowledgeStore({ database: { path: join(root, "disabled-sekb.sqlite") } });
    const query = vi.spyOn(store, "query_principles");
    vi.stubEnv("OPENCLAW_SEKB_ENABLED", "0");
    expect(
      (
        await new SekbChatKnowledgeSourceAdapter(store, { cfg, identity: identity() }).resolve({
          id: "x",
          title: "x",
          lookup: "x",
        })
      ).status,
    ).toBe("denied");
    expect(query).not.toHaveBeenCalled();
  });

  it("preserves queued owner refs and removes their projection when DCS preparation fails", async () => {
    const refs = (await read()).admitted;
    const queuedRun: FollowupRun["run"] = {
      agentId: "rag-test",
      agentDir: root,
      sessionId: generation,
      sessionKey,
      sessionFile: join(root, "owner.jsonl"),
      workspaceDir: identity().workspaceDir,
      workspaceId: identity().workspaceId,
      config: { ...cfg, runtime: { rc03: { seal: false } } },
      provider: "agent-fixture",
      model: "agent-fixture",
      timeoutMs: 60_000,
      blockReplyBreak: "text_end",
      chatKnowledgeRefs: refs,
    };
    const queuedParams = buildEmbeddedRunBaseParams({
      run: queuedRun,
      provider: queuedRun.provider,
      model: queuedRun.model,
      runId: "rag-dcs-test",
      authProfile: {},
    });
    const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => Promise<unknown>>>();
    const factories = buildEmbeddedExtensionFactories({
      ...queuedParams,
      cfg: queuedParams.config,
      sessionManager: {} as never,
      provider: "agent-fixture",
      modelId: "agent-fixture",
      model: undefined,
      sessionId: generation,
      sessionKey,
      runId: "rag-dcs-test",
      injectionTurnId: `rag-turn-${root}`,
      workspaceId: identity().workspaceId,
      workspaceDir: identity().workspaceDir,
    });
    const api = {
      on(name: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) {
        handlers.set(name, [...(handlers.get(name) ?? []), handler]);
      },
    };
    for (const factory of factories) await factory(api as never);
    let first: { messages: unknown[] } = { messages: [] };
    for (const handler of handlers.get("context") ?? [])
      first = (await handler({ messages: first.messages }, {})) as { messages: unknown[] };
    expect(JSON.stringify(first.messages)).toContain("Owner read contract");
    const failed = vi
      .spyOn(Assembler.prototype, "assemble")
      .mockRejectedValueOnce(new Error("owner preparation unavailable"));
    try {
      let second: { messages: unknown[] } = first;
      for (const handler of handlers.get("context") ?? [])
        second = (await handler({ messages: second.messages }, {})) as { messages: unknown[] };
      expect(JSON.stringify(second.messages)).not.toContain("Owner read contract");
    } finally {
      failed.mockRestore();
    }
  });

  it("resolves a qualified confirmed SEKB id from its real owner namespace", async () => {
    const store = new KnowledgeStore({ database: { path: join(root, "sekb.sqlite") } });
    const now = new Date().toISOString();
    store.save_principle({
      principle_id: "principle-rag",
      created_at: now,
      updated_at: now,
      title: "Owner lesson",
      condition: "when reading",
      action: "check the owner",
      reason: "permissions can change",
      full_content: "",
      task_types: ["chat"],
      context_tags: [],
      embedding: null,
      source_trajectories: [],
      created_by: "agent",
      status: "active",
      retrieval_count: 0,
      adoption_count: 0,
      post_adoption_success: 0,
      criticality: "medium",
      pinned: false,
      metadata: {},
    });
    const adapter = new SekbChatKnowledgeSourceAdapter(store, { cfg, identity: identity() });
    const value = await adapter.resolve({
      id: "sekb:principle-rag",
      title: "Lesson",
      lookup: "sekb:principle-rag",
    });
    expect(value.status).toBe("resolved");
    if (value.status !== "resolved") throw new Error("SEKB owner read failed");
    expect(value.resolved.ownerSnapshot!.source.namespaceId).toBe(store.get_source_namespace_id());
    store.update_principle("principle-rag", { status: "archived" });
    expect(
      (
        await adapter.resolve({
          id: "x",
          title: "Lesson",
          lookup: "x",
          sourceRef: value.resolved.ownerSnapshot!.source,
        })
      ).status,
    ).toBe("denied");
  });
});
