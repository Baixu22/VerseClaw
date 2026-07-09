// @runtime-family v1.0
// @authority diagnostic_only
// @owner WP1

import { randomUUID } from 'node:crypto';

import { shadowSafetyBoundary } from './shadow-safety-boundary-adapter.js';
import type {
  CompletionEvidence,
  EvidenceEnvelope,
  EvidenceItem,
  EvidenceKind,
  EvidenceRef,
  MutationEvidence,
  RuntimeSpineMetadata,
  RuntimeSpineResult,
} from './types.js';

type EvidenceCollectOptions = {
  metadata?: RuntimeSpineMetadata;
};

class EvidenceLedger {
  private readonly envelopes = new Map<string, EvidenceEnvelope>();

  collect(
    entityId: string,
    kind: EvidenceKind,
    collector: string,
    items: readonly EvidenceItem[],
    opts: EvidenceCollectOptions = {},
  ): EvidenceEnvelope {
    const base = {
      envelopeId: randomUUID(),
      entityId,
      kind,
      collector,
      items: items.slice(),
      status: 'pending' as const,
      collectedAt: Date.now(),
      metadata: opts.metadata,
    };

    const envelope: EvidenceEnvelope =
      kind === 'mutation_evidence'
        ? { ...base, kind, mutationEvidence: true }
        : kind === 'completion_evidence'
          ? { ...base, kind, completionEvidence: true }
          : base;

    shadowSafetyBoundary.execute('evidence-ledger.collect', () => {
      this.envelopes.set(envelope.envelopeId, envelope);
    });

    return envelope;
  }

  verify(envelopeId: string, verifiedBy: string): RuntimeSpineResult<EvidenceEnvelope> {
    const envelope = this.envelopes.get(envelopeId);
    if (!envelope) {
      return { success: false, error: `Evidence envelope not found: ${envelopeId}` };
    }

    shadowSafetyBoundary.execute('evidence-ledger.verify', () => {
      envelope.status = 'verified';
      envelope.verifiedAt = Date.now();
      envelope.verifiedBy = verifiedBy;
    });

    return { success: true, value: envelope };
  }

  reject(envelopeId: string, rejectedBy: string): RuntimeSpineResult<EvidenceEnvelope> {
    const envelope = this.envelopes.get(envelopeId);
    if (!envelope) {
      return { success: false, error: `Evidence envelope not found: ${envelopeId}` };
    }

    shadowSafetyBoundary.execute('evidence-ledger.reject', () => {
      envelope.status = 'rejected';
      envelope.rejectedAt = Date.now();
      envelope.rejectedBy = rejectedBy;
    });

    return { success: true, value: envelope };
  }

  get(envelopeId: string): EvidenceEnvelope | undefined {
    return this.envelopes.get(envelopeId);
  }

  getByEntity(entityId: string): EvidenceEnvelope[] {
    return Array.from(this.envelopes.values()).filter((envelope) => envelope.entityId === entityId);
  }

  toRef(envelope: EvidenceEnvelope): EvidenceRef {
    return {
      refType: 'evidence',
      envelopeId: envelope.envelopeId,
      entityId: envelope.entityId,
      kind: envelope.kind,
      status: envelope.status,
    };
  }

  isMutationEvidence(envelope: EvidenceEnvelope): envelope is MutationEvidence {
    return envelope.kind === 'mutation_evidence';
  }

  isCompletionEvidence(envelope: EvidenceEnvelope): envelope is CompletionEvidence {
    return envelope.kind === 'completion_evidence';
  }
}

export const evidenceLedger = new EvidenceLedger();
