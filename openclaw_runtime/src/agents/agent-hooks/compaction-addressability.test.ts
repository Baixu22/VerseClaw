import { describe, expect, it } from "vitest";
import {
  buildDeterministicCompressionArtifact,
  type CompressionArtifact,
  type CompressionEvidenceRef,
  type CompressionSemanticAtom,
} from "../../../packages/agent-core/src/harness/compaction/compression-artifact.js";
import {
  auditCompactionAddressability,
  bindCompactionArchiveEvidence,
  bindCompactionDetailsArchiveEvidence,
  buildPreviousCompactionLedgerMessage,
} from "./compaction-addressability.js";
import { normalizeChecksum } from "../../../../shared/types/context-runtime-kit.js";
import type { ArchiveHandle } from "../../../../shared/types/context-family.js";
import {
  compileCvkFixtureSources,
  type CvkFixtureArtifact,
} from "../../context-engine/cvk/compiler.js";
import { buildCvkRecoveryContext } from "../../context-engine/cvk/recovery.js";
import type { AgentMessage } from "../runtime/index.js";

function message(id: string, role: "user", content: string): AgentMessage & { id: string } {
  return { id, role, content, timestamp: 0 };
}

function atom(
  id: string,
  type: CompressionSemanticAtom["type"],
  canonicalIdentity: string,
  text: string,
  status: CompressionSemanticAtom["status"] = "verified",
  evidenceRefs: CompressionEvidenceRef[] = [],
): CompressionSemanticAtom {
  return {
    id,
    type,
    canonicalIdentity,
    severity: "critical",
    confidence: 0.95,
    scope: "session",
    polarity: "neutral",
    status,
    text,
    evidenceRefs,
  };
}

function artifactWithAtoms(atoms: CompressionSemanticAtom[]): CompressionArtifact {
  return buildDeterministicCompressionArtifact({
    messages: [message("message:1", "user", "Preserve critical atoms for P3 addressability.")],
    semanticAtoms: atoms,
  });
}

function archiveHandle(uri = "context-archive://session-1/pre-compaction.context-archive.json"): ArchiveHandle {
  return {
    uri,
    checksum: normalizeChecksum(`sha256:${"a".repeat(64)}`),
    byteLength: 128,
    createdAt: "2026-08-17T00:00:00.000Z",
  };
}

function buildCvkArtifact(): CvkFixtureArtifact {
  return compileCvkFixtureSources({
    sources: [{
      kind: "project_rule",
      id: "p3-addressability-rules",
      version: "v1",
      title: "P3 Addressability Rules",
      rules: [
        { selector: "rule:keep", text: "Keep critical atoms addressable." },
        { selector: "rule:old", text: "Old stale branch rule." },
      ],
    }],
  });
}

function cvkChunkRef(artifact: CvkFixtureArtifact, selector: string): {
  resourceId: string;
  selector: string;
  checksum: string;
} {
  const chunk = artifact.chunks.find((item) => (
    item.resourceId === "project_rule:p3-addressability-rules@v1" && item.selector === selector
  ));
  if (!chunk) {
    throw new Error(`Missing cvk fixture selector ${selector}`);
  }
  return {
    resourceId: chunk.resourceId,
    selector: chunk.selector,
    checksum: chunk.checksum,
  };
}

function cvkEvidenceRef(artifact: CvkFixtureArtifact, selector: string): CompressionEvidenceRef {
  const ref = cvkChunkRef(artifact, selector);
  return {
    type: "cvk",
    ref: `cvk:${ref.resourceId}::${ref.selector}`,
    label: ref.checksum,
  };
}

function textOf(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block) => {
      if (!block || typeof block !== "object") return [];
      const text = (block as { text?: unknown }).text;
      return typeof text === "string" ? [text] : [];
    })
    .join("\n");
}

