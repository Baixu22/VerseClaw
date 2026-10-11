// Background Observation Consolidation (Hindsight-inspired, Item 3).
//
// Cross-session fact merging: within each conversation, group all facts by
// subject, then call LLM to merge related facts into higher-level observations.
// This is the "background consolidation" step that Hindsight runs after retain
// (hindsight-research.md §3.1-3.4). Observations carry source_memory_ids and
// proof_count so applyFinalBoost can weight them.
//
// Key differences from buffered-extraction.ts consolidation:
// - buffered-extraction consolidates WITHIN a single session (5-turn chunks)
// - this consolidates ACROSS all sessions within a conversation (cross-session)
// - this REPLACES merged facts (reduces total count), buffered keeps consolidated
//
// Acceptance (from plan doc):
// - facts count ≤ 2000 (from 2919)
// - multi_hop J Score +5pp
// - observations' source_memory_ids traceable to original facts
//
// Env:
//   DISABLE_OBSERVATION_CONSOLIDATION=1 → skip (for A/B comparison)

export type ObservationInputFact = {
  factId: string;
  subject: string;
  predicate: string;
  objectSummary: string;
  sessionDate?: number;
  // S0-2: optional LLM-extracted entities from the source fact. When present,
  // consolidateSubjectGroup unions these across merged source facts so the
  // resulting ObservationFact carries entities[] forward without re-extraction.
  entities?: string[];
};

export type ObservationFact = {
  subject: string;
  predicate: string;
  objectSummary: string;
  sourceMemoryIds: string[]; // original fact IDs merged into this observation
  proofCount: number;
  sessionDate?: number; // latest session date among merged facts
  // S0-1: optional LLM-extracted entity list. Populated by S0-2 when the
  // consolidation prompt is updated to emit entities[]. When absent, the
  // EntityStore falls back to regex extraction (mem-status §3 断裂点 1).
  entities?: string[];
  // P0 #1 (Hindsight Observation 2 阶合成层):
  // trend: based on evidence timestamp density (recent 30d / old 90d ratio).
  // STABLE / STRENGTHENING / WEAKENING / NEW / STALE
  // Source: hindsight-main/hindsight-api-slim/hindsight_api/engine/reflect/observations.py
  trend?: "STABLE" | "STRENGTHENING" | "WEAKENING" | "NEW" | "STALE";
  // evidence: key quotes from source facts that support this observation.
  // Source: hindsight-main consolidator.py _OUTPUT_SECTION "evidence" field
  evidence?: string[];
  // reason: LLM-generated explanation of why these facts were merged.
  // Source: hindsight-main consolidator.py "reason" field (mandatory per schema)
  reason?: string;
};

export type ObservationConsolidationResult = {
  observations: ObservationFact[];
  stats: {
    subjectsProcessed: number;
    factsBeforeConsolidation: number;
    factsAfterConsolidation: number;
    batchesSent: number;
  };
};

export type ObservationCallLLM = (
  system: string,
  user: string,
  options?: { temperature?: number; maxTokens?: number },
) => Promise<{ content: string }>;

export const OBSERVATION_CACHE_VERSION = "3.0-p0-1-hindsight-observation";

// Batch size: max facts per LLM call. Keeps prompt within 8K tokens.
const OBSERVATION_BATCH_SIZE = 15;

// Minimum facts per subject to trigger consolidation. Subjects with 1 fact
// are kept as-is (no merge possible).
const MIN_FACTS_FOR_CONSOLIDATION = 2;

