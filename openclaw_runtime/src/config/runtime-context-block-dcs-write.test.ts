import { describe, expect, it } from "vitest";
import { OpenClawSchema } from "./zod-schema.js";
import type { OpenClawConfig } from "./types.openclaw.js";

describe("runtime.contextBlock context-write / context-understand config", () => {
  it("parses the context-write role leaf", () => {
    const parsed = OpenClawSchema.parse({
      runtime: { contextBlock: { "context-write": { role: "planner" } } },
    }).runtime?.contextBlock?.["context-write"]?.role;
    expect(parsed).toBe("planner");
  });

  it("parses the context-understand budgetChars leaf", () => {
    const parsed = OpenClawSchema.parse({
      runtime: { contextBlock: { "context-understand": { budgetChars: 24_000 } } },
    }).runtime?.contextBlock?.["context-understand"]?.budgetChars;
    expect(parsed).toBe(24_000);
  });

  it("rejects unknown keys under context-write", () => {
    expect(() =>
      OpenClawSchema.parse({
        runtime: { contextBlock: { "context-write": { role: "planner", extra: true } } },
      }),
    ).toThrow();
  });

  it("rejects unknown keys under context-understand", () => {
    expect(() =>
      OpenClawSchema.parse({
        runtime: { contextBlock: { "context-understand": { budgetChars: 1, extra: true } } },
      }),
    ).toThrow();
  });

  it("rejects invalid budgetChars values", () => {
    expect(() =>
      OpenClawSchema.parse({
        runtime: { contextBlock: { "context-understand": { budgetChars: 0 } } },
      }),
    ).toThrow();
    expect(() =>
      OpenClawSchema.parse({
        runtime: { contextBlock: { "context-understand": { budgetChars: 1_000_001 } } },
      }),
    ).toThrow();
  });

  it("types the leaves on OpenClawConfig", () => {
    const cfg: OpenClawConfig = {
      runtime: {
        contextBlock: {
          "context-write": { role: "architect" },
          "context-understand": { budgetChars: 8_000 },
        },
      },
    };
    expect(cfg.runtime?.contextBlock?.["context-write"]?.role).toBe("architect");
    expect(cfg.runtime?.contextBlock?.["context-understand"]?.budgetChars).toBe(8_000);
  });
});
