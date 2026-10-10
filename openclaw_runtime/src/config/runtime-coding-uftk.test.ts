import { describe, expect, it } from "vitest";
import { OpenClawSchema } from "./zod-schema.js";

describe("removed runtime.coding.uftk config surface (#95)", () => {
  it("rejects the retired uftk block instead of advertising unwired switches", () => {
    expect(() =>
      OpenClawSchema.parse({
        runtime: { coding: { uftk: { enabled: true } } },
      }),
    ).toThrow();
  });
});