describe("auditCompactionAddressability", () => {
  it("does not treat a session-only critical atom as addressable", () => {
    const artifact = artifactWithAtoms([
      atom("atom-goal-session", "goal", "goal:session-only", "Session-only critical goal.", "verified", [
        { type: "session", ref: "message:1" },
      ]),
    ]);

    const audit = auditCompactionAddressability({ artifact });

    expect(audit.criticalAtomCount).toBe(1);
    expect(audit.addressableCount).toBe(0);
    expect(audit.diagnostics).toEqual([
      expect.objectContaining({
        atomId: "atom-goal-session",
        status: "missing_archive",
      }),
    ]);
  });

  it("makes every critical atom addressable after archive bind and survives JSON round-trip", () => {
    const handle = archiveHandle();
    const artifact = artifactWithAtoms([
      atom("atom-goal-a", "goal", "goal:archive-bound", "Archive-bound critical goal.", "verified", [
        { type: "session", ref: "message:1" },
      ]),
    ]);

    const bound = bindCompactionArchiveEvidence({ artifact, archiveHandle: handle });

    expect(bound.semanticAtoms?.[0]?.evidenceRefs).toContainEqual({
      type: "archive",
      ref: handle.uri,
      label: "pre-compaction checkpoint",
    });
    expect(JSON.parse(JSON.stringify(bound))).toEqual(bound);

    const audit = auditCompactionAddressability({ artifact: bound, archiveHandles: [handle] });
    expect(audit.criticalAtomCount).toBe(1);
    expect(audit.addressableCount).toBe(1);
    expect(audit.diagnostics[0]?.status).toBe("ok");
  });

  it("is idempotent and does not duplicate archive evidence when file or cvk evidence exists", () => {
    const cvkArtifact = buildCvkArtifact();
    const handle = archiveHandle();
    const fileAtom = atom("atom-file", "constraint", "constraint:file", "File-backed constraint.", "verified", [
      { type: "file", ref: "openclaw_runtime/src/agents/agent-hooks/compaction-addressability.ts" },
    ]);
    const cvkAtom = atom("atom-cvk", "decision", "decision:cvk", "CVK-backed decision.", "verified", [
      cvkEvidenceRef(cvkArtifact, "rule:keep"),
    ]);
    const artifact = artifactWithAtoms([fileAtom, cvkAtom]);

    const bound = bindCompactionArchiveEvidence({ artifact, archiveHandle: handle });

    expect(bound.semanticAtoms?.[0]?.evidenceRefs).toHaveLength(1);
    expect(bound.semanticAtoms?.[1]?.evidenceRefs).toHaveLength(1);
    expect(bound.semanticAtoms?.[0]?.evidenceRefs.some((ref) => ref.type === "archive")).toBe(false);
    expect(bound.semanticAtoms?.[1]?.evidenceRefs.some((ref) => ref.type === "archive")).toBe(false);

    const audit = auditCompactionAddressability({
      artifact: bound,
      archiveHandles: [handle],
      cvkArtifact,
    });
    expect(audit.criticalAtomCount).toBe(2);
    expect(audit.addressableCount).toBe(2);
  });

  it("returns missing_selector and stale_selector diagnostics and keeps recovery explicit-fail", () => {
    const cvkArtifact = buildCvkArtifact();
    const missingEvidence = cvkEvidenceRef(cvkArtifact, "rule:keep");
    const missingAtom = atom(
      "atom-missing",
      "next_action",
      "next:missing",
      "Missing selector next action.",
      "verified",
      [{
        type: "cvk",
        ref: "cvk:project_rule:p3-addressability-rules@v1::rule:missing",
        label: `sha256:${"f".repeat(64)}`,
      }],
    );
    const missingArtifact = artifactWithAtoms([missingAtom]);

    const missingAudit = auditCompactionAddressability({ artifact: missingArtifact, cvkArtifact });
    expect(missingAudit.addressableCount).toBe(0);
    expect(missingAudit.diagnostics[0]?.status).toBe("missing_selector");

    const staleCvk = {
      resourceId: missingEvidence.ref.replace(/^cvk:/, "").split("::")[0]!,
      selector: missingEvidence.ref.replace(/^cvk:/, "").split("::")[1]!,
      checksum: missingEvidence.label,
      kind: "project_rule" as const,
    };
    const staleArtifact = buildDeterministicCompressionArtifact({
      messages: [message("message:1", "user", "Stale selector recovery.")],
      semanticAtoms: [
        atom("atom-stale", "decision", "decision:stale", "Stale selector decision.", "verified", [missingEvidence]),
      ],
      contextRuntimeKit: {
        staleReferences: [staleCvk],
      },
    });

    const staleAudit = auditCompactionAddressability({ artifact: staleArtifact, cvkArtifact });
    expect(staleAudit.addressableCount).toBe(0);
    expect(staleAudit.diagnostics[0]?.status).toBe("stale_selector");

    const recoveryArtifact = buildDeterministicCompressionArtifact({
      messages: [message("message:1", "user", "Missing selector recovery.")],
      contextRuntimeKit: {
        requiredSelectors: [{
          resourceId: "project_rule:p3-addressability-rules@v1",
          selector: "rule:missing",
          checksum: `sha256:${"f".repeat(64)}`,
          kind: "project_rule",
        }],
      },
    });
    const recovery = buildCvkRecoveryContext({
      compressionArtifact: recoveryArtifact,
      cvkArtifact,
    });
    expect(recovery.ok).toBe(false);
    expect(recovery.projection.missingReferenceDiagnostics[0]?.status).toBe("missing_selector");
  });
});

