import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURE = "harness/specs/fixtures/harness-codex-authority-baseline";
const read = (name: string) => JSON.parse(readFileSync(resolve(ROOT, FIXTURE, name), "utf8"));
const sha256 = (name: string) => createHash("sha256").update(readFileSync(resolve(ROOT, FIXTURE, name))).digest("hex");

describe("harness and Codex authority baseline", () => {
  it("keeps harness layers separate from product owners", () => {
    const matrix = read("authority-matrix.json");
    expect(matrix.layers.map((layer: { id: string }) => layer.id)).toEqual(expect.arrayContaining([
      "openclaw-native", "codex-app-server", "codex-command-surface", "acpx", "codex-supervisor", "copilot-provider", "clawx-owners"
    ]));
    for (const layer of matrix.layers) {
      expect(layer.source.length).toBeGreaterThan(0);
      expect(layer.owns.length).toBeGreaterThan(0);
      expect(layer.doesNotOwn.length).toBeGreaterThan(0);
      expect(layer.fallback.length).toBeGreaterThan(0);
      expect(layer.decision).toBeTruthy();
      expect(layer.adoptionScope).toBeTruthy();
      for (const source of layer.source) {
        expect(existsSync(resolve(ROOT, source)), "missing source: " + source).toBe(true);
      }
    }
  });
  it("covers all scenarios and assigns them to a next node", () => {
    const scenarios = read("scenario-matrix.json");
    expect(scenarios.scenarios.map((scenario: { id: string }) => scenario.id)).toEqual(expect.arrayContaining([
      "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10", "S11"
    ]));
    for (const scenario of scenarios.scenarios) {
      expect(scenario.owner).toBeTruthy();
      expect(scenario.negativeCase).toBeTruthy();
      expect(scenario.realValue).toBeTruthy();
      expect(scenario.negativeEvidence).toBeTruthy();
      expect(scenario.ownerBoundary).toBeTruthy();
      expect(scenario.nextNode).toMatch(/^TF-05(66|67|68|69|70)$/);
    }
  });
  it("retains an agent-driven acceptance receipt without promoting runtime claims", () => {
    const receipt = read("acceptance.json");
    expect(receipt.schemaVersion).toBe("HarnessCodexAuthorityAcceptance/v1");
    expect(receipt.driven_by).toBe("agent");
    expect(receipt.node).toBe("TF-0565");
    expect(receipt.realHumanEvidence).toBe(false);
    expect(receipt.packageOrReleaseStateChanged).toBe(false);
    expect(receipt.validation.length).toBeGreaterThanOrEqual(5);
    expect(receipt.validation.every((entry: { exitCode: number }) => entry.exitCode === 0)).toBe(true);
    expect(receipt.fixtureHashes.every((entry: { match: boolean }) => entry.match)).toBe(true);
    const fixtureDir = "harness/specs/fixtures/harness-codex-authority-baseline";
    for (const entry of receipt.fixtureHashes as Array<{ file: string }>) {
      expect(receipt.fixtureHashes.length).toBeGreaterThan(0);
      expect(existsSync(resolve(ROOT, fixtureDir, entry.file))).toBe(true);
    }
  });
  it("keeps external sources primary and explicitly non-accepting", () => {
    const ledger = read("verseSearch-sources.json");
    expect(ledger.sources.length).toBeGreaterThanOrEqual(10);
    for (const source of ledger.sources) {
      expect(source.url).toMatch(/^https:\/\//);
      expect(source.status).toBeTruthy();
      expect(source.evidenceType).toBeTruthy();
      expect(source.retrievalMethod).toBeTruthy();
      expect(source.observationTime).toBeTruthy();
      expect(source.contentScope).toBeTruthy();
      expect(["retrieved", "search-result-only", "failed", "paywalled"]).toContain(source.status);
    }
    expect(ledger.boundaries.join(" ")).toContain("not product acceptance");
    expect(ledger.retrieval.boundary).toContain("does not mean");
  });
  it("keeps the retained fixture manifest complete", () => {
    const manifest = readFileSync(resolve(ROOT, FIXTURE, "SHA256SUMS"), "utf8");
    for (const name of ["authority-matrix.json", "scenario-matrix.json", "verseSearch-sources.json", "runtime-probe-20261026.json"]) {
      expect(manifest).toContain(`${sha256(name)}  ${name}`);
    }
  });
});
