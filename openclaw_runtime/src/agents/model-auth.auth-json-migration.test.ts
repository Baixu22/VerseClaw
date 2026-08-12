import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveApiKeyForProvider } from "./model-auth.js";
import type { AuthProfileStore } from "./auth-profiles/types.js";

const roots: string[] = [];
let originalDeepseekApiKey: string | undefined;

beforeEach(() => {
  originalDeepseekApiKey = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
});

afterEach(() => {
  for (let root = roots.pop(); root; root = roots.pop()) {
    rmSync(root, { recursive: true, force: true });
  }
  if (originalDeepseekApiKey === undefined) {
    delete process.env.DEEPSEEK_API_KEY;
  } else {
    process.env.DEEPSEEK_API_KEY = originalDeepseekApiKey;
  }
});

describe("missing provider auth migration guidance", () => {
  it("points to Doctor when a compatible JSON store is waiting for migration", async () => {
    const agentDir = mkdtempSync(path.join(os.tmpdir(), "openclaw-auth-diagnostic-"));
    roots.push(agentDir);
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      path.join(agentDir, "auth-profiles.json"),
      JSON.stringify({
        version: 1,
        profiles: {
          "deepseek:default": { type: "api_key", provider: "deepseek", key: "fake-json-key" },
        },
      }),
    );
    const emptyStore: AuthProfileStore = { version: 1, profiles: {} };

    await expect(
      resolveApiKeyForProvider({
        provider: "deepseek",
        agentDir,
        store: emptyStore,
      }),
    ).rejects.toThrow("openclaw doctor --fix");
  });
});