export function buildObservationConsolidationSystemPrompt(): string {
  return [
    "You are a memory observation consolidation system (Hindsight-inspired 2nd-order knowledge synthesis).",
    "Given a list of facts about the same person from multiple conversation sessions, synthesize higher-level observations.",
    "",
    "## Consolidation Rules (Hindsight consolidator.py)",
    "- Merge facts that describe the SAME logical concept or topic (e.g., multiple hiking-related facts → one hiking observation).",
    "- DO NOT merge facts about different topics, even if they share the same subject.",
    "- PREFER UPDATE OVER CREATE: if an existing observation could be updated rather than creating a new one, update it.",
    "- ONE OBSERVATION PER DISTINCT FACET: each observation covers one distinct aspect of the subject.",
    "- NO COMPUTATION: do not perform arithmetic; preserve numbers verbatim from source facts.",
    "- Each observation should synthesize information from multiple facts into a complete, self-contained statement.",
    "- Preserve ALL specific details: dates, locations, names, quantities, reasons, durations.",
    "- If a fact is unique (no merge candidate), keep it as a standalone observation with its own content.",
    "- The objectSummary must be a complete sentence combining all merged facts' details.",
    "",
    "## Evidence + Reason (Hindsight evidence-grounded belief)",
    "Each observation MUST include:",
    "- 'evidence': an array of 1-3 short quotes (verbatim phrases) from the source facts that support this observation.",
    "- 'reason': a one-sentence explanation of WHY these facts were merged into this observation.",
    "This makes the consolidation auditable and traceable to source evidence.",
    "",
    "For each observation, include a 'source_indices' array listing the 0-based indices of ALL original facts that contributed to this observation.",
    "A standalone (unmerged) fact should have source_indices with just its own index.",
    "",
    "Return ONLY a JSON array of observations with this schema:",
    '  {"predicate": "snake_case_concept", "objectSummary": "complete synthesized sentence", "source_indices": [0, 2, 5], "evidence": ["quote1", "quote2"], "reason": "why merged"}',
    "",
    "Examples:",
    '  Input facts: ["Jon went hiking on October 19th", "Jon loves hiking and outdoor activities", "Jon bought new hiking boots"]',
    '  Output: [{"predicate": "hiking_enthusiast", "objectSummary": "Jon is a hiking enthusiast who loves outdoor activities, went hiking on October 19th, and bought new hiking boots", "source_indices": [0, 1, 2], "evidence": ["went hiking on October 19th", "loves hiking and outdoor activities", "bought new hiking boots"], "reason": "All three facts describe Jon\'s hiking hobby across activities, events, and gear."}]',
    "",
    '  Input facts: ["Jon works as a software engineer", "Jon went hiking on October 19th"]',
    '  Output: [{"predicate": "occupation", "objectSummary": "Jon works as a software engineer", "source_indices": [0], "evidence": ["works as a software engineer"], "reason": "Standalone occupation fact, no merge candidate."}, {"predicate": "went_hiking", "objectSummary": "Jon went hiking on October 19th", "source_indices": [1], "evidence": ["went hiking on October 19th"], "reason": "Standalone event fact, no merge candidate."}]',
  ].join("\n");
}

export function buildObservationConsolidationUserPrompt(
  subject: string,
  facts: ObservationInputFact[],
): string {
  const factsJson = JSON.stringify(
    facts.map((f, idx) => ({
      index: idx,
      predicate: f.predicate,
      objectSummary: f.objectSummary,
    })),
    null,
    2,
  );
  return [
    `Consolidate these facts about "${subject}" into higher-level observations (merge related facts, preserve all unique information):`,
    "",
    factsJson,
    "",
    "Return ONLY a JSON array of observations.",
  ].join("\n");
}

export type ParsedObservation = {
  predicate: string;
  objectSummary: string;
  sourceIndices: number[];
  // P0 #1 (Hindsight evidence-grounded belief):
  evidence?: string[];
  reason?: string;
};

export function parseObservationConsolidationResponse(
  content: string,
): ParsedObservation[] {
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  try {
    const parsed = JSON.parse(jsonMatch[0]) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null,
      )
      .map((item) => {
        const obs: ParsedObservation = {
          predicate: String(item.predicate ?? "observation"),
          objectSummary: String(item.objectSummary ?? ""),
          sourceIndices: Array.isArray(item.source_indices)
            ? (item.source_indices as unknown[])
                .filter((i) => typeof i === "number")
                .map((i) => i as number)
            : [],
        };
        // P0 #1: parse evidence[] (key quotes from source facts).
        if (Array.isArray(item.evidence)) {
          const evidence = (item.evidence as unknown[])
            .filter((e): e is string => typeof e === "string" && e.trim().length > 0)
            .map((e) => e.trim())
            .slice(0, 5);
          if (evidence.length > 0) {
            obs.evidence = evidence;
          }
        }
        // P0 #1: parse reason (why these facts were merged).
        if (typeof item.reason === "string" && item.reason.trim().length > 0) {
          obs.reason = item.reason.trim();
        }
        return obs;
      })
      .filter((o) => o.objectSummary.length > 0);
  } catch {
    return [];
  }
}

