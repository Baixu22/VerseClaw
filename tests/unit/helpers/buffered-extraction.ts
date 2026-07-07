// Buffer+flush + consolidation extraction (Memobase-inspired).
//
// Key differences from existing extraction:
// 1. Multi-attribute facts: each fact carries a list of attributes (e.g., location, time, reason, items)
//    instead of a single objectSummary string. This preserves more information per fact.
// 2. Consolidation: after extracting each session's facts, call LLM to merge near-duplicate facts
//    of the same subject, keeping a single consolidated fact with unioned attributes.
// 3. Buffer+flush: process in chunks of 5 turns (not 30) to preserve dialogue context.
//
// Output schema:
//   type BufferedExtractedFact = {
//     subject: string;
//     predicate: string;
//     attributes: { name: string; value: string }[]; // multi-attribute
//     objectSummary: string; // backward-compat: human-readable summary of attributes
//     sessionDate?: number;
//   };
//
// Env:
//   DISABLE_BUFFERED_EXTRACTION=1  → fall back to existing extraction (for A/B comparison)
//   BUFFERED_CHUNK_SIZE=5         → buffer size in turns (default 5)
//   ENABLE_CONSOLIDATION=1         → run consolidation after each session (default: on)

import { createHash } from "node:crypto";

export type FactAttribute = {
  name: string; // e.g., "location", "time", "reason", "items"
  value: string; // e.g., "by the water", "May 2023", "to relax", "oat milk, espresso"
};

export type BufferedExtractedFact = {
  subject: string;
  predicate: string;
  attributes: FactAttribute[];
  objectSummary: string; // human-readable summary, e.g., "wants dance studio by the water with natural light and Marley flooring"
  sessionDate?: number;
  // Item 2: evidenceRefs / proofCount filled during consolidation.
  // evidenceRefs stores the raw pre-consolidation fact IDs that were merged
  // into this consolidated fact. proofCount = evidenceRefs.length.
  // Used by applyFinalBoost (ce_norm * recency * temporal * proof_count_boost).
  evidenceRefs?: string[];
  proofCount?: number;
  // S0-2: LLM-extracted entity list (Person/Preference/Location/Event/Topic/...).
  // EntityStore reads this field directly instead of re-running regex
  // extraction, eliminating the Extraction→EntityStore duplicated-work
  // coupling break (mem-status §3 断裂点 1).
  // Source: Hindsight ProcessedFact.entities[] / Mem0 entity_store / Zep schema.
  entities?: string[];
  // P0 #2 (Mem0 ADDITIVE): linkedFactIds links a new fact to related existing
  // facts by their stable IDs. This builds a "fact graph" without an external
  // graph store — retrieval can boost linked facts via entity boost.
  // Source: mem0-main/mem0/configs/prompts.py ADDITIVE_EXTRACTION_PROMPT
  // "linked_memory_ids" field.
  linkedFactIds?: string[];
};

export type BufferedExtractionResult = {
  facts: BufferedExtractedFact[];
  totalRaw: number;
  totalConsolidated: number;
  consolidationStats: {
    sessionsProcessed: number;
    factsBeforeConsolidation: number;
    factsAfterConsolidation: number;
  };
};

const DEFAULT_BUFFERED_CHUNK_SIZE = 5;

export const BUFFERED_EXTRACTION_PROMPT_VERSION = "buffered-v4-2026-07-05-additive-p0";

// Item 2: monotonic counter for stable pre-consolidation fact IDs.
// Reset per extraction run; used to fill evidenceRefs on consolidated facts.
let globalFactCounter = 0;

