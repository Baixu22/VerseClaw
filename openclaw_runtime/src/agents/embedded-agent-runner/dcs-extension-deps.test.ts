/**
 * DCS W1: production attempt wiring characterization for DCS factory deps.
 *
 * Proves resolveEmbeddedDcsExtensionDeps supplies sink/store so
 * buildEmbeddedExtensionFactories can set TaskStateHandlerConfig.
 * Removing this helper from the production call path would leave config unset.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, SessionManager } from "../sessions/index.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import type { ProviderRuntimeModel } from "../../plugins/provider-runtime-model.types.js";
import {
  clearTaskStateHandlerConfig,
  getTaskStateHandlerConfig,
} from "../harness/lifecycle-hook-helpers.js";
import { buildEmbeddedExtensionFactories } from "./extensions.js";
import {
  buildBlockStoreUnavailableNotice,
  buildFactServiceUnavailableNotice,
  DCS_BLOCKSTORE_UNAVAILABLE_HEADING,
  DCS_FACTSERVICE_UNAVAILABLE_HEADING,
  resolveEmbeddedDcsExtensionDeps,
} from "./dcs-extension-deps.js";
import { openOpenClawStateDatabase } from "../../state/openclaw-state-db.js";
import { resolveWorkspaceFactService } from "../../context-engine/factstore/workspace-fact-service.js";

const upsert = vi.fn(async () => ({ accepted: true }));
const query = vi.fn(async () => []);

vi.mock("../../state/openclaw-state-db.js", () => ({
  openOpenClawStateDatabase: vi.fn(() => ({
    db: {},
  })),
}));

vi.mock("../../context-engine/block-store.js", () => ({
  BlockStore: class {
    upsert = upsert;
    query = query;
  },
}));

vi.mock("../../context-engine/factstore/workspace-fact-service.js", () => ({
  resolveWorkspaceFactService: vi.fn(() => ({ store: {}, materializer: {} })),
}));

const mockedOpenStateDb = vi.mocked(openOpenClawStateDatabase);
const mockedResolveFactService = vi.mocked(resolveWorkspaceFactService);

beforeEach(() => {
  clearTaskStateHandlerConfig();
  upsert.mockClear();
  query.mockClear();
  mockedOpenStateDb.mockReset();
  mockedOpenStateDb.mockReturnValue({ db: {} } as never);
  mockedResolveFactService.mockReset();
  mockedResolveFactService.mockReturnValue({ store: {}, materializer: {} } as never);
});

afterEach(() => {
  clearTaskStateHandlerConfig();
});

describe("DCS W1 attempt factory deps wiring", () => {
  it("resolveEmbeddedDcsExtensionDeps returns sink + store and sets handler config via factories", () => {
    const resolution = resolveEmbeddedDcsExtensionDeps({
      prompt: "Implement D2 wiring",
      spawnedBy: "agent:parent:main",
    });
    const deps = resolution.deps;
    expect(deps).toBeDefined();
    expect(resolution.degradationNotice).toBeUndefined();
    expect(deps?.contextBlockSink).toBeTypeOf("function");
    expect(deps?.workingMemoryStore).toBeDefined();
    expect(deps?.objective).toBe("Implement D2 wiring");
    expect(deps?.parentSessionId).toBe("agent:parent:main");

    const agent = createAgentRecorder();
    for (const factory of buildEmbeddedExtensionFactories({
      cfg: undefined as OpenClawConfig | undefined,
      sessionManager: {} as SessionManager,
      workspaceDir: "C:/repo",
      provider: "openai",
      modelId: "gpt-test",
      model: undefined as ProviderRuntimeModel | undefined,
      sessionId: "session-1",
      sessionKey: "agent:alpha:main",
      ...deps,
    })) {
      void factory(agent as unknown as ExtensionAPI);
    }

    const config = getTaskStateHandlerConfig();
    expect(config).toBeDefined();
    expect(config?.contextBlockSink).toBe(deps?.contextBlockSink);
    expect(config?.workingMemoryStore).toBe(deps?.workingMemoryStore);
    expect(config?.objective).toBe("Implement D2 wiring");
    expect(config?.parentSessionId).toBe("agent:parent:main");
  });

  it("omits task-state handler config when DCS deps are absent (safe negative path)", () => {
    const agent = createAgentRecorder();
    for (const factory of buildEmbeddedExtensionFactories({
      cfg: undefined as OpenClawConfig | undefined,
      sessionManager: {} as SessionManager,
      workspaceDir: "C:/repo",
      provider: "openai",
      modelId: "gpt-test",
      model: undefined as ProviderRuntimeModel | undefined,
      sessionId: "session-1",
      sessionKey: "agent:alpha:main",
      // intentionally no sink/store
    })) {
      void factory(agent as unknown as ExtensionAPI);
    }
    expect(getTaskStateHandlerConfig()).toBeUndefined();
  });

  it("omits trajectoryCapture when SEKB is not enabled", () => {
    const resolution = resolveEmbeddedDcsExtensionDeps({
      prompt: "Implement D2 wiring",
      spawnedBy: "agent:parent:main",
    });
    expect(resolution.deps?.trajectoryCapture).toBeUndefined();
    expect(resolution.deps?.sekbRuntime).toBeUndefined();
  });

  it("TASK-P0-04: BlockStore open failure returns user-visible degradation notice", () => {
    mockedOpenStateDb.mockImplementation(() => {
      throw new Error("EACCES: permission denied opening state db");
    });
    const resolution = resolveEmbeddedDcsExtensionDeps({
      prompt: "coding turn",
    });
    expect(resolution.deps).toBeUndefined();
    expect(resolution.failureCode).toBe("block_store_open_failed");
    expect(resolution.degradationNotice).toContain(DCS_BLOCKSTORE_UNAVAILABLE_HEADING);
    expect(resolution.degradationNotice).toContain("context_read");
    expect(resolution.degradationNotice).toMatch(/not because the product lacks/i);
    expect(resolution.degradationNotice).toContain("EACCES");
  });

  it("TASK-P0-04: FactService failure keeps BlockStore and surfaces fact-store notice", () => {
    mockedResolveFactService.mockImplementation(() => {
      throw new Error("factstore path unreadable");
    });
    const resolution = resolveEmbeddedDcsExtensionDeps({
      prompt: "coding turn",
      workspaceRoot: "C:/repo",
    });
    expect(resolution.deps?.workingMemoryStore).toBeDefined();
    expect(resolution.deps?.factService).toBeUndefined();
    expect(resolution.failureCode).toBe("fact_service_open_failed");
    expect(resolution.degradationNotice).toContain(DCS_FACTSERVICE_UNAVAILABLE_HEADING);
    expect(resolution.degradationNotice).toContain("context_understand");
    expect(resolution.degradationNotice).toContain("factstore path unreadable");
  });

  it("TASK-P0-04: notice builders never claim feature is absent", () => {
    expect(buildBlockStoreUnavailableNotice(new Error("disk full"))).toContain(
      "temporarily unavailable",
    );
    expect(buildFactServiceUnavailableNotice(new Error("x"))).toContain("until the fact store recovers");
  });
});
type RegisteredHandler = (event: unknown, ctx: { cwd?: string }) => unknown;

function createAgentRecorder() {
  const handlers: Record<string, RegisteredHandler[]> = {};
  return {
    handlers,
    on(event: string, handler: RegisteredHandler) {
      handlers[event] ??= [];
      handlers[event]?.push(handler);
      return Promise.resolve();
    },
  };
}