const TREND_RECENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const TREND_OLD_WINDOW_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const TREND_STRENGTHENING_RATIO = 1.5;
const TREND_WEAKENING_RATIO = 0.5;

/**
 * P0 #1 (Hindsight Observation 2 阶合成层): compute trend from source facts'
 * sessionDate density.
 *
 * Source: hindsight-main/hindsight-api-slim/hindsight_api/engine/reflect/observations.py
 * Hindsight computes a per-observation trend by comparing how often the
 * underlying memory has been reinforced recently vs. historically.
 *
 * - STRENGTHENING: recent (30d) / old (90d prior) ratio >= 1.5
 * - WEAKENING:    ratio <= 0.5
 * - STABLE:       0.5 < ratio < 1.5
 * - NEW:          single-fact observation with a sessionDate within the
 *                 recent 30-day window (no historical evidence)
 * - STALE:        all source facts older than the 90-day window
 *
 * If sessionDate is missing (no timestamps available), default to STABLE.
 */
function computeObservationTrend(
  sourceFacts: ObservationInputFact[],
  sessionDate: number | undefined,
): "STABLE" | "STRENGTHENING" | "WEAKENING" | "NEW" | "STALE" {
  if (sessionDate === undefined) return "STABLE";

  const dated = sourceFacts
    .map((f) => f.sessionDate)
    .filter((d): d is number => d !== undefined);
  if (dated.length === 0) return "STABLE";

  const recentCutoff = sessionDate - TREND_RECENT_WINDOW_MS;
  const oldCutoff = sessionDate - TREND_OLD_WINDOW_MS;

  // NEW: single source fact dated within the recent window.
  if (sourceFacts.length === 1 && sessionDate >= recentCutoff) {
    return "NEW";
  }

  // STALE: every source fact is older than the 90-day window.
  if (dated.every((d) => d < oldCutoff)) {
    return "STALE";
  }

  // Count facts in the recent (30d) vs. old (30d-90d prior) windows.
  let recent = 0;
  let old = 0;
  for (const d of dated) {
    if (d >= recentCutoff) {
      recent += 1;
    } else if (d >= oldCutoff) {
      old += 1;
    }
  }

  // No recent activity at all → STALE if everything is old, otherwise STABLE.
  if (recent === 0) {
    return old > 0 ? "STALE" : "STABLE";
  }
  if (old === 0) {
    // All activity is recent → treat as strengthening.
    return "STRENGTHENING";
  }
  const ratio = recent / old;
  if (ratio >= TREND_STRENGTHENING_RATIO) return "STRENGTHENING";
  if (ratio <= TREND_WEAKENING_RATIO) return "WEAKENING";
  return "STABLE";
}

/**
 * Consolidate facts into observations for a single subject group.
 * If the group has fewer than MIN_FACTS_FOR_CONSOLIDATION facts, returns empty
 * (caller keeps originals as-is).
 *
 * Batching: if the group has more than OBSERVATION_BATCH_SIZE facts, split
 * into batches and consolidate each independently. This avoids prompt length
 * issues at the cost of potential cross-batch duplication (acceptable for
 * smoke test; can be refined with a second-pass merge later).
 */
