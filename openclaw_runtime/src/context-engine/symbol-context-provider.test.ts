/**
 * Lock-in tests for the symbol context provider (shadow-only gating).
 *
 * The provider is a readonly symbol overview/find/reference surface that must
 * stay OFF by default (enabledByDefault=false, shadowOnly=true) so it never
 * injects prompt content or tool authority unless explicitly enabled. These
 * tests pin the gate and the no-op behavior when not enabled.
 */
import type { RuntimeContextProviderQuery } from "../runtime-core/index.js";
import { describe, expect, it } from "vitest";
import {
  createSymbolContextProvider,
  SYMBOL_CONTEXT_PROVIDER_ID,
} from "./symbol-context-provider.js";

describe("symbol context provider (shadow-only gate)", () => {
  it("is shadow-only and disabled by default", () => {
    const provider = createSymbolContextProvider();
    expect(provider.manifest.id).toBe(SYMBOL_CONTEXT_PROVIDER_ID);
    expect(provider.manifest.enabledByDefault).toBe(false);
    expect(provider.manifest.shadowOnly).toBe(true);
    expect(provider.manifest.metadata).toMatchObject({
      readonlySymbolContext: true,
      shadowOnly: true,
      noPromptAuthority: true,
      noToolAuthority: true,
      noRuntimeAuthority: true,
    });
  });

  it("returns a fallback result when not explicitly enabled", async () => {
    const provider = createSymbolContextProvider();
    const result = await provider.getContext(
      { text: "find SymbolName" } as RuntimeContextProviderQuery,
      {},
    );
    // Shadow gate: no symbol output, no prompt injection.
    if (Array.isArray(result)) {
      expect(result).toEqual([]);
    } else {
      expect(result.status).toBe("fallback");
      expect(result.contextItems).toEqual([]);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    }
  });
});
