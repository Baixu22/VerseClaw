import { describe, expect, it } from "vitest";
import {
  evaluateCommandApprovalPolicy,
  normalizeCommandApprovalPolicy,
  normalizeCommandPrefix,
} from "./command-approval-policy.js";

describe("normalizeCommandPrefix", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalizeCommandPrefix("  Git   Status --short ")).toBe("git status --short");
  });
});

describe("normalizeCommandApprovalPolicy", () => {
  it("drops malformed rules and keeps valid ones", () => {
    const policy = normalizeCommandApprovalPolicy({
      id: "p1",
      defaultDecision: "forbidden",
      rules: [
        { prefix: "git status", decision: "allow", reason: "read-only" },
        { prefix: "", decision: "allow" },
        { prefix: "rm", decision: "unknown" },
        null,
      ],
    });
    expect(policy.id).toBe("p1");
    expect(policy.defaultDecision).toBe("forbidden");
    expect(policy.rules).toHaveLength(1);
    expect(policy.rules[0]).toMatchObject({ prefix: "git status", decision: "allow", reason: "read-only" });
  });
});

describe("evaluateCommandApprovalPolicy", () => {
  const policy = normalizeCommandApprovalPolicy({
    id: "workspace-policy",
    defaultDecision: "prompt",
    rules: [
      { prefix: "git status", decision: "allow" },
      { prefix: "git", decision: "prompt", reason: "git may mutate" },
      { prefix: "npm run build", decision: "allow" },
      { prefix: "rm -rf", decision: "forbidden", reason: "destructive" },
    ],
  });

  it("defaults to prompt when no rule matches", () => {
    const approval = evaluateCommandApprovalPolicy("unknown-command --flag", policy);
    expect(approval.decision).toBe("prompt");
    expect(approval.policyId).toBe("workspace-policy");
    expect(approval.matchedPrefix).toBeUndefined();
  });

  it("matches the longest prefix and is case/whitespace insensitive", () => {
    expect(evaluateCommandApprovalPolicy("  GIT   STATUS --short ", policy).decision).toBe("allow");
    expect(evaluateCommandApprovalPolicy("git diff", policy).decision).toBe("prompt");
    expect(evaluateCommandApprovalPolicy("npm run build -- --watch", policy).decision).toBe("allow");
    expect(evaluateCommandApprovalPolicy("npm run build:watch", policy).decision).toBe("prompt");
  });

  it("returns forbidden with matched prefix and reason", () => {
    const approval = evaluateCommandApprovalPolicy("rm -rf ./node_modules", policy);
    expect(approval.decision).toBe("forbidden");
    expect(approval.matchedPrefix).toBe("rm -rf");
    expect(approval.reason).toBe("destructive");
  });

  it("does not match a prefix inside a different token", () => {
    const approval = evaluateCommandApprovalPolicy("git status --short", policy);
    expect(approval.matchedPrefix).toBe("git status");
  });
});
