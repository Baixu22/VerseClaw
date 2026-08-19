import { createHash } from "node:crypto";
import type {
  ContextBlock,
  ContextBlockSink,
} from "../../context-engine/block.js";
import type { DistillationSuggestion, Principle } from "./types.js";
import {
  canEnterHighTrustContext,
  type ConfirmIntegrityLevel,
  type ConfirmProvenance,
} from "./confirm-provenance.js";
import { productizeExperienceShadow } from "./experience-shadow-product.js";

/**
 * DCS Stage 5: Bridge between SEKB distillation `confirm_and_save` and the
 * BlockStore `experience` Block.
 *
 * Per DCS v1.6 spec §阶段5 and §P3:
 * - Only `confirm_and_save` confirmed principles write `experience` Blocks
 * - ANTI-8: `suggest_principles_from_trajectories` advisory results MUST NOT
 *   write any Block
 * - `source_system="sekb"`, `mutability="system_managed"`, `compression_depth=0`
 * - `presence = { always_on: false, on_demand: { expand_tool: "context_search",
 *   auto_register: false }, background: true }`
 * - Admission: `confirmed=true`, `confidence=suggestion.confidence`,
 *   `write_origin="handler"`
 */

export const EXPERIENCE_PROJECTION_SCHEMA = "experience-projection/v1";

/**
 * KS-02: stable projection revision derived from canonical principle content.
 * Same principle content + same session always maps to the same block_id, so
 * BlockStore upsert makes confirm retry/concurrency idempotent.
 */
export function experienceProjectionRevision(principle: Principle): string {
  return createHash("sha256").update(principle.full_content).digest("hex").slice(0, 16);
}

export function experienceProjectionBlockId(principle: Principle, sessionId: string): string {
  return `experience:sekb:${EXPERIENCE_PROJECTION_SCHEMA}:${sessionId}:${principle.principle_id}:${experienceProjectionRevision(principle)}`;
}

export interface BuildExperienceBlockParams {
  principle: Principle;
  suggestion: DistillationSuggestion;
  sessionId: string;
  now?: Date;
}

export function buildExperienceBlock(
  params: BuildExperienceBlockParams,
): ContextBlock {
  const now = params.now ?? new Date();
  const principle = params.principle;

  const entities = [
    ...principle.task_types,
    ...principle.context_tags,
  ];

  return {
    block_id: experienceProjectionBlockId(principle, params.sessionId),
    block_type: "experience",
    source_system: "sekb",
    session_id: params.sessionId,
    presence: {
      always_on: false,
      on_demand: { expand_tool: "context_search", auto_register: false },
      background: true,
    },
    entities,
    valid_at: now,
    created_at: now,
    mutability: "system_managed",
    summary: `## Experience\n${principle.title}`,
    full_content: principle.full_content,
    compression_depth: 0,
    entity_extraction_status: "empty",
  };
}

export interface HandleConfirmAndSaveParams {
  principle: Principle;
  suggestion: DistillationSuggestion;
  sessionId: string;
  contextBlockSink?: ContextBlockSink;
  now?: Date;
  integrity?: ConfirmIntegrityLevel;
  provenance?: ConfirmProvenance;
  highTrustEligible?: boolean;
  /**
   * C7-2: optional experience shadow journal. Omitted / enabled:false = zero
   * shadow side effects (production default path unchanged).
   */
  experienceShadow?: {
    workspaceRoot: string;
    enabled: boolean;
    dualWrite?: boolean;
  };
}

export async function handleConfirmAndSave(
  params: HandleConfirmAndSaveParams,
): Promise<{ accepted: boolean; blockId: string } | undefined> {
  if (!params.contextBlockSink) {
    // Shadow-only confirm path: journal experience without production BlockStore write.
    if (params.experienceShadow?.enabled && params.experienceShadow.workspaceRoot) {
      try {
        productizeExperienceShadow({
          workspaceRoot: params.experienceShadow.workspaceRoot,
          enabled: true,
          dualWrite: params.experienceShadow.dualWrite ?? false,
          buildBlock: (build) => buildExperienceBlock(build),
          build: {
            principle: params.principle,
            suggestion: params.suggestion,
            sessionId: params.sessionId,
            now: params.now,
          },
        });
      } catch {
        // best-effort
      }
    }
    return undefined;
  }
  const block = buildExperienceBlock({
    principle: params.principle,
    suggestion: params.suggestion,
    sessionId: params.sessionId,
    now: params.now,
  });
  const integrity = params.integrity ?? "confirmed";
  const highTrust =
    params.highTrustEligible === true ||
    (params.provenance
      ? canEnterHighTrustContext(params.provenance)
      : false);
  // A3: unknown / non-lineage content never gets high-trust always_on presence.
  if (integrity === "high_trust" && !highTrust) {
    return { accepted: false, blockId: block.block_id };
  }
  if (params.provenance && !params.sessionId?.trim()) {
    return { accepted: false, blockId: block.block_id };
  }
  const [result] = await params.contextBlockSink([
    {
      block: {
        ...block,
        // Never promote experience to always_on high-trust without eligibility.
        presence: {
          ...block.presence,
          always_on: highTrust ? block.presence.always_on : false,
          background: true,
        },
      },
      admission: {
        confirmed: true,
        confidence: params.suggestion.confidence,
        write_origin: "handler",
        verification_status: integrity,
        integrity,
        session_id: params.sessionId,
        provenance_source: params.provenance?.sourceSystem ?? "sekb",
        high_trust_eligible: highTrust,
      } as {
        confirmed: boolean;
        confidence: number;
        write_origin: "handler";
        verification_status: string;
        integrity: ConfirmIntegrityLevel;
        session_id: string;
        provenance_source: string;
        high_trust_eligible: boolean;
      },
    },
  ]);

  // C7-2 shadow journal (default-off; never flips production cutover).
  if (params.experienceShadow?.enabled && params.experienceShadow.workspaceRoot) {
    try {
      productizeExperienceShadow({
        workspaceRoot: params.experienceShadow.workspaceRoot,
        enabled: true,
        dualWrite: params.experienceShadow.dualWrite ?? true,
        buildBlock: (build) => buildExperienceBlock(build),
        build: {
          principle: params.principle,
          suggestion: params.suggestion,
          sessionId: params.sessionId,
          now: params.now,
        },
      });
    } catch {
      // Shadow path is best-effort only.
    }
  }

  return result
    ? { accepted: result.accepted, blockId: block.block_id }
    : undefined;
}
