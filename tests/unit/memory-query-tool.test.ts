// @vitest-environment node
// memory_query agent tool unit tests.
//
// ORIGINAL INTENT: assert that createMemoryQueryTool builds a working tool when
// runtime.memory.persist is enabled, and that execute() honours query, subject
// and topK.
//
// CURRENT CONTRACT (TF-0500 / TF-0574): persist is retired and can never resolve
// to true, so createMemoryQueryTool always returns null. The tool object (and its
// inline parameter schema) cannot be constructed, so execute-level coverage is
// not reachable. These cases lock the retirement boundary instead.

import { describe, expect, it } from "vitest";
import { createMemoryQueryTool } from "../../openclaw_runtime/src/runtime-core/memory-query-tool";

const retiredConfigs: Array<[string, unknown]> = [
  ["persist: true", { runtime: { memory: { persist: true } } }],
  ["string persist: \"true\"", { runtime: { memory: { persist: "true" } } }],
  ["persist: false", { runtime: { memory: { persist: false } } }],
  ["empty config", {}],
  ["undefined config", undefined],
];

describe("memory_query agent tool is retired", () => {
  it.each(retiredConfigs)("returns null for %s", (_label, config) => {
    expect(createMemoryQueryTool({ config })).toBeNull();
  });

  it("never exposes a callable memory_query surface", () => {
    const tool = createMemoryQueryTool({
      config: { runtime: { memory: { persist: true, shadow: true, proposeFacts: true } } },
    });
    expect(tool).toBeNull();
  });
});