export function buildBufferedExtractionSystemPrompt(options?: {
  sessionDate?: number;
  knownEntities?: string[];
  // P0 #2 (Mem0 ADDITIVE): pass previously extracted facts so the LLM can
  // link new facts to existing ones via linkedFactIds. Source:
  // mem0-main/mem0/configs/prompts.py ADDITIVE_EXTRACTION_PROMPT
  // "Existing Memories" section.
  knownFacts?: ReadonlyArray<{ id: string; summary: string }>;
}): string {
  const entityHint =
    options?.knownEntities && options.knownEntities.length > 0
      ? `\nPreviously seen entities: ${options.knownEntities.slice(0, 80).join(", ")}. Resolve pronouns to these names.`
      : "";

  const dateHint =
    options?.sessionDate !== undefined
      ? `\nSession date (Observation Date): ${new Date(options.sessionDate).toISOString().split("T")[0]}. Resolve relative time expressions (yesterday, last week, etc.) to absolute dates anchored to THIS session date, NOT the current date. This ensures "last week" always refers to the week of this conversation, even months later.`
      : "";

  // P0 #2 (Mem0 ADDITIVE): existing facts context for linking.
  const existingFactsSection =
    options?.knownFacts && options.knownFacts.length > 0
      ? `\nExisting Memories (link to these via linkedFactIds when relevant):\n${
          options.knownFacts
            .slice(0, 30)
            .map((f) => `  [id: ${f.id}] ${f.summary}`)
            .join("\n")
        }\n`
      : "";

  return [
    "You are a Memory Extractor — a precise, evidence-bound processor responsible for extracting rich, contextual memories from conversations.",
    "",
    "## ROLE",
    "Your SOLE operation is ADD: identify every piece of memorable information and produce self-contained, contextually rich factual statements.",
    "Never decide to UPDATE or DELETE existing memories — just ADD new ones. The retrieval layer will decide which wins via ranking.",
    "",
    "Each fact must capture a COMPLETE piece of information, not an atomic fragment.",
    "Use multi-attribute structure to preserve all related details in a single fact.",
    "",
    "## Schema",
    '  {"subject": "PersonName", "predicate": "snake_case_verb", "attributes": [{"name": "...", "value": "..."}, ...], "objectSummary": "human-readable summary", "entities": ["..."], "linkedFactIds": ["id-of-related-existing-fact"]}',
    "",
    "Attribute names should be semantic (location, time, reason, items, participants, cost, duration, etc.).",
    "objectSummary must be a complete sentence that combines all attributes.",
    "",
    "## Examples",
    '  Input: "I want my dance studio to be by the water, with natural light and Marley flooring"',
    '  Output: {"subject": "Jon", "predicate": "ideal_dance_studio", "attributes": [{"name": "location", "value": "by the water"}, {"name": "lighting", "value": "natural light"}, {"name": "flooring", "value": "Marley flooring"}], "objectSummary": "wants dance studio by the water with natural light and Marley flooring", "entities": ["Jon", "dance studio"]}',
    "",
    '  Input: "I have two cats named Oliver and Luna, plus a new one called Bailey"',
    '  Output: {"subject": "Melanie", "predicate": "has_pets", "attributes": [{"name": "items", "value": "Oliver (cat), Luna (cat), Bailey (cat)"}], "objectSummary": "has three cats: Oliver, Luna, and Bailey", "entities": ["Melanie", "Oliver", "Luna", "Bailey"]}',
    "",
    '  Input: "I went hiking on October 19th after the roadtrip"',
    '  Output: {"subject": "Melanie", "predicate": "went_hiking", "attributes": [{"name": "time", "value": "19 October 2023"}, {"name": "context", "value": "after the roadtrip"}], "objectSummary": "went hiking on 19 October 2023 after the roadtrip", "entities": ["Melanie"]}',
    "",
    "## Rules",
    "- subject: Always a person's name, never pronouns.",
    "- predicate: snake_case, captures the relationship type.",
    "- One fact per logical concept, NOT per sentence. Combine related details into one fact with multiple attributes.",
    "- DO NOT split 'I want a studio by the water with natural light' into 3 separate facts. Use attributes.",
    "- Use third-person perspective.",
    "- Extract only factual, specific information. Skip greetings, small talk, vague statements.",
    "",
    "## Exhaustive Extraction (Mem0 anti-overfitting)",
    "- Scan EVERY user message in the dialogue for memorable facts. Do not stop at the first topic.",
    "- 10+ messages typically yield 5-15 facts. Fewer than 3 facts almost certainly means you missed something.",
    "- Watch for 'first topic dominance' — do not let the first topic in the conversation dominate extraction.",
    "- Preserve proper nouns, numbers, dates, and qualifiers verbatim.",
    "",
    "## Memory Linking (Mem0 ADDITIVE fact graph)",
    "When extracting a new fact, check if it relates to any Existing Memory listed below.",
    "Add related Existing Memory IDs to the 'linkedFactIds' array. Link when:",
    "- Same entity/topic: New fact about a person, place, or thing already mentioned",
    "- Updated preference: A changed or evolved opinion on something previously captured",
    "- Continuation: Follow-up event or next step in a previously captured narrative",
    "- Contradiction: New information that conflicts with an existing fact",
    "If no existing fact is related, omit 'linkedFactIds' or return an empty array.",
    "",
    "## Temporal Anchoring (Mem0 Observation Date)",
    "All relative time expressions (yesterday, last week, next month) MUST be anchored to the Session Date (Observation Date), NOT the current date.",
    "This ensures 'last week' always refers to the week of THIS conversation, even when retrieved months later.",
    "",
    "Return ONLY a JSON array of fact objects. No markdown, no explanation.",
  ].join("\n") + dateHint + entityHint + existingFactsSection;
}

