/**
 * Acceptance test for repair-plan batch 1 (dead-weight cleanup).
 *
 * Batch 1 changed how the ported coding tools are constructed:
 *   1. createCodingTools gained an optional `only` filter so callers can skip
 *      constructing tools they will discard downstream (agent-tools.ts no longer
 *      builds the unused ported bash tool).
 *   2. The zero-consumer read-only factories (createGrepTool/createFindTool/
 *      createLsTool/createReadOnlyTools) were dropped from the sessions SDK
 *      surface; their implementations are retained under ./tools.
 *
 * These assertions pin the resulting TOOL REGISTRATION SURFACE so the cleanup is
 * provably behavior-equivalent: the default coding tool-name set/order is
 * unchanged, and the filtered set matches what the agent-tools call site now
 * requests.
 */
import { describe, expect, it } from "vitest";
import { createCodingTools, type ToolName } from "./index.js";

const CWD = process.cwd();

function toolNames(tools: Array<{ name: string }>): string[] {
  return tools.map((tool) => tool.name);
}

describe("createCodingTools registration surface", () => {
  it("defaults to the historical [read, bash, edit, write] set and order", () => {
    // characterization: this is the pre-batch-1 default and must not drift.
    expect(toolNames(createCodingTools(CWD))).toEqual(["read", "bash", "edit", "write"]);
  });

  it("materializes exactly the requested subset, in canonical order, when `only` is passed", () => {
    // This is what the agent-tools call site now requests: the ported bash tool
    // is never constructed because the shell surface is the native exec family.
    const filtered = createCodingTools(CWD, undefined, ["read", "edit", "write"]);
    expect(toolNames(filtered)).toEqual(["read", "edit", "write"]);
    expect(toolNames(filtered)).not.toContain("bash");
  });

  it("preserves canonical order regardless of the order of names in `only`", () => {
    const filtered = createCodingTools(CWD, undefined, ["write", "read"]);
    expect(toolNames(filtered)).toEqual(["read", "write"]);
  });

  it("treats an empty `only` array as 'construct nothing'", () => {
    expect(createCodingTools(CWD, undefined, [])).toEqual([]);
  });

  it("is equivalent to filtering the unfiltered set for any subset", () => {
    const subsets: ToolName[][] = [
      ["read"],
      ["read", "write"],
      ["read", "edit", "write"],
      ["read", "bash", "edit", "write"],
    ];
    const defaultNames = toolNames(createCodingTools(CWD));
    for (const subset of subsets) {
      const filteredNames = toolNames(createCodingTools(CWD, undefined, subset));
      expect(filteredNames).toEqual(defaultNames.filter((name) => subset.includes(name as ToolName)));
    }
  });
});

describe("sessions SDK tool-factory surface", () => {
  it("still exports the live coding factories used in production", async () => {
    const sdk = await import("../sdk.js");
    expect(typeof sdk.createCodingTools).toBe("function");
    expect(typeof sdk.createReadTool).toBe("function");
    expect(typeof sdk.createBashTool).toBe("function");
    expect(typeof sdk.createEditTool).toBe("function");
    expect(typeof sdk.createWriteTool).toBe("function");
  });

  it("still reaches the retained read-only factories via the lower tools barrel", async () => {
    // The implementations are kept for test-support; only the curated SDK
    // re-export was trimmed. They remain importable from ./tools.
    const tools = await import("./index.js");
    expect(typeof tools.createGrepTool).toBe("function");
    expect(typeof tools.createFindTool).toBe("function");
    expect(typeof tools.createLsTool).toBe("function");
    expect(typeof tools.createReadOnlyTools).toBe("function");
  });
});
