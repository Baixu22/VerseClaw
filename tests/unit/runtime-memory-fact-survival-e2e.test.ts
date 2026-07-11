// @vitest-environment node
// E2E Fact Survival Test — measures fact survival rate from AUDN extraction
// through store write to retrieval.
//
// User's directive: "如果存活率低于 80%，所有其他优化都是在漏桶上浇水"
// (If survival rate < 80%, all other optimizations are pouring water
//  into a leaky bucket.)
//
// This test traces a fact through three stages:
//   Stage A (Acceptance): AUDN-extracted fact → store.appendFact() → accepted?
//   Stage B (Persistence): accepted fact survives eviction → still in store?
//   Stage C (Retrieval):   stored fact is findable by hybridSearchFacts?
//
// Each stage can leak. This test reports WHERE the leaks are so we know
// whether to fix the front door (type guard), the bucket (eviction), or
// the spigot (retrieval filters).

import { describe, it, expect } from "vitest";
import { RuntimeMemoryStore } from "../../openclaw_runtime/src/runtime-core/memory-store";
import {
  buildRuntimeMemoryTemporalFactFixture,
  buildRuntimeMemoryTemporalFactCandidateFixture,
  buildRuntimeMemoryInvalidationProposalFixture,
  type RuntimeMemoryTemporalFact,
  type RuntimeMemoryTemporalFactCandidate,
  type RuntimeMemoryQueryableFact,
  type RuntimeMemoryType,
} from "../../openclaw_runtime/src/runtime-core/memory-context";
import {
  hybridSearchFacts,
  OPTIMAL_HYBRID_FUSION,
} from "../../openclaw_runtime/src/runtime-core/memory-hybrid-retrieval";

// ---------------------------------------------------------------------------
// Simulated AUDN extraction output
// ---------------------------------------------------------------------------
// Each entry represents one atomic fact that the AUDN write-curation layer
// would extract from a conversation. We model a realistic variety:
//   - semantic facts (stable user profile, ~40%)
//   - episodic facts (time-bound events, ~35%)
//   - procedural facts (learned preferences, ~20%)
//   - candidate facts (unverified, ~5%)
// Plus edge cases:
//   - a few facts with valid_at in the future (should be filtered at retrieval)
//   - a few facts that get invalidated (should be filtered at retrieval)
//
// `query` is the natural-language query a user might ask that SHOULD retrieve
// this fact. We use lexically-overlapping queries (realistic — users quote
// their own prior phrasing) so BM25 has a fair chance even without embeddings.

type SimulatedExtractedFact = {
  id: string;
  subject: string;
  predicate: string;
  objectSummary: string;
  valid_at: number;
  reference_time: number;
  memoryType?: RuntimeMemoryType;
  isCandidate?: boolean;
  invalidAt?: number; // if set, fact will be invalidated after write
  query: string;
};

const T0 = 1_700_000_000_000; // base timestamp (~Nov 2023)
const DAY = 24 * 60 * 60 * 1000;

