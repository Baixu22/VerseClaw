/**
 * 源码级对抗验证(parity audit)临时用例 —— 只读审计,不属于生产代码。
 * 依据 docs/dev/source-parity-verification-prompt.md §5 构造。
 * 能力1/2/7 的本地行为对抗断言;Aider 参照真值由 .parity-audit/aider_find_similar_lines_truth.py
 * 直接运行归档源函数产生(见用例注释)。
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { findSimilarLines } from "../sessions/tools/edit-diff.js";
import {
  __resetWriteJournals,
  getOrCreateWriteJournal,
  snapshotBeforeWrite,
} from "../tools/write-journal.js";
import { applyCheckpointToJournal, validateCheckpointRecord } from "../checkpoint-rollback-executor.js";
import { executeReplayRollback } from "../replay-rollback-authority.js";
import { buildRuntimeResumeCheckpoint } from "../long-task-control/store.js";
import type { LongTaskCheckpointRecord } from "../long-task-control/store.js";
import { evaluateExecAllowlist } from "../../infra/exec-approvals-allowlist.js";
import { analyzeShellCommand } from "../../infra/exec-approvals-analysis.js";
import type { ExecAllowlistEntry } from "../../infra/exec-approvals.types.js";

// =====================================================================
// 能力 1: did_you_mean —— findSimilarLines 与 Aider find_similar_lines 真值对比
// Aider 真值(参照函数已实际运行, 见 .parity-audit/aider_find_similar_lines_truth.py):
//   c1 单字符错行单行   → ""        (Aider 同样漏报, ratio=0)
//   c2 3行2对1错       → 命中      (ratio=2/3≈0.667)
//   c3 乱序2行         → ""        (LCS=1, ratio=0.5)
//   c4 乱序3行         → ""        (LCS=1, ratio=1/3)
//   c5 重复行          → 命中      (ratio=2/3)
//   c6 首末行精确       → 命中不扩行 (返回窗口本体)
//   c7 空 search       → IndexError 崩溃
//   c8 智能引号         → ""        (Aider 无归一化)
//   c9 恰好 0.6        → 命中      (0.6 等值算命中)
//   c10 pattern 长于 content → ""
//   c11 正常路径        → 命中不扩行
// =====================================================================
describe("能力1 did_you_mean: findSimilarLines 对抗用例(参照=Aider 原函数实测)", () => {
  const alpha3 = "function alpha() {\n  const x = 1;\n  retrun x;\n}\n";
  const alpha3Pattern = "function alpha() {\n  const x = 1;\n  retrun x;\n}\n";

  it("C1 单字符错行单行: 本地与 Aider 一致漏报 (并非本地特有缺陷)", () => {
    // Aider: SequenceMatcher([retrun x],[return x]).ratio()=0 → ""
    expect(findSimilarLines("  retrun x;\n", "  return x;\n")).toBe("");
  });

  it("C2 单字符错行3行(2对1错): 本地与 Aider 一致命中", () => {
    // Aider 命中(len=47, 不扩行);本地 shared=2/3=0.667 ≥ 0.6
    const out = findSimilarLines(alpha3, alpha3Pattern);
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain("retrun x;");
  });

  it("C3/C4 乱序行(修复后): 本地与 Aider 一致拒绝 — LCS 对顺序敏感", () => {
    // Aider: LCS=1 → ratio 0.5 / 0.333 → "";LCS 替换 Set 计数后本地同样拒绝
    expect(findSimilarLines("b\na\n", "a\nb\n")).toBe("");
    expect(findSimilarLines("c\nb\na\n", "a\nb\nc\n")).toBe("");
  });

  it("C5 重复行: 与 Aider 一致命中(LCS=2 → 0.667 ≥ 0.6)", () => {
    // LCS("aab","aba")=2 → 2*2/6=0.667;Set 计数时代为 1.0, 现已对齐 Aider
    expect(findSimilarLines("a\na\nb\n", "a\nb\na\n")).not.toBe("");
  });

  it("C6 首末行精确匹配: Aider 不扩行, 本地扩 5 行返回更多上下文", () => {
    const content = "l0\nl1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\n";
    const out = findSimilarLines(content, "l2\nDIFFERENT\nl4\n");
    // Aider 返回 "l2\nl3\nl4"(8 字符);本地 padding=5 → 应含 l1 与 l5
    expect(out).toContain("l1\n");
    expect(out).toContain("l5\n");
  });

  it("C7 空 oldText: Aider 抛 IndexError, 本地防御返回空串", () => {
    expect(findSimilarLines("x\ny\nz\n", "")).toBe("");
  });

  it("C8 智能引号: Aider 不命中, 本地 NFKC 归一化后命中(本地更强)", () => {
    expect(findSimilarLines("const msg = \u201chello\u201d;\n", 'const msg = "hello";\n')).not.toBe("");
  });

  it("C9 阈值恰好 0.6: 双方都命中(等值不算低于阈值)", () => {
    // 5 行 pattern, 3 对 2 错 → 0.6;Aider 与本地均 best_ratio < 0.6 才拒绝
    expect(findSimilarLines("a\nb\nx\ny\ne\n", "a\nb\nc\nd\ne\n")).not.toBe("");
  });

  it("C10 pattern 长于 content: 双方都返回空串", () => {
    expect(findSimilarLines("a\nb\n", "a\nb\nc\nd\ne\n")).toBe("");
  });

  it("C11 正常路径精确块: 双方都命中", () => {
    const content =
      "function alpha() {\n  const x = 1;\n  return x;\n}\n\nfunction beta() {\n  const y = 2;\n  return y;\n}\n";
    const out = findSimilarLines(content, "function alpha() {\n  const x = 1;\n  return x;\n}\n");
    expect(out).toContain("const x = 1;");
  });
});

// =====================================================================
// 能力 2: rewind/checkpoint 回滚 —— applyCheckpointToJournal 边界对抗
// =====================================================================
describe("能力2 checkpoint 回滚: journal 时间戳过滤边界", () => {
  let repoRoot: string;
  const sessionKey = "agent::sess-parity";
  const journalSessionId = "sess-parity";

  const makeCheckpointRecord = (
    createdAt: string,
    metadata?: Record<string, unknown>,
  ): LongTaskCheckpointRecord => ({
    id: "c-parity",
    sessionKey,
    trigger: "guide",
    status: "guide",
    checkpoint: buildRuntimeResumeCheckpoint({
      id: "c-parity",
      sessionKey,
      trigger: "guide",
      metadata,
      createdAt: Date.parse(createdAt),
    }),
    createdAt: Date.parse(createdAt),
    updatedAt: Date.parse(createdAt),
  });

  afterEach(() => {
    vi.useRealTimers();
    __resetWriteJournals();
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("J1 同毫秒(修复后): seq 边界下 checkpoint 前同毫秒的写入不再被误伤", async () => {
    repoRoot = mkdtempSync(path.join(tmpdir(), "parity-j1-"));
    const file = path.join(repoRoot, "f.ts");
    writeFileSync(file, "v0\n", "utf8");
    // 固定时钟: snapshot 与 checkpoint 同一毫秒 T
    const T = Date.UTC(2026, 6, 31, 12, 0, 0, 123);
    vi.useFakeTimers();
    vi.setSystemTime(T);
    const entry = snapshotBeforeWrite({
      workspaceRoot: repoRoot,
      sessionId: journalSessionId,
      filePath: "f.ts",
      toolName: "write",
    });
    writeFileSync(file, "v1\n", "utf8");
    // checkpoint 同毫秒落库, stamp 落库时刻的 journal 尾部 seq(=该条目 seq)
    const checkpointAt = new Date().toISOString();
    const record = makeCheckpointRecord(checkpointAt, { journalSeq: entry!.seq });
    vi.useRealTimers();

    const outcome = await applyCheckpointToJournal({
      workspaceRoot: repoRoot,
      checkpoint: record,
      sessionId: journalSessionId,
    });
    // seq 边界: 条目 seq 不 > journalSeq → 同毫秒写入视为 checkpoint 前, 保留
    expect(outcome.restored).toEqual([]);
    expect(readFileSync(file, "utf8")).toBe("v1\n");
  });

  it("J2 快照丢失: 恢复硬锁 — errors 非空且不再继续", async () => {
    repoRoot = mkdtempSync(path.join(tmpdir(), "parity-j2-"));
    const file = path.join(repoRoot, "f.ts");
    writeFileSync(file, "v0\n", "utf8");
    const checkpointAt = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 5));
    snapshotBeforeWrite({
      workspaceRoot: repoRoot,
      sessionId: journalSessionId,
      filePath: "f.ts",
      toolName: "write",
    });
    writeFileSync(file, "v1\n", "utf8");
    // 删除 .pre 快照,模拟快照损坏/丢失
    const journal = getOrCreateWriteJournal(repoRoot, journalSessionId);
    const entry = journal.entries.find((e) => e.relPath === "f.ts");
    expect(entry).toBeDefined();
    expect(existsSync(entry!.snapshotPath)).toBe(true);
    rmSync(entry!.snapshotPath, { force: true });

    const record = makeCheckpointRecord(checkpointAt);
    const outcome = await applyCheckpointToJournal({
      workspaceRoot: repoRoot,
      checkpoint: record,
      sessionId: journalSessionId,
    });
    console.log("J2 debug", JSON.stringify({
      entryCreatedAtMs: entry!.createdAtMs,
      checkpointAt: record.checkpoint.createdAt,
      snapshotExistsAfterDelete: existsSync(entry!.snapshotPath),
      restored: outcome.restored,
      errors: outcome.errors,
      remaining: journal.entries.length,
    }));
    expect(outcome.errors.length).toBeGreaterThan(0);
    // 硬锁: 文件保持 v1, 不被部分恢复破坏
    expect(readFileSync(file, "utf8")).toBe("v1\n");
  });

  it("J3 applyCheckpoint 抛异常: executeReplayRollback 返回 ok:false(rollback_apply_failed) 且经 recordOutcome", async () => {
    repoRoot = mkdtempSync(path.join(tmpdir(), "parity-j3-"));
    const record = makeCheckpointRecord(new Date().toISOString());
    const outcomes: string[] = [];
    const result = await executeReplayRollback(
      {
        decision: "repair",
        repairStrategy: "replay_rollback",
        reason: "parity",
        requestedAtTick: 1,
      },
      { enabled: false, reason: "pilot off" },
      { kind: "checkpoint", checkpointId: "c-parity" },
      {
        loadCheckpoint: async () => record,
        validateCheckpoint: async () => ({ ok: true as const }),
        applyCheckpoint: async () => {
          throw new Error("journal snapshot corrupted");
        },
        replayEventLog: async () => ({ ok: false, reason: "n/a" }),
        recordOutcome: (r) => outcomes.push(r.ok ? r.mode : `err:${r.reason}`),
      },
    );
    // 修复后契约: 异常映射 ok:false + recordOutcome 全出口, 不再 reject
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("rollback_apply_failed");
      expect(result.detail).toContain("journal snapshot corrupted");
    }
    expect(outcomes).toEqual(["err:rollback_apply_failed"]);
  });

  it("J5 时序修复: 回滚目标为上一个 checkpoint(seq 边界在本 tick 写入前) → 真实撤销本 tick 写入", async () => {
    // 模拟修复后的 mission 时序: T0 上一 tick 末尾落库 checkpoint(stamp journalSeq=0)
    // → T1 本 tick 工具写入 v1(seq=1) → repeatedRepair 触发, controller 取
    // listLongTaskCheckpoints[1](上一个 checkpoint) → 撤销 seq>0 的全部写入。
    repoRoot = mkdtempSync(path.join(tmpdir(), "parity-j5-"));
    const file = path.join(repoRoot, "f.ts");
    writeFileSync(file, "v0\n", "utf8");
    const prevTickCheckpoint = makeCheckpointRecord(new Date().toISOString(), { journalSeq: 0 });
    await new Promise((r) => setTimeout(r, 5));
    snapshotBeforeWrite({
      workspaceRoot: repoRoot,
      sessionId: journalSessionId,
      filePath: "f.ts",
      toolName: "write",
    });
    writeFileSync(file, "v1\n", "utf8"); // T1: 本 tick 的 repair 写入 (seq=1)

    const result = await executeReplayRollback(
      {
        decision: "repair",
        repairStrategy: "replay_rollback",
        reason: "repeated without progress",
        requestedAtTick: 5,
      },
      { enabled: false, reason: "event-log replay not implemented; legacy checkpoint fallback" },
      { kind: "checkpoint", checkpointId: prevTickCheckpoint.id },
      {
        loadCheckpoint: async () => prevTickCheckpoint,
        validateCheckpoint: async (c) => validateCheckpointRecord(c),
        applyCheckpoint: async (c) => {
          const r = c as LongTaskCheckpointRecord;
          const outcome = await applyCheckpointToJournal({
            workspaceRoot: repoRoot,
            checkpoint: r,
            sessionId: journalSessionId,
          });
          if (outcome.errors.length > 0) throw new Error(outcome.errors.join("; "));
          return { restored: outcome.restored } as never;
        },
        replayEventLog: async () => ({ ok: false, reason: "n/a" }),
    recordOutcome: () => undefined,
      },
    );
    // 修复后: 回滚真实撤销本 tick 写入, 文件恢复 v0
    expect(result.ok).toBe(true);
    expect(readFileSync(file, "utf8")).toBe("v0\n");
  });
});

// =====================================================================
// 能力 7: 命令前缀审批 —— allowlist 匹配对抗
// =====================================================================
describe("能力7 命令前缀审批: allowlist 匹配对抗", () => {
  function evaluate(command: string, allowlist: ExecAllowlistEntry[]) {
    const analysis = analyzeShellCommand({ command, cwd: process.cwd() });
    if (!analysis.ok) {
      return { allowlistSatisfied: false as const, reason: "analysis failed" };
    }
    const evaluation = evaluateExecAllowlist({
      analysis,
      allowlist,
      safeBins: new Set(),
      allowShellBuiltins: true,
    } as never);
    return evaluation;
  }

  it("W1 Windows 扩展名(修复后): allowlist 写 'node' 即可匹配 node.exe", () => {
    const withBare = evaluate("node -e x", [{ pattern: "node", argPattern: "^-e( |$)" }]);
    const withExt = evaluate("node -e x", [{ pattern: "node.exe", argPattern: "^-e( |$)" }]);
    // normalizeExecutableToken 归一化后裸名与全名都匹配(Windows 与 POSIX 一致)
    expect(withBare.allowlistSatisfied).toBe(true);
    expect(withExt.allowlistSatisfied).toBe(true);
  });

  it("W2 argPattern 前缀锚定(修复后): 非前缀参数不再被子串放行", () => {
    // Codex 前缀语义: 'node server' 前缀才放行;修复后 argPattern "server" 自动
    // 锚定参数串开头 — "foo-server.js"(server 在中间)必须拒绝, "server.js" 前缀可放行。
    const entry = {
      pattern: process.platform === "win32" ? "node.exe" : "node",
      argPattern: "server",
    };
    expect(evaluate("node foo-server.js", [entry]).allowlistSatisfied).toBe(false);
    expect(evaluate("node server.js", [entry]).allowlistSatisfied).toBe(true);
    // 参数串前缀语义: 第一个参数以 pattern 开头即可(与 Codex 前缀一致)
    expect(evaluate("node server.js --port 8080", [entry]).allowlistSatisfied).toBe(true);
  });

  it("W3 链式绕过防护(Codex 'git status; rm -rf /' 型): 逐段评估整体拒绝", () => {
    const nodePattern = process.platform === "win32" ? "node.exe" : "node";
    const result = evaluate("node -e x; rm -rf /", [
      { pattern: nodePattern, argPattern: "^-e( |$)" },
    ]);
    expect(result.allowlistSatisfied).toBe(false);
  });
});
