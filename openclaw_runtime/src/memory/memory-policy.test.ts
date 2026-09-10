/**
 * Branch coverage for the memory governance policy (TF-0118 AC-2).
 *
 * This module is pure decision logic: it decides whether a proposed memory
 * mutation is allowed, how risky it is, whether a card may be injected into a
 * prompt, and when a card should be cooled or tombstoned. Nothing here throws,
 * so every defect is a silently wrong verdict — a role-authored card quietly
 * granted user scope, or a secret card classified as injectable. These tests pin
 * the escalation branches, the precedence between overlapping rules, and the
 * governance invariants the snapshot advertises.
 */
import { describe, expect, it } from "vitest";
import type { MemoryCard, MemoryProposal } from "./types.js";
import {
  classifyInjectionCandidate,
  evaluateMemoryPolicy,
  evaluateRetentionCandidate,
  getMemoryPolicySnapshot,
  inferOwnerRole,
  inferSourceRole,
  MEMORY_CONTEXT_POLICY_VERSION,
  MEMORY_GOVERNANCE_POLICY_VERSION,
  normalizeAllowedMutators,
  normalizeApplicableRoles,
  normalizeMemoryType,
  roleAppliesToCard,
  semanticMemoryType,
  SEMANTIC_MEMORY_TYPES,
} from "./memory-policy.js";

const proposal = (over: Partial<MemoryProposal> = {}): MemoryProposal => ({
  type: "fact",
  scope: "project",
  content: "The project uses pnpm.",
  ...over,
});

const card = (over: Partial<MemoryCard> = {}): MemoryCard => ({
  id: "mem_1",
  type: "fact",
  scope: "project",
  roleTags: ["architect"],
  content: "The project uses pnpm.",
  evidence: ["package.json"],
  confidence: 0.9,
  importance: 0.8,
  lastAccessedAt: "2026-06-12T00:00:00.000Z",
  createdAt: "2026-06-12T00:00:00.000Z",
  accessCount: 1,
  version: 1,
  status: "active",
  supersedes: null,
  supersededBy: null,
  expiresAt: null,
  ...over,
});

describe("normalizeMemoryType / semanticMemoryType", () => {
  it("maps every legacy alias onto a semantic type", () => {
    expect(normalizeMemoryType("project_fact")).toBe("fact");
    expect(normalizeMemoryType("role_experience")).toBe("procedure");
    expect(normalizeMemoryType("episodic")).toBe("episode");
    expect(normalizeMemoryType("procedural")).toBe("procedure");
  });

  it("passes canonical types through and trims whitespace", () => {
    expect(normalizeMemoryType("constraint")).toBe("constraint");
    expect(normalizeMemoryType("  decision  ")).toBe("decision");
  });

  it("falls back to fact for unknown and non-string input", () => {
    expect(normalizeMemoryType("not_a_type")).toBe("fact");
    expect(normalizeMemoryType(undefined)).toBe("fact");
    expect(normalizeMemoryType(42)).toBe("fact");
    expect(normalizeMemoryType(null)).toBe("fact");
    expect(semanticMemoryType(undefined)).toBe("fact");
  });

  it("only ever returns a declared semantic type", () => {
    for (const input of ["project_fact", "episodic", "junk", "risk"]) {
      expect(SEMANTIC_MEMORY_TYPES).toContain(normalizeMemoryType(input));
    }
  });
});

describe("normalizeApplicableRoles", () => {
  it("prefers applicableRoles when present", () => {
    expect(
      normalizeApplicableRoles({ applicableRoles: ["a"], roleTags: ["b"] }),
    ).toEqual(["a"]);
  });

  it("falls back to roleTags when applicableRoles is absent or empty", () => {
    expect(normalizeApplicableRoles({ roleTags: ["b"] })).toEqual(["b"]);
    expect(
      normalizeApplicableRoles({ applicableRoles: [], roleTags: ["b"] }),
    ).toEqual(["b"]);
  });

  it("trims, drops blanks, and dedupes", () => {
    expect(
      normalizeApplicableRoles({ applicableRoles: [" a ", "a", "", "  ", "b"] }),
    ).toEqual(["a", "b"]);
  });

  it("returns an empty list when neither field is set", () => {
    expect(normalizeApplicableRoles({})).toEqual([]);
  });
});

