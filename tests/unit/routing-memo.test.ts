import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  buildMemoActiveAdjustment,
  buildMemoShadowReason,
  computeTaskDigest,
  readRoutingMemoDashboard,
  recordRoutingMemo,
  recallRoutingMemos,
  resolveRoutingMemoAuthority,
  resolveMemoFilePath,
  resolveRoutingMemoPilotMode,
  taskDigestSimilarity,
  DEFAULT_ROUTING_MEMO_PILOT_MODE,
  ROUTING_MEMO_MAX_ENTRIES,
  ROUTING_MEMO_RECALL_SIMILARITY_THRESHOLD,
  type RoutingMemo,
  type RoutingMemoMatch,
} from "../../openclaw_runtime/src/agents/routing-memo";

function makeMemo(overrides: Partial<RoutingMemo> = {}): RoutingMemo {
  return {
    id: `memo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
    taskDigest: ["review", "security", "diff"],
    mode: "router",
    leadRole: "reviewer",
    workerRoles: ["reviewer"],
    outcome: { graphStatus: "completed", repairCount: 0 },
    ...overrides,
  };
}

function makeMatch(overrides: Partial<RoutingMemoMatch> = {}): RoutingMemoMatch {
  return {
    memo: makeMemo(),
    similarity: 0.75,
    ...overrides,
  };
}

describe("routing-memo (Area 3 §3.1)", () => {
  describe("resolveRoutingMemoPilotMode", () => {
    it("returns 'off' for undefined input", () => {
      expect(resolveRoutingMemoPilotMode(undefined)).toBe(DEFAULT_ROUTING_MEMO_PILOT_MODE);
      expect(resolveRoutingMemoPilotMode("off")).toBe("off");
    });

    it("returns 'off' for non-record input", () => {
      expect(resolveRoutingMemoPilotMode("shadow")).toBe("off");
      expect(resolveRoutingMemoPilotMode(42)).toBe("off");
      expect(resolveRoutingMemoPilotMode(null)).toBe("off");
      expect(resolveRoutingMemoPilotMode([])).toBe("off");
    });

    it("reads runtime.orchestration.routingMemoPilot = 'shadow'", () => {
      const cfg = { runtime: { orchestration: { routingMemoPilot: "shadow" } } };
      expect(resolveRoutingMemoPilotMode(cfg)).toBe("shadow");
    });

    it("reads runtime.orchestration.routingMemoPilot = 'active'", () => {
      const cfg = { runtime: { orchestration: { routingMemoPilot: "active" } } };
      expect(resolveRoutingMemoPilotMode(cfg)).toBe("active");
    });

    it("falls back to 'off' for unknown pilot values", () => {
      const cfg = { runtime: { orchestration: { routingMemoPilot: "experimental" } } };
      expect(resolveRoutingMemoPilotMode(cfg)).toBe("off");
    });

    it("falls back to 'off' when orchestration block is missing", () => {
      const cfg = { runtime: { features: { foo: true } } };
      expect(resolveRoutingMemoPilotMode(cfg)).toBe("off");
    });

    it("falls back to 'off' when runtime block is missing", () => {
      const cfg = { agents: { defaults: {} } };
      expect(resolveRoutingMemoPilotMode(cfg)).toBe("off");
    });
  });

  describe("computeTaskDigest", () => {
    it("lowercases tokens and drops punctuation", () => {
      const digest = computeTaskDigest("Review THE Security Diff!");
      expect(digest).toEqual(expect.arrayContaining(["review", "security", "diff"]));
      expect(digest).not.toContain("the");
    });

    it("drops stopwords and tokens shorter than 2 chars", () => {
      const digest = computeTaskDigest("a plan to fix the bug");
      expect(digest).toEqual(expect.arrayContaining(["plan", "fix", "bug"]));
      expect(digest).not.toContain("a");
      expect(digest).not.toContain("to");
      expect(digest).not.toContain("the");
    });

    it("supports CJK characters as tokens", () => {
      const digest = computeTaskDigest("对用户行为数据进行建模");
      // CJK characters survive the [^a-z0-9\u4e00-\u9fff] split.
      expect(digest).toEqual(expect.arrayContaining(["对用户行为数据进行建模"]));
    });

    it("combines task and fileHints into one digest", () => {
      // Note: "auth.ts" splits on "." into ["auth", "ts"] — only alphanumeric
      // and CJK runs survive the digest tokenizer. This is intentional: file
      // extensions add little routing signal, but file basenames do.
      const digest = computeTaskDigest("review the diff", ["auth.ts", "token.ts"]);
      expect(digest).toEqual(expect.arrayContaining(["review", "diff", "auth", "token", "ts"]));
    });

    it("returns a de-duplicated, sorted array", () => {
      const digest = computeTaskDigest("review review review diff diff");
      const unique = [...new Set(digest)].sort();
      expect(digest).toEqual(unique);
    });

    it("returns empty array for empty input", () => {
      expect(computeTaskDigest("")).toEqual([]);
      expect(computeTaskDigest("", [])).toEqual([]);
    });
  });

  describe("taskDigestSimilarity", () => {
    it("returns 1.0 for identical digests", () => {
      const digest = ["review", "security", "diff"];
      expect(taskDigestSimilarity(digest, digest)).toBe(1);
    });

    it("returns 0 for disjoint digests", () => {
      expect(taskDigestSimilarity(["alpha"], ["beta"])).toBe(0);
    });

    it("returns 0 when either digest is empty", () => {
      expect(taskDigestSimilarity([], ["alpha"])).toBe(0);
      expect(taskDigestSimilarity(["alpha"], [])).toBe(0);
      expect(taskDigestSimilarity([], [])).toBe(0);
    });

    it("computes Jaccard similarity for partial overlap", () => {
      // intersection=2, union=4 → 0.5
      expect(taskDigestSimilarity(["a", "b", "c"], ["b", "c", "d"])).toBeCloseTo(0.5, 5);
    });

    it("handles duplicate tokens in input by Set semantics", () => {
      // Sets dedupe; intersection=2, union=3 → 2/3.
      const sim = taskDigestSimilarity(["a", "a", "b", "c"], ["b", "c", "c"]);
      expect(sim).toBeCloseTo(2 / 3, 5);
    });
  });

  describe("buildMemoShadowReason", () => {
    it("emits 'similar-task-success' for completed graph status", () => {
      const match = makeMatch({
        memo: makeMemo({ leadRole: "reviewer", outcome: { graphStatus: "completed", repairCount: 0 } }),
        similarity: 0.72,
      });
      expect(buildMemoShadowReason(match)).toBe("memo-shadow:similar-task-success:reviewer:0.72");
    });

    it("emits 'similar-task-success' for qualityOverall='good'", () => {
      const match = makeMatch({
        memo: makeMemo({
          leadRole: "implementer",
          outcome: { graphStatus: "partial", qualityOverall: "good", repairCount: 0 },
        }),
        similarity: 0.65,
      });
      expect(buildMemoShadowReason(match)).toBe("memo-shadow:similar-task-success:implementer:0.65");
    });

    it("emits 'similar-task-poor' for qualityOverall='poor_attempt'", () => {
      const match = makeMatch({
        memo: makeMemo({
          leadRole: "implementer",
          outcome: { graphStatus: "failed", qualityOverall: "poor_attempt", repairCount: 2 },
        }),
        similarity: 0.55,
      });
      expect(buildMemoShadowReason(match)).toBe("memo-shadow:similar-task-poor:implementer:0.55");
    });

    it("emits 'similar-task-unclear' when neither success nor poor", () => {
      const match = makeMatch({
        memo: makeMemo({
          leadRole: "planner",
          outcome: { graphStatus: "partial", repairCount: 1 },
        }),
        similarity: 0.5,
      });
      expect(buildMemoShadowReason(match)).toBe("memo-shadow:similar-task-unclear:planner:0.50");
    });
  });

  describe("buildMemoActiveAdjustment", () => {
    it("returns +2 for completed graph status", () => {
      const match = makeMatch({
        memo: makeMemo({ leadRole: "reviewer", outcome: { graphStatus: "completed", repairCount: 0 } }),
      });
      expect(buildMemoActiveAdjustment(match)).toEqual({
        delta: 2,
        reason: "memo:similar-task-success:reviewer",
      });
    });

    it("returns +2 for qualityOverall='good' even with partial graph status", () => {
      const match = makeMatch({
        memo: makeMemo({
          leadRole: "implementer",
          outcome: { graphStatus: "partial", qualityOverall: "good", repairCount: 0 },
        }),
      });
      expect(buildMemoActiveAdjustment(match)).toEqual({
        delta: 2,
        reason: "memo:similar-task-success:implementer",
      });
    });

    it("returns -1 for qualityOverall='poor_attempt'", () => {
      const match = makeMatch({
        memo: makeMemo({
          leadRole: "implementer",
          outcome: { graphStatus: "failed", qualityOverall: "poor_attempt", repairCount: 2 },
        }),
      });
      expect(buildMemoActiveAdjustment(match)).toEqual({
        delta: -1,
        reason: "memo:similar-task-poor:implementer",
      });
    });

    it("returns undefined for unclear outcome", () => {
      const match = makeMatch({
        memo: makeMemo({
          leadRole: "planner",
          outcome: { graphStatus: "partial", repairCount: 1 },
        }),
      });
      expect(buildMemoActiveAdjustment(match)).toBeUndefined();
    });
  });

  describe("recordRoutingMemo + recallRoutingMemos (file-backed)", () => {
    let workspace: string;

    beforeEach(() => {
      workspace = mkdtempSync(join(tmpdir(), "routing-memo-"));
    });

    afterEach(() => {
      rmSync(workspace, { recursive: true, force: true });
    });

    it("recordRoutingMemo is a no-op when workspaceDir is undefined", () => {
      const memo = makeMemo();
      recordRoutingMemo(memo, undefined);
      // No file created anywhere; no throw.
      expect(true).toBe(true);
    });

    it("recordRoutingMemo appends a JSONL line under .clawx/orchestration/", () => {
      const memo = makeMemo({ id: "memo-test-1" });
      recordRoutingMemo(memo, workspace);
      const filePath = resolveMemoFilePath(workspace);
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, "utf8").trim();
      expect(content).toBe(JSON.stringify(memo));
    });

    it("recallRoutingMemos returns [] when store is missing", () => {
      const matches = recallRoutingMemos(["review"], workspace);
      expect(matches).toEqual([]);
    });

    it("recallRoutingMemos returns [] when workspaceDir is undefined", () => {
      recordRoutingMemo(makeMemo(), workspace);
      const matches = recallRoutingMemos(["review"], undefined);
      expect(matches).toEqual([]);
    });

    it("recallRoutingMemos returns [] when taskDigest is empty", () => {
      recordRoutingMemo(makeMemo({ taskDigest: ["review"] }), workspace);
      const matches = recallRoutingMemos([], workspace);
      expect(matches).toEqual([]);
    });

    it("recallRoutingMemos returns matches above threshold, sorted by similarity desc", () => {
      const memoHigh = makeMemo({
        id: "memo-high",
        createdAt: "2026-01-01T00:00:00.000Z",
        taskDigest: ["review", "security", "diff"],
      });
      const memoLow = makeMemo({
        id: "memo-low",
        createdAt: "2026-01-02T00:00:00.000Z",
        taskDigest: ["review", "documentation"],
      });
      recordRoutingMemo(memoHigh, workspace);
      recordRoutingMemo(memoLow, workspace);
      // query shares 3/3 with memoHigh (sim=1.0) and 1/2 with memoLow (sim=0.333 < 0.5 threshold)
      const matches = recallRoutingMemos(["review", "security", "diff"], workspace);
      expect(matches).toHaveLength(1);
      expect(matches[0]!.memo.id).toBe("memo-high");
      expect(matches[0]!.similarity).toBe(1);
    });

    it("recallRoutingMemos tie-breaks by recency (newer first)", () => {
      const older = makeMemo({
        id: "memo-older",
        createdAt: "2026-01-01T00:00:00.000Z",
        taskDigest: ["alpha", "beta", "gamma"],
      });
      const newer = makeMemo({
        id: "memo-newer",
        createdAt: "2026-02-01T00:00:00.000Z",
        taskDigest: ["alpha", "beta", "gamma"],
      });
      recordRoutingMemo(older, workspace);
      recordRoutingMemo(newer, workspace);
      const matches = recallRoutingMemos(["alpha", "beta", "gamma"], workspace);
      expect(matches).toHaveLength(2);
      expect(matches[0]!.memo.id).toBe("memo-newer");
      expect(matches[1]!.memo.id).toBe("memo-older");
    });

    it("recallRoutingMemos respects limit option", () => {
      for (let i = 0; i < 8; i++) {
        recordRoutingMemo(
          makeMemo({
            id: `memo-${i}`,
            createdAt: new Date(2026, 0, i + 1).toISOString(),
            taskDigest: ["alpha", "beta"],
          }),
          workspace,
        );
      }
      const matches = recallRoutingMemos(["alpha", "beta"], workspace, { limit: 3 });
      expect(matches).toHaveLength(3);
    });

    it("recallRoutingMemos respects custom threshold option", () => {
      recordRoutingMemo(
        makeMemo({ id: "memo-low-sim", taskDigest: ["alpha", "beta", "gamma", "delta", "epsilon"] }),
        workspace,
      );
      // query=[alpha,beta], memo=[alpha,beta,gamma,delta,epsilon]
      // intersection=2, union=5 → sim = 2/5 = 0.4
      // default threshold 0.5 excludes; threshold 0.3 includes.
      expect(recallRoutingMemos(["alpha", "beta"], workspace)).toEqual([]);
      const relaxed = recallRoutingMemos(["alpha", "beta"], workspace, { threshold: 0.3 });
      expect(relaxed).toHaveLength(1);
      expect(relaxed[0]!.similarity).toBeCloseTo(2 / 5, 5);
    });

    it("recallRoutingMemos skips corrupt JSONL lines and returns valid ones", () => {
      const filePath = resolveMemoFilePath(workspace);
      mkdirSync(dirname(filePath), { recursive: true });
      // Manually write a corrupt line between two valid ones.
      const valid1 = makeMemo({ id: "valid-1", taskDigest: ["alpha", "beta"] });
      const valid2 = makeMemo({ id: "valid-2", taskDigest: ["alpha", "beta"] });
      const lines = [
        JSON.stringify(valid1),
        "{not valid json",
        JSON.stringify(valid2),
        "",
      ];
      writeFileSync(filePath, lines.join("\n") + "\n", "utf8");
      const matches = recallRoutingMemos(["alpha", "beta"], workspace);
      expect(matches).toHaveLength(2);
      expect(matches.map((m) => m.memo.id).sort()).toEqual(["valid-1", "valid-2"]);
    });

    it("recallRoutingMemos skips lines that fail normalizeMemo (missing required fields)", () => {
      const filePath = resolveMemoFilePath(workspace);
      mkdirSync(dirname(filePath), { recursive: true });
      const valid = makeMemo({ id: "valid", taskDigest: ["alpha", "beta"] });
      const malformed = { id: "bad", createdAt: "x" /* missing required fields */ };
      writeFileSync(filePath, `${JSON.stringify(valid)}\n${JSON.stringify(malformed)}\n`, "utf8");
      const matches = recallRoutingMemos(["alpha", "beta"], workspace);
      expect(matches).toHaveLength(1);
      expect(matches[0]!.memo.id).toBe("valid");
    });

    it("compacts the store to ROUTING_MEMO_MAX_ENTRIES on load when exceeded", () => {
      const filePath = resolveMemoFilePath(workspace);
      mkdirSync(dirname(filePath), { recursive: true });
      // Write ROUTING_MEMO_MAX_ENTRIES + 5 lines directly.
      const memos: RoutingMemo[] = [];
      for (let i = 0; i < ROUTING_MEMO_MAX_ENTRIES + 5; i++) {
        memos.push(
          makeMemo({
            id: `memo-${i}`,
            createdAt: new Date(2026, 0, 1, 0, 0, i).toISOString(),
            taskDigest: ["alpha", "beta"],
          }),
        );
      }
      writeFileSync(filePath, memos.map((m) => JSON.stringify(m)).join("\n") + "\n", "utf8");
      // Trigger recall (which triggers compaction).
      recallRoutingMemos(["alpha", "beta"], workspace);
      // After compaction, file should have exactly ROUTING_MEMO_MAX_ENTRIES lines.
      const after = readFileSync(filePath, "utf8").trim().split(/\r?\n/);
      expect(after.length).toBe(ROUTING_MEMO_MAX_ENTRIES);
      // The newest ROUTING_MEMO_MAX_ENTRIES are kept (the last 500 by createdAt).
      const keptIds = after.map((line) => (JSON.parse(line) as { id: string }).id);
      expect(keptIds).toContain(`memo-${ROUTING_MEMO_MAX_ENTRIES + 4}`);
      expect(keptIds).not.toContain("memo-0");
    });
  });

  describe("readRoutingMemoDashboard", () => {
    let workspace: string;

    beforeEach(() => {
      workspace = mkdtempSync(join(tmpdir(), "routing-memo-dashboard-"));
    });

    afterEach(() => {
      rmSync(workspace, { recursive: true, force: true });
    });

    it("summarizes shadow samples, divergences, outcomes, and active gate status", () => {
      recordRoutingMemo(
        makeMemo({
          id: "memo-shadow-diverged",
          createdAt: "2026-01-03T00:00:00.000Z",
          leadRole: "implementer",
          outcome: { graphStatus: "completed", qualityOverall: "good", repairCount: 0 },
          shadowObservation: {
            mode: "shadow",
            actualLeadRole: "implementer",
            memoLeadRole: "reviewer",
            diverged: true,
            outcome: "memo_worse",
            similarity: 0.72,
          },
        }),
        workspace,
      );
      recordRoutingMemo(
        makeMemo({
          id: "memo-shadow-same",
          createdAt: "2026-01-04T00:00:00.000Z",
          leadRole: "reviewer",
          outcome: { graphStatus: "partial", qualityOverall: "needs_attention", repairCount: 0 },
          shadowObservation: {
            mode: "shadow",
            actualLeadRole: "reviewer",
            memoLeadRole: "reviewer",
            diverged: false,
            outcome: "same",
            similarity: 0.91,
          },
        }),
        workspace,
      );

      const dashboard = readRoutingMemoDashboard(workspace, {
        runtime: { orchestration: { routingMemoPilot: "shadow" } },
      });

      expect(dashboard.pilotMode).toBe("shadow");
      expect(dashboard.authority).toBe("shadow");
      expect(dashboard.sampleCount).toBe(2);
      expect(dashboard.outcomes.graphStatus).toMatchObject({ completed: 1, partial: 1 });
      expect(dashboard.shadow.sampleCount).toBe(2);
      expect(dashboard.shadow.divergenceCount).toBe(1);
      expect(dashboard.shadow.outcomes).toMatchObject({ same: 1, memo_worse: 1 });
      expect(dashboard.activeGate.eligible).toBe(false);
      expect(dashboard.activeGate.reasons).toEqual(expect.arrayContaining(["shadow-sample-count-below-threshold"]));
      expect(dashboard.recentSamples[0]).toMatchObject({
        id: "memo-shadow-same",
        leadRole: "reviewer",
        graphStatus: "partial",
        shadow: { diverged: false, outcome: "same" },
      });
    });
  });

  describe("resolveRoutingMemoAuthority", () => {
    it("keeps requested active mode in shadow without scorecard-backed quality", () => {
      expect(resolveRoutingMemoAuthority({
        pilotMode: "active",
        qualityState: null,
      })).toMatchObject({
        authority: "shadow",
        reason: "missing-scorecard-quality",
      });

      expect(resolveRoutingMemoAuthority({
        pilotMode: "active",
        qualityState: { source: "ordinary_orchestration", qualityOverall: "good", scorecardBacked: false },
      })).toMatchObject({
        authority: "shadow",
        reason: "missing-scorecard-quality",
      });
    });

    it("allows active authority only for scorecard-backed quality", () => {
      expect(resolveRoutingMemoAuthority({
        pilotMode: "active",
        qualityState: { source: "scorecard", qualityOverall: "good", scorecardBacked: true },
      })).toMatchObject({
        authority: "active",
        reason: "scorecard-quality-present",
      });
    });
  });

  describe("default constants and thresholds", () => {
    it("DEFAULT_ROUTING_MEMO_PILOT_MODE is 'off' (default-off)", () => {
      expect(DEFAULT_ROUTING_MEMO_PILOT_MODE).toBe("off");
    });

    it("ROUTING_MEMO_RECALL_SIMILARITY_THRESHOLD is 0.5", () => {
      expect(ROUTING_MEMO_RECALL_SIMILARITY_THRESHOLD).toBe(0.5);
    });

    it("ROUTING_MEMO_MAX_ENTRIES is 500", () => {
      expect(ROUTING_MEMO_MAX_ENTRIES).toBe(500);
    });
  });

  describe("resolveMemoFilePath", () => {
    it("places the store under .clawx/orchestration/routing-memos.jsonl", () => {
      const path = resolveMemoFilePath("/tmp/workspace");
      const expected = join("/tmp/workspace", ".clawx", "orchestration", "routing-memos.jsonl");
      expect(path).toBe(expected);
    });
  });
});
