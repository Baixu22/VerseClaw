import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultRetrievalPolicy,
  retrievalPolicyDigest,
} from "openclaw/plugin-sdk/knowledge-retrieval";
import { registerMemoryWikiGatewayMethods } from "./src/gateway.js";

const state = vi.hoisted(() => ({ retrieve: vi.fn(async () => ({ status: "empty" })) }));
vi.mock("./src/retrieval/plan-service.js", () => ({ retrieveMemoryWiki: state.retrieve }));
vi.mock("./src/owner-read.js", () => ({
  memoryWikiNamespaceId: () => "agent-owner",
  createMemoryWikiReadContext: () => ({
    schema: "ReadAdmissionContext/v1",
    contextId: "agent-context",
    principalId: "operator",
    sessionId: "session-1",
    sessionKey: "agent:main:main",
    workspaceId: "agent-workspace",
    workspaceRootDigest: "sha256:" + "a".repeat(64),
    policyDigest: "sha256:" + "b".repeat(64),
    ownerNamespaces: ["agent-owner"],
    egressProviderRefs: [],
    expiresAt: "2099-01-01T00:00:00.000Z",
  }),
}));
vi.mock("./src/query.js", () => ({
  searchMemoryWiki: async () => [],
  getMemoryWikiPage: vi.fn(),
  WIKI_SEARCH_MODES: [],
}));

const config = {
  retrieval: { profile: "local" },
  vault: { path: "D:/agent-fixture" },
  search: { backend: "local", corpus: "wiki" },
};
const candidate = { ...defaultRetrievalPolicy("local"), version: "agent-evaluation/v3", rrfK: 40 };
const identity = {
  workspaceId: "agent-workspace",
  workspaceDir: "D:/agent-fixture",
  sessionId: "session-1",
};
beforeEach(() => {
  state.retrieve.mockClear();
});

describe("owner policy evaluation", () => {
  it("registers admin evaluation and keeps candidate parameters out of ordinary retrieval", async () => {
    const methods = new Map<
      string,
      { handler: (context: unknown) => Promise<void>; scope: string }
    >();
    registerMemoryWikiGatewayMethods({
      config: config as never,
      api: {
        registerGatewayMethod: (
          name: string,
          handler: (context: unknown) => Promise<void>,
          options: { scope: string },
        ) => methods.set(name, { handler, scope: options.scope }),
      } as never,
    });
    expect(methods.get("wiki.retrieve")?.scope).toBe("operator.read");
    expect(methods.get("wiki.retrieval.evaluate")?.scope).toBe("operator.admin");
    const respond = vi.fn(),
      context = {
        params: { query: "q", profile: "local", policy: candidate, readIdentity: identity },
        client: { connect: { client: { mode: "backend" } } },
        respond,
      };
    await methods.get("wiki.retrieve")!.handler(context);
    expect(state.retrieve).not.toHaveBeenCalled();
    expect(respond.mock.calls[0][0]).toBe(false);
    await methods.get("wiki.retrieval.evaluate")!.handler(context);
    expect(state.retrieve).toHaveBeenCalledWith(
      expect.objectContaining({ evaluationPolicy: candidate, mode: "manual" }),
    );
    state.retrieve.mockClear();
    await methods
      .get("wiki.retrieval.evaluate")!
      .handler({
        ...context,
        params: { ...context.params, policy: { ...candidate, candidateK: 41 } },
      });
    expect(state.retrieve).not.toHaveBeenCalled();
  });

  it("runs candidate parameters without changing the stored policy", async () => {
    const { retrieveMemoryWiki } = await vi.importActual<
      typeof import("./src/retrieval/plan-service.js")
    >("./src/retrieval/plan-service.js");
    const policy = vi.fn(async () => defaultRetrievalPolicy("local")),
      record = vi.fn(async () => "receipt-1");
    const input = {
      config: config as never,
      identity,
      query: "q",
      profile: "local" as const,
      mode: "manual" as const,
      observability: { policy, record } as never,
    };
    const preview = await retrieveMemoryWiki({ ...input, evaluationPolicy: candidate });
    expect(preview.plan.policyDigest).toBe(retrievalPolicyDigest(candidate));
    expect(policy).not.toHaveBeenCalled();
    const ordinary = await retrieveMemoryWiki(input);
    expect(ordinary.plan.policyDigest).toBe(retrievalPolicyDigest(defaultRetrievalPolicy("local")));
    expect(policy).toHaveBeenCalledTimes(1);
  });
});
