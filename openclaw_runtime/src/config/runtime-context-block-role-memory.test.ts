import { describe, expect, expectTypeOf, it } from "vitest";
import { OpenClawSchema } from "./zod-schema.js";
import { FIELD_HELP } from "./schema.help.js";
import { FIELD_LABELS } from "./schema.labels.js";
import type { OpenClawConfig } from "./types.openclaw.js";

describe("runtime.contextBlock role-memory config", () => {
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
          injectionBudget?: {
            totalChars?: number;
            dropAlertRatio?: number;
            channelDecay?: Record<string, number>;
          };
          sessionStartInjection?: {
            enabled?: boolean;
            budgetChars?: number;
          };
          checkpointedContextReset?: {
            enabled?: boolean;
          };
          "context-write"?: {
            role?: string;
          };
          "context-understand"?: {
            budgetChars?: number;
          };
        }
      | undefined
    >();

    expect(OpenClawSchema.parse({ runtime: {} }).runtime?.contextBlock).toBeUndefined();
    expect(
      OpenClawSchema.parse({
        runtime: { contextBlock: { "role-memory": { enabled: true } } },
      }).runtime?.contextBlock?.["role-memory"]?.enabled,
    ).toBe(true);
  });

  it("documents the new strict schema keys", () => {
    expect(FIELD_LABELS["runtime.contextBlock.role-memory.enabled"]).toBeTruthy();
    expect(FIELD_HELP["runtime.contextBlock.role-memory.enabled"]).toContain("default");
    expect(() =>
      OpenClawSchema.parse({
        runtime: { contextBlock: { "role-memory": { enabled: true, extra: true } } },
      }),
    ).toThrow();
  });
});
