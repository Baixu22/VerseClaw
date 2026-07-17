import { describe, expect, it } from "vitest";
import { validateCorpus } from "./dcs-corpus-schema.js";
import {
  DEFAULT_SYNTHETIC_CORPUS_SEED,
  buildSyntheticTasks,
  countSyntheticTasks,
  generateSyntheticAgentCorpus,
} from "./dcs-corpus-synthetic.js";

describe("dcs-corpus-synthetic", () => {
  it("generates -30 tasks with three arms and valid schema", () => {
    const doc = generateSyntheticAgentCorpus({ seed: DEFAULT_SYNTHETIC_CORPUS_SEED });
    expect(doc.kind).toBe("synthetic-agent");
    expect(countSyntheticTasks(doc)).toBeGreaterThanOrEqual(30);
    expect(doc.entries.every((e) => e.kind === "synthetic-agent")).toBe(true);
    expect(doc.entries.some((e) => e.kind === "live")).toBe(false);

    const arms = new Set(doc.entries.map((e) => e.arm));
    expect(arms.has("baseline")).toBe(true);
    expect(arms.has("factstore")).toBe(true);
    expect(arms.has("mcp_control")).toBe(true);

    // 3 entries per task
    expect(doc.entries.length).toBe(countSyntheticTasks(doc) * 3);

    const validated = validateCorpus(doc);
    expect(validated.entries.length).toBe(doc.entries.length);
  });

  it("is deterministic for the same seed", () => {
    const a = generateSyntheticAgentCorpus({ seed: 99, taskCount: 30 });
    const b = generateSyntheticAgentCorpus({ seed: 99, taskCount: 30 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.seed).toBe(99);
  });

  it("changes when seed changes", () => {
    const a = generateSyntheticAgentCorpus({ seed: 1, taskCount: 30 });
    const b = generateSyntheticAgentCorpus({ seed: 2, taskCount: 30 });
    // Extra synthetic tasks after the base fixture set depend on seed.
    const aExtra = a.entries.find((e) => e.taskId?.startsWith("nav-syn-"));
    const bExtra = b.entries.find((e) => e.taskId?.startsWith("nav-syn-"));
    expect(aExtra && bExtra).toBeTruthy();
    // At least session ids differ by seed prefix.
    expect(a.entries[0]?.sessionId).not.toBe(b.entries[0]?.sessionId);
  });

  it("buildSyntheticTasks respects minimum count", () => {
    const tasks = buildSyntheticTasks({ taskCount: 5 });
    expect(tasks.length).toBeGreaterThanOrEqual(30);
  });
});