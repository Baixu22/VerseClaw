/**
 * R2 RED→GREEN tests: DCS producer envelope vertical slice.
 *
 * These tests prove the P0 producer boundary for the coding-runtime vertical
 * slice: only edit/write/apply_patch emit `details.working_memory`, read does
 * not, and the envelope contract matches the consumer-side
 * `readWorkingMemoryEnvelope` shape.
 *
 * RED phase: tests asserting envelope presence FAIL because no producer
 * currently emits `details.working_memory`.
 * GREEN phase: producers emit explicit envelopes and all tests pass.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createHostWorkspaceEditTool,
  createHostWorkspaceWriteTool,
  createOpenClawReadTool,
} from "./agent-tools.read.js";
import { createApplyPatchTool } from "./apply-patch.js";
import { createEditTool, createReadTool, createWriteTool } from "./sessions/index.js";
import type { AnyAgentTool } from "./agent-tools.types.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "clawx-dcs-producer-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

interface WorkingMemoryEnvelope {
  result_summary: string;
  significance: "high" | "medium" | "low";
}

function extractEnvelope(details: unknown): WorkingMemoryEnvelope | undefined {
  if (typeof details !== "object" || details === null) {
    return undefined;
  }
  const wm = (details as Record<string, unknown>).working_memory;
  if (typeof wm !== "object" || wm === null) {
    return undefined;
  }
  const record = wm as Record<string, unknown>;
  const resultSummary = record.result_summary;
  const significance = record.significance;
  if (typeof resultSummary !== "string" || resultSummary.trim().length === 0) {
    return undefined;
  }
  if (significance !== "high" && significance !== "medium" && significance !== "low") {
    return undefined;
  }
  return { result_summary: resultSummary, significance };
}

describe("R2 producer envelope: edit tool", () => {
  it("emits details.working_memory envelope on successful edit (host variant)", async () => {
    await writeFile(join(dir, "f.txt"), "one\ntwo\nthree\n", "utf-8");
    const tool = createHostWorkspaceEditTool(dir, { workspaceOnly: true }) as AnyAgentTool;
    const result = await tool.execute(
      "call",
      { path: "f.txt", edits: [{ oldText: "two", newText: "TWO" }] },
      undefined,
      undefined,
    );
    const envelope = extractEnvelope(result.details);
    expect(envelope).toBeDefined();
    expect(envelope?.significance).toBe("high");
    expect(envelope?.result_summary.length).toBeLessThanOrEqual(100);
    expect(envelope?.result_summary).toContain("f.txt");
  });

  it("emits details.working_memory envelope on successful edit (base tool — shared by host+sandbox)", async () => {
    await writeFile(join(dir, "g.txt"), "alpha\n", "utf-8");
    const tool = createEditTool(dir) as unknown as AnyAgentTool;
    const result = await tool.execute(
      "call",
      { path: "g.txt", edits: [{ oldText: "alpha", newText: "ALPHA" }] },
      undefined,
      undefined,
    );
    const envelope = extractEnvelope(result.details);
    expect(envelope).toBeDefined();
    expect(envelope?.significance).toBe("high");
    expect(envelope?.result_summary.length).toBeLessThanOrEqual(100);
  });
});

describe("R2 producer envelope: write tool", () => {
  it("emits details.working_memory envelope on successful write (host variant)", async () => {
    const tool = createHostWorkspaceWriteTool(dir, { workspaceOnly: true }) as AnyAgentTool;
    const result = await tool.execute(
      "call",
      { path: "new.txt", content: "hello world" },
      undefined,
      undefined,
    );
    const envelope = extractEnvelope(result.details);
    expect(envelope).toBeDefined();
    expect(envelope?.significance).toBe("high");
    expect(envelope?.result_summary.length).toBeLessThanOrEqual(100);
    expect(envelope?.result_summary).toContain("new.txt");
  });

  it("emits details.working_memory envelope on successful write (base tool — shared by host+sandbox)", async () => {
    const tool = createWriteTool(dir) as unknown as AnyAgentTool;
    const result = await tool.execute(
      "call",
      { path: "sandbox.txt", content: "sandbox content" },
      undefined,
      undefined,
    );
    const envelope = extractEnvelope(result.details);
    expect(envelope).toBeDefined();
    expect(envelope?.significance).toBe("high");
    expect(envelope?.result_summary.length).toBeLessThanOrEqual(100);
  });
});

describe("R2 producer envelope: apply_patch tool", () => {
  it("emits details.working_memory envelope on successful patch application", async () => {
    await writeFile(join(dir, "patch-target.txt"), "original\n", "utf-8");
    const tool = createApplyPatchTool({ cwd: dir, workspaceOnly: true });
    const patchInput = [
      "*** Begin Patch",
      "*** Update File: patch-target.txt",
      "@@",
      "-original",
      "+patched",
      "*** End Patch",
    ].join("\n");
    const result = await tool.execute("call", { input: patchInput }, undefined);
    const envelope = extractEnvelope(result.details);
    expect(envelope).toBeDefined();
    expect(envelope?.significance).toBe("high");
    expect(envelope?.result_summary.length).toBeLessThanOrEqual(100);
  });
});

describe("R2 producer boundary: non-mutation tools emit no envelope", () => {
  it("read tool does NOT emit details.working_memory", async () => {
    await writeFile(join(dir, "read-target.txt"), "content\n", "utf-8");
    const base = createReadTool(dir) as unknown as AnyAgentTool;
    const tool = createOpenClawReadTool(base);
    const result = await tool.execute("call", { path: "read-target.txt" }, undefined, undefined);
    const envelope = extractEnvelope(result.details);
    expect(envelope).toBeUndefined();
  });
});

describe("R2 producer envelope: failure paths", () => {
  it("edit failure (mismatched oldText) does not emit high-significance envelope", async () => {
    await writeFile(join(dir, "h.txt"), "unchanged\n", "utf-8");
    const tool = createHostWorkspaceEditTool(dir, { workspaceOnly: true }) as AnyAgentTool;
    const error = await tool
      .execute(
        "call",
        { path: "h.txt", edits: [{ oldText: "nonexistent", newText: "x" }] },
        undefined,
        undefined,
      )
      .then(
        () => null,
        (err: unknown) => err,
      );
    // A failed edit throws (no envelope); only successful mutations emit.
    expect(error).toBeInstanceOf(Error);
  });
});