describe("normalizeAllowedMutators", () => {
  it("uses an explicit list when given, trimmed and deduped", () => {
    expect(
      normalizeAllowedMutators({ allowedMutators: [" x ", "x", "y"], source: "user" }),
    ).toEqual(["x", "y"]);
  });

  it("derives defaults from the source", () => {
    expect(normalizeAllowedMutators({ source: "user" })).toEqual(["user", "operator"]);
    expect(normalizeAllowedMutators({ source: "system" })).toEqual(["operator", "system"]);
    expect(normalizeAllowedMutators({ source: "role" })).toEqual(["ownerRole", "operator"]);
    expect(normalizeAllowedMutators({})).toEqual(["ownerRole", "operator"]);
  });
});

describe("inferOwnerRole / inferSourceRole", () => {
  it("prefers an explicit ownerRole, then the first role tag", () => {
    expect(inferOwnerRole({ ownerRole: "lead", roleTags: ["architect"] })).toBe("lead");
    expect(inferOwnerRole({ roleTags: ["architect"] })).toBe("architect");
  });

  it("skips the wildcard when falling back to applicableRoles", () => {
    expect(inferOwnerRole({ applicableRoles: ["*", "reviewer"] })).toBe("reviewer");
    expect(inferOwnerRole({ applicableRoles: ["*"] })).toBeNull();
    expect(inferOwnerRole({})).toBeNull();
  });

  it("only infers a source role for role-authored proposals", () => {
    expect(inferSourceRole({ sourceRole: "x", source: "user" })).toBe("x");
    expect(inferSourceRole({ source: "role", roleTags: ["architect"] })).toBe("architect");
    expect(inferSourceRole({ source: "user", roleTags: ["architect"] })).toBeNull();
    expect(inferSourceRole({ source: "role" })).toBeNull();
  });
});

