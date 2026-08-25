/**
 * P3 addressability audit and evidence-projection helpers.
 *
 * These helpers keep compaction deterministic and shadow-only:
 * - auditCompactionAddressability checks whether every critical atom can be
 *   recovered through an archive handle, file hunk, or CVK selector.
 * - bindCompactionArchiveEvidence wires a captured checkpoint archive handle
 *   into critical atoms that would otherwise only have session refs.
 * - buildPreviousCompactionLedgerMessage renders a bounded previous-artifact
 *   ledger so the next compaction re-distills atoms + new messages instead of
 *   recursively summarizing the previous natural-language summary.
 */
import type { AgentMessage } from "../runtime/index.js";
import type { ArchiveHandle } from "../../../../shared/types/context-family.js";
import {
  type CompressionArtifact,
  type CompressionEvidenceRef,
} from "../../../packages/agent-core/src/harness/compaction/compression-artifact.js";
import { resolveCvkSelector } from "../../context-engine/cvk/resolver.js";
import type { CvkFixtureArtifact } from "../../context-engine/cvk/compiler.js";

export type CompactionAddressabilityStatus =
  | "missing_evidence"
  | "missing_archive"
  | "missing_file"
  | "missing_selector"
  | "stale_selector"
  | "ok";

export type CompactionAddressabilityDiagnostic = {
  atomId: string;
  status: CompactionAddressabilityStatus;
  evidenceRefs: string[];
  message: string;
};

export type CompactionAddressabilityAudit = {
  criticalAtomCount: number;
  addressableCount: number;
  diagnostics: CompactionAddressabilityDiagnostic[];
};

const DEFAULT_ARCHIVE_EVIDENCE_LABEL = "pre-compaction checkpoint";
const DEFAULT_LEDGER_MAX_CHARS = 2000;
const LEDGER_ATOM_LIMIT = 12;
const LEDGER_EVIDENCE_LIMIT = 4;
const PREVIOUS_SUMMARY_REDISTILL_PREFIX =
  "Previous compaction summary to re-distill with the current conversation. " +
  "Prune stale, duplicate, or superseded details instead of preserving it verbatim.";
const PREVIOUS_COMPACTION_LEDGER_PREFIX =
  "Previous compaction atom ledger to re-distill with the current conversation. " +
  "Prefer current messages; keep active critical atoms addressable and drop stale or superseded work.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function evidenceKey(ref: CompressionEvidenceRef): string {
  return `${ref.type}:${ref.ref}`;
}

function hasRecoverableEvidenceType(ref: CompressionEvidenceRef): boolean {
  return ref.type === "file" || ref.type === "archive" || ref.type === "cvk";
}

function parseCvkEvidenceRef(ref: CompressionEvidenceRef): {
  resourceId: string;
  selector: string;
  checksum?: string;
} | undefined {
  if (ref.type !== "cvk") {
    return undefined;
  }
  let body = ref.ref.trim();
  if (body.startsWith("cvk:")) {
    body = body.slice(4);
  }
  const separator = "::";
  const separatorIndex = body.indexOf(separator);
  if (separatorIndex <= 0 || separatorIndex + separator.length >= body.length) {
    return undefined;
  }
  const resourceId = body.slice(0, separatorIndex).trim();
  const selector = body.slice(separatorIndex + separator.length).trim();
  if (!resourceId || !selector) {
    return undefined;
  }
  const label = ref.label?.trim();
  const checksum = label && /^sha256:[A-Fa-f0-9]{16,}$/.test(label) ? label : undefined;
  return {
    resourceId,
    selector,
    ...(checksum ? { checksum } : {}),
  };
}

