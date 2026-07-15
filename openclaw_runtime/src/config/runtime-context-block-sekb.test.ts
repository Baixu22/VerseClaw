import { describe, expect, expectTypeOf, it } from "vitest";
import { OpenClawSchema } from "./zod-schema.js";
import { FIELD_HELP } from "./schema.help.js";
import { FIELD_LABELS } from "./schema.labels.js";
import type { OpenClawConfig } from "./types.openclaw.js";

describe("runtime.contextBlock sekb config", () => {
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
            shadowEvaluation?: {
              enabled?: boolean;
            };
            batchDistillationAssistant?: {
              enabled?: boolean;
            };
            phaseCWouldTrigger?: {
              enabled?: boolean;
              owner?: string;
              timeoutMs?: number;
            };
          };
        }
      | undefined
    >();

    expect(OpenClawSchema.parse({ runtime: {} }).runtime?.contextBlock).toBeUndefined();
    expect(
      OpenClawSchema.parse({
        runtime: {
          contextBlock: {
            sekb: {
              enabled: true,
              shadowEvaluation: { enabled: true },
              batchDistillationAssistant: { enabled: true },
              phaseCWouldTrigger: { enabled: true, owner: "d1-owner", timeoutMs: 3000 },
            },
          },
        },
      }).runtime?.contextBlock?.sekb?.batchDistillationAssistant?.enabled,
    ).toBe(true);
    expect(
      OpenClawSchema.parse({
        runtime: {
          contextBlock: {
            sekb: {
              enabled: true,
              phaseCWouldTrigger: { enabled: true, owner: "d1-owner", timeoutMs: 3000 },
            },
          },
        },
      }).runtime?.contextBlock?.sekb?.phaseCWouldTrigger?.enabled,
    ).toBe(true);
  });

  it("documents the new strict schema keys", () => {
    expect(FIELD_LABELS["runtime.contextBlock.sekb.enabled"]).toBeTruthy();
    expect(FIELD_HELP["runtime.contextBlock.sekb.enabled"]).toContain("default");
    expect(FIELD_LABELS["runtime.contextBlock.sekb.shadowEvaluation.enabled"]).toBeTruthy();
    expect(FIELD_HELP["runtime.contextBlock.sekb.shadowEvaluation.enabled"]).toContain("default");
    expect(FIELD_LABELS["runtime.contextBlock.sekb.batchDistillationAssistant.enabled"]).toBeTruthy();
    expect(FIELD_HELP["runtime.contextBlock.sekb.batchDistillationAssistant.enabled"]).toContain("default");
    expect(FIELD_LABELS["runtime.contextBlock.sekb.phaseCWouldTrigger.enabled"]).toBeTruthy();
    expect(FIELD_HELP["runtime.contextBlock.sekb.phaseCWouldTrigger.enabled"]).toContain("default");
    expect(() =>
      OpenClawSchema.parse({
        runtime: {
          contextBlock: {
            sekb: { enabled: true, batchDistillationAssistant: { enabled: true, extra: true } },
          },
        },
      }),
    ).toThrow();
  });
});