export function buildBufferedExtractionUserPrompt(
  dialogue: string,
  options: { conversationId: string; chunkNum: number; totalChunks: number },
): string {
  return [
    `Extract facts from this dialogue (part ${options.chunkNum}/${options.totalChunks} of conversation ${options.conversationId}):`,
    "",
    dialogue,
    "",
    "Return ONLY a JSON array of fact objects.",
  ].join("\n");
}

export function parseBufferedExtractionResponse(content: string): BufferedExtractedFact[] {
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  try {
    const parsed = JSON.parse(jsonMatch[0]) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is BufferedExtractedFact =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as BufferedExtractedFact).subject === "string" &&
        typeof (item as BufferedExtractedFact).predicate === "string" &&
        typeof (item as BufferedExtractedFact).objectSummary === "string",
    ).map((item) => {
      const fact: BufferedExtractedFact = {
        subject: item.subject,
        predicate: item.predicate,
        attributes: Array.isArray(item.attributes)
          ? item.attributes.filter(
              (a): a is FactAttribute =>
                typeof a === "object" &&
                a !== null &&
                typeof a.name === "string" &&
                typeof a.value === "string",
            )
          : [],
        objectSummary: item.objectSummary,
      };
      // S0-2: parse LLM-extracted entities[] when present. Normalization
      // (lowercase/trim) is deferred to EntityStore/makeFactFromExtracted so
      // the raw surface form is preserved for alias resolution.
      if (Array.isArray(item.entities)) {
        const entities = item.entities
          .filter((e): e is string => typeof e === "string" && e.trim().length > 0)
          .map((e) => e.trim())
          // Cap at 10 to bound prompt size; downstream store dedupes.
          .slice(0, 10);
        if (entities.length > 0) {
          fact.entities = entities;
        }
      }
      // P0 #2 (Mem0 ADDITIVE): parse linkedFactIds — links to existing facts.
      if (Array.isArray(item.linkedFactIds)) {
        const linked = item.linkedFactIds
          .filter((e): e is string => typeof e === "string" && e.trim().length > 0)
          .map((e) => e.trim())
          .slice(0, 20);
        if (linked.length > 0) {
          fact.linkedFactIds = linked;
        }
      }
      return fact;
    });
  } catch {
    return [];
  }
}

// === Consolidation ===
//
// After each session's facts are extracted, ask LLM to merge near-duplicate facts.
// Two facts are consolidation candidates if they share the same subject AND have
// similar predicate (e.g., "started_hobby" + "enjoys_hobby" → consolidated as "hobby").
//
// The LLM receives all facts for a session and returns a consolidated list with:
// - Unioned attributes (preserving all unique information)
// - Single objectSummary that captures all attributes

export function buildConsolidationSystemPrompt(): string {
  return [
    "You are a fact consolidation system. Given a list of facts about people, merge near-duplicate facts into single facts with unioned attributes.",
    "",
    "Consolidation rules:",
    "- Merge facts with the same subject if they describe the same logical concept (e.g., 'enjoys_hobby' + 'started_hobby' about the same hobby → merge).",
    "- DO NOT merge facts that describe different things, even if the subject is the same.",
    "- When merging, union the attributes (combine attributes from both facts, deduplicating by name+value).",
    "- The merged objectSummary should be a complete sentence capturing all attributes.",
    "- Preserve all unique information. Do not lose any details.",
    "- If a fact is unique (no merge candidate), keep it as-is.",
    "",
    "## Contradiction Detection (Zep invalid_at 四元组)",
    "When two facts about the SAME subject and predicate CONTRADICT each other (e.g., 'Alice lives in NYC' vs 'Alice moved to LA'):",
    "- Keep ONLY the newer/latest fact in the consolidated output.",
    "- Add an 'invalidated_source_indices' array listing the 0-based indices of the contradicted facts that should be marked as invalidated.",
    "- The retrieval layer will use this to set invalid_at on the old fact, so temporal queries get the latest answer.",
    "If no contradictions exist, omit 'invalidated_source_indices' or return an empty array.",
    "",
    "For each consolidated fact, include a 'source_indices' array listing the 0-based indices of the original facts that were merged into it. A standalone (unmerged) fact should have source_indices with just its own index.",
    "",
    "Return ONLY a JSON array of consolidated facts with this schema:",
    '  {"subject": "...", "predicate": "...", "attributes": [...], "objectSummary": "...", "source_indices": [0, 2, 5], "invalidated_source_indices": [3]}',
  ].join("\n");
}