async function consolidateSubjectGroup(
  subject: string,
  facts: ObservationInputFact[],
  callLLM: ObservationCallLLM,
): Promise<{ observations: ObservationFact[]; batchesSent: number }> {
  if (facts.length < MIN_FACTS_FOR_CONSOLIDATION) {
    return { observations: [], batchesSent: 0 };
  }

  const observations: ObservationFact[] = [];
  let batchesSent = 0;

  // Split into batches of OBSERVATION_BATCH_SIZE.
  const batchCount = Math.ceil(facts.length / OBSERVATION_BATCH_SIZE);
  for (let b = 0; b < batchCount; b += 1) {
    const batchStart = b * OBSERVATION_BATCH_SIZE;
    const batch = facts.slice(batchStart, batchStart + OBSERVATION_BATCH_SIZE);
    if (batch.length < MIN_FACTS_FOR_CONSOLIDATION) {
      // Last batch too small to consolidate; skip (originals kept by caller).
      continue;
    }

    const system = buildObservationConsolidationSystemPrompt();
    const user = buildObservationConsolidationUserPrompt(subject, batch);

    let parsed: ParsedObservation[] = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await callLLM(system, user, {
          temperature: 0,
          maxTokens: 8192,
        });
        parsed = parseObservationConsolidationResponse(response.content);
        if (parsed.length > 0) break;
      } catch {
        // retry
      }
    }
    batchesSent += 1;

    if (parsed.length === 0) {
      // LLM failed; caller keeps originals for this batch.
      continue;
    }

    // Map source_indices (local to batch) to global factIds.
    for (const obs of parsed) {
      const sourceMemoryIds = obs.sourceIndices
        .filter((i) => i >= 0 && i < batch.length)
        .map((i) => batch[i].factId);
      // Fallback: if LLM didn't return valid indices, link to all facts in batch.
      const finalSourceIds =
        sourceMemoryIds.length > 0 ? sourceMemoryIds : batch.map((f) => f.factId);

      // Latest session date among merged facts.
      const sourceFacts = finalSourceIds
        .map((id) => batch.find((f) => f.factId === id))
        .filter((f): f is ObservationInputFact => f !== undefined);
      const dates = sourceFacts
        .map((f) => f.sessionDate)
        .filter((d): d is number => d !== undefined);
      const sessionDate = dates.length > 0 ? Math.max(...dates) : undefined;

      // S0-2: deterministically union entities[] from merged source facts.
      // No LLM call needed for entity merge — just dedupe case-insensitively
      // and preserve the first surface form seen. Cap at 10 entities.
      const entitySeen = new Set<string>();
      const entities: string[] = [];
      for (const src of sourceFacts) {
        if (!Array.isArray(src.entities)) continue;
        for (const e of src.entities) {
          if (typeof e !== "string") continue;
          const trimmed = e.trim();
          if (trimmed.length === 0) continue;
          const key = trimmed.toLowerCase();
          if (entitySeen.has(key)) continue;
          entitySeen.add(key);
          entities.push(trimmed);
          if (entities.length >= 10) break;
        }
        if (entities.length >= 10) break;
      }

      // P0 #1 (Hindsight trend): compute evidence timestamp density.
      // Source: hindsight-main/hindsight-api-slim/hindsight_api/engine/reflect/observations.py
      // Compares facts dated within the most recent 30 days vs. the prior 90 days.
      // - STRENGTHENING: recent/old ratio >= 1.5 (more activity recently)
      // - WEAKENING:    ratio <= 0.5 (activity dying down)
      // - STABLE:       0.5 < ratio < 1.5
      // Single-fact observations with a recent sessionDate → NEW.
      // All source facts older than 90 days → STALE.
      const trend = computeObservationTrend(sourceFacts, sessionDate);

      observations.push({
        subject,
        predicate: obs.predicate,
        objectSummary: obs.objectSummary,
        sourceMemoryIds: finalSourceIds,
        proofCount: finalSourceIds.length,
        sessionDate,
        ...(entities.length > 0 ? { entities } : {}),
        trend,
        // P0 #1 (Hindsight evidence-grounded belief): pass through parsed
        // evidence/reason from LLM. Required by Hindsight consolidator.py schema.
        ...(obs.evidence && obs.evidence.length > 0 ? { evidence: obs.evidence } : {}),
        ...(obs.reason ? { reason: obs.reason } : {}),
      });
    }
  }

  return { observations, batchesSent };
}

/**
 * Main entry: consolidate facts across sessions within each conversation.
 *
 * For each conversation:
 * 1. Group facts by subject
 * 2. For each subject with 2+ facts: call LLM to merge into observations
 * 3. Replace merged facts with observations
 * 4. Single-fact subjects keep their original fact
 *
 * Returns a map of conversationId → observation facts (only the observations,
 * NOT the full replacement list). The caller is responsible for replacing
 * merged facts with observations.
 */