describe("evaluateMemoryPolicy", () => {
  it("allows a low-risk role-scoped create", () => {
    const out = evaluateMemoryPolicy(proposal({ scope: "role", source: "user" }));
    expect(out.permissionDecision).toBe("allow");
    expect(out.suggestedAction).toBe("approve");
    expect(out.riskLevel).toBe("low");
  });

  it("rejects role-authored constraints aimed at user or workspace scope", () => {
    for (const scope of ["user", "workspace"] as const) {
      const out = evaluateMemoryPolicy(
        proposal({ scope, type: "constraint", source: "role" }),
      );
      expect(out.permissionDecision).toBe("reject");
      expect(out.suggestedAction).toBe("reject");
    }
  });

  it("rejects role-authored non-create operations on user/workspace scope", () => {
    const out = evaluateMemoryPolicy(
      proposal({ scope: "workspace", source: "role", operation: "update" }),
    );
    expect(out.permissionDecision).toBe("reject");
  });

  it("downgrades a role-authored workspace create to cold review", () => {
    const out = evaluateMemoryPolicy(proposal({ scope: "workspace", source: "role" }));
    expect(out.permissionDecision).toBe("needs_review");
    expect(out.suggestedAction).toBe("applyAsCold");
  });

  it("sends role-authored project memory to review", () => {
    const out = evaluateMemoryPolicy(proposal({ scope: "project", source: "role" }));
    expect(out.permissionDecision).toBe("needs_review");
    expect(out.permissionReason).toMatch(/project memory requires review/);
  });

  it("treats a user actor as an operator, not as the role branch", () => {
    // actorKind maps actor.type "user" -> "operator", so the role-scope
    // escalation must not fire even though the proposal source is "role".
    const out = evaluateMemoryPolicy(
      proposal({ scope: "workspace", source: "role" }),
      { actor: { type: "user" } },
    );
    expect(out.permissionDecision).toBe("allow");
  });

  it("requires review before trace summaries mutate existing memory", () => {
    const mutate = evaluateMemoryPolicy(
      proposal({ scope: "session", source: "trace", operation: "update" }),
    );
    expect(mutate.permissionDecision).toBe("needs_review");

    const create = evaluateMemoryPolicy(
      proposal({ scope: "session", source: "trace", operation: "create" }),
    );
    expect(create.permissionDecision).toBe("allow");
  });

  it("restricts system-authored global memory", () => {
    const out = evaluateMemoryPolicy(
      proposal({ scope: "global", source: "system" }),
      { actor: { type: "system" } },
    );
    expect(out.permissionDecision).toBe("needs_review");
    expect(out.suggestedAction).toBe("reject");
  });

  it("asks decisions to be superseded rather than silently updated", () => {
    const out = evaluateMemoryPolicy(
      proposal({ scope: "session", type: "decision", source: "user", operation: "update" }),
    );
    expect(out.permissionDecision).toBe("needs_review");
    expect(out.suggestedAction).toBe("supersede");
  });

  it("escalates risk with scope, type, sensitivity and operation", () => {
    const low = evaluateMemoryPolicy(proposal({ scope: "session", source: "user" }));
    const scoped = evaluateMemoryPolicy(proposal({ scope: "user", source: "user" }));
    const secret = evaluateMemoryPolicy(
      proposal({ scope: "user", source: "user", sensitivity: "secret" }),
    );
    expect(low.riskLevel).toBe("low");
    expect(scoped.riskLevel).toBe("high");
    expect(secret.riskLevel).toBe("critical");
  });

  it("scores secret_adjacent exactly as secret", () => {
    // A deliberate pin: TF-0110 has to reconcile secret_adjacent handling
    // between this policy and the real injection path, so the current
    // equivalence must be visible if anyone changes one side.
    const a = evaluateMemoryPolicy(
      proposal({ scope: "user", source: "user", sensitivity: "secret" }),
    );
    const b = evaluateMemoryPolicy(
      proposal({ scope: "user", source: "user", sensitivity: "secret_adjacent" }),
    );
    expect(b.riskLevel).toBe(a.riskLevel);
  });

  it("reports scope and a human-readable summary", () => {
    const out = evaluateMemoryPolicy(
      proposal({ scope: "project", type: "project_fact", source: "user" }),
    );
    expect(out.impactScope).toBe("project");
    expect(out.reasonSummary).toBe(`${out.riskLevel} risk create on project fact`);
  });
});

describe("roleAppliesToCard", () => {
  it("applies when no role is requested or the card is unrestricted", () => {
    expect(roleAppliesToCard({ applicableRoles: ["a"], roleTags: [] })).toBe(true);
    expect(roleAppliesToCard({ roleTags: [] }, "architect")).toBe(true);
    expect(roleAppliesToCard({ applicableRoles: ["*"], roleTags: [] }, "architect")).toBe(true);
  });

  it("matches by name and rejects non-members", () => {
    expect(roleAppliesToCard({ applicableRoles: ["architect"], roleTags: [] }, "architect")).toBe(true);
    expect(roleAppliesToCard({ applicableRoles: ["reviewer"], roleTags: [] }, "architect")).toBe(false);
  });

  it("falls back to roleTags when applicableRoles is empty", () => {
    expect(roleAppliesToCard({ applicableRoles: [], roleTags: ["architect"] }, "architect")).toBe(true);
  });
});

