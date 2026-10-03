import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXEC_ASK,
  DEFAULT_EXEC_APPROVAL_ASK_FALLBACK,
  DEFAULT_EXEC_SECURITY,
  resolveExecApprovalsFromFile,
} from "./exec-approvals.js";
import { resolveExecPolicyScopeSnapshot } from "./exec-approvals-effective.js";

describe("exec policy defaults", () => {
  it("uses a bounded approval policy when config is absent", () => {
    const resolved = resolveExecApprovalsFromFile({
      file: { version: 1, agents: {} },
    });

    expect(DEFAULT_EXEC_SECURITY).toBe("allowlist");
    expect(DEFAULT_EXEC_ASK).toBe("on-miss");
    expect(DEFAULT_EXEC_APPROVAL_ASK_FALLBACK).toBe("allowlist");
    expect(resolved.agent).toMatchObject({
      security: "allowlist",
      ask: "on-miss",
      askFallback: "allowlist",
    });
  });

  it("keeps explicit full access opt-in intact", () => {
    const resolved = resolveExecApprovalsFromFile({
      file: { version: 1, agents: {} },
      overrides: { security: "full", ask: "off", askFallback: "full" },
    });

    expect(resolved.agent).toMatchObject({
      security: "full",
      ask: "off",
      askFallback: "full",
    });
  });

  it("reports the same bounded defaults that runtime resolution consumes", () => {
    const snapshot = resolveExecPolicyScopeSnapshot({
      approvals: { version: 1, agents: {} },
      configPath: "tools.exec",
      scopeLabel: "tools.exec",
    });

    expect(snapshot.security.requested).toBe("allowlist");
    expect(snapshot.ask.requested).toBe("on-miss");
    expect(snapshot.security.effective).toBe("allowlist");
    expect(snapshot.ask.effective).toBe("on-miss");
    expect(snapshot.askFallback.effective).toBe("allowlist");
    expect(snapshot.mode.requested).toBe("ask");
  });
});
