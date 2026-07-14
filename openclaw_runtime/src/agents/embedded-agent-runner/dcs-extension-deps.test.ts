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
import { resolveEmbeddedDcsExtensionDeps } from "./dcs-extension-deps.js";

const upsert = vi.fn(async () => ({ accepted: true }));
const query = vi.fn(async () => []);

vi.mock("../../state/openclaw-state-db.js", () => ({
  openOpenClawStateDatabase: () => ({
    db: {},
  }),
}));

vi.mock("../../context-engine/block-store.js", () => ({
  BlockStore: class {
    upsert = upsert;
    query = query;
  },
}));

beforeEach(() => {
  clearTaskStateHandlerConfig();
  upsert.mockClear();
  query.mockClear();
});

afterEach(() => {
  clearTaskStateHandlerConfig();
});

describe("DCS W1 attempt factory deps wiring", () => {
  it("resolveEmbeddedDcsExtensionDeps returns sink + store and sets handler config via factories", () => {
    const deps = resolveEmbeddedDcsExtensionDeps({
      prompt: "Implement D2 wiring",
      spawnedBy: "agent:parent:main",
    });
    expect(deps).toBeDefined();
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