export async function consolidateObservations(
  factsByConversation: Map<string, ObservationInputFact[]>,
  callLLM: ObservationCallLLM,
  options: {
    onProgress?: (event: {
      conversationId: string;
      subject: string;
      factsBefore: number;
      observationsAfter: number;
    }) => void;
    // Called once per conversation as soon as its observations are final, so a
    // caller can persist incremental state. Without this, an interruption loses
    // every conversation's work because the cache is only written at the end.
    onConversationComplete?: (conversationId: string, observations: ObservationFact[]) => void;
  } = {},
): Promise<Map<string, ObservationFact[]>> {
  const onProgress = options.onProgress ?? (() => {});
  const onConversationComplete = options.onConversationComplete ?? (() => {});
  const result = new Map<string, ObservationFact[]>();
  let totalBatchesSent = 0;

  for (const [convId, facts] of factsByConversation) {
    // Group facts by subject.
    const bySubject = new Map<string, ObservationInputFact[]>();
    for (const f of facts) {
      const arr = bySubject.get(f.subject) ?? [];
      arr.push(f);
      bySubject.set(f.subject, arr);
    }

    const observations: ObservationFact[] = [];
    let subjectsProcessed = 0;

    for (const [subject, subjectFacts] of bySubject) {
      if (subjectFacts.length < MIN_FACTS_FOR_CONSOLIDATION) {
        // Single-fact subject: no consolidation needed.
        continue;
      }
      subjectsProcessed += 1;
      const { observations: obs, batchesSent } = await consolidateSubjectGroup(
        subject,
        subjectFacts,
        callLLM,
      );
      observations.push(...obs);
      totalBatchesSent += batchesSent;
      onProgress({
        conversationId: convId,
        subject,
        factsBefore: subjectFacts.length,
        observationsAfter: obs.length,
      });
    }

    result.set(convId, observations);
    onConversationComplete(convId, observations);
    console.log(
      `[ObservationConsolidation] ${convId}: ${subjectsProcessed} subjects processed, ` +
        `${observations.length} observations generated, ${totalBatchesSent} batches sent`,
    );
  }

  return result;
}

/**
 * Apply observations to a facts list: remove facts that were merged into
 * observations, then add observation facts.
 *
 * Returns the new facts list (observations + unmerged originals).
 */
export function applyObservationsToFacts<T extends ObservationInputFact>(
  originalFacts: readonly T[],
  observations: readonly ObservationFact[],
): Array<T | ObservationFact> {
  if (observations.length === 0) return [...originalFacts];

  // Collect all factIds that were merged into observations.
  const mergedFactIds = new Set<string>();
  for (const obs of observations) {
    for (const id of obs.sourceMemoryIds) {
      mergedFactIds.add(id);
    }
  }

  // Keep originals that were NOT merged.
  const unmerged = originalFacts.filter((f) => !mergedFactIds.has(f.factId));

  // Return unmerged originals + observations.
  return [...unmerged, ...observations];
}

// ============================================================================
// P2-2: Second-pass Consolidation (Memobase merge_yolo inspired).
//
// Source: memobase-main/memobase/buffer/buffer.py merge_yolo method
//
// Memobase runs a second consolidation pass after all observations are built.
// The first pass groups facts by subject and merges within each batch of 15.
// This leaves cross-batch duplicates: the same topic split across batches
// produces two observations that should be merged.
//
// The second pass takes the output of the first pass and re-runs
// consolidation on it, treating each observation as an input "fact". This
// catches:
// - Same predicate across batches (e.g., "hiking_enthusiast" from batch 1
//   and batch 2 → one merged observation with unioned evidence)
// - Topic continuation across sessions (e.g., "loves hiking" from session 1
//   and "bought hiking boots" from session 2)
//
// The second pass uses the same LLM prompt as the first pass, but with
// larger batch size (30 vs 15) because observations are already compact.
// ============================================================================

const SECOND_PASS_BATCH_SIZE = 30;
const SECOND_PASS_MIN_OBSERVATIONS = 2;

export function buildSecondPassSystemPrompt(): string {
  return [
    "You are a second-pass observation consolidation system (Memobase merge_yolo inspired).",
    "Given a list of observations about the same person from previous consolidation passes, merge any that describe the same facet.",
    "",
    "## Second-pass Rules",
    "- Each input item is already an observation (synthesized from multiple facts).",
    "- Merge observations that describe the SAME facet, even if their predicates differ slightly.",
    "- e.g., 'hiking_enthusiast' + 'outdoor_activities' → one merged observation.",
    "- DO NOT merge observations about clearly different facets.",
    "- Preserve ALL source_memory_ids from merged observations (union them).",
    "- Preserve ALL evidence quotes from merged observations (union them).",
    "- The merged objectSummary should be a complete sentence combining all details.",
    "- Recompute proof_count as the total number of source facts.",
    "",
    "## Output Schema",
    '  {"predicate": "snake_case_concept", "objectSummary": "complete synthesized sentence", "source_indices": [0, 2], "evidence": ["quote1"], "reason": "why merged"}',
    "",
    "Return ONLY a JSON array of merged observations.",
  ].join("\n");
}

