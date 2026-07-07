// Structured UserProfile layer for open-domain question answering.
// Aggregates flat facts into dimension-based profile for O(1) lookup.
// Inspired by Memobase's profile approach — open-domain questions can be
// answered from structured dimensions without exhaustive retrieval.

import type { RuntimeMemoryQueryableFact } from "./memory-context.js";

export type ProfileDimensionCategory =
  | "occupation"
  | "preferences"
  | "relationships"
  | "locations"
  | "timeline";

export type ProfileDimension = {
  category: ProfileDimensionCategory;
  subject: string;
  value: string;
  valid_at?: number;
  sourceFactIds: string[];
};

export type UserProfile = {
  userId: string;
  lastUpdated: number;
  dimensions: {
    occupation: ProfileDimension[];
    preferences: ProfileDimension[];
    relationships: ProfileDimension[];
    locations: ProfileDimension[];
    timeline: ProfileDimension[];
  };
};

const OCCUPATION_PATTERNS: readonly RegExp[] = [
  /\b(?:job|work|works|working|career|profession|employment|employed)\b/i,
  /\b(?:engineer|teacher|nurse|doctor|lawyer|student|manager|developer|programmer|designer|accountant|consultant|architect|artist|writer|chef|driver|pilot|scientist|researcher|analyst|therapist|pharmacist|dentist|veterinarian|electrician|plumber|mechanic|photographer|journalist|reporter|editor|producer|director|actor|singer|musician|dancer|athlete|coach|trainer|librarian|curator|historian|philosopher|linguist|translator|interpreter)\b/i,
  /\b(?:studies|studying|studied|major|degree|university|college|school|enrolled|graduated|graduation)\b/i,
];

const PREFERENCES_PATTERNS: readonly RegExp[] = [
  /\b(?:likes|liked|likes|prefers|preferred|enjoys|enjoyed|loves|loved|adores|favorite|favourite)\b/i,
  /\b(?:hobby|hobbies|interest|interests|interested|passion|passionate|fan|enthusiast)\b/i,
  /\b(?:listens to|reads|watches|plays|collects|paints|draws|cooks|bakes|gardens|knits|sews)\b/i,
];

const RELATIONSHIPS_PATTERNS: readonly RegExp[] = [
  /\b(?:married|wife|husband|spouse|partner|boyfriend|girlfriend|fiance|fiancee|divorced|engaged)\b/i,
  /\b(?:mother|father|mom|dad|parent|parents|sister|brother|sibling|daughter|son|child|children|kids?|family)\b/i,
  /\b(?:friend|friends|friendship|colleague|coworker|classmate|roommate|neighbor|neighbour|acquaintance)\b/i,
  /\b(?:aunt|uncle|cousin|niece|nephew|grandmother|grandfather|grandparent|grandchild|grandkid|in-law|stepmother|stepfather|stepson|stepdaughter)\b/i,
];

const LOCATIONS_PATTERNS: readonly RegExp[] = [
  /\b(?:lives? in|lives? at|resides? in|resides? at|based in|located in|stays? in)\b/i,
  /\b(?:from|grew up in|born in|raised in|hometown|home town)\b/i,
  /\b(?:moved to|relocated to|moved from|returned to|immigrated to|emigrated from)\b/i,
  /\b(?:city|country|state|town|village|neighborhood|neighbourhood|street|avenue|road|district|region|province|county)\b/i,
];

// Question-to-dimension matching patterns
const QUESTION_OCCUPATION_PATTERNS: readonly RegExp[] = [
  /\b(?:job|work|career|profession|occupation|employed|employment)\b/i,
  /\b(?:what does .* do|what is .* job|what is .* profession)\b/i,
  /\b(?:studies|studying|major|degree|university|college|school)\b/i,
];

const QUESTION_PREFERENCES_PATTERNS: readonly RegExp[] = [
  /\b(?:like|likes|liked|prefer|prefers|preferred|enjoy|enjoys|love|loves|hobby|hobbies|interest|interests|interested|passion|favorite|favourite)\b/i,
  /\b(?:what does .* do for fun|what are .* interests|what does .* enjoy)\b/i,
];

const QUESTION_RELATIONSHIPS_PATTERNS: readonly RegExp[] = [
  /\b(?:married|wife|husband|spouse|partner|boyfriend|girlfriend|relationship|relationships|family|relative|relatives)\b/i,
  /\b(?:mother|father|mom|dad|parent|parents|sister|brother|sibling|daughter|son|child|children|kids?)\b/i,
  /\b(?:friend|friends|colleague|coworker|classmate|roommate)\b/i,
  /\b(?:who is .* (?:wife|husband|partner|mother|father|sister|brother|friend))\b/i,
];

