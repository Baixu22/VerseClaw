import { describe, expect, expectTypeOf, it } from "vitest";
import { OpenClawSchema } from "./zod-schema.js";
import type { OpenClawConfig } from "./types.openclaw.js";

describe("runtime.verseShellFoundation config", () => {
  it("is typed, strict, and default-off when omitted", () => {
    expectTypeOf<NonNullable<OpenClawConfig["runtime"]>["verseShellFoundation"]>()
      .toMatchTypeOf<Record<string, boolean | undefined> | undefined>();
    expect(OpenClawSchema.parse({ runtime: {} }).runtime?.verseShellFoundation).toBeUndefined();
    expect(() => OpenClawSchema.parse({
      runtime: { verseShellFoundation: { governedExec: true, extra: true } },
    })).toThrow();
  });

  it("accepts the complete explicit canary and kill-switch surface", () => {
    const flags = {
      killSwitch: false,
      verifiedRuntime: true,
      typedAci: true,
      facade: true,
      deferredOps: false,
      governedExec: true,
      artifactResults: true,
      mcpCompatibility: false,
      legacyEval: false,
      compatibilityNativeFallback: false,
      readOnlyShadow: false,
    };
    expect(OpenClawSchema.parse({
      runtime: { verseShellFoundation: flags },
    }).runtime?.verseShellFoundation).toEqual(flags);
  });

  it("accepts operator-owned global and agent VerseShell cohort selection", () => {
    const parsed = OpenClawSchema.parse({
      tools: { exec: { host: "verseshell" } },
      agents: {
        list: [{ id: "canary-agent", tools: { exec: { host: "verseshell" } } }],
      },
    });
    expect(parsed.tools?.exec?.host).toBe("verseshell");
    expect(parsed.agents?.list?.[0]?.tools?.exec?.host).toBe("verseshell");
  });
});
