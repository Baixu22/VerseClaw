import { afterEach, describe, expect, it, vi } from "vitest";
import { startQaLabServer } from "./lab-server.js";
import { QA_PERSONAL_AGENT_SCENARIO_IDS } from "./scenario-packs.js";
import { runQaSuite } from "./suite.js";

const fixture = vi.hoisted(() => ({
  failure: "gateway",
  urls: [] as string[],
  stops: [] as Array<() => Promise<void>>,
}));

vi.mock("./gateway-child.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./gateway-child.js")>()),
  startQaGatewayChild: async () => {
    throw new Error("QA deliberate Gateway startup failure");
  },
}));

vi.mock("./providers/server-runtime.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./providers/server-runtime.js")>();
  return {
    ...actual,
    startQaProviderServer: async (...args: Parameters<typeof actual.startQaProviderServer>) => {
      if (fixture.failure === "provider") {
        throw new Error("QA deliberate provider startup failure");
      }
      const provider = await actual.startQaProviderServer(...args);
      if (provider) {
        fixture.urls.push(provider.baseUrl);
        fixture.stops.push(() => provider.stop());
      }
      return provider;
    },
  };
});

afterEach(async () => {
  await Promise.allSettled(fixture.stops.map((stop) => stop()));
  fixture.urls = [];
  fixture.stops = [];
});

describe("QA suite startup cleanup", () => {
  it.each(["provider", "gateway"])(
    "closes acquired HTTP listeners after %s startup fails",
    async (failure) => {
      fixture.failure = failure;
      await expect(
        runQaSuite({
          repoRoot: process.cwd(),
          providerMode: "mock-openai",
          scenarioIds: [QA_PERSONAL_AGENT_SCENARIO_IDS[0]],
          controlUiEnabled: false,
          concurrency: 1,
          startLab: async (params) => {
            const lab = await startQaLabServer(params);
            fixture.urls.push(lab.baseUrl);
            fixture.stops.push(() => lab.stop());
            return lab;
          },
        }),
      ).rejects.toThrow(
        `QA deliberate ${failure === "gateway" ? "Gateway" : "provider"} startup failure`,
      );
      expect(fixture.urls.length).toBe(failure === "gateway" ? 2 : 1);
      for (const url of fixture.urls) {
        await expect(fetch(`${url}/healthz`)).rejects.toThrow();
      }
    },
  );
});
