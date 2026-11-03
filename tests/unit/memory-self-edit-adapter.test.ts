// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createMemorySelfEditTools } from "../../openclaw_runtime/src/runtime-core/memory-self-edit-adapter";

/**
 * TF-0500 retired runtime.memory.persist, so the self-edit adapter's gate
 * (`runtimeMemoryFlagEnabled(cfg, "persist")`) can never pass. The adapter
 * therefore returns an empty tool list for every configuration.
 *
 * The previous cases asserted that setting persist=true registered four tools;
 * that behaviour no longer exists. These cases lock the retired contract instead:
 * no configuration can surface the tools, so the model is never offered an
 * unusable memory_recall/update/forget/strengthen surface.
 */
const retiredConfigs: Array<[string, unknown]> = [
  ["explicit persist: true", { runtime: { memory: { persist: true } } }],
  ["string persist: \"true\"", { runtime: { memory: { persist: "true" } } }],
  ["persist: false", { runtime: { memory: { persist: false } } }],
  ["empty config", {}],
  ["undefined config", undefined],
];

describe("P1-2 memory self-edit adapter stays retired", () => {
  it.each(retiredConfigs)("registers no tools for %s", (_label, config) => {
    expect(createMemorySelfEditTools({ config })).toEqual([]);
  });

  it("never exposes any of the retired tool names", () => {
    const names = createMemorySelfEditTools({
      config: { runtime: { memory: { persist: true, shadow: true, proposeFacts: true } } },
    }).map((tool) => tool.name);
    expect(names).toEqual([]);
    expect(names).not.toContain("memory_recall");
    expect(names).not.toContain("memory_update");
    expect(names).not.toContain("memory_forget");
    expect(names).not.toContain("memory_strengthen");
  });
});
