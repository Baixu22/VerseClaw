// P1-3: Topic/SubTopic Schema (Memobase-inspired 8-topic taxonomy).
//
// Source: memobase-main/memobase/profile/schema.py
//         memobase-main/memobase/buffer/llm_classifier.py
//
// Memobase classifies every memory into one of 8 high-level topics, each
// with a sub_topic for finer granularity. This enables:
// 1. Topic-filtered retrieval (only scan facts matching the query's topic)
// 2. Budget allocation per topic (avoid one topic dominating results)
// 3. Profile aggregation (group facts by topic for user profile views)
//
// The 8 topics (Memobase `TopicType`):
//   - basic_info:       demographic background (name, age, gender, occupation)
//   - occupation:       work, career, professional skills
//   - education:        schooling, courses, certifications
//   - family:           family members, relationships, pets
//   - preferences:      likes, dislikes, hobbies, tastes
//   - health:           physical/mental health, diet, exercise
//   - lifestyle:        daily routines, habits, living situation
//   - plans:            goals, plans, upcoming events, aspirations
//
// Each fact gets `topic` and `subTopic` fields. When the extraction LLM
// doesn't emit a topic, `inferTopicFromPredicate` provides a heuristic
// fallback based on keyword matching against the predicate.

export const MEMORY_TOPIC_TYPES = [
  "basic_info",
  "occupation",
  "education",
  "family",
  "preferences",
  "health",
  "lifestyle",
  "plans",
  "other",
] as const;

export type MemoryTopicType = (typeof MEMORY_TOPIC_TYPES)[number];

export type TopicSubTopic = {
  topic: MemoryTopicType;
  subTopic: string;
};

/**
 * Predicate → topic keyword map. Used by `inferTopicFromPredicate` as a
 * heuristic fallback when the LLM doesn't emit a topic.
 *
 * Memobase's LLM classifier uses a similar keyword-based approach as a
 * first pass before LLM confirmation. We keep the heuristic path so
 * cached/legacy facts without topic fields can still be classified.
 */
const TOPIC_KEYWORDS: Record<MemoryTopicType, readonly string[]> = {
  basic_info: [
    "name",
    "age",
    "gender",
    "birthday",
    "born",
    "nationality",
    "hometown",
    "live_in",
    "live",
    "based_in",
    "occupation_is",
    "is_a",
    "is_an",
  ],
  occupation: [
    "work",
    "works",
    "working",
    "worked",
    "job",
    "jobs",
    "career",
    "occupation",
    "company",
    "employer",
    "colleague",
    "boss",
    "salary",
    "promotion",
    "fired",
    "quit",
    "started_job",
    "started_work",
    "project",
    "skill",
    "expertise",
    "profession",
  ],
  education: [
    "school",
    "university",
    "college",
    "study",
    "studied",
    "major",
    "degree",
    "course",
    "certification",
    "graduated",
    "enrolled",
    "student",
    "teacher",
    "exam",
    "thesis",
  ],
  family: [
    "family",
    "father",
    "mother",
    "parent",
    "sister",
    "brother",
    "sibling",
    "son",
    "daughter",
    "child",
    "husband",
    "wife",
    "spouse",
    "married",
    "divorced",
    "pet",
    "dog",
    "cat",
    "cousin",
    "aunt",
    "uncle",
    "grandparent",
    "grandfather",
    "grandmother",
  ],
  preferences: [
    "like",
    "likes",
    "love",
    "loves",
    "hate",
    "hates",
    "prefer",
    "prefers",
    "favorite",
    "favourite",
    "enjoy",
    "enjoys",
    "hobby",
    "hobbies",
    "interest",
    "interested_in",
    "taste",
    "tastes",
    "fan_of",
    "dislike",
    "dislikes",
  ],
  health: [
    "health",
    "sick",
    "ill",
    "illness",
    "disease",
    "condition",
    "allergy",
    "allergic",
    "medication",
    "medicine",
    "doctor",
    "hospital",
    "surgery",
    "injury",
    "mental",
    "anxiety",
    "depression",
    "therapy",
    "exercise",
    "workout",
    "gym",
    "run",
    "running",
    "yoga",
    "diet",
    "vegan",
    "vegetarian",
    "weight",
  ],
  lifestyle: [
    "live",
    "lives",
    "lived",
    "living",
    "apartment",
    "house",
    "home",
    "move",
    "moved",
    "commute",
    "car",
    "bike",
    "transport",
    "routine",
    "habit",
    "wake_up",
    "sleep",
    "morning",
    "evening",
    "weekend",
    "vacation",
    "travel",
    "trip",
    "hiking",
    "cook",
    "cooking",
    "restaurant",
    "coffee",
    "tea",
    "alcohol",
    "drink",
  ],
  plans: [
    "plan",
    "plans",
    "planned",
    "planning",
    "goal",
    "aim",
    "aspire",
    "aspiration",
    "dream",
    "want",
    "wants",
    "will",
    "going_to",
    "upcoming",
    "future",
    "next",
    "schedule",
    "appointment",
    "deadline",
    "wedding",
    "moving",
    "retire",
    "retirement",
  ],
  other: [],
};

/**
 * Infer a topic from a fact's predicate and objectSummary using keyword
 * matching. Returns "other" when no keyword matches.
 *
 * This is a deterministic fallback — the extraction LLM should emit the
 * topic directly when possible (higher accuracy). But this ensures every
 * fact has a topic field even when the LLM omits it.
 */
