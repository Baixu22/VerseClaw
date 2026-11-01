// @vitest-environment node
/**
 * TF-0647 / B1: the decision record is the deliverable, so it gets a real gate.
 *
 * A decision that silently loses a section is worse than no decision: a later
 * implementer would read a half record as authority. This test reads the file
 * from disk and fails if any required section or per-capability field is gone.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const DOC = path.join(ROOT, "docs/dev/session-lifecycle-control-plane/B1-DECISION.zh-CN.md");
const SPEC = path.join(ROOT, "harness/specs/tasks/session-index-capability-preset-decision.md");

function readDoc(): string {
  return fs.readFileSync(DOC, "utf8");
}

describe("B1 decision record", () => {
  it("exists as a decision, not as an implementation", () => {
    expect(fs.existsSync(DOC)).toBe(true);
    const source = readDoc();
    expect(source).toContain("决策记录，不是实现");
    expect(source).toContain("## 1. 决定摘要");
    expect(source).toContain("## 2. 需求证据");
    expect(source).toContain("## 3. 若立项：写集与 owner");
    expect(source).toContain("## 4. 冻结面（无论 GO 与否都不碰）");
    expect(source).toContain("## 5. 重开条件（满足任一）");
    expect(source).toContain("## 6. 判定");
  });

  it("decides both capabilities with a status and a reason", () => {
    const source = readDoc();
    for (const capability of ["可重建会话索引", "会话能力预设"]) {
      const row = source.split("\n").find((line) => line.startsWith(`| ${capability} |`));
      expect(row, `missing decision row for ${capability}`).toBeDefined();
      expect(row).toMatch(/\*\*(GO|NO-GO)/);
      expect((row ?? "").split("|").filter(Boolean).length).toBeGreaterThanOrEqual(3);
    }
    expect(source).toContain("两项均 NO-GO");
  });

  it("names a write set and an owner for every capability that could go", () => {
    const source = readDoc();
    const sections = source.split("### 3.1")[1]?.split("### 3.2")[0] ?? "";
    const presets = source.split("### 3.2")[1]?.split("## 4.")[0] ?? "";
    for (const section of [sections, presets]) {
      expect(section).toContain("写集");
      expect(section).toContain("owner");
      expect(section).toContain("必须满足");
    }
  });

  it("records the demand gap explicitly rather than implying demand", () => {
    const source = readDoc();
    expect(source).toContain("未测量");
    expect(source).toContain("无请求语料");
    expect(source).toContain("第二写入面");
  });

  it("freezes the surfaces the decision must not touch", () => {
    const source = readDoc();
    expect(source).toContain("不改 `SessionEffectivePolicy` 语义");
    expect(source).toContain("不建多机 SessionStore 适配器");
    expect(source).toContain("不复活 TF-0129");
  });

  it("declares reopening conditions and adds no implementation in the spec", () => {
    const source = readDoc();
    expect(source).toContain("## 5. 重开条件");
    expect(source).toContain("记录延迟与会话数");
    const spec = fs.readFileSync(SPEC, "utf8");
    expect(spec).toContain("No new session search index");
    expect(spec).toContain("No change to SessionEffectivePolicy semantics");
  });
});