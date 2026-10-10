import type { CompressionArtifact } from '../../../packages/agent-core/src/harness/compaction/compression-artifact.js';
import type { CvkFixtureArtifact } from './compiler.js';
import type { CvkEvalReport } from './eval-report.js';
import {
  buildCvkRecoveryContext,
  unavailableCvkRecoveryRollback,
  type CvkRecoveryProjection,
  type CvkRecoveryReferenceDiagnostic,
  type CvkRecoveryRollback,
} from './recovery.js';

export type CvkDefaultRecoveryDiagnostic =
  | {
      code: 'no_cvk_refs';
      message: string;
    }
  | {
      code: 'eval_gate_blocked';
      reason: CvkEvalReport['gateDecisions']['level2']['reason'];
      message: string;
    }
  | ({
      code: 'selector_resolution_failed';
    } & CvkRecoveryReferenceDiagnostic);

export type CvkDefaultRecoveryProjectionResult = {
  mode: 'context-runtime-kit' | 'legacy';
  legacyProjection: string;
  projection?: CvkRecoveryProjection;
  diagnostics: CvkDefaultRecoveryDiagnostic[];
  rollback: CvkRecoveryRollback;
};

export type CvkDefaultRecoveryProjectionInput = {
  compressionArtifact: CompressionArtifact;
  cvkArtifact: CvkFixtureArtifact;
  evalReport: CvkEvalReport;
  legacyProjection: string;
};

/**
 * Degrade to the caller-supplied legacy projection. No CVK projection was
 * built, so the rollback declaration is explicitly unavailable — a fallback is
 * not proof that a rollback executor exists.
 */
function fallback(params: {
  legacyProjection: string;
  diagnostics: CvkDefaultRecoveryDiagnostic[];
}): CvkDefaultRecoveryProjectionResult {
  return {
    mode: 'legacy',
    legacyProjection: params.legacyProjection,
    diagnostics: params.diagnostics,
    rollback: unavailableCvkRecoveryRollback('legacy_projection_retained'),
  };
}

export function buildDefaultCvkRecoveryProjection(
  input: CvkDefaultRecoveryProjectionInput,
): CvkDefaultRecoveryProjectionResult {
  const requiredSelectors = input.compressionArtifact.requiredSelectors ?? [];
  if (requiredSelectors.length === 0) {
    return fallback({
      legacyProjection: input.legacyProjection,
      diagnostics: [{
        code: 'no_cvk_refs',
        message: 'Compression artifact does not contain CRK selector refs; using legacy recovery projection.',
      }],
    });
  }

  const level2 = input.evalReport.gateDecisions.level2;
  if (level2.status !== 'pass') {
    return fallback({
      legacyProjection: input.legacyProjection,
      diagnostics: [{
        code: 'eval_gate_blocked',
        reason: level2.reason,
        message: `CRK recovery default-on is blocked by Level 2 gate: ${level2.reason}.`,
      }],
    });
  }

  const recovery = buildCvkRecoveryContext({
    compressionArtifact: input.compressionArtifact,
    cvkArtifact: input.cvkArtifact,
  });
  if (!recovery.ok) {
    return fallback({
      legacyProjection: input.legacyProjection,
      diagnostics: recovery.diagnostics.map((diagnostic) => ({
        code: 'selector_resolution_failed',
        ...diagnostic,
      })),
    });
  }

  return {
    mode: 'context-runtime-kit',
    legacyProjection: input.legacyProjection,
    projection: recovery.projection,
    diagnostics: [],
    rollback: recovery.rollback,
  };
}