describe("classifyInjectionCandidate", () => {
  const base = { taskMatch: 0.5, conflict: false, expired: false };

  it("never injects inactive, superseded, expired or secret cards", () => {
    for (const over of [
      { status: "archived" as const },
      { status: "tombstone" as const },
      { supersededBy: "mem_2" },
      { sensitivity: "secret" as const },
    ]) {
      expect(
        classifyInjectionCandidate({ ...base, card: card(over) }).injectionClass,
      ).toBe("never");
    }
    expect(
      classifyInjectionCandidate({ ...base, card: card(), expired: true }).injectionClass,
    ).toBe("never");
  });

  it("tells an expired card what would make it selectable", () => {
    const out = classifyInjectionCandidate({ ...base, card: card(), expired: true });
    expect(out.whatWouldSelect).toMatch(/fresh proposal/);
  });

  it("puts the never check ahead of the constraint check", () => {
    // A secret constraint must not be promoted to "must" just because
    // constraints are normally mandatory.
    const out = classifyInjectionCandidate({
      ...base,
      card: card({ type: "constraint", sensitivity: "secret" }),
    });
    expect(out.injectionClass).toBe("never");
  });

  it("treats active constraints and open conflicts as must", () => {
    expect(
      classifyInjectionCandidate({ ...base, card: card({ type: "constraint" }) }).injectionClass,
    ).toBe("must");
    expect(
      classifyInjectionCandidate({ ...base, card: card(), conflict: true }).injectionClass,
    ).toBe("must");
  });

  it("recommends important decisions, matched procedures, and phase-relevant risks", () => {
    expect(
      classifyInjectionCandidate({
        ...base,
        card: card({ type: "decision", importance: 0.7 }),
      }).injectionClass,
    ).toBe("should");
    expect(
      classifyInjectionCandidate({
        ...base,
        card: card({ type: "procedure" }),
        roleName: "architect",
      }).injectionClass,
    ).toBe("should");
    expect(
      classifyInjectionCandidate({
        ...base,
        card: card({ type: "risk" }),
        phase: "review",
      }).injectionClass,
    ).toBe("should");
  });

  it("keeps an unimportant decision below the should threshold", () => {
    expect(
      classifyInjectionCandidate({
        ...base,
        card: card({ type: "decision", importance: 0.69 }),
      }).injectionClass,
    ).not.toBe("should");
  });

  it("gates facts and handoffs on the task match threshold", () => {
    for (const type of ["fact", "handoff"] as const) {
      expect(
        classifyInjectionCandidate({ ...base, card: card({ type }), taskMatch: 0.45 })
          .injectionClass,
      ).toBe("should");
      expect(
        classifyInjectionCandidate({ ...base, card: card({ type }), taskMatch: 0.44 })
          .injectionClass,
      ).toBe("may");
    }
  });

  it("asks cold memory for a stronger match and says so", () => {
    const out = classifyInjectionCandidate({
      ...base,
      card: card({ status: "cold", type: "episode" }),
      taskMatch: 0.5,
    });
    expect(out.injectionClass).toBe("may");
    expect(out.whatWouldSelect).toMatch(/key terms/);
  });

  it("hints at a stronger match only for weakly matched leftovers", () => {
    const weak = classifyInjectionCandidate({
      ...base,
      card: card({ type: "episode" }),
      taskMatch: 0.2,
    });
    expect(weak.injectionClass).toBe("may");
    expect(weak.whatWouldSelect).toMatch(/stronger task match/);

    const midling = classifyInjectionCandidate({
      ...base,
      card: card({ type: "episode" }),
      taskMatch: 0.5,
    });
    expect(midling.whatWouldSelect).toBeUndefined();
  });
});