export function buildConsolidationUserPrompt(facts: BufferedExtractedFact[]): string {
  const factsJson = JSON.stringify(
    facts.map((f) => ({
      subject: f.subject,
      predicate: f.predicate,
      attributes: f.attributes,
      objectSummary: f.objectSummary,
    })),
    null,
    2,
  );
  return [
    "Consolidate these facts (merge near-duplicates, preserve all unique information):",
    "",
    factsJson,
    "",
    "Return ONLY a JSON array of consolidated facts.",
  ].join("\n");
}

export function parseConsolidationResponse(
  content: string,
): Array<BufferedExtractedFact & { sourceIndices?: number[]; invalidatedSourceIndices?: number[] }> {
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
        const fact: BufferedExtractedFact & { sourceIndices?: number[]; invalidatedSourceIndices?: number[] } = {
          subject: String(item.subject ?? ""),
          predicate: String(item.predicate ?? ""),
          attributes: Array.isArray(item.attributes)
            ? (item.attributes as unknown[])
                .filter(
                  (a): a is FactAttribute =>
                    typeof a === "object" &&
                    a !== null &&
                    typeof (a as FactAttribute).name === "string" &&
                    typeof (a as FactAttribute).value === "string",
                )
                .map((a) => ({
                  name: a.name,
                  value: a.value,
                }))
            : [],
          objectSummary: String(item.objectSummary ?? ""),
        };
        // S0-2: parse entities[] from consolidated output.
        if (Array.isArray(item.entities)) {
          const entities = item.entities
            .filter((e): e is string => typeof e === "string" && e.trim().length > 0)
            .map((e) => e.trim())
            .slice(0, 10);
          if (entities.length > 0) {
            fact.entities = entities;
          }
        }
        // P0 #2 (Mem0 ADDITIVE): parse linkedFactIds from consolidated output.
        if (Array.isArray(item.linkedFactIds)) {
          const linked = item.linkedFactIds
            .filter((e): e is string => typeof e === "string" && e.trim().length > 0)
            .map((e) => e.trim())
            .slice(0, 20);
          if (linked.length > 0) {
            fact.linkedFactIds = linked;
          }
        }
        if (
          Array.isArray(item.source_indices) &&
          item.source_indices.every((i) => typeof i === "number")
        ) {
          fact.sourceIndices = item.source_indices as number[];
        }
        // P0 #3 (Zep invalid_at): parse invalidated_source_indices —
        // indices of contradicted facts that should be marked invalidated.
        if (
          Array.isArray(item.invalidated_source_indices) &&
          item.invalidated_source_indices.every((i) => typeof i === "number")
        ) {
          fact.invalidatedSourceIndices = item.invalidated_source_indices as number[];
        }
        return fact;
      })
      .filter(
        (f) => f.subject.length > 0 && f.objectSummary.length > 0,
      );
  } catch {
    return [];
  }
}

/**
 * S0-2: union entities from source facts into a consolidated fact when the
 * consolidation LLM did not return entities (or returned an empty list).
 * Deduplicates case-insensitively, preserving the first surface form seen.
 * Used by the consolidation orchestrator as a safety net so entities[] is
 * never lost even when the LLM forgets to emit the field.
 */
export function unionEntitiesFromSources(
  sourceFacts: readonly BufferedExtractedFact[],
  sourceIndices: readonly number[],
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const idx of sourceIndices) {
    const src = sourceFacts[idx];
    if (!src || !Array.isArray(src.entities)) continue;
    for (const e of src.entities) {
      if (typeof e !== "string") continue;
      const trimmed = e.trim();
      if (trimmed.length === 0) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(trimmed);
      if (result.length >= 10) break;
    }
    if (result.length >= 10) break;
  }
  return result;
}