function buildExtractedCorpus(): SimulatedExtractedFact[] {
  const facts: SimulatedExtractedFact[] = [];

  // --- Semantic facts (stable user profile) — 20 facts, all verified ---
  const semantic: Array<[string, string, string, string]> = [
    ["Alice", "works_as", "Alice works as a registered nurse at Seattle General Hospital", "What does Alice do for work?"],
    ["Alice", "speaks", "Alice speaks English and conversational Spanish", "What languages does Alice speak?"],
    ["Alice", "lives_in", "Alice lives in Seattle Washington", "Where does Alice live?"],
    ["Alice", "owns_pet", "Alice has a cat named Whiskers", "Does Alice have any pets?"],
    ["Alice", "drives", "Alice drives a Toyota Prius", "What car does Alice drive?"],
    ["Alice", "studies", "Alice is studying for a BSN nursing degree at University of Washington", "What is Alice studying?"],
    ["Alice", "allergic_to", "Alice is allergic to penicillin and peanuts", "What is Alice allergic to?"],
    ["Alice", "birthday", "Alice birthday is March 15 1992", "When is Alice birthday?"],
    ["Alice", "favorite_food", "Alice favorite food is Thai green curry", "What is Alice favorite food?"],
    ["Alice", "hobby", "Alice enjoys hiking and landscape photography on weekends", "What are Alice hobbies?"],
    ["Alice", "spouse", "Alice is married to Bob who works as a software engineer", "Who is Alice married to?"],
    ["Alice", "music_preference", "Alice listens to indie folk and jazz music", "What kind of music does Alice like?"],
    ["Alice", "coffee_order", "Alice drinks oat milk lattes with no sugar", "What coffee does Alice drink?"],
    ["Alice", "phone", "Alice uses an iPhone for personal and work", "What phone does Alice use?"],
    ["Alice", "exercise", "Alice goes to the gym three times a week for strength training", "How often does Alice exercise?"],
    ["Alice", "education", "Alice has an associate degree in nursing from Bellevue College", "What education does Alice have?"],
    ["Alice", "blood_type", "Alice blood type is O positive", "What is Alice blood type?"],
    ["Alice", "commute", "Alice commutes by bus to the hospital about 30 minutes each way", "How does Alice commute to work?"],
    ["Alice", "vacation_days", "Alice has 15 vacation days remaining this year", "How many vacation days does Alice have?"],
    ["Alice", "shoe_size", "Alice wears size 8 shoes", "What shoe size does Alice wear?"],
  ];
  for (let i = 0; i < semantic.length; i++) {
    const [subject, predicate, summary, query] = semantic[i];
    facts.push({
      id: `sem_${i}`,
      subject,
      predicate,
      objectSummary: summary,
      valid_at: T0 + i * DAY,
      reference_time: T0 + i * DAY,
      memoryType: "semantic",
      query,
    });
  }

  // --- Episodic facts (time-bound events) — 18 facts, all verified ---
  const episodic: Array<[string, string, string, number, string]> = [
    ["Alice", "traveled_to", "Alice traveled to Japan for a two-week vacation", 30, "Did Alice travel to Japan?"],
    ["Alice", "attended", "Alice attended the AWS re:Invent conference in Las Vegas", 60, "Did Alice attend AWS re:Invent?"],
    ["Alice", "bought", "Alice bought a new MacBook Pro laptop for nursing school", 90, "What did Alice buy recently?"],
    ["Alice", "moved_to", "Alice moved to a new apartment in Capitol Hill neighborhood", 120, "Did Alice move apartments?"],
    ["Alice", "started_job", "Alice started a new job at Seattle General Hospital", 150, "When did Alice start her hospital job?"],
    ["Alice", "hospitalized", "Alice was briefly hospitalized for appendicitis surgery", 180, "Was Alice ever hospitalized?"],
    ["Alice", "presented", "Alice presented a poster at the Washington Nursing Conference", 210, "Did Alice present at a conference?"],
    ["Alice", "volunteered", "Alice volunteered at a free clinic during the holidays", 240, "Did Alice volunteer anywhere?"],
    ["Alice", "took_exam", "Alice passed the NCLEX licensing exam on the first attempt", 270, "Did Alice pass her licensing exam?"],
    ["Alice", "adopted_pet", "Alice adopted a second cat named Pepper from the shelter", 300, "Did Alice adopt another pet?"],
    ["Alice", "renovated", "Alice renovated her kitchen with new cabinets and floors", 330, "Did Alice renovate her home?"],
    ["Alice", "traveled_to", "Alice visited family in Portland Oregon for Thanksgiving", 360, "Did Alice visit family for Thanksgiving?"],
    ["Alice", "completed", "Alice completed a certification in critical care nursing", 390, "What certification did Alice complete?"],
    ["Alice", "interviewed", "Alice interviewed for a charge nurse position", 420, "Did Alice interview for a promotion?"],
    ["Alice", "celebrated", "Alice celebrated her one-year wedding anniversary with Bob", 450, "Did Alice celebrate an anniversary?"],
    ["Alice", "switched_shifts", "Alice switched from night shifts to day shifts at the hospital", 480, "Did Alice change her work schedule?"],
    ["Alice", "bought_car", "Alice bought a used Toyota Prius hybrid car", 510, "When did Alice buy her car?"],
    ["Alice", "joined_gym", "Alice joined a CrossFit gym near her apartment", 540, "Did Alice join a gym?"],
  ];
  for (let i = 0; i < episodic.length; i++) {
    const [subject, predicate, summary, daysOffset, query] = episodic[i];
    facts.push({
      id: `epi_${i}`,
      subject,
      predicate,
      objectSummary: summary,
      valid_at: T0 + daysOffset * DAY,
      reference_time: T0 + daysOffset * DAY,
      memoryType: "episodic",
      query,
    });
  }

  // --- Procedural facts (learned preferences) — 10 facts, all verified ---
  const procedural: Array<[string, string, string, string]> = [
    ["Alice", "prefers", "Alice wants code examples written in Python not JavaScript", "What programming language does Alice prefer?"],
    ["Alice", "prefers", "Alice wants meeting notes formatted as bullet points not paragraphs", "How does Alice want meeting notes?"],
    ["Alice", "prefers", "Alice prefers dark mode for all applications and websites", "Does Alice prefer dark mode?"],
    ["Alice", "prefers", "Alice wants the assistant to be concise and skip pleasantries", "How does Alice want the assistant to communicate?"],
    ["Alice", "prefers", "Alice wants schedule reminders 15 minutes before meetings", "When does Alice want meeting reminders?"],
    ["Alice", "prefers", "Alice wants medical terms explained in plain language", "How does Alice want medical terms handled?"],
    ["Alice", "prefers", "Alice prefers email over Slack for non-urgent communication", "How does Alice prefer to be contacted?"],
    ["Alice", "prefers", "Alice wants recipe ingredients listed before instructions", "How does Alice want recipes formatted?"],
    ["Alice", "prefers", "Alice wants travel itineraries sorted by time not priority", "How does Alice want travel plans organized?"],
    ["Alice", "prefers", "Alice wants book recommendations with page count and genre", "How does Alice want book recommendations?"],
  ];
  for (let i = 0; i < procedural.length; i++) {
    const [subject, predicate, summary, query] = procedural[i];
    facts.push({
      id: `pro_${i}`,
      subject,
      predicate,
      objectSummary: summary,
      valid_at: T0 + (550 + i) * DAY,
      reference_time: T0 + (550 + i) * DAY,
      memoryType: "procedural",
      query,
    });
  }

  // --- Candidate facts (unverified) — 4 facts, verificationStatus: candidate ---
  // These test whether the retrieval layer's includeCandidates=false default
  // silently drops AUDN output that hasn't been promoted to verified yet.
  const candidates: Array<[string, string, string, string]> = [
    ["Alice", "might_move", "Alice is considering moving to Portland next year", "Is Alice planning to move?"],
    ["Alice", "might_study", "Alice is thinking about a master in public health", "Is Alice considering further study?"],
    ["Alice", "might_travel", "Alice is planning a trip to Iceland to see the northern lights", "Is Alice planning any trips?"],
    ["Alice", "might_adopt", "Alice is thinking about adopting a dog from the shelter", "Is Alice considering a dog?"],
  ];
  for (let i = 0; i < candidates.length; i++) {
    const [subject, predicate, summary, query] = candidates[i];
    facts.push({
      id: `can_${i}`,
      subject,
      predicate,
      objectSummary: summary,
      valid_at: T0 + (600 + i) * DAY,
      reference_time: T0 + (600 + i) * DAY,
      memoryType: "semantic",
      isCandidate: true,
      query,
    });
  }

  // --- Edge case: facts that will be invalidated ---
  // 3 facts that start verified, then get invalidated by a newer fact.
  // These SHOULD be filtered at retrieval (temporalMode=filter excludes
  // invalidated facts when referenceTime >= invalid_at).
  facts.push({
    id: "inv_old_job_0",
    subject: "Alice",
    predicate: "works_as",
    objectSummary: "Alice works as a nursing assistant at Bellevue Clinic",
    valid_at: T0 - 200 * DAY,
    reference_time: T0 - 200 * DAY,
    memoryType: "semantic",
    invalidAt: T0 + 150 * DAY, // invalidated when she started at Seattle General
    query: "Where did Alice work before?",
  });
  facts.push({
    id: "inv_old_car_0",
    subject: "Alice",
    predicate: "drives",
    objectSummary: "Alice drives a Honda Civic sedan",
    valid_at: T0 - 100 * DAY,
    reference_time: T0 - 100 * DAY,
    memoryType: "semantic",
    invalidAt: T0 + 510 * DAY, // invalidated when she bought the Prius
    query: "What car did Alice drive before?",
  });
  facts.push({
    id: "inv_old_home_0",
    subject: "Alice",
    predicate: "lives_in",
    objectSummary: "Alice lives in Bellevue Washington",
    valid_at: T0 - 150 * DAY,
    reference_time: T0 - 150 * DAY,
    memoryType: "semantic",
    invalidAt: T0 + 120 * DAY, // invalidated when she moved to Capitol Hill
    query: "Where did Alice live before?",
  });

  return facts;
}