function resolveCvkEvidenceRef(params: {
  artifact: CompressionArtifact;
  ref: CompressionEvidenceRef;
  cvkArtifact?: CvkFixtureArtifact;
}): { status: CompactionAddressabilityStatus; message: string } {
  const parsed = parseCvkEvidenceRef(params.ref);
  if (!parsed) {
    return {
      status: "missing_selector",
      message: "CVK evidence ref is malformed and cannot be resolved.",
    };
  }
  const stale = params.artifact.staleReferences?.some(
    (entry) => entry.resourceId === parsed.resourceId && entry.selector === parsed.selector,
  );
  if (stale) {
    return {
      status: "stale_selector",
      message: `CVK selector ${parsed.resourceId} ${parsed.selector} is stale and must be revalidated.`,
    };
  }
  if (!params.cvkArtifact) {
    return {
      status: "missing_selector",
      message: `CVK selector ${parsed.resourceId} ${parsed.selector} cannot be resolved without a CVK artifact.`,
    };
  }
  const required = params.artifact.requiredSelectors?.find(
    (entry) => entry.resourceId === parsed.resourceId && entry.selector === parsed.selector,
  );
  const checksum = required?.checksum ?? parsed.checksum;
  const result = resolveCvkSelector(params.cvkArtifact, {
    resourceId: parsed.resourceId,
    selector: parsed.selector,
    ...(checksum ? { checksum } : {}),
  });
  if (result.ok) {
    return {
      status: "ok",
      message: `CVK selector ${parsed.resourceId} ${parsed.selector} resolved.`,
    };
  }
  return {
    status: result.status === "stale_selector" ? "stale_selector" : "missing_selector",
    message: result.diagnostic.message,
  };
}

function archiveRefIsResolvable(
  ref: CompressionEvidenceRef,
  archiveHandles: readonly ArchiveHandle[] | undefined,
): boolean {
  if (ref.type !== "archive" || !ref.ref.trim()) {
    return false;
  }
  if (!archiveHandles) {
    return false;
  }
  return archiveHandles.some((handle) => handle.uri === ref.ref);
}

function auditAtom(params: {
  atom: NonNullable<CompressionArtifact["semanticAtoms"]>[number];
  artifact: CompressionArtifact;
  archiveHandles?: ArchiveHandle[];
  cvkArtifact?: CvkFixtureArtifact;
}): CompactionAddressabilityDiagnostic {
  const { atom, artifact, archiveHandles, cvkArtifact } = params;
  const evidenceRefs = atom.evidenceRefs.map(evidenceKey);
  const fileRefs = atom.evidenceRefs.filter((ref) => ref.type === "file" && ref.ref.trim());
  const archiveRefs = atom.evidenceRefs.filter((ref) =>
    archiveRefIsResolvable(ref, archiveHandles),
  );
  const cvkRefs = atom.evidenceRefs.filter((ref) => ref.type === "cvk");

  let hasFile = false;
  let hasArchive = false;
  let hasCvk = false;
  let cvkFailure: CompactionAddressabilityStatus = "missing_selector";
  let cvkMessage = "";

  for (const ref of fileRefs) {
    if (ref.ref.trim()) hasFile = true;
  }
  for (const ref of archiveRefs) {
    if (ref.ref.trim()) hasArchive = true;
  }
  for (const ref of cvkRefs) {
    const resolution = resolveCvkEvidenceRef({ artifact, ref, cvkArtifact });
    if (resolution.status === "ok") {
      hasCvk = true;
    } else {
      cvkFailure = resolution.status;
      cvkMessage = resolution.message;
    }
  }

  if (hasFile || hasArchive || hasCvk) {
    return {
      atomId: atom.id,
      status: "ok",
      evidenceRefs,
      message: "Critical atom has at least one addressable recovery evidence ref.",
    };
  }

  if (cvkRefs.length > 0) {
    return {
      atomId: atom.id,
      status: cvkFailure,
      evidenceRefs,
      message: cvkMessage || "Critical atom CVK evidence could not be resolved.",
    };
  }

  if (atom.evidenceRefs.length === 0) {
    return {
      atomId: atom.id,
      status: "missing_evidence",
      evidenceRefs,
      message: "Critical atom has no evidence refs; archive, file, or CVK evidence is required.",
    };
  }

  return {
    atomId: atom.id,
    status: "missing_archive",
    evidenceRefs,
    message: "Critical atom has no archive, file, or CVK evidence; session/trace refs are not addressable for recovery.",
  };
}

