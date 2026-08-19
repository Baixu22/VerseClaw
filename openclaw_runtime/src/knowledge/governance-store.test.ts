import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeOpenClawStateDatabaseForTest, openOpenClawStateDatabase } from "../state/openclaw-state-db.js";
import { GovernanceStore, type GovernanceCandidateRecord, type GovernanceProposalRecord } from "./governance-store.js";

const roots: string[] = [];
afterEach(() => {
  closeOpenClawStateDatabaseForTest();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeCandidate(id: string, overrides: Partial<GovernanceCandidateRecord> = {}): GovernanceCandidateRecord {
  return {
    id,
    recordKind: "draft",
    kind: "manual",
    type: "synthesis",
    status: "draft",
    title: `Candidate ${id}`,
    body: "Body for candidate with enough reusable content.",
    sourceIds: [`source:${id}`],
    sourceRefs: [{ id: `source:${id}`, kind: "manual" }],
    tags: ["governance"],
    workspaceId: null,
    agentId: null,
    createdBy: "user",
    warnings: [],
    metadata: {},
    revision: 1,
    contentDigest: `digest-${id}`,
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
    ...overrides,
  };
}

function makeProposal(id: string, overrides: Partial<GovernanceProposalRecord> = {}): GovernanceProposalRecord {
  return {
    id,
    operation: "create",
    status: "proposed",
    draftId: `draft-${id}`,
    reason: "review",
    sources: [{ id: "source", kind: "manual" }],
    requiresUserConfirmation: true,
    revision: 1,
    contentDigest: `digest-${id}`,
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
    ...overrides,
  };
}

function openStore() {
  const root = mkdtempSync(path.join(os.tmpdir(), "clawx-governance-store-"));
  roots.push(root);
  const database = openOpenClawStateDatabase({ path: path.join(root, "state.sqlite") });
  return new GovernanceStore({ database: { path: database.path } });
}

describe("KS-03 GovernanceStore", () => {
  it("persists candidates and proposals with json round-trip fidelity", () => {
    const store = openStore();
    store.saveCandidate(makeCandidate("draft-1"));
    store.saveProposal(makeProposal("proposal-1"));
    expect(store.getCandidate("draft-1")).toMatchObject({
      id: "draft-1",
      title: "Candidate draft-1",
      sourceRefs: [{ id: "source:draft-1", kind: "manual" }],
      metadata: {},
      revision: 1,
    });
    expect(store.getProposal("proposal-1")).toMatchObject({
      id: "proposal-1",
      draftId: "draft-proposal-1",
      sources: [{ id: "source", kind: "manual" }],
    });
  });

  it("imports legacy records in one transaction and reports count/digest parity", () => {
    const store = openStore();
    const report = store.importBatch({
      candidates: [makeCandidate("draft-a"), makeCandidate("inbox-b", { recordKind: "inbox", status: "pending", kind: "task-ledger", type: "decision" })],
      proposals: [makeProposal("proposal-a")],
    });
    expect(report.schema).toBe("knowledge-governance-import-parity.v1");
    expect(report.candidates.jsonCount).toBe(2);
    expect(report.candidates.importedCount).toBe(2);
    expect(report.proposals.jsonCount).toBe(1);
    expect(report.proposals.importedCount).toBe(1);
    expect(report.legacyJsonMode).toBe("read-only");
    expect(store.listCandidates({ status: "draft" })).toHaveLength(1);
    expect(store.listCandidates({ recordKind: "inbox" })).toHaveLength(1);
  });

  it("preserves captureKey and supports capture-key lookup", () => {
    const store = openStore();
    store.saveCandidate(makeCandidate("inbox-1", {
      recordKind: "inbox",
      kind: "task-ledger",
      captureKey: "mission:1:tick:1:knowledge:stable",
    }));
    expect(store.listCandidates({ captureKey: "mission:1:tick:1:knowledge:stable" })).toHaveLength(1);
  });

  it("records governance events and owner links", () => {
    const store = openStore();
    store.saveEvent({ id: "kge-1", stream: "knowledge", eventType: "candidate_created", payload: { id: "draft-1" }, createdAt: "2026-08-17T00:00:00.000Z" });
    store.saveOwnerLink({
      sourceRef: "source:draft-1",
      owner: "memory-wiki",
      subjectKind: "wiki-page",
      subjectId: "wiki-page-1",
      revision: 1,
      contentDigest: "digest",
      createdAt: "2026-08-17T00:00:00.000Z",
      updatedAt: "2026-08-17T00:00:00.000Z",
    });
    expect(store.listOwnerLinks("memory-wiki")).toHaveLength(1);
  });
});
