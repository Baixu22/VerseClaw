import { describe, expect, it } from "vitest";
import {
  buildCapabilityCatalogSnapshot,
  buildModelCapabilityCatalogView,
  computeCapabilityCatalogDigest,
  discoverCapabilityCatalog,
} from "./tool-search-capability-catalog.js";
import type { ToolSearchCapabilityEntry } from "./tool-search-capability-v3.js";

const entries: ToolSearchCapabilityEntry[] = [
  {
    id: "openclaw:workspace-read",
    source: "openclaw",
    name: "workspace_read",
    label: "Workspace Read",
    description: "Read a workspace file.",
    parameters: { type: "object", properties: { path: { type: "string" } } },
  },
  {
    id: "mcp:github-search",
    source: "mcp",
    sourceName: "github",
    name: "search_issues",
    description: "Search GitHub issues.",
    parameters: { type: "object", properties: { query: { type: "string" } } },
  },
];

function classify(entry: ToolSearchCapabilityEntry) {
  return {
    capabilityId: `tool:${entry.source}:${entry.name.replaceAll("_", "-")}`,
    permissions: entry.source === "mcp" ? ["network.read"] : ["workspace.read"],
    revision: "v1",
  };
}

describe("TF-0502 capability catalog adapter", () => {
  it("builds one deterministic snapshot with executor and availability metadata", () => {
    const snapshot = buildCapabilityCatalogSnapshot({ entries, classify });
    expect(snapshot.schemaVersion).toBe("CapabilityCatalogSnapshot/v1");
    expect(snapshot.entries).toHaveLength(2);
    expect(snapshot.entries[0]).toMatchObject({
      scope: "run",
      executor: { kind: "tool-search" },
      availability: "available",
      executionTopologies: ["proxy"],
    });
    expect(snapshot.entries.find((entry) => entry.source === "mcp")?.permissions).toEqual(["network.read"]);
    expect(snapshot.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(snapshot.digest).toBe(computeCapabilityCatalogDigest(snapshot.entries));
    expect(buildCapabilityCatalogSnapshot({ entries: [...entries].reverse(), classify }).digest).toBe(snapshot.digest);
  });

  it("excludes duplicate capability ids instead of choosing a second catalog", () => {
    const duplicate = [...entries, { ...entries[0]!, id: "openclaw:workspace-read-copy" }];
    const snapshot = buildCapabilityCatalogSnapshot({ entries: duplicate, classify });
    expect(snapshot.entries.map((entry) => entry.capabilityId)).toEqual(["tool:mcp:search-issues"]);
    expect(snapshot.diagnostics).toEqual(["duplicate capability id excluded: tool:openclaw:workspace-read"]);
  });

  it("uses one schema hash for differently ordered but equivalent schemas", () => {
    const left = buildCapabilityCatalogSnapshot({ entries: [entries[0]!], classify });
    const right = buildCapabilityCatalogSnapshot({
      entries: [{
        ...entries[0]!,
        parameters: { properties: { path: { type: "string" } }, type: "object" },
      }],
      classify,
    });
    expect(left.entries[0]?.schemaHash).toBe(right.entries[0]?.schemaHash);
  });

  it("fails closed with an explicit reason when discovery has no callable tool", () => {
    const snapshot = buildCapabilityCatalogSnapshot({
      entries,
      classify,
      availability: () => ({ state: "disabled", reason: "Workspace FactService unavailable." }),
    });
    expect(discoverCapabilityCatalog(snapshot, { text: "workspace" })).toEqual({
      ok: false,
      reason: "No capability is available in the current run; Tool Search catalog is empty or all entries are unavailable.",
      digest: snapshot.digest,
    });
    const empty = buildCapabilityCatalogSnapshot({ entries: [], classify });
    expect(discoverCapabilityCatalog(empty, { text: "workspace" }).ok).toBe(false);
  });

  it("fails closed when a query matches no callable capability", () => {
    const snapshot = buildCapabilityCatalogSnapshot({ entries, classify });
    const result = discoverCapabilityCatalog(snapshot, { text: "nonexistent" });
    expect(result).toEqual({
      ok: false,
      reason: "No callable capability matched the query; refine the query or inspect availability.",
      digest: snapshot.digest,
    });
  });

  it("returns model-safe entries from the same catalog digest", () => {
    const snapshot = buildCapabilityCatalogSnapshot({
      entries,
      classify,
      availability: (entry) =>
        entry.source === "mcp"
          ? { state: "disabled", reason: "Network access is disabled." }
          : { state: "available", reason: null },
    });
    const view = buildModelCapabilityCatalogView(snapshot, {
      "tool:openclaw:workspace-read": "Workspace file read",
    });
    expect(view.digest).toBe(snapshot.digest);
    expect(view.entries).toEqual([
      expect.objectContaining({ capabilityId: "tool:mcp:search-issues", availability: "disabled", reason: "Network access is disabled." }),
      expect.objectContaining({ capabilityId: "tool:openclaw:workspace-read", displayName: "Workspace file read", availability: "available" }),
    ]);
    expect(JSON.stringify(view.entries)).not.toContain("parameters");
    expect(JSON.stringify(view.entries)).not.toContain("executor");
  });
});
