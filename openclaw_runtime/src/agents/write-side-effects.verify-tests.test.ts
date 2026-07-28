/**
 * FP-P1-04 verify段 wiring: a write must carry its test-runner verdict out with
 * the tool result, so "no tests were run" is a sentence the user can read and
 * not an absence they have to infer.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { codingObservability } from "../context-engine/coding-observability.js";
import type { AnyAgentTool } from "./agent-tools.types.js";
import { wrapToolWithWriteSideEffects } from "./write-side-effects.js";

const roots: string[] = [];
afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

function workspace(files: Record<string, string> = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), "fp-p1-04-wse-"));
  roots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    writeFileSync(path.join(root, rel), content, "utf8");
  }
  return root;
}

function editTool(): AnyAgentTool {
  return {
    name: "edit",
    label: "Edit",
    description: "edit",
    parameters: {},
    execute: async () => ({
      content: [{ type: "text", text: "Successfully replaced 1 block(s) in a.js." }],
      details: { diff: "- old\n+ new", patch: "--- a.js\n+++ a.js\n" },
    }),
  } as unknown as AnyAgentTool;
}

async function runEdit(workspaceRoot: string): Promise<Record<string, unknown>> {
  const wrapped = wrapToolWithWriteSideEffects(editTool(), {
    workspaceRoot,
    // Isolate the verify段: the other side effects need a materializer/factStore.
    parseOnWriteEnabled: false,
    syntaxCheckEnabled: false,
    diagEnabled: false,
    verifyConsumeEnabled: false,
  });
  const result = (await wrapped.execute("call-1", { path: "a.js" }, undefined, undefined)) as {
    details?: Record<string, unknown>;
  };
  return (result.details ?? {}) as Record<string, unknown>;
}

describe("FP-P1-04 write-side verify段 (test-runner detection)", () => {
  it("attaches a detected runner with its command", async () => {
    const root = workspace({
      "a.js": "x\n",
      "package.json": JSON.stringify({ scripts: { test: "vitest run" } }),
    });
    const details = await runEdit(root);
    const verify = details.verify_tests as Record<string, unknown>;
    expect(verify.detected).toBe(true);
    expect(verify.command).toBe("npm test");
    expect(String(verify.rendered)).toMatch(/^detected\(node\/npm\)/);
    // The pre-existing diff is preserved, not clobbered.
    expect(details.diff).toBe("- old\n+ new");
  });

  it("attaches an explainable skip when the project has no runner", async () => {
    const details = await runEdit(workspace({ "a.js": "x\n" }));
    const verify = details.verify_tests as Record<string, unknown>;
    expect(verify.detected).toBe(false);
    expect(verify.skipReason).toBe("no-manifest");
    expect(String(verify.rendered)).toMatch(/^skipped\(no-manifest\):/);
    // A skip must never be renderable as a pass.
    expect(String(verify.rendered)).not.toMatch(/detected/);
  });

  it("counts detections and skips separately in coding observability", async () => {
    const before = codingObservability.snapshot();
    await runEdit(
      workspace({ "a.js": "x\n", "package.json": JSON.stringify({ scripts: { test: "vitest" } }) }),
    );
    await runEdit(workspace({ "a.js": "x\n" }));
    const after = codingObservability.snapshot();
    expect(after.testRunnerDetected).toBe(before.testRunnerDetected + 1);
    expect(after.testRunnerSkipped).toBe(before.testRunnerSkipped + 1);
  });

  it("can be turned off explicitly", async () => {
    const root = workspace({ "a.js": "x\n" });
    const wrapped = wrapToolWithWriteSideEffects(editTool(), {
      workspaceRoot: root,
      parseOnWriteEnabled: false,
      syntaxCheckEnabled: false,
      diagEnabled: false,
      verifyConsumeEnabled: false,
      testRunnerDetectEnabled: false,
    });
    const result = (await wrapped.execute("call-1", { path: "a.js" }, undefined, undefined)) as {
      details?: Record<string, unknown>;
    };
    expect(result.details?.verify_tests).toBeUndefined();
  });
});

describe("FP-P1-04 diff段/verify段 reach the user (content, not details)", () => {
  /**
   * The gateway strips `details` from chat history
   * (gateway/chat-display-projection.ts deletes it), so evidence that only
   * lives there is invisible in the product. These assertions pin the evidence
   * to `content`, which survives the projection.
   */
  async function runEditWithContent(workspaceRoot: string): Promise<string> {
    const wrapped = wrapToolWithWriteSideEffects(editTool(), {
      workspaceRoot,
      parseOnWriteEnabled: false,
      syntaxCheckEnabled: false,
      diagEnabled: false,
      verifyConsumeEnabled: false,
    });
    const result = (await wrapped.execute("call-1", { path: "a.js" }, undefined, undefined)) as {
      content?: Array<{ type: string; text: string }>;
    };
    return (result.content ?? []).map((block) => block.text).join("\n");
  }

  it("appends the diff to the tool result content", async () => {
    const text = await runEditWithContent(workspace({ "a.js": "x\n" }));
    // The original success sentence is preserved...
    expect(text).toContain("Successfully replaced 1 block(s) in a.js.");
    // ...and the diff is now visible alongside it.
    expect(text).toContain("diff:");
    expect(text).toContain("+ new");
  });

  it("appends an explainable verify verdict for both outcomes", async () => {
    const skipped = await runEditWithContent(workspace({ "a.js": "x\n" }));
    expect(skipped).toMatch(/verify_tests: skipped\(no-manifest\)/);

    const detected = await runEditWithContent(
      workspace({ "a.js": "x\n", "package.json": JSON.stringify({ scripts: { test: "vitest" } }) }),
    );
    expect(detected).toMatch(/verify_tests: detected\(node\/npm\): npm test/);
  });

  it("leaves a result with no coding evidence untouched", async () => {
    const plain = {
      name: "write",
      label: "Write",
      description: "write",
      parameters: {},
      execute: async () => ({ content: [{ type: "text", text: "wrote a.js" }] }),
    } as unknown as AnyAgentTool;
    const wrapped = wrapToolWithWriteSideEffects(plain, {
      workspaceRoot: workspace({ "a.js": "x\n" }),
      parseOnWriteEnabled: false,
      syntaxCheckEnabled: false,
      diagEnabled: false,
      verifyConsumeEnabled: false,
      testRunnerDetectEnabled: false,
    });
    const result = (await wrapped.execute("call-1", { path: "a.js" }, undefined, undefined)) as {
      content?: Array<{ type: string; text: string }>;
    };
    expect(result.content).toHaveLength(1);
    expect(result.content?.[0]?.text).toBe("wrote a.js");
  });
});
