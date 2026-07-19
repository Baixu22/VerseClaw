import { afterEach, describe, expect, it } from "vitest";
import { dcsObservability } from "./dcs-observability.js";

afterEach(() => {
  dcsObservability.reset();
});

describe("DCS dual-injection observability (D7)", () => {
  it("records CVK systemPromptAddition call count and actual chars", () => {
    dcsObservability.recordCvkSystemPromptAddition(120);
    dcsObservability.recordCvkSystemPromptAddition(0);
    const snap = dcsObservability.snapshot();
    expect(snap.cvkSystemPromptAdditionCalls).toBe(2);
    expect(snap.cvkSystemPromptAdditionChars).toBe(120);
  });

  it("records DCS transformContext chars and exactly-once suppressions", () => {
    dcsObservability.recordDcsTransformContextInjection({ chars: 80 });
    dcsObservability.recordDcsTransformContextInjection({ chars: 0, suppressed: true });
    dcsObservability.recordDcsTransformContextInjection({ chars: 40 });
    const snap = dcsObservability.snapshot();
    expect(snap.dcsTransformContextCalls).toBe(3);
    expect(snap.dcsTransformContextChars).toBe(120);
    expect(snap.injectionDuplicateSuppressions).toBe(1);
  });

  it("snapshot is a detached copy", () => {
    dcsObservability.recordCvkSystemPromptAddition(10);
    const a = dcsObservability.snapshot();
    a.cvkSystemPromptAdditionChars = 999;
    expect(dcsObservability.snapshot().cvkSystemPromptAdditionChars).toBe(10);
  });

  it("records Verse Token assembly in the existing DCS registry", () => {
    dcsObservability.recordVtokenAssembly({
      success: true,
      chars: 120,
      tokens: 32,
      sourcesIngested: 4,
    });
    dcsObservability.recordVtokenAssembly({ success: false });
    expect(dcsObservability.snapshot()).toMatchObject({
      vtokenAssemblyCalls: 2,
      vtokenAssemblySuccesses: 1,
      vtokenAssemblyErrors: 1,
      vtokenAssemblyChars: 120,
      vtokenAssemblyTokens: 32,
      vtokenSourcesIngested: 4,
    });
  });
});