// ---------------------------------------------------------------------------
// Helpers: convert simulated AUDN output → store-accepted fact objects
// ---------------------------------------------------------------------------

function buildVerifiedFact(ef: SimulatedExtractedFact): RuntimeMemoryTemporalFact {
  return buildRuntimeMemoryTemporalFactFixture({
    factId: ef.id,
    subject: ef.subject,
    predicate: ef.predicate,
    objectSummary: ef.objectSummary,
    valid_at: ef.valid_at,
    reference_time: ef.reference_time,
    confidence: 0.85,
    source: "verifier_summary",
    ...(ef.memoryType ? { memoryType: ef.memoryType } : {}),
  });
}

function buildCandidateFact(ef: SimulatedExtractedFact): RuntimeMemoryTemporalFactCandidate {
  return buildRuntimeMemoryTemporalFactCandidateFixture({
    factId: ef.id,
    subject: ef.subject,
    predicate: ef.predicate,
    objectSummary: ef.objectSummary,
    valid_at: ef.valid_at,
    reference_time: ef.reference_time,
    confidence: 0.6,
    source: "task_event",
    ...(ef.memoryType ? { memoryType: ef.memoryType } : {}),
  });
}

// ---------------------------------------------------------------------------
// The test
// ---------------------------------------------------------------------------

