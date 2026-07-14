import { describe, expect, expectTypeOf, it } from "vitest";
import { OpenClawSchema } from "./zod-schema.js";
import { FIELD_HELP } from "./schema.help.js";
import { FIELD_LABELS } from "./schema.labels.js";
import type { OpenClawConfig } from "./types.openclaw.js";

describe("runtime.contextBlock tool-registry config", () => {
  it("exports a default-off typed config surface", () => {
    expectTypeOf<NonNullable<OpenClawConfig["runtime"]>["contextBlock"]>().toEqualTypeOf<
      | {
          "working-memory"?: {
            enabled?: boolean;
          };
          "tool-registry"?: {
            enabled?: boolean;
          };
          "compass"?: {
            enabled?: boolean;
          };
          "role-memory"?: {
            enabled?: boolean;
          };
          sekb?: {
            enabled?: boolean;
          };
        }
      | undefined
    >();

    expect(OpenClawSchema.parse({ runtime: {} }).runtime?.contextBlock).toBeUndefined();
    expect(
      OpenClawSchema.parse({
        runtime: { contextBlock: { "tool-registry": { enabled: true } } },
      }).runtime?.contextBlock?.["tool-registry"]?.enabled,
    ).toBe(true);
  });

  it("documents the new strict schema keys", () => {
    expect(FIELD_LABELS["runtime.contextBlock.tool-registry.enabled"]).toBeTruthy();
    expect(FIELD_HELP["runtime.contextBlock.tool-registry.enabled"]).toContain("default");
    expect(() =>
      OpenClawSchema.parse({
        runtime: { contextBlock: { "tool-registry": { enabled: true, extra: true } } },
      }),
    ).toThrow();
  });
});
