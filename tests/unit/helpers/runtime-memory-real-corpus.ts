// Non-template fact/query corpus generator for runtime-memory real evaluation.
// Anti-overfitting: 3 independent domains (programming/travel/debugging) with
// realistic content, NOT the 8-category template in tests/fixtures/.
// Each turn produces 1 useful + 1 semantic-noise fact. Labels are assigned at
// generation time and serve as INDEPENDENT ground truth (not consumer-derived).

import {
  buildRuntimeMemoryTemporalFactFixture,
  type RuntimeMemoryTemporalFact,
} from "../../../openclaw_runtime/src/runtime-core";

export type FactLabel = "useful" | "noise";

export type DomainKey = "programming" | "travel" | "debugging";

export type GeneratedFact = RuntimeMemoryTemporalFact & {
  label: FactLabel;
  domain: DomainKey;
  turn: number;
};

export type LongTermCorpus = {
  facts: GeneratedFact[];
  labels: Map<string, FactLabel>;
  writeOrder: string[];
  domainByFactId: Map<string, DomainKey>;
  usefulFactIds: string[];
  noiseFactIds: string[];
};

type DomainConfig = {
  subject: string;
  predicates: readonly string[];
  usefulSummaries: readonly string[];
  noiseSummaries: readonly string[];
};

const DOMAINS: Record<DomainKey, DomainConfig> = {
  programming: {
    subject: "DevPreference",
    predicates: [
      "package_manager",
      "test_framework",
      "lint_rule",
      "commit_style",
      "error_handling",
      "logging_lib",
      "ci_platform",
      "deploy_target",
    ],
    usefulSummaries: [
      "User project uses pnpm as package manager",
      "User prefers Vitest for unit tests",
      "User enforces strict ESLint rules with no-unused-vars",
      "User follows conventional commits with scope",
      "User wraps async errors in Result types",
      "User uses pino for structured logging",
      "User runs CI on GitHub Actions",
      "User deploys to Vercel for frontend",
    ],
    noiseSummaries: [
      "User likes pineapple on pizza",
      "User's cat is named Mittens",
      "User watched a sci-fi movie last night",
      "User prefers tea over coffee",
      "User owns a blue bicycle",
    ],
  },
  travel: {
    subject: "TravelProfile",
    predicates: [
      "passport_expiry",
      "dietary_restriction",
      "seat_preference",
      "hotel_tier",
      "visa_status",
      "frequent_flyer",
    ],
    usefulSummaries: [
      "User passport expires on 2028-03-15",
      "User has severe peanut allergy",
      "User prefers aisle seat on long flights",
      "User books 4-star hotels for business travel",
      "User has valid Schengen visa until 2026",
      "User is Star Alliance Gold member",
    ],
    noiseSummaries: [
      "User enjoys rainy weather",
      "User's favorite color is green",
      "User has a vinyl record collection",
      "User practices yoga on weekends",
      "User reads two books per month",
    ],
  },
  debugging: {
    subject: "DebugContext",
    predicates: [
      "repro_steps",
      "root_cause",
      "fix_applied",
      "regression_source",
      "env_diff",
      "log_pattern",
    ],
    usefulSummaries: [
      "Bug reproduces only when NODE_ENV is production",
      "Root cause was a race in SQLite transaction retry",
      "Fix applied: added mutex around write transaction",
      "Regression introduced in commit abc1234",
      "Env diff: production has REDIS_URL, staging does not",
      "Log pattern: error appears after 30s of idle connection",
    ],
    noiseSummaries: [
      "User thinks Mondays are slow",
      "User's desk faces north",
      "User bought new headphones",
      "User likes instrumental music",
      "User drinks sparkling water",
    ],
  },
};

const DOMAIN_KEYS: readonly DomainKey[] = ["programming", "travel", "debugging"];

// Deterministic RNG (mulberry32) for reproducible corpus generation.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateLongTermCorpus(turns: number, seed = 42): LongTermCorpus {
  const rng = mulberry32(seed);
  const facts: GeneratedFact[] = [];
  const labels = new Map<string, FactLabel>();
  const writeOrder: string[] = [];
  const domainByFactId = new Map<string, DomainKey>();
  const usefulFactIds: string[] = [];
  const noiseFactIds: string[] = [];

  for (let turn = 0; turn < turns; turn += 1) {
    const domain = DOMAIN_KEYS[turn % DOMAIN_KEYS.length];
    const cfg = DOMAINS[domain];
    const taskId = `task_${domain}_t${turn}`;
    const baseTime = turn * 1000 + 100;

    // Useful fact
    const usefulPred = cfg.predicates[turn % cfg.predicates.length];
    const usefulSummary = cfg.usefulSummaries[turn % cfg.usefulSummaries.length];
    const usefulId = `fact_${domain}_useful_t${turn}`;
    const usefulFact = buildRuntimeMemoryTemporalFactFixture({
      factId: usefulId,
      taskId,
      subject: cfg.subject,
      predicate: usefulPred,
      objectSummary: usefulSummary,
      valid_at: baseTime,
      reference_time: baseTime,
      confidence: 0.85 + rng() * 0.1,
      acceptedAt: baseTime,
    });
    const usefulGenerated: GeneratedFact = {
      ...usefulFact,
      label: "useful",
      domain,
      turn,
    };
    facts.push(usefulGenerated);
    labels.set(usefulId, "useful");
    writeOrder.push(usefulId);
    domainByFactId.set(usefulId, domain);
    usefulFactIds.push(usefulId);

    // Noise fact (well-formed but semantically irrelevant)
    const noiseSummary = cfg.noiseSummaries[turn % cfg.noiseSummaries.length];
    const noiseId = `fact_${domain}_noise_t${turn}`;
    const noiseFact = buildRuntimeMemoryTemporalFactFixture({
      factId: noiseId,
      taskId,
      subject: cfg.subject,
      predicate: `noise_${turn}`,
      objectSummary: noiseSummary,
      valid_at: baseTime,
      reference_time: baseTime,
      confidence: 0.5 + rng() * 0.2,
      acceptedAt: baseTime,
    });
    const noiseGenerated: GeneratedFact = {
      ...noiseFact,
      label: "noise",
      domain,
      turn,
    };
    facts.push(noiseGenerated);
    labels.set(noiseId, "noise");
    writeOrder.push(noiseId);
    domainByFactId.set(noiseId, domain);
    noiseFactIds.push(noiseId);
  }

  return { facts, labels, writeOrder, domainByFactId, usefulFactIds, noiseFactIds };
}