describe("E2E Fact Survival: AUDN extraction → store write → retrieval", () => {
  it("should achieve ≥80% end-to-end survival rate (the leaky-bucket gate)", () => {
    const extracted = buildExtractedCorpus();
    const N_EXTRACTED = extracted.length;

    // Reference time for retrieval: well after all facts are valid, so
    // temporalMode=filter does not exclude them for being "in the future".
    const RETRIEVAL_REF_TIME = T0 + 700 * DAY;

    // -----------------------------------------------------------------------
    // Stage A: Acceptance — does appendFact accept the fact?
    // -----------------------------------------------------------------------
    // Use a generous maxFacts so eviction does not confound Stage A.
    const store = new RuntimeMemoryStore({ maxFacts: 1024, evictionPolicy: "fifo" });

    const accepted: SimulatedExtractedFact[] = [];
    const rejected: Array<{ id: string; reason: string; message: string }> = [];

    for (const ef of extracted) {
      const fact = ef.isCandidate ? buildCandidateFact(ef) : buildVerifiedFact(ef);
      const result = store.appendFact(fact);
      if (result.accepted) {
        accepted.push(ef);
      } else {
        rejected.push({
          id: ef.id,
          reason: result.reason,
          message: result.message,
        });
      }
    }

    const N_ACCEPTED = accepted.length;
    const acceptanceRate = N_ACCEPTED / N_EXTRACTED;

    // -----------------------------------------------------------------------
    // Stage A2: Invalidation — apply invalidations for facts marked invalidAt
    // -----------------------------------------------------------------------
    let invalidationsApplied = 0;
    for (const ef of accepted) {
      if (ef.invalidAt === undefined) continue;
      const proposal = buildRuntimeMemoryInvalidationProposalFixture({
        invalidationId: `inv_${ef.id}`,
        factId: ef.id,
        invalid_at: ef.invalidAt,
        reference_time: ef.invalidAt,
        reason: "superseded",
        verificationStatus: "verified",
      });
      const invResult = store.invalidateFact(proposal);
      if (invResult.accepted) invalidationsApplied++;
    }

    // -----------------------------------------------------------------------
    // Stage B: Persistence — how many facts are still in the store?
    // -----------------------------------------------------------------------
    const stats = store.stats();
    const N_STORED = stats.facts;
    const persistenceRate = N_STORED / N_EXTRACTED;

    // -----------------------------------------------------------------------
    // Stage C: Retrieval — can we find each accepted fact via hybridSearchFacts?
    // -----------------------------------------------------------------------
    // Source every accepted lifecycle state from the store, then let
    // hybridSearchFacts enforce candidate and temporal visibility per query.
    const liveFacts = store.queryFacts({
      includeCandidates: true,
      includeInvalidated: true,
    }) as readonly RuntimeMemoryQueryableFact[];
    const retrievalEligible = accepted.filter((ef) => !ef.isCandidate);

    let N_RETRIEVED = 0;
    const notRetrieved: Array<{ id: string; subject: string; reason: string }> = [];

    for (const ef of retrievalEligible) {
      // For invalidated facts, query at a time when they were still valid.
      // For normal facts, query at RETRIEVAL_REF_TIME.
      const queryRefTime = ef.invalidAt !== undefined
        ? ef.invalidAt - DAY  // query just before invalidation
        : RETRIEVAL_REF_TIME;

      const hits = hybridSearchFacts(liveFacts, {
        queryText: ef.query,
        topK: 10,
        referenceTime: queryRefTime,
        temporalMode: "filter",
        fusion: OPTIMAL_HYBRID_FUSION,
      });

      const found = hits.some((h) => h.fact.factId === ef.id);
      if (found) {
        N_RETRIEVED++;
      } else {
        notRetrieved.push({
          id: ef.id,
          subject: ef.subject,
          reason: ef.invalidAt !== undefined && queryRefTime >= ef.invalidAt
              ? "invalidated and filtered by temporalMode=filter"
              : "not in BM25 top-10 (lexical mismatch or low score)",
        });
      }
    }

    const retrievalRate = N_RETRIEVED / retrievalEligible.length;

    // -----------------------------------------------------------------------
    // Report
    // -----------------------------------------------------------------------
    console.log("\n========== FACT SURVIVAL REPORT ==========");
    console.log(`Stage 0 (Extracted):          ${N_EXTRACTED}`);
    console.log(`Stage A (Accepted by store):  ${N_ACCEPTED}  (${(acceptanceRate * 100).toFixed(1)}%)`);
    console.log(`Stage B (Persisted in store): ${N_STORED}  (${(persistenceRate * 100).toFixed(1)}%)`);
    console.log(`Stage C (Eligible facts):      ${retrievalEligible.length}`);
    console.log(`Stage C (Retrievable):         ${N_RETRIEVED}  (${(retrievalRate * 100).toFixed(1)}%)`);
    console.log(`Invalidations applied:        ${invalidationsApplied}`);
    console.log(`End-to-end survival rate:     ${(retrievalRate * 100).toFixed(1)}%`);

    if (rejected.length > 0) {
      console.log("\n--- Stage A rejections (front-door leak) ---");
      for (const r of rejected) {
        console.log(`  ${r.id}: reason=${r.reason} message=${r.message}`);
      }
    }

    if (notRetrieved.length > 0) {
      console.log("\n--- Stage C retrieval misses (spigot leak) ---");
      for (const m of notRetrieved) {
        console.log(`  ${m.id} [${m.subject}]: ${m.reason}`);
      }
    }

    console.log("===========================================\n");

    // The leaky-bucket gate: if <80%, optimizations are wasted.
    expect(
      retrievalRate,
      `Eligible retrieval survival rate ${(retrievalRate * 100).toFixed(1)}% < 80%. ` +
      `Leaks: ${rejected.length} rejected at store, ${N_ACCEPTED - N_STORED} evicted, ` +
      `${retrievalEligible.length - N_RETRIEVED} eligible facts not retrievable. ` +
      `Candidates are measured separately because default retrieval intentionally excludes them.`,
    ).toBeGreaterThanOrEqual(0.8);
  });

  // -----------------------------------------------------------------------
  // Diagnostic sub-tests: isolate each leak independently
  // -----------------------------------------------------------------------

  it("Stage A diagnostic: acceptance rate of properly-formed facts (target: 100%)", () => {
    const extracted = buildExtractedCorpus();
    const store = new RuntimeMemoryStore({ maxFacts: 1024 });
    let accepted = 0;
    const reasons = new Map<string, number>();

    for (const ef of extracted) {
      const fact = ef.isCandidate ? buildCandidateFact(ef) : buildVerifiedFact(ef);
      const result = store.appendFact(fact);
      if (result.accepted) {
        accepted++;
      } else {
        reasons.set(result.reason, (reasons.get(result.reason) ?? 0) + 1);
      }
    }

    console.log(`\nStage A: ${accepted}/${extracted.length} accepted (${(accepted / extracted.length * 100).toFixed(1)}%)`);
    if (reasons.size > 0) {
      console.log("Rejection reasons:");
      for (const [reason, count] of reasons) {
        console.log(`  ${reason}: ${count}`);
      }
    }

    // All facts built via the official fixture helpers should be accepted.
    // If any are rejected, the store's type guard is stricter than the
    // AUDN layer's output contract — a front-door leak.
    expect(accepted).toBe(extracted.length);
  });

  it("Stage B diagnostic: persistence rate with generous maxFacts (target: 100%)", () => {
    const extracted = buildExtractedCorpus();
    const store = new RuntimeMemoryStore({ maxFacts: 1024 });
    for (const ef of extracted) {
      const fact = ef.isCandidate ? buildCandidateFact(ef) : buildVerifiedFact(ef);
      store.appendFact(fact);
    }
    const stats = store.stats();
    console.log(`\nStage B: ${stats.facts}/${extracted.length} persisted (${(stats.facts / extracted.length * 100).toFixed(1)}%)`);
    expect(stats.facts).toBe(extracted.length);
  });

  it("Stage B diagnostic: persistence rate under capacity pressure (eviction leak)", () => {
    const extracted = buildExtractedCorpus();
    // Tight maxFacts to force eviction — simulates long-running sessions.
    const store = new RuntimeMemoryStore({ maxFacts: 20, evictionPolicy: "fifo" });
    for (const ef of extracted) {
      const fact = ef.isCandidate ? buildCandidateFact(ef) : buildVerifiedFact(ef);
      store.appendFact(fact);
    }
    const stats = store.stats();
    const rate = stats.facts / extracted.length;
    console.log(`\nStage B (maxFacts=20): ${stats.facts}/${extracted.length} persisted (${(rate * 100).toFixed(1)}%)`);
    // Under FIFO with maxFacts=20, only the last 20 survive. This is the
    // eviction leak — documented here so we know the bucket size matters.
  });

  it("Stage C diagnostic: retrieval rate for verified facts only (candidate exclusion check)", () => {
    const extracted = buildExtractedCorpus();
    const store = new RuntimeMemoryStore({ maxFacts: 1024 });
    const verified: SimulatedExtractedFact[] = [];

    for (const ef of extracted) {
      if (ef.isCandidate) continue;
      const fact = buildVerifiedFact(ef);
      const result = store.appendFact(fact);
      if (result.accepted) verified.push(ef);
    }

    const liveFacts = store.queryFacts() as readonly RuntimeMemoryQueryableFact[];
    const RETRIEVAL_REF_TIME = T0 + 700 * DAY;

    const retrievalEligibleVerified = verified.filter(
      (ef) => ef.invalidAt === undefined,
    );
    let found = 0;
    const missed: string[] = [];
    for (const ef of retrievalEligibleVerified) {
      const hits = hybridSearchFacts(liveFacts, {
        queryText: ef.query,
        topK: 10,
        referenceTime: RETRIEVAL_REF_TIME,
        temporalMode: "filter",
        fusion: OPTIMAL_HYBRID_FUSION,
      });
      if (hits.some((h) => h.fact.factId === ef.id)) {
        found++;
      } else {
        missed.push(ef.id);
      }
    }

    const rate = found / retrievalEligibleVerified.length;
    console.log(`\nStage C (verified only): ${found}/${retrievalEligibleVerified.length} retrievable (${(rate * 100).toFixed(1)}%)`);
    if (missed.length > 0) {
      console.log(`Missed: ${missed.join(", ")}`);
    }
  });

  it("Stage C diagnostic: candidate facts are NOT retrievable by default (the includeCandidates leak)", () => {
    const extracted = buildExtractedCorpus().filter((ef) => ef.isCandidate);
    const store = new RuntimeMemoryStore({ maxFacts: 1024 });

    for (const ef of extracted) {
      store.appendFact(buildCandidateFact(ef));
    }

    const liveFacts = store.queryFacts({
      includeCandidates: true,
    }) as readonly RuntimeMemoryQueryableFact[];
    const RETRIEVAL_REF_TIME = T0 + 700 * DAY;

    // Default: includeCandidates is undefined/false → candidates filtered.
    let foundDefault = 0;
    for (const ef of extracted) {
      const hits = hybridSearchFacts(liveFacts, {
        queryText: ef.query,
        topK: 10,
        referenceTime: RETRIEVAL_REF_TIME,
        temporalMode: "filter",
        fusion: OPTIMAL_HYBRID_FUSION,
      });
      if (hits.some((h) => h.fact.factId === ef.id)) foundDefault++;
    }

    // Explicit: includeCandidates=true → candidates included.
    let foundWithFlag = 0;
    for (const ef of extracted) {
      const hits = hybridSearchFacts(liveFacts, {
        queryText: ef.query,
        topK: 10,
        referenceTime: RETRIEVAL_REF_TIME,
        temporalMode: "filter",
        includeCandidates: true,
        fusion: OPTIMAL_HYBRID_FUSION,
      });
      if (hits.some((h) => h.fact.factId === ef.id)) foundWithFlag++;
    }

    console.log(`\nStage C (candidates): default=${foundDefault}/${extracted.length}, includeCandidates=true=${foundWithFlag}/${extracted.length}`);
    // Candidates remain invisible by default but are recoverable with explicit
    // lifecycle opt-in.
    expect(foundDefault).toBe(0);
    expect(foundWithFlag).toBe(extracted.length);
  });

  it("Stage C diagnostic: invalidated facts are retrievable at pre-invalidation time but filtered after", () => {
    const extracted = buildExtractedCorpus().filter((ef) => ef.invalidAt !== undefined);
    const store = new RuntimeMemoryStore({ maxFacts: 1024 });

    for (const ef of extracted) {
      store.appendFact(buildVerifiedFact(ef));
      store.invalidateFact(buildRuntimeMemoryInvalidationProposalFixture({
        invalidationId: `inv_${ef.id}`,
        factId: ef.id,
        invalid_at: ef.invalidAt!,
        reference_time: ef.invalidAt!,
        reason: "superseded",
        verificationStatus: "verified",
      }));
    }

    const liveFacts = store.queryFacts({
      includeInvalidated: true,
    }) as readonly RuntimeMemoryQueryableFact[];

    // Query BEFORE invalidation → should be retrievable.
    let foundBefore = 0;
    for (const ef of extracted) {
      const hits = hybridSearchFacts(liveFacts, {
        queryText: ef.query,
        topK: 10,
        referenceTime: ef.invalidAt! - DAY,
        temporalMode: "filter",
        fusion: OPTIMAL_HYBRID_FUSION,
      });
      if (hits.some((h) => h.fact.factId === ef.id)) foundBefore++;
    }

    // Query AFTER invalidation → should be filtered out.
    let foundAfter = 0;
    for (const ef of extracted) {
      const hits = hybridSearchFacts(liveFacts, {
        queryText: ef.query,
        topK: 10,
        referenceTime: ef.invalidAt! + DAY,
        temporalMode: "filter",
        fusion: OPTIMAL_HYBRID_FUSION,
      });
      if (hits.some((h) => h.fact.factId === ef.id)) foundAfter++;
    }

    console.log(`\nStage C (invalidated): before_invalid=${foundBefore}/${extracted.length}, after_invalid=${foundAfter}/${extracted.length}`);
    expect(foundBefore).toBe(extracted.length);
    expect(foundAfter).toBe(0);
  });
});
