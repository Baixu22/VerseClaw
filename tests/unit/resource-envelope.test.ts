import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ResourceEnvelopeLedger,
  RESOURCE_ENVELOPE_SCHEMA,
  mergeResourceEnvelopeSnapshots,
  type ResourceEnvelopeSnapshot,
} from "../../openclaw_runtime/src/resources/resource-envelope";
import {
  readMergedResourceEnvelopeSnapshot,
  readResourceEnvelopeSnapshot,
  writeResourceEnvelopeSnapshot,
} from "../../openclaw_runtime/src/resources/resource-envelope-snapshot-store";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function snapshot(owner: string, activeSlots: number): ResourceEnvelopeSnapshot {
  const ledger = new ResourceEnvelopeLedger();
  ledger.update({
    id: `${owner}:terminal-exec:ws-a`,
    workspaceKey: "ws-a",
    kind: "terminal-exec",
    priority: "foreground",
    owner,
    activeSlots,
    queuedCount: 0,
    queueWaitMs: 0,
    processCount: 0,
    treeRssBytes: 0,
    treeCpuPercent: 0,
  });
  return ledger.snapshot(1_000);
}

describe("resource envelope shadow ledger", () => {
  it("always admits in shadow mode while recording over-limit candidates", () => {
    const ledger = new ResourceEnvelopeLedger({
      limits: { "terminal-exec": { concurrencySlots: 1, processCount: 2 } },
    });
    const decision = ledger.evaluate({
      id: "main:terminal-exec:ws-a",
      workspaceKey: "ws-a",
      kind: "terminal-exec",
      priority: "foreground",
      owner: "main",
      activeSlots: 3,
      queuedCount: 9,
      queueWaitMs: 20,
      processCount: 4,
      treeRssBytes: 10,
      treeCpuPercent: 5,
    });
    expect(decision).toMatchObject({ allow: true, shadow: true });
    expect(decision.exceeded.map((entry) => entry.dimension)).toEqual([
      "processCount",
      "concurrencySlots",
    ]);
  });

  it("merges Main and Gateway totals without letting adjacent leases hide them", () => {
    const merged = mergeResourceEnvelopeSnapshots([snapshot("main", 2), snapshot("gateway", 1)], 2_000);
    expect(merged.schema).toBe(RESOURCE_ENVELOPE_SCHEMA);
    expect(merged.entries).toHaveLength(2);
    expect(merged.totals.activeSlots).toBe(3);
    expect(merged.entries.map((entry) => entry.owner).sort()).toEqual(["gateway", "main"]);
  });

  it("persists snapshots atomically and fails closed on malformed input", () => {
    const root = mkdtempSync(join(tmpdir(), "clawx-resource-envelope-"));
    roots.push(root);
    const file = join(root, "gateway.json");
    const original = snapshot("gateway", 1);
    writeResourceEnvelopeSnapshot(original, file);
    expect(readResourceEnvelopeSnapshot(file)?.totals.activeSlots).toBe(1);
    writeFileSync(file, JSON.stringify({ schema: "wrong", entries: [] }), "utf8");
    expect(readResourceEnvelopeSnapshot(file)).toBeNull();
    expect(readMergedResourceEnvelopeSnapshot({ gatewayPath: file, now: 5_000 }).warnings).toEqual([
      "gateway resource-envelope snapshot unavailable",
    ]);
  });
});