export function auditCompactionAddressability(params: {
  artifact: CompressionArtifact;
  archiveHandles?: ArchiveHandle[];
  cvkArtifact?: CvkFixtureArtifact;
}): CompactionAddressabilityAudit {
  const atoms = (params.artifact.semanticAtoms ?? []).filter(
    (atom) => atom.severity === "critical",
  );
  const diagnostics = atoms.map((atom) =>
    auditAtom({
      atom,
      artifact: params.artifact,
      archiveHandles: params.archiveHandles,
      cvkArtifact: params.cvkArtifact,
    }),
  );
  return {
    criticalAtomCount: atoms.length,
    addressableCount: diagnostics.filter((diagnostic) => diagnostic.status === "ok").length,
    diagnostics,
  };
}

export function bindCompactionArchiveEvidence(params: {
  artifact: CompressionArtifact;
  archiveHandle: ArchiveHandle;
  archiveLabel?: string;
}): CompressionArtifact {
  const atoms = params.artifact.semanticAtoms;
  if (!atoms?.length) {
    return params.artifact;
  }
  const label = params.archiveLabel?.trim() || DEFAULT_ARCHIVE_EVIDENCE_LABEL;
  const archiveRef: CompressionEvidenceRef = {
    type: "archive",
    ref: params.archiveHandle.uri,
    label,
  };
  const nextAtoms = atoms.map((atom) => {
    if (
      atom.severity !== "critical" ||
      atom.evidenceRefs.some((ref) => hasRecoverableEvidenceType(ref))
    ) {
      return atom;
    }
    return {
      ...atom,
      evidenceRefs: [...atom.evidenceRefs, archiveRef],
    };
  });
  return {
    ...params.artifact,
    semanticAtoms: nextAtoms,
  };
}

export function bindCompactionDetailsArchiveEvidence(params: {
  details: unknown;
  archiveHandle?: ArchiveHandle;
  archiveLabel?: string;
}): Record<string, unknown> | undefined {
  const details = params.details;
  if (!isRecord(details)) {
    return undefined;
  }
  if (!params.archiveHandle) {
    return details;
  }
  const artifact = details.artifact;
  if (!artifact) {
    return details;
  }
  return {
    ...details,
    artifact: bindCompactionArchiveEvidence({
      artifact: artifact as CompressionArtifact,
      archiveHandle: params.archiveHandle,
      archiveLabel: params.archiveLabel,
    }),
  };
}

function ledgerLineForAtom(atom: NonNullable<CompressionArtifact["semanticAtoms"]>[number]): string {
  const evidence = atom.evidenceRefs
    .slice(0, LEDGER_EVIDENCE_LIMIT)
    .map((ref) => `${ref.type}:${ref.ref}`)
    .join(", ");
  return `- [${atom.type}:${atom.status}:${atom.severity}] ${atom.canonicalIdentity} | ${atom.text}${evidence ? ` | evidence: ${evidence}` : ""}`;
}

export function buildPreviousCompactionLedgerMessage(params: {
  previousArtifact?: CompressionArtifact;
  previousSummary?: string;
  maxChars?: number;
}): AgentMessage | undefined {
  const atoms = params.previousArtifact?.semanticAtoms;
  if (atoms?.length) {
    const body = atoms
      .slice(0, LEDGER_ATOM_LIMIT)
      .map(ledgerLineForAtom)
      .join("\n");
    const maxChars = Math.max(200, Math.floor(params.maxChars ?? DEFAULT_LEDGER_MAX_CHARS));
    const closeTag = "</previous-compaction-ledger>";
    let text =
      `<previous-compaction-ledger>\n${PREVIOUS_COMPACTION_LEDGER_PREFIX}\n\n${body}\n${closeTag}`;
    if (text.length > maxChars) {
      text = `${text.slice(0, Math.max(0, maxChars - closeTag.length - 16)).trim()} [truncated]\n${closeTag}`;
    }
    return {
      role: "user",
      content: [{ type: "text", text }],
      timestamp: 0,
    } as AgentMessage;
  }

  const previousSummary = params.previousSummary?.trim();
  if (!previousSummary) {
    return undefined;
  }
  return {
    role: "user",
    content: [{
      type: "text",
      text:
        `<previous-compaction-summary>\n${PREVIOUS_SUMMARY_REDISTILL_PREFIX}\n\n${previousSummary}\n</previous-compaction-summary>`,
    }],
    timestamp: 0,
  } as AgentMessage;
}
