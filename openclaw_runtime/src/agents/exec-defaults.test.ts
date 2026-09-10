import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../infra/exec-approvals.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../infra/exec-approvals.js")>();
  return {
    ...actual,
    loadExecApprovals: vi.fn(() => ({ version: 1, agents: {} })),
  };
});

import { resolveExecDefaults } from "./exec-defaults.js";
import { loadExecApprovals } from "../infra/exec-approvals.js";

describe("resolveExecDefaults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses bounded host execution when config is absent", () => {
    expect(resolveExecDefaults({ cfg: {}, sandboxAvailable: false })).toMatchObject({
      host: "auto",
      effectiveHost: "gateway",
      mode: "ask",
      security: "allowlist",
      ask: "on-miss",
    });
  });

  it("preserves explicit full access and sandbox denial", () => {
    expect(
      resolveExecDefaults({
        cfg: { tools: { exec: { security: "full", ask: "off" } } },
        sandboxAvailable: false,
      }),
    ).toMatchObject({ security: "full", ask: "off", mode: "full" });

    expect(resolveExecDefaults({ cfg: {}, sandboxAvailable: true })).toMatchObject({
      effectiveHost: "sandbox",
      security: "deny",
      ask: "off",
      mode: "deny",
    });
  });

  it("still lets an explicit approvals file tighten full access", () => {
    vi.mocked(loadExecApprovals).mockReturnValueOnce({
      version: 1,
      defaults: { security: "allowlist", ask: "always" },
      agents: {},
    });

    expect(
      resolveExecDefaults({
        cfg: { tools: { exec: { security: "full", ask: "off" } } },
        sandboxAvailable: false,
      }),
    ).toMatchObject({ security: "allowlist", ask: "always", mode: "ask" });
  });
});
