// @vitest-environment node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { VTOKEN_RETIRED, resolveVtokenAssemblyConfig, shouldAssembleVtokenWorkingContext } from '../../openclaw_runtime/src/context-engine/chat-turn-vtoken-injection';
import { VTOKEN_BRIDGE_RETIRED, readVtokenBridgeEnabledFromEnv, setVtokenBridgeEnabled, isVtokenBridgeEnabled } from '../../electron/services/vtoken-bridge';

const dir = 'tests/unit/fixtures/vtoken-tf0496';
const read = (name: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), dir, name), "utf8"));

describe('TF-0496 deciding A/B is self-consistent', () => {
  it('has the predeclared number of pairs with no provider errors', () => {
    const protocol = read("ab-protocol.json");
    const run = read("ab-run.json");
    expect(run.pairs).toHaveLength(protocol.design.totalPairs);
    expect(run.summary.pairs).toBe(protocol.design.totalPairs);
    expect(run.summary.providerErrors).toBe(0);
    expect(run.checks.providerErrorsZero).toBe(true);
  });

  it('reports both the real usage reduction and the materiality failure', () => {
    const run = read("ab-run.json");
    expect(run.summary.cachedTokensReported).toBe(true);
    expect(run.summary.inputTokenReductionMean).toBeGreaterThan(0);
    expect(run.summary.inputTokenReductionCi95.lower).toBeGreaterThan(0);
    // Below the predeclared 10% materiality bar, which is the only failing check.
    expect(run.summary.relativeInputTokenReduction).toBeLessThan(0.1);
    expect(run.checks.materialTokenWin).toBe(false);
    expect(run.checks.qualityNonInferior).toBe(true);
    expect(run.checks.latencyNonRegression).toBe(true);
    expect(run.decision.status).toBe("retire-or-hold");
    expect(run.decision.reasons).toEqual(["materialTokenWin"]);
  });

  it('binds the run to the frozen protocol digest', () => {
    const protocolBytes = fs.readFileSync(path.join(process.cwd(), dir, "ab-protocol.json"));
    const digest = crypto.createHash("sha256").update(protocolBytes).digest("hex");
    expect(read("ab-run.json").protocolSha256).toBe(digest);
  });
});

describe('TF-0496 retirement is unconditional', () => {
  it('cannot be enabled from runtime config or environment', () => {
    expect(VTOKEN_RETIRED).toBe(true);
    const previous = process.env.VERSE_VTOKEN_ASSEMBLY_ENABLED;
    try {
      process.env.VERSE_VTOKEN_ASSEMBLY_ENABLED = "1";
      expect(resolveVtokenAssemblyConfig({ runtime: { vtoken: { assembly: { enabled: true } } } }).enabled).toBe(false);
      expect(resolveVtokenAssemblyConfig({}).enabled).toBe(false);
      expect(shouldAssembleVtokenWorkingContext({ enabled: true, budgetTokens: 600, renderMode: "compact", sessions: "all", timeoutMs: 12000, maxSourceFiles: 12, maxSourceChars: 24000 })).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.VERSE_VTOKEN_ASSEMBLY_ENABLED;
      else process.env.VERSE_VTOKEN_ASSEMBLY_ENABLED = previous;
    }
  });

  it('cannot be enabled from the host bridge surface', () => {
    expect(VTOKEN_BRIDGE_RETIRED).toBe(true);
    const previous = process.env.VERSE_VTOKEN_BRIDGE_ENABLED;
    try {
      process.env.VERSE_VTOKEN_BRIDGE_ENABLED = "1";
      expect(readVtokenBridgeEnabledFromEnv()).toBe(false);
      setVtokenBridgeEnabled(true);
      expect(isVtokenBridgeEnabled()).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.VERSE_VTOKEN_BRIDGE_ENABLED;
      else process.env.VERSE_VTOKEN_BRIDGE_ENABLED = previous;
    }
  });

  it('keeps the retirement decision on disk with a rollback record', () => {
    const doc = fs.readFileSync(path.join(process.cwd(), 'docs/dev/vtoken-retirement-decision.md'), 'utf8');
    expect(doc).toContain("retired");
    expect(doc).toContain("Rollback");
    expect(doc).toContain("materiality");
    expect(doc).toContain("TF-0505");
  });
});
