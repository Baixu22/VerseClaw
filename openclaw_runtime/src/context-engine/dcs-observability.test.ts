import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

describe("DCS observability writeSoakSnapshot (D7 minimal on-disk export)", () => {
  it("writes a timestamped JSON file with current counters and honesty markers", () => {
    const dir = mkdtempSync(join(tmpdir(), "dcs-soak-snap-"));
    try {
      dcsObservability.recordCvkSystemPromptAddition(42);
      dcsObservability.recordContextOrchestrator({
        killSwitch: false,
        stages: 3,
        charsAdded: 100,
      });

      const result = dcsObservability.writeSoakSnapshot(dir);

      expect(existsSync(result.path)).toBe(true);
      expect(result.schema).toBe("tf0006-soak-snapshot/dcs/v1");
      expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      const written = JSON.parse(readFileSync(result.path, "utf8"));
      expect(written.schema).toBe("tf0006-soak-snapshot/dcs/v1");
      expect(written.counters.cvkSystemPromptAdditionCalls).toBe(1);
      expect(written.counters.cvkSystemPromptAdditionChars).toBe(42);
      expect(written.counters.contextOrchestratorCalls).toBe(1);
      // Honesty markers: never claim soak satisfaction from a dump alone.
      expect(written.satisfiesTf0006Soak).toBe(false);
      expect(written.live).toBe(false);
      expect(typeof written.d7ResidualNote).toBe("string");
      expect(written.d7ResidualNote.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("creates targetDir if missing and does not mutate counters", () => {
    const base = mkdtempSync(join(tmpdir(), "dcs-soak-mkdir-"));
    const dir = join(base, "nested", "snapshots");
    try {
      dcsObservability.recordCvkSystemPromptAddition(7);
      const before = dcsObservability.snapshot();

      const result = dcsObservability.writeSoakSnapshot(dir);

      expect(existsSync(result.path)).toBe(true);
      expect(readdirSync(dir).length).toBe(1);
      // Counters unchanged after dump (no reset side effect).
      expect(dcsObservability.snapshot()).toEqual(before);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("produces unique filenames across rapid successive calls", () => {
    const dir = mkdtempSync(join(tmpdir(), "dcs-soak-uniq-"));
    try {
      const paths = new Set<string>();
      for (let i = 0; i < 5; i++) {
        paths.add(dcsObservability.writeSoakSnapshot(dir).path);
      }
      expect(paths.size).toBe(5);
      expect(readdirSync(dir).length).toBe(5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects empty targetDir", () => {
    expect(() => dcsObservability.writeSoakSnapshot("")).toThrow(/targetDir/);
  });
});