/**
 * Run a second consolidation pass on the output of the first pass.
 *
 * This merges cross-batch duplicates that the first pass (batch_size=15)
 * couldn't catch. The second pass uses larger batches (30) because
 * observations are already compact.
 *
 * Returns the merged observations. Source fact IDs and evidence quotes are
 * unioned across merged observations so no provenance is lost.
 */
export async function secondPassConsolidation(
  observations: readonly ObservationFact[],
  subject: string,
  callLLM: ObservationCallLLM,
): Promise<{ observations: ObservationFact[]; batchesSent: number }> {
  if (observations.length < SECOND_PASS_MIN_OBSERVATIONS) {
    return { observations: [...observations], batchesSent: 0 };
  }

  const merged: ObservationFact[] = [];
  let batchesSent = 0;
  const batchCount = Math.ceil(observations.length / SECOND_PASS_BATCH_SIZE);

  for (let b = 0; b < batchCount; b += 1) {
    const batchStart = b * SECOND_PASS_BATCH_SIZE;
    const batch = observations.slice(batchStart, batchStart + SECOND_PASS_BATCH_SIZE);
    if (batch.length < SECOND_PASS_MIN_OBSERVATIONS) {
      merged.push(...batch);
      continue;
    }

    const system = buildSecondPassSystemPrompt();
    const user = JSON.stringify(
      batch.map((o, idx) => ({
        index: idx,
        predicate: o.predicate,
        objectSummary: o.objectSummary,
      })),
      null,
      2,
    );

    let parsed: ParsedObservation[] = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await callLLM(system, user, {
          temperature: 0,
          maxTokens: 8192,
        });
        parsed = parseObservationConsolidationResponse(response.content);
        if (parsed.length > 0) break;
      } catch {
        // retry
      }
    }
    batchesSent += 1;

    if (parsed.length === 0) {
      // LLM failed; keep originals for this batch.
      merged.push(...batch);
      continue;
    }

    // Map parsed results back to observations, unioning source IDs/evidence.
    for (const obs of parsed) {
      const sourceObs = obs.sourceIndices
        .filter((i) => i >= 0 && i < batch.length)
        .map((i) => batch[i]);
      const finalSourceObs =
        sourceObs.length > 0 ? sourceObs : batch;

      // Union sourceMemoryIds across all merged observations.
      const sourceMemoryIds = new Set<string>();
      for (const so of finalSourceObs) {
        for (const id of so.sourceMemoryIds) sourceMemoryIds.add(id);
      }
      // Union evidence across all merged observations.
      const evidence = new Set<string>();
      for (const so of finalSourceObs) {
        if (Array.isArray(so.evidence)) {
          for (const e of so.evidence) evidence.add(e);
        }
      }
      // Add new evidence from parsed result.
      if (Array.isArray(obs.evidence)) {
        for (const e of obs.evidence) evidence.add(e);
      }
      // Use the latest sessionDate among merged observations.
      const dates = finalSourceObs
        .map((o) => o.sessionDate)
        .filter((d): d is number => d !== undefined);
      const sessionDate = dates.length > 0 ? Math.max(...dates) : undefined;
      // Union entities across merged observations.
      const entitySeen = new Set<string>();
      const entities: string[] = [];
      for (const so of finalSourceObs) {
        if (!Array.isArray(so.entities)) continue;
        for (const e of so.entities) {
          const key = e.toLowerCase();
          if (entitySeen.has(key)) continue;
          entitySeen.add(key);
          entities.push(e);
          if (entities.length >= 10) break;
        }
        if (entities.length >= 10) break;
      }

      merged.push({
        subject,
        predicate: obs.predicate,
        objectSummary: obs.objectSummary,
        sourceMemoryIds: [...sourceMemoryIds],
        proofCount: sourceMemoryIds.size,
        sessionDate,
        ...(entities.length > 0 ? { entities } : {}),
        ...(evidence.size > 0 ? { evidence: [...evidence].slice(0, 5) } : {}),
        ...(obs.reason ? { reason: obs.reason } : {}),
      });
    }
  }

  return { observations: merged, batchesSent };
}