// === Probe fact generators for Layer 3 (real LLM verification) ===

// Generates a fact with a unique token in objectSummary that the LLM cannot
// generate on its own. Token format: mixed case + digits + hyphens, not a
// real English word, does not match any of the 11 raw-input rejection regexes.
export function makeUniqueProbeToken(seed: number): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ";
  const rng = mulberry32(seed);
  let token = "";
  for (let i = 0; i < 7; i += 1) {
    token += chars[Math.floor(rng() * chars.length)];
  }
  return `${token}-${1000 + Math.floor(rng() * 9000)}`;
}

export type ProbeFact = {
  fact: RuntimeMemoryTemporalFact;
  token: string;
};

export function makeProbeFact(params: {
  factId: string;
  taskId: string;
  subject: string;
  predicate: string;
  token: string;
  valid_at?: number;
  reference_time?: number;
  confidence?: number;
  invalid_at?: number;
}): ProbeFact {
  const { token, factId, taskId, subject, predicate, ...rest } = params;
  const fact = buildRuntimeMemoryTemporalFactFixture({
    factId,
    taskId,
    subject,
    predicate,
    objectSummary: `User preference code is ${token}`,
    valid_at: rest.valid_at ?? 100,
    reference_time: rest.reference_time ?? 100,
    confidence: rest.confidence ?? 0.95,
    acceptedAt: rest.valid_at ?? 100,
    ...(rest.invalid_at !== undefined ? { invalid_at: rest.invalid_at } : {}),
  });
  return { fact, token };
}

// Build a probe fact set: N facts each with a distinct unique token.
export function makeProbeFactSet(params: {
  count: number;
  taskId: string;
  subject: string;
  basePredicate: string;
  seed?: number;
}): ProbeFact[] {
  const { count, taskId, subject, basePredicate, seed = 42 } = params;
  const result: ProbeFact[] = [];
  for (let i = 0; i < count; i += 1) {
    const token = makeUniqueProbeToken(seed + i * 17);
    result.push(
      makeProbeFact({
        factId: `probe_${i}`,
        taskId,
        subject,
        predicate: `${basePredicate}_${i}`,
        token,
        valid_at: 100,
        reference_time: 100,
        confidence: 0.9,
      }),
    );
  }
  return result;
}

// === Holdout domain for Layer 5 (adversarial) ===

export const HOLDOUT_DOMAIN: DomainConfig = {
  subject: "HealthProfile",
  predicates: ["blood_type", "allergy", "medication", "exercise_routine"],
  usefulSummaries: [
    "User blood type is O positive",
    "User is allergic to penicillin",
    "User takes daily vitamin D supplement",
    "User runs 5km three times per week",
  ],
  noiseSummaries: [
    "User prefers winter over summer",
    "User owns a cactus plant",
  ],
};

export function makeHoldoutProbeFact(token: string): ProbeFact {
  return makeProbeFact({
    factId: "holdout_probe_1",
    taskId: "task_health_holdout",
    subject: HOLDOUT_DOMAIN.subject,
    predicate: "medication",
    token,
    valid_at: 100,
    reference_time: 100,
    confidence: 0.92,
  });
}

// === Ablation query set for Layer 5 (real-variance Cohen's d) ===

export type AblationQuery = {
  queryId: string;
  taskId: string;
  subject: string;
  predicate: string;
  referenceTime: number;
  expectedToken: string;
  userQuestion: string;
};

export function makeAblationQuerySet(count: number, seed = 42): {
  queries: AblationQuery[];
  baselineFacts: RuntimeMemoryTemporalFact[];
  treatmentFacts: RuntimeMemoryTemporalFact[];
} {
  const rng = mulberry32(seed);
  const queries: AblationQuery[] = [];
  const baselineFacts: RuntimeMemoryTemporalFact[] = [];
  const treatmentFacts: RuntimeMemoryTemporalFact[] = [];

  for (let i = 0; i < count; i += 1) {
    const token = makeUniqueProbeToken(seed + i * 31 + 7);
    const taskId = `task_ablation_${i}`;
    const subject = "AblationSubject";
    const predicate = `probe_${i}`;
    const factId = `ablation_${i}`;

    // Baseline arm: empty (no fact for this query)
    // Treatment arm: fact with the unique token
    const treatmentFact = buildRuntimeMemoryTemporalFactFixture({
      factId,
      taskId,
      subject,
      predicate,
      objectSummary: `User preference code is ${token}`,
      valid_at: 100,
      reference_time: 100,
      confidence: 0.88 + rng() * 0.08,
      acceptedAt: 100,
    });
    treatmentFacts.push(treatmentFact);

    queries.push({
      queryId: `q_ablation_${i}`,
      taskId,
      subject,
      predicate,
      referenceTime: 1000,
      expectedToken: token,
      userQuestion: "What is the user's preference code? Answer with the code only.",
    });
  }

  return { queries, baselineFacts, treatmentFacts };
}
