// R4: runtime.rc03.seal config leaf must be schema-accepted (rc03-seal-hook reads it).
import { describe, expect, it } from "vitest";
import { OpenClawSchema } from "./zod-schema.js";
import type { OpenClawConfig } from "./types.openclaw.js";

describe("runtime.rc03 config", () => {
  it("accepts runtime.rc03.seal=true", () => {
    const parsed = OpenClawSchema.parse({ runtime: { rc03: { seal: true } } });
    expect(parsed.runtime?.rc03?.seal).toBe(true);
  });

  it("defaults off when omitted", () => {
    expect(OpenClawSchema.parse({ runtime: {} }).runtime?.rc03).toBeUndefined();
  });

  it("rejects a non-boolean seal value", () => {
    expect(() =>
      OpenClawSchema.parse({ runtime: { rc03: { seal: "yes" } } }),
    ).toThrow();
  });

  it("rejects rc03 as a boolean", () => {
    expect(() => OpenClawSchema.parse({ runtime: { rc03: true } })).toThrow();
  });

  it("rejects unknown keys under rc03", () => {
    expect(() =>
      OpenClawSchema.parse({ runtime: { rc03: { seal: true, extra: true } } }),
    ).toThrow();
  });

  it("types the leaf on OpenClawConfig", () => {
    const cfg: OpenClawConfig = { runtime: { rc03: { seal: true } } };
    expect(cfg.runtime?.rc03?.seal).toBe(true);
  });
});