const QUESTION_LOCATIONS_PATTERNS: readonly RegExp[] = [
  /\b(?:live|lives|living|reside|resides|from|hometown|home town|located|location)\b/i,
  /\b(?:city|country|state|town|address|area|neighborhood|neighbourhood)\b/i,
  /\b(?:where does .* live|where is .* from|where does .* work)\b/i,
];

const QUESTION_TIMELINE_PATTERNS: readonly RegExp[] = [
  /\b(?:when|what year|what time|timeline|history|chronology|chronological|sequence of events)\b/i,
  /\b(?:how long|how many years|since when|what happened)\b/i,
  /\b(?:first|last|before|after|during|between|ago|recently|previously)\b/i,
];

function matchesAnyPattern(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

function buildDimension(
  fact: RuntimeMemoryQueryableFact,
  category: ProfileDimensionCategory,
): ProfileDimension {
  return {
    category,
    subject: fact.subject,
    value: fact.objectSummary,
    valid_at: fact.valid_at,
    sourceFactIds: [fact.factId],
  };
}

function deduplicateDimensions(
  dims: ProfileDimension[],
): ProfileDimension[] {
  const seen = new Set<string>();
  const result: ProfileDimension[] = [];
  for (const dim of dims) {
    const key = `${dim.category}|${dim.value.toLowerCase().trim()}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(dim);
    }
  }
  return result;
}

export function buildUserProfile(
  facts: readonly RuntimeMemoryQueryableFact[],
  userId: string,
): UserProfile {
  const occupation: ProfileDimension[] = [];
  const preferences: ProfileDimension[] = [];
  const relationships: ProfileDimension[] = [];
  const locations: ProfileDimension[] = [];
  const timeline: ProfileDimension[] = [];

  for (const fact of facts) {
    const text = `${fact.subject} ${fact.predicate} ${fact.objectSummary}`;

    if (matchesAnyPattern(text, OCCUPATION_PATTERNS)) {
      occupation.push(buildDimension(fact, "occupation"));
    }
    if (matchesAnyPattern(text, PREFERENCES_PATTERNS)) {
      preferences.push(buildDimension(fact, "preferences"));
    }
    if (matchesAnyPattern(text, RELATIONSHIPS_PATTERNS)) {
      relationships.push(buildDimension(fact, "relationships"));
    }
    if (matchesAnyPattern(text, LOCATIONS_PATTERNS)) {
      locations.push(buildDimension(fact, "locations"));
    }
    // Timeline: include facts with valid_at, sorted chronologically
    if (fact.valid_at !== undefined) {
      timeline.push(buildDimension(fact, "timeline"));
    }
  }

  // Sort timeline chronologically (oldest first)
  timeline.sort((a, b) => (a.valid_at ?? 0) - (b.valid_at ?? 0));

  return {
    userId,
    lastUpdated: Date.now(),
    dimensions: {
      occupation: deduplicateDimensions(occupation),
      preferences: deduplicateDimensions(preferences),
      relationships: deduplicateDimensions(relationships),
      locations: deduplicateDimensions(locations),
      timeline: deduplicateDimensions(timeline),
    },
  };
}

export function selectProfileDimensions(
  question: string,
  profile: UserProfile,
): ProfileDimension[] {
  const result: ProfileDimension[] = [];
  const dims = profile.dimensions;

  if (matchesAnyPattern(question, QUESTION_OCCUPATION_PATTERNS)) {
    result.push(...dims.occupation);
  }
  if (matchesAnyPattern(question, QUESTION_PREFERENCES_PATTERNS)) {
    result.push(...dims.preferences);
  }
  if (matchesAnyPattern(question, QUESTION_RELATIONSHIPS_PATTERNS)) {
    result.push(...dims.relationships);
  }
  if (matchesAnyPattern(question, QUESTION_LOCATIONS_PATTERNS)) {
    result.push(...dims.locations);
  }
  if (matchesAnyPattern(question, QUESTION_TIMELINE_PATTERNS)) {
    // For timeline, return the most recent N entries to avoid flooding context
    result.push(...dims.timeline.slice(-10));
  }

  // If no specific dimension matched, return a broad summary (top entries from each)
  if (result.length === 0) {
    const summarySize = 3;
    result.push(...dims.occupation.slice(0, summarySize));
    result.push(...dims.preferences.slice(0, summarySize));
    result.push(...dims.relationships.slice(0, summarySize));
    result.push(...dims.locations.slice(0, summarySize));
  }

  return result;
}
