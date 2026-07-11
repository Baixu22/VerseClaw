import { describe, expect, it } from "vitest";
import { statusSummaryRuntime } from "./status.summary.runtime.js";

describe("status summary runtime surface", () => {
  it("provides the retained status-summary helpers", () => {
    expect(statusSummaryRuntime).toMatchObject({
      classifySessionKey: expect.any(Function),
      resolveConfiguredStatusModelRef: expect.any(Function),
      resolveContextTokensForModel: expect.any(Function),
      resolveSessionModelRef: expect.any(Function),
      resolveSessionRuntimeLabel: expect.any(Function),
    });
  });

  it("uses explicit provider metadata before the persisted session provider", () => {
    expect(
      statusSummaryRuntime.resolveSessionRuntimeLabel({
        cfg: {},
        entry: { modelProvider: "persisted" },
        provider: "selected",
      }),
    ).toBe("selected");
    expect(
      statusSummaryRuntime.resolveSessionRuntimeLabel({
        cfg: {},
        entry: { modelProvider: "persisted" },
      }),
    ).toBe("persisted");
  });
});