describe("evaluateRetentionCandidate", () => {
  const now = new Date("2026-06-12T00:00:00.000Z");
  const daysAgo = (n: number) =>
    new Date(now.getTime() - n * 86_400_000).toISOString();

  it("tombstones expired session and task memory", () => {
    for (const scope of ["session", "task"] as const) {
      const out = evaluateRetentionCandidate(
        card({ scope, expiresAt: daysAgo(1) }),
        now,
      );
      expect(out.recommendedAction).toBe("tombstone");
    }
  });

  it("reviews rather than auto-archives stale governance memory", () => {
    for (const type of ["constraint", "decision"] as const) {
      const stale = evaluateRetentionCandidate(
        card({ type, updatedAt: daysAgo(200) }),
        now,
      );
      expect(stale.recommendedAction).toBe("review");

      const cold = evaluateRetentionCandidate(card({ type, status: "cold" }), now);
      expect(cold.recommendedAction).toBe("review");
    }
  });

  it("cools a low-scoring active card and archives a low-scoring cold one", () => {
    const weak = {
      type: "episode" as const,
      importance: 0,
      confidence: 0,
      accessCount: 0,
      evidence: [],
      updatedAt: daysAgo(200),
    };
    expect(evaluateRetentionCandidate(card({ ...weak }), now).recommendedAction).toBe("cold");
    expect(
      evaluateRetentionCandidate(card({ ...weak, status: "cold" }), now).recommendedAction,
    ).toBe("archive");
  });

  it("keeps a strong, fresh, well-evidenced card", () => {
    const out = evaluateRetentionCandidate(
      card({
        importance: 0.9,
        confidence: 0.9,
        accessCount: 10,
        evidence: ["a", "b", "c"],
        updatedAt: daysAgo(1),
      }),
      now,
    );
    expect(out.recommendedAction).toBe("keep");
    expect(out.retentionScore).toBeGreaterThan(0.45);
  });

  it("labels staleness, disuse and importance", () => {
    const out = evaluateRetentionCandidate(
      card({ type: "constraint", accessCount: 0, updatedAt: daysAgo(150) }),
      now,
    );
    expect(out.labels).toContain("Likely stale");
    expect(out.labels).toContain("Rarely used");
    expect(out.labels).toContain("Still important");
    expect(out.card.retentionLabels).toEqual(out.labels);
  });

  it("penalises secret and secret_adjacent cards equally", () => {
    const plain = evaluateRetentionCandidate(card(), now).retentionScore;
    const secret = evaluateRetentionCandidate(card({ sensitivity: "secret" }), now)
      .retentionScore;
    const adjacent = evaluateRetentionCandidate(
      card({ sensitivity: "secret_adjacent" }),
      now,
    ).retentionScore;
    expect(secret).toBeCloseTo(plain - 0.2, 4);
    expect(adjacent).toBe(secret);
  });

  it("treats an unparseable timestamp as age zero instead of NaN", () => {
    const out = evaluateRetentionCandidate(card({ updatedAt: "not-a-date" }), now);
    expect(Number.isFinite(out.retentionScore)).toBe(true);
    expect(out.labels).not.toContain("Likely stale");
  });
});

describe("getMemoryPolicySnapshot", () => {
  it("advertises the pinned policy versions", () => {
    const snap = getMemoryPolicySnapshot();
    expect(snap.version).toBe(MEMORY_GOVERNANCE_POLICY_VERSION);
    expect(snap.contextPolicyVersion).toBe(MEMORY_CONTEXT_POLICY_VERSION);
  });

  it("keeps automatic mutation off and the evidence bridge read-only", () => {
    // Two governance invariants: memory is never mutated without review, and
    // the native evidence bridge never writes. Both are load-bearing claims
    // made to operators, so flipping either should break a test.
    const snap = getMemoryPolicySnapshot();
    expect(snap.lifecyclePolicy.automaticMutation).toBe(false);
    expect(snap.evidencePolicy.nativeBridge).toBe("read_only");
  });

  it("keeps the injection classes and retention actions in sync with the logic", () => {
    const snap = getMemoryPolicySnapshot();
    expect([...snap.injectionClasses].sort()).toEqual(["may", "must", "never", "should"]);
    expect([...snap.lifecyclePolicy.allowedActions].sort()).toEqual([
      "archive",
      "cold",
      "keep",
      "review",
      "tombstone",
    ]);
  });
});
