import { describe, expect, it } from "vitest";
import {
  getAgentRuntimeCommandSecretTargetIds,
  getScopedChannelsCommandSecretTargets,
} from "./command-secret-targets.js";

describe("command secret targets", () => {
  it("returns the retained agent runtime target closure as a Set", () => {
    const targetIds = getAgentRuntimeCommandSecretTargetIds();

    expect(targetIds).toBeInstanceOf(Set);
    expect(targetIds).toContain("models.providers.*.apiKey");
    expect(targetIds).toContain("agents.defaults.memorySearch.remote.apiKey");
    expect(targetIds).toContain("tools.web.search.apiKey");
  });

  it("returns scoped channel targets in Set-shaped collections", () => {
    const targets = getScopedChannelsCommandSecretTargets({
      config: {},
      channel: "telegram",
      accountId: " default ",
    });

    expect(targets.targetIds).toBeInstanceOf(Set);
    expect(targets.allowedPaths === undefined || targets.allowedPaths instanceof Set).toBe(true);
  });
});
