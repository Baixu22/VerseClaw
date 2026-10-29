import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { resolveEffectiveToolPolicy } from "./agent-tools.policy.js";
import { applyToolPolicyPipeline, buildDefaultToolPolicyPipelineSteps } from "./tool-policy-pipeline.js";
import type { AnyAgentTool } from "./tools/common.js";

const names = ["read", "write", "edit", "apply_patch", "undo_write", "exec"];

function effective(config: OpenClawConfig) {
  const policy = resolveEffectiveToolPolicy({ config, agentId: "main" });
  return applyToolPolicyPipeline({
    tools: names.map(name => ({ name, execute: async () => ({ content: [], details: {} }) }) as unknown as AnyAgentTool),
    toolMeta: () => undefined,
    warn: () => undefined,
    steps: buildDefaultToolPolicyPipelineSteps({ globalPolicy: policy.globalPolicy, agentPolicy: policy.agentPolicy }),
  }).map(tool => tool.name);
}

describe("Main-owned read-only workspace policy at the native tool boundary", () => {
  it.each([
    { security: "allowlist" as const, ask: "always" as const },
    { security: "deny" as const, ask: "always" as const },
  ])("blocks mutations and shell despite global and agent wildcard grants: %j", exec => {
    expect(effective({
      tools: { allow: ["*"], exec },
      agents: { defaults: { sandbox: { mode: "off", workspaceAccess: "ro" } }, list: [{ id: "main", tools: { allow: ["*"] } }] },
    })).toEqual(["read"]);
  });

  it("does not persist the derived restriction or remove an operator deny when switching back", () => {
    const config: OpenClawConfig = { agents: { defaults: { sandbox: { mode: "off", workspaceAccess: "ro" } } }, tools: { allow: ["*"], deny: ["write"], exec: { security: "allowlist", ask: "always" } } };
    expect(effective(config)).toEqual(["read"]);
    expect(config.tools?.deny).toEqual(["write"]);
    config.tools!.exec!.ask = "on-miss";
    expect(effective(config)).toEqual(["read", "edit", "apply_patch", "undo_write", "exec"]);
    expect(config.tools?.deny).toEqual(["write"]);
  });

  it("does not treat a shell-only always-ask configuration as read-only filesystem authority", () => {
    expect(effective({ tools: { exec: { security: "allowlist", ask: "always" } } })).toEqual(names);
  });
});