export function inferTopicFromPredicate(
  predicate: string,
  objectSummary: string = "",
): MemoryTopicType {
  // Replace underscores with spaces so \b word boundaries work correctly
  // with snake_case predicates. In JavaScript regex, "_" is a word character,
  // so \bmarried\b does NOT match "married_to" (no boundary between 'd' and '_').
  // Normalizing both text and keywords to space-separated form fixes this.
  const text = `${predicate} ${objectSummary}`.toLowerCase().replace(/_/g, " ");

  // Check each topic's keywords. The first match wins, but we check
  // more specific topics (family, health, plans) before general ones
  // (basic_info, lifestyle) to avoid false positives.
  const order: MemoryTopicType[] = [
    "family",
    "health",
    "education",
    "occupation",
    "plans",
    "preferences",
    "lifestyle",
    "basic_info",
  ];

  for (const topic of order) {
    const keywords = TOPIC_KEYWORDS[topic];
    for (const kw of keywords) {
      // Normalize keyword: replace underscores with spaces to match the
      // normalized text. Then match as whole words via \b boundaries.
      const kwNormalized = kw.replace(/_/g, " ");
      const re = new RegExp(`\\b${escapeRegex(kwNormalized)}\\b`, "i");
      if (re.test(text)) {
        return topic;
      }
    }
  }

  return "other";
}

/**
 * Infer a sub_topic from a fact's predicate. The sub_topic is a finer
 * granularity label within a topic (e.g., under "family" → "pet", "parent").
 *
 * Currently returns the predicate itself (stripped of topic prefixes) as
 * the sub_topic. This is intentionally simple — the LLM should emit a
 * proper sub_topic when accuracy matters. The heuristic ensures every
 * fact has a non-empty sub_topic for grouping.
 */
export function inferSubTopic(
  topic: MemoryTopicType,
  predicate: string,
): string {
  if (!predicate) return topic;
  // Strip common verb prefixes to get the core concept.
  const cleaned = predicate
    .replace(
      /^(is_|has_|have_|had_|did_|do_|does_|was_|were_|likes_|loves_|hates_|dislikes_|wants_|needs_|plans_|started_|graduated_|enrolled_)/,
      "",
    )
    .replace(/_/g, " ");
  return cleaned.length > 0 ? cleaned : topic;
}

/**
 * Classify a fact into { topic, subTopic }.
 * Uses the LLM-provided topic when available, falls back to heuristic.
 */
export function classifyFactTopic(
  predicate: string,
  objectSummary: string,
  llmTopic?: string,
  llmSubTopic?: string,
): TopicSubTopic {
  let topic: MemoryTopicType;
  if (llmTopic && isMemoryTopicType(llmTopic)) {
    topic = llmTopic;
  } else {
    topic = inferTopicFromPredicate(predicate, objectSummary);
  }
  const subTopic =
    llmSubTopic && llmSubTopic.trim().length > 0
      ? llmSubTopic.trim()
      : inferSubTopic(topic, predicate);
  return { topic, subTopic };
}

export function isMemoryTopicType(value: unknown): value is MemoryTopicType {
  return (
    typeof value === "string" &&
    (MEMORY_TOPIC_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Group facts by topic. Returns a Map<topic, factId[]> for budget allocation
 * and topic-filtered retrieval.
 */
export function groupFactsByTopic<T extends { topic?: MemoryTopicType }>(
  facts: readonly (T & { factId: string })[],
): Map<MemoryTopicType, string[]> {
  const groups = new Map<MemoryTopicType, string[]>();
  for (const topic of MEMORY_TOPIC_TYPES) {
    groups.set(topic, []);
  }
  for (const f of facts) {
    const topic = f.topic ?? "other";
    groups.get(topic)!.push(f.factId);
  }
  return groups;
}

/**
 * Budget allocation per topic. Memobase allocates retrieval budget
 * proportionally but with a cap per topic to avoid domination.
 *
 * Default: max 40% of budget from any single topic, remainder distributed
 * by count. This ensures diverse coverage across topics.
 */
export function allocateTopicBudget(
  factCountsByTopic: Map<MemoryTopicType, number>,
  totalBudget: number,
  options: { maxPerTopicRatio?: number } = {},
): Map<MemoryTopicType, number> {
  const maxRatio = options.maxPerTopicRatio ?? 0.4;
  const maxPerTopic = Math.max(1, Math.floor(totalBudget * maxRatio));

  const total = [...factCountsByTopic.values()].reduce((a, b) => a + b, 0);
  if (total === 0) {
    return new Map();
  }

  // First pass: proportional allocation.
  const allocation = new Map<MemoryTopicType, number>();
  let allocated = 0;
  for (const [topic, count] of factCountsByTopic) {
    const proportional = Math.min(
      maxPerTopic,
      Math.ceil((count / total) * totalBudget),
    );
    allocation.set(topic, proportional);
    allocated += proportional;
  }

  // Second pass: distribute remaining budget to topics with available facts,
  // respecting the cap.
  let remaining = totalBudget - allocated;
  while (remaining > 0) {
    let added = false;
    for (const [topic, count] of factCountsByTopic) {
      if (remaining <= 0) break;
      const current = allocation.get(topic) ?? 0;
      if (current >= count || current >= maxPerTopic) continue;
      allocation.set(topic, current + 1);
      remaining--;
      added = true;
    }
    if (!added) break;
  }

  return allocation;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
