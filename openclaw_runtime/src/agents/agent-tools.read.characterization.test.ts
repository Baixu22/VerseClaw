/**
 * Characterization tests for the host/workspace tool wrapper layer.
 *
 * This is the layer agent-tools.ts:784-798 wraps the ported session tools with,
 * and it is where the P0 producer envelope (details.working_memory) will be
 * attached. These tests snapshot the CURRENT behavior of the wrappers and,
 * crucially, FREEZE the result shape (content + details) so P0 can graft an
 * envelope onto details without silently regressing anything.
 *
 * Result-shape assertions use toMatchObject / property checks rather than
 * deep-equality on details, so an ADDED details.working_memory field does not
 * break the net (that is exactly what P0 will add). Where a behavior looks
 * questionable it carries a `characterization:` comment — recorded, not
 * endorsed.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createHostWorkspaceEditTool,
  createHostWorkspaceWriteTool,
  createOpenClawReadTool,
  wrapToolWorkspaceRootGuard,
} from "./agent-tools.read.js";
import type { AnyAgentTool } from "./agent-tools.types.js";
import { createReadTool } from "./sessions/index.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "clawx-wrapper-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");
}

async function runError(promise: Promise<unknown>): Promise<Error> {
  const outcome = await promise.then(
    () => null,
    (error: unknown) => error,
  );
  expect(outcome).toBeInstanceOf(Error);
  return outcome as Error;
}

describe("createHostWorkspaceWriteTool", () => {
  it("writes a file and returns the session write result shape", async () => {
    const tool = createHostWorkspaceWriteTool(dir, { workspaceOnly: true }) as AnyAgentTool;
    expect(tool.name).toBe("write");
    const result = await tool.execute(
      "call",
      { path: "new.txt", content: "hello" },
      undefined,
      undefined,
    );
    expect(textOf(result)).toBe("Successfully wrote 5 bytes to new.txt");
    // P0 envelope: write now emits a details.working_memory envelope.
    expect(result.details).toMatchObject({
      working_memory: {
        significance: "high",
      },
    });
    expect(result.details?.working_memory?.result_summary).toContain("new.txt");
    expect(await readFile(join(dir, "new.txt"), "utf-8")).toBe("hello");
  });

  it("creates parent directories under the workspace root", async () => {
    const tool = createHostWorkspaceWriteTool(dir, { workspaceOnly: true }) as AnyAgentTool;
    await tool.execute("call", { path: "a/b/c.txt", content: "x" }, undefined, undefined);
    expect(await readFile(join(dir, "a", "b", "c.txt"), "utf-8")).toBe("x");
  });

  it("rejects a missing content parameter with retry guidance before writing", async () => {
    const tool = createHostWorkspaceWriteTool(dir, { workspaceOnly: true }) as AnyAgentTool;
    const error = await runError(
      tool.execute("call", { path: "x.txt" }, undefined, undefined),
    );
    expect(error.message).toBe(
      "Missing required parameter: content (received: path). Supply correct parameters before retrying.",
    );
  });

  it("rejects a missing path parameter with retry guidance", async () => {
    const tool = createHostWorkspaceWriteTool(dir, { workspaceOnly: true }) as AnyAgentTool;
    const error = await runError(
      tool.execute("call", { content: "orphan" }, undefined, undefined),
    );
    expect(error.message).toContain("Missing required parameter: path");
    expect(error.message).toContain("received: content");
  });
});

describe("createHostWorkspaceEditTool", () => {
  it("edits a file and returns the session edit details shape (diff + patch)", async () => {
    await writeFile(join(dir, "f.txt"), "one\ntwo\nthree\n", "utf-8");
    const tool = createHostWorkspaceEditTool(dir, { workspaceOnly: true }) as AnyAgentTool;
    expect(tool.name).toBe("edit");
    const result = await tool.execute(
      "call",
      { path: "f.txt", edits: [{ oldText: "two", newText: "TWO" }] },
      undefined,
      undefined,
    );
    expect(textOf(result)).toBe("Successfully replaced 1 block(s) in f.txt.");
    // P0 anchor: freeze that edit still returns details.diff / details.patch.
    // toMatchObject tolerates P0 adding details.working_memory alongside these.
    expect(result.details).toMatchObject({
      diff: expect.stringContaining("TWO"),
      patch: expect.stringContaining("+TWO"),
    });
    expect(await readFile(join(dir, "f.txt"), "utf-8")).toBe("one\nTWO\nthree\n");
  });

  it("rejects invalid edits (empty oldText) with retry guidance", async () => {
    await writeFile(join(dir, "f.txt"), "content\n", "utf-8");
    const tool = createHostWorkspaceEditTool(dir, { workspaceOnly: true }) as AnyAgentTool;
    const error = await runError(
      tool.execute(
        "call",
        { path: "f.txt", edits: [{ oldText: "", newText: "x" }] },
        undefined,
        undefined,
      ),
    );
    // characterization: the wrapper's param validator rejects empty oldText
    // BEFORE the inner edit tool runs, so the message is the retry-guidance form
    // (with a received-params hint), not the inner "oldText must not be empty".
    expect(error.message).toBe(
      "Missing required parameter: edits (received: path, edits=<array>). Supply correct parameters before retrying.",
    );
  });
});

describe("wrapToolWorkspaceRootGuard", () => {
  it("passes through in-workspace paths to the inner tool", async () => {
    await writeFile(join(dir, "inside.txt"), "ok", "utf-8");
    const inner = createHostWorkspaceEditTool(dir, { workspaceOnly: true }) as AnyAgentTool;
    const guarded = wrapToolWorkspaceRootGuard(inner, dir);
    const result = await guarded.execute(
      "call",
      { path: "inside.txt", edits: [{ oldText: "ok", newText: "OK" }] },
      undefined,
      undefined,
    );
    expect(textOf(result)).toContain("Successfully replaced 1 block(s)");
    expect(await readFile(join(dir, "inside.txt"), "utf-8")).toBe("OK");
  });

  it("rejects a path escaping the workspace root with the temp-dir hint", async () => {
    const inner = createHostWorkspaceEditTool(dir, { workspaceOnly: true }) as AnyAgentTool;
    const guarded = wrapToolWorkspaceRootGuard(inner, dir);
    const error = await runError(
      guarded.execute(
        "call",
        { path: "../escape.txt", edits: [{ oldText: "a", newText: "b" }] },
        undefined,
        undefined,
      ),
    );
    expect(error.message).toMatch(/^Path escapes sandbox root \(/);
    // characterization: the guard appends actionable guidance pointing at
    // .openclaw/tmp/ for scratch files.
    expect(error.message).toContain(".openclaw/tmp/");
  });

  it("rejects an absolute path outside the workspace root", async () => {
    const inner = createHostWorkspaceWriteTool(dir, { workspaceOnly: true }) as AnyAgentTool;
    const guarded = wrapToolWorkspaceRootGuard(inner, dir);
    const outside = join(tmpdir(), "clawx-wrapper-escape-target.txt");
    const error = await runError(
      guarded.execute("call", { path: outside, content: "nope" }, undefined, undefined),
    );
    expect(error.message).toMatch(/Path escapes sandbox root/);
  });

  it("normalizes a malformed XML arg_value suffix out of the path before guarding", async () => {
    // characterization: models sometimes emit a trailing </arg_value>> on the
    // path; the guard strips it so the write still lands at the clean path.
    await writeFile(join(dir, "clean.txt"), "old", "utf-8");
    const inner = createHostWorkspaceWriteTool(dir, { workspaceOnly: true }) as AnyAgentTool;
    const guarded = wrapToolWorkspaceRootGuard(inner, dir);
    await guarded.execute(
      "call",
      { path: "clean.txt</arg_value>>", content: "new" },
      undefined,
      undefined,
    );
    expect(await readFile(join(dir, "clean.txt"), "utf-8")).toBe("new");
  });
});

describe("createOpenClawReadTool", () => {
  function hostReadTool() {
    const base = createReadTool(dir) as unknown as AnyAgentTool;
    return createOpenClawReadTool(base);
  }

  it("reads a small file and preserves the text content shape", async () => {
    await writeFile(join(dir, "f.txt"), "hello\nworld\n", "utf-8");
    const result = await hostReadTool().execute("call", { path: "f.txt" }, undefined, undefined);
    expect(textOf(result)).toBe("hello\nworld\n");
  });

  it("aggregates a line-truncated read across pages, inserting a blank-line seam", async () => {
    // characterization: current behavior, not necessarily desired — with no
    // explicit limit, adaptive paging re-reads past the 2000-line truncation and
    // joins pages with "\n\n", so the reproduced text gains a blank line between
    // L2000 and L2001 that the file does not contain. The final result reuses
    // the LAST page's details, so page 1's truncation metadata is dropped
    // (details is undefined when the last page was not truncated).
    const lines = Array.from({ length: 2100 }, (_, i) => `L${i + 1}`);
    await writeFile(join(dir, "big.txt"), lines.join("\n"), "utf-8");
    const result = await hostReadTool().execute("call", { path: "big.txt" }, undefined, undefined);
    const expected = `${lines.slice(0, 2000).join("\n")}\n\n${lines.slice(2000).join("\n")}`;
    expect(textOf(result)).toBe(expected);
    expect(result.details).toBeUndefined();
  });

  it("caps multi-page output at 32KB, keeping page-1 truncation details minus the content field", async () => {
    // 60 lines x 1000 chars: the inner read truncates by bytes at 51 lines
    // (~51KB), which already exceeds the 32KB adaptive budget, so paging stops
    // after page 1 with a cap notice.
    const lines = Array.from({ length: 60 }, () => "x".repeat(1000));
    await writeFile(join(dir, "wide.txt"), lines.join("\n"), "utf-8");
    const result = await hostReadTool().execute("call", { path: "wide.txt" }, undefined, undefined);
    expect(
      textOf(result).endsWith(
        "\n\n[Read output capped at 32KB for this call. Use offset=52 to continue.]",
      ),
    ).toBe(true);
    // characterization: the wrapper strips the bulky truncation.content field
    // from details but keeps the rest of the truncation metadata.
    const details = result.details as { truncation?: Record<string, unknown> } | undefined;
    expect(details?.truncation).toBeDefined();
    expect(details?.truncation).not.toHaveProperty("content");
    expect(details?.truncation).toMatchObject({ truncated: true, truncatedBy: "bytes" });
  });

  it("converts an out-of-range offset into an empty read instead of throwing", async () => {
    // characterization: the wrapper swallows "Offset N is beyond end of file" and
    // returns empty content (the inner session read throws this).
    await writeFile(join(dir, "f.txt"), "a\nb\n", "utf-8");
    const result = await hostReadTool().execute(
      "call",
      { path: "f.txt", offset: 99 },
      undefined,
      undefined,
    );
    expect(textOf(result)).toBe("");
  });

  it("rejects a missing path parameter with retry guidance", async () => {
    const error = await runError(
      hostReadTool().execute("call", {}, undefined, undefined),
    );
    expect(error.message).toContain("Missing required parameter: path");
  });
});