describe("bindCompactionDetailsArchiveEvidence", () => {
  it("binds archive evidence from checkpoint snapshot handles and leaves details unchanged without one", () => {
    const handle = archiveHandle();
    const artifact = artifactWithAtoms([
      atom("atom-goal-a", "goal", "goal:checkpoint", "Checkpoint-backed goal.", "verified", [
        { type: "session", ref: "message:1" },
      ]),
    ]);
    const details = { readFiles: [], modifiedFiles: [], artifact };

    const bound = bindCompactionDetailsArchiveEvidence({ details, archiveHandle: handle });
    expect(
      (bound?.artifact as CompressionArtifact).semanticAtoms?.[0]?.evidenceRefs.some(
        (ref) => ref.type === "archive" && ref.ref === handle.uri,
      ),
    ).toBe(true);

    const unchanged = bindCompactionDetailsArchiveEvidence({ details, archiveHandle: undefined });
    expect(unchanged).toBe(details);
  });
});

describe("buildPreviousCompactionLedgerMessage", () => {
  it("prefers a bounded atom ledger projection over the previous summary", () => {
    const previous = artifactWithAtoms([
      atom("atom-goal-a", "goal", "goal:ledger-first", "Ledger-first critical goal.", "verified", [
        { type: "archive", ref: "context-archive://session-1/pre-compaction.context-archive.json" },
      ]),
    ]);
    const result = buildPreviousCompactionLedgerMessage({
      previousArtifact: previous,
      previousSummary: "legacy summary should not be used",
    });

    expect(result).toBeDefined();
    const text = textOf(result!);
    expect(text).toContain("previous-compaction-ledger");
    expect(text).toContain("goal:ledger-first");
    expect(text).not.toContain("legacy summary should not be used");
  });

  it("keeps the legacy previous-summary path when no artifact is available", () => {
    const result = buildPreviousCompactionLedgerMessage({
      previousSummary: "Legacy previous summary text.",
    });

    expect(result).toBeDefined();
    const text = textOf(result!);
    expect(text).toContain("previous-compaction-summary");
    expect(text).toContain("Legacy previous summary text.");
  });

  it("bounds ledger projection output and omits large atom bodies", () => {
    const previous = artifactWithAtoms([
      atom(
        "atom-goal-large",
        "goal",
        "goal:large",
        "Critical goal with a large body ".repeat(30),
        "verified",
        [{ type: "archive", ref: "context-archive://session-1/pre-compaction.context-archive.json" }],
      ),
    ]);
    const result = buildPreviousCompactionLedgerMessage({
      previousArtifact: previous,
      previousSummary: "Legacy fallback.",
      maxChars: 360,
    });

    expect(result).toBeDefined();
    const text = textOf(result!);
    expect(text.length).toBeLessThanOrEqual(460);
    expect(text).not.toContain("large body ".repeat(30));
  });
});