// === Main extraction orchestrator ===
//
// Flow:
//   1. Split session into chunks of BUFFERED_CHUNK_SIZE turns
//   2. For each chunk, call LLM to extract facts (multi-attribute)
//   3. After all chunks in a session are extracted, call LLM to consolidate facts
//   4. Move to next session
//
// The consolidation step is what makes this different from the existing extraction.
// Without consolidation, each turn produces 1-2 facts, leading to 2403+ fragmented facts.
// With consolidation, similar facts are merged, reducing total count and increasing density.

export type BufferedExtractionCallLLM = (
  system: string,
  user: string,
  options?: { temperature?: number; maxTokens?: number },
) => Promise<{ content: string }>;

export type BufferedExtractionTurn = {
  speaker: string;
  text: string;
  sessionDate: number;
  sessionId: string;
  turnIndex?: number;
};

export async function extractFactsWithBufferedFlush(
  turns: BufferedExtractionTurn[],
  conversationId: string,
  callLLM: BufferedExtractionCallLLM,
  options: {
    chunkSize?: number;
    enableConsolidation?: boolean;
    onProgress?: (event: { phase: string; chunk?: number; totalChunks?: number; facts?: number }) => void;
  } = {},
): Promise<BufferedExtractionResult> {
  const chunkSize = options.chunkSize ?? DEFAULT_BUFFERED_CHUNK_SIZE;
  const enableConsolidation = options.enableConsolidation ?? true;
  const onProgress = options.onProgress ?? (() => {});

  // Group turns by session for consolidation.
  const turnsBySession = new Map<string, BufferedExtractionTurn[]>();
  for (const turn of turns) {
    const arr = turnsBySession.get(turn.sessionId) ?? [];
    arr.push(turn);
    turnsBySession.set(turn.sessionId, arr);
  }

  const allExtracted: BufferedExtractedFact[] = [];
  const seenEntities = new Set<string>();
  let totalRaw = 0;
  let sessionsProcessed = 0;
  let factsBeforeConsolidation = 0;
  let factsAfterConsolidation = 0;

  for (const sessionId of Array.from(turnsBySession.keys())) {
    const sessionTurns = turnsBySession.get(sessionId)!;
    if (sessionTurns.length === 0) continue;
    const sessionDate = sessionTurns[0].sessionDate;

    // Split session into chunks of chunkSize turns.
    const totalChunks = Math.ceil(sessionTurns.length / chunkSize);
    const sessionFacts: BufferedExtractedFact[] = [];

    for (let i = 0; i < sessionTurns.length; i += chunkSize) {
      const chunk = sessionTurns.slice(i, i + chunkSize);
      const chunkNum = Math.floor(i / chunkSize) + 1;
      const dialogue = chunk.map((t) => `${t.speaker}: ${t.text}`).join("\n");

      // P0 #2 (Mem0 ADDITIVE): pass previously extracted facts (this session
      // + earlier sessions) so the LLM can link new facts via linkedFactIds.
      // Cap at 30 most recent to bound prompt size.
      const knownFacts = allExtracted
        .slice(-30)
        .concat(sessionFacts.slice(-30))
        .map((f, idx) => ({
          id: `fact_${idx}_${f.subject}_${f.predicate}`.replace(/\s+/g, "_"),
          summary: `${f.subject} ${f.predicate}: ${f.objectSummary}`,
        }));

      const system = buildBufferedExtractionSystemPrompt({
        sessionDate,
        knownEntities: Array.from(seenEntities),
        knownFacts,
      });
      const user = buildBufferedExtractionUserPrompt(dialogue, {
        conversationId,
        chunkNum,
        totalChunks,
      });

      onProgress({ phase: "extract", chunk: chunkNum, totalChunks });

      let facts: BufferedExtractedFact[] = [];
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await callLLM(system, user, {
            temperature: 0,
            maxTokens: 4096,
          });
          facts = parseBufferedExtractionResponse(response.content);
          if (facts.length > 0) break;
        } catch {
          // retry
        }
      }

      for (const f of facts) {
        f.sessionDate = sessionDate;
        if (f.subject) seenEntities.add(f.subject);
      }
      sessionFacts.push(...facts);
      totalRaw += facts.length;
      onProgress({ phase: "extract", chunk: chunkNum, totalChunks, facts: facts.length });
    }

    // Consolidation step: merge near-duplicates within this session.
    // Item 2: generate stable IDs for pre-consolidation facts so we can
    // fill evidenceRefs/proofCount on consolidated facts (Hindsight §3.4
    // source_memory_ids + proof_count).
    factsBeforeConsolidation += sessionFacts.length;
    let consolidatedFacts: BufferedExtractedFact[] = sessionFacts;
    // P0 #3: track which raw fact indices were invalidated by contradiction.
    const invalidatedIndices = new Set<number>();
    if (enableConsolidation && sessionFacts.length > 1) {
      // Assign stable IDs to pre-consolidation facts for evidenceRefs.
      const rawFactIds = sessionFacts.map(
        (_, idx) => `${sessionId}_raw_${globalFactCounter++}`,
      );
      try {
        const cSystem = buildConsolidationSystemPrompt();
        const cUser = buildConsolidationUserPrompt(sessionFacts);
        const response = await callLLM(cSystem, cUser, {
          temperature: 0,
          maxTokens: 8192,
        });
        const consolidated = parseConsolidationResponse(response.content);
        if (consolidated.length > 0) {
          consolidatedFacts = consolidated.map((f) => {
            // P0 #3: collect invalidated indices for contradicted facts.
            if (f.invalidatedSourceIndices) {
              for (const idx of f.invalidatedSourceIndices) {
                if (idx >= 0 && idx < sessionFacts.length) {
                  invalidatedIndices.add(idx);
                }
              }
            }
            // Map sourceIndices to raw fact IDs → evidenceRefs.
            let evidenceRefs: string[] | undefined;
            let sourceIndicesForUnion: number[] = [];
            if (
              f.sourceIndices &&
              f.sourceIndices.length > 0 &&
              f.sourceIndices.every(
                (i) => i >= 0 && i < rawFactIds.length,
              )
            ) {
              evidenceRefs = f.sourceIndices.map((i) => rawFactIds[i]);
              sourceIndicesForUnion = f.sourceIndices;
            } else {
              // Fallback: link to all raw facts with the same subject.
              const sameSubjectIds: string[] = [];
              sessionFacts.forEach((sf, idx) => {
                if (sf.subject === f.subject) {
                  sameSubjectIds.push(rawFactIds[idx]);
                  sourceIndicesForUnion.push(idx);
                }
              });
              evidenceRefs =
                sameSubjectIds.length > 0 ? sameSubjectIds : undefined;
            }
            // S0-2: prefer entities[] from the consolidation LLM. If the
            // LLM omitted entities (or returned []), union from source facts
            // as a safety net so entities[] is never lost during merge.
            let entities: string[] | undefined = Array.isArray(f.entities)
              ? f.entities
              : undefined;
            if (
              (!entities || entities.length === 0) &&
              sourceIndicesForUnion.length > 0
            ) {
              const unioned = unionEntitiesFromSources(
                sessionFacts,
                sourceIndicesForUnion,
              );
              if (unioned.length > 0) {
                entities = unioned;
              }
            }
            return {
              subject: f.subject,
              predicate: f.predicate,
              attributes: f.attributes,
              objectSummary: f.objectSummary,
              sessionDate,
              evidenceRefs,
              proofCount: evidenceRefs?.length,
              ...(entities && entities.length > 0 ? { entities } : {}),
            };
          });
        }
      } catch {
        // Fall back to unconsolidated facts.
      }
    }
    factsAfterConsolidation += consolidatedFacts.length;
    allExtracted.push(...consolidatedFacts);

    // P0 #3 (Zep invalid_at): preserve contradicted facts with invalid_at
    // marker so temporal queries can filter them out. The consolidation LLM
    // returns invalidated_source_indices for facts that were superseded;
    // we keep them in the output but mark invalid_at_hint = sessionDate so
    // downstream fact promotion can set invalid_at. isRuntimeMemoryFactValidAt
    // filters them in strict mode, applyFinalBoost penalizes in non-strict.
    for (const idx of invalidatedIndices) {
      const contradicted = sessionFacts[idx];
      if (contradicted) {
        allExtracted.push({
          ...contradicted,
          invalid_at_hint: sessionDate,
        } as BufferedExtractedFact & { invalid_at_hint?: number });
      }
    }

    sessionsProcessed += 1;
    onProgress({ phase: "consolidate", facts: consolidatedFacts.length });
  }

  return {
    facts: allExtracted,
    totalRaw,
    totalConsolidated: allExtracted.length,
    consolidationStats: {
      sessionsProcessed,
      factsBeforeConsolidation,
      factsAfterConsolidation,
    },
  };
}
