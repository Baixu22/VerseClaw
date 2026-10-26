import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HARNESS_ADAPTER_CONTRACTS, HARNESS_ADAPTER_CONTRACT_SCHEMA, getHarnessAdapterContract } from "../../shared/harness-adapter-contract.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURE = "harness/specs/fixtures/harness-codex-adapter-pilot";

describe("TF-0568 adapter contract and pilot", () => {
  it("freezes protocol, session, permission, lifecycle, cost and fail-closed fields", () => {
    expect(HARNESS_ADAPTER_CONTRACT_SCHEMA).toBe("HarnessAdapterContract/v1");
    expect(HARNESS_ADAPTER_CONTRACTS.length).toBeGreaterThanOrEqual(3);
    for (const contract of HARNESS_ADAPTER_CONTRACTS) {
      expect(contract.protocol.protocol).toMatch(/acp|native|cli/);
      expect(contract.session.identity).toBeTruthy();
      expect(contract.permission.denyByDefault).toBe(false);
      expect(contract.failClosed.silentFallback).toBe(false);
      expect(contract.evidence.driven_by).toBe("agent");
      expect(contract.limitations.length).toBeGreaterThan(0);
    }
    expect(getHarnessAdapterContract("acpx-codex")?.protocol.initialize).toBe("verified");
    expect(getHarnessAdapterContract("opencode")?.availability).toBe("unavailable");
  });

  it("retains a real pilot with initialize evidence and explicit not-run comparisons", () => {
    const receipt = JSON.parse(readFileSync(resolve(ROOT, FIXTURE, "acceptance.json"), "utf8"));
    expect(receipt.schemaVersion).toBe("HarnessAdapterPilotAcceptance/v1");
    expect(receipt.driven_by).toBe("agent");
    expect(receipt.node).toBe("TF-0568");
    expect(receipt.protocol.protocolOk).toBe(true);
    expect(receipt.protocol.protocolVersion).toBe(1);
    expect(receipt.protocol.agentInfo.name).toBe("codex-acp");
    expect(receipt.protocol.authMethods.length).toBe(3);
    expect(receipt.opencodeBaseline.binaryVersionExitCode).toBe(0);
    expect(receipt.opencodeBaseline.modelTurn).toBe("failed-before-turn");
    expect(receipt.protocolLifecycle.status).toBe("pass");
    expect(receipt.sourceLedger.path).toContain("verseSearch-sources.json");
    expect(receipt.sourceLedger.opencode).toContain("opencode-acp");
    expect(receipt.rollback.adapterRegistered).toBe(false);
    expect(receipt.rollback.productPathChanged).toBe(false);
    expect(receipt.protocolLifecycle.fixture).toBe("mock-acp-lifecycle.json");
    expect(receipt.modelTurn.status).toBe("pass");
    const real = JSON.parse(readFileSync(resolve(ROOT, FIXTURE, "real-turns.json"), "utf8"));
    expect(real.results.directResponses.quality).toBe("pass");
    expect(real.results.nativeOpenClaw.quality).toBe("pass");
    expect(real.results.acpxCodex.quality).toBe("pass");
    expect(real.comparison.latency.acpxCodexWallMs).toBeGreaterThan(0);
    expect(real.comparison.currencyCost).toContain("not-run");
    for (const key of ["nativeOpenClaw", "codexAppServer", "acpxCodex", "opencode"]) {
      expect(receipt.comparisons[key].quality).toBe("not-run");
      expect(receipt.comparisons[key].latency).toBe("not-run");
      expect(receipt.comparisons[key].cost).toBe("not-run");
    }
    expect(receipt.productBoundary.defaultChanged).toBe(false);
    expect(receipt.productBoundary.silentFallback).toBe(false);
    expect(receipt.productBoundary.realHumanEvidence).toBe(false);
  });
});
