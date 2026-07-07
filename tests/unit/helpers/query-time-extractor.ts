// P2-2: Query time constraint extractor.
//
// Extracts temporal constraints from a question text. The extracted
// `referenceTime` replaces the conversation-level referenceTime (max valid_at)
// for queries that explicitly mention a time — this is the core of the "time
// as an independent retrieval path" idea (P2).
//
// Three modes:
//   - "absolute": question mentions an explicit date ("on 15 March 2023")
//                 → referenceTime = parsed date
//   - "relative": question uses relative terms ("five years ago", "recently")
//                 → referenceTime = anchorTime adjusted by the relative offset
//                   (caller must pass anchorTime for relative resolution)
//   - "unknown":  no temporal constraint detected → caller falls back to
//                 conversation-level referenceTime
//
// The extractor is purely lexical (regex + keyword map) — no LLM call. This
// keeps P2 zero-cost per query.

const MONTH_MAP: Record<string, number> = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sep: 8, sept: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11,
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;
const MS_PER_MONTH_AVG = 30 * MS_PER_DAY;
const MS_PER_YEAR = 365 * MS_PER_DAY;

export type QueryTimeConstraint = {
  /** Parsed reference time in epoch ms. Undefined when mode === "unknown". */
  referenceTime?: number;
  mode: "absolute" | "relative" | "unknown";
  /** The matched substring that triggered the constraint, for debugging. */
  matchedPhrase?: string;
};

/**
 * Extract a temporal constraint from a question.
 *
 * @param question   The user's question text.
 * @param anchorTime  Reference point for relative expressions (e.g. the
 *                    conversation's max valid_at). Required to resolve
 *                    "five years ago"; without it, relative matches return
 *                    mode="relative" with referenceTime=undefined.
 */
export function extractQueryTimeConstraint(
  question: string,
  anchorTime?: number,
): QueryTimeConstraint {
  if (!question || typeof question !== "string") {
    return { mode: "unknown" };
  }

  // === Absolute date extraction ===
  // Matches: "on 15 March 2023", "in March 2023", "in 2023", "before 2023",
  //          "after 15 March 2023", "since 2023", "at 8 May, 2023"
  // Does NOT match bare month names ("in March" without year) — too ambiguous.
  // Note: regex written on one line because esbuild does not support comments
  // inside regex literals spanning multiple lines.
  const absDateMatch = question.match(
    /(?:on|at|before|after|since|in)\s+(?:(\d{1,2})\s+)?([A-Za-z]+)?,?\s*(\d{4})\b/i,
  );
  if (absDateMatch) {
    const [, dayStr, monthStr, yearStr] = absDateMatch;
    const year = parseInt(yearStr, 10);
    const monthName = (monthStr ?? "").toLowerCase();
    const month = monthName ? MONTH_MAP[monthName] : undefined;
    const day = dayStr ? parseInt(dayStr, 10) : 1;

    if (monthName && MONTH_MAP[monthName] === undefined) {
      // Month name not recognized — fall through to other extractors
    } else {
      const refTime = Date.UTC(year, month ?? 0, day, 0, 0, 0);
      if (!Number.isNaN(refTime)) {
        return {
          referenceTime: refTime,
          mode: "absolute",
          matchedPhrase: absDateMatch[0].trim(),
        };
      }
    }
  }

  // Year-only absolute match: "in 2023", "before 2023", "since 2018"
  // (Already covered by absDateMatch when no month is given, but be defensive
  // — this catches bare "2023" without a preposition.)
  const bareYearMatch = question.match(/\b(19|20)\d{2}\b/);
  if (bareYearMatch && !absDateMatch) {
    const year = parseInt(bareYearMatch[0], 10);
    const refTime = Date.UTC(year, 0, 1, 0, 0, 0);
    return {
      referenceTime: refTime,
      mode: "absolute",
      matchedPhrase: bareYearMatch[0],
    };
  }

  // === Relative time extraction ===
  // Pattern: "<number> years ago", "<number> months ago", "<number> weeks ago",
  //          "<number> days ago"
  const relNumAgoMatch = question.match(
    /(\d+)\s+(year|month|week|day)s?\s+ago/i,
  );
  if (relNumAgoMatch) {
    const n = parseInt(relNumAgoMatch[1], 10);
    const unit = relNumAgoMatch[2].toLowerCase();
    if (anchorTime !== undefined) {
      let ms = 0;
      if (unit === "year") ms = n * MS_PER_YEAR;
      else if (unit === "month") ms = n * MS_PER_MONTH_AVG;
      else if (unit === "week") ms = n * MS_PER_WEEK;
      else if (unit === "day") ms = n * MS_PER_DAY;
      return {
        referenceTime: anchorTime - ms,
        mode: "relative",
        matchedPhrase: relNumAgoMatch[0].trim(),
      };
    }
    // No anchor — can't resolve, but signal that a relative constraint exists.
    return {
      mode: "relative",
      matchedPhrase: relNumAgoMatch[0].trim(),
    };
  }

  // Word-form relative: "five years ago", "two months ago"
  const wordNums: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
    eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  };
  const wordAgoMatch = question.match(
    /(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(year|month|week|day)s?\s+ago/i,
  );
  if (wordAgoMatch) {
    const n = wordNums[wordAgoMatch[1].toLowerCase()];
    const unit = wordAgoMatch[2].toLowerCase();
    if (anchorTime !== undefined) {
      let ms = 0;
      if (unit === "year") ms = n * MS_PER_YEAR;
      else if (unit === "month") ms = n * MS_PER_MONTH_AVG;
      else if (unit === "week") ms = n * MS_PER_WEEK;
      else if (unit === "day") ms = n * MS_PER_DAY;
      return {
        referenceTime: anchorTime - ms,
        mode: "relative",
        matchedPhrase: wordAgoMatch[0].trim(),
      };
    }
    return {
      mode: "relative",
      matchedPhrase: wordAgoMatch[0].trim(),
    };
  }

  // "last month", "last week", "last year"
  const lastUnitMatch = question.match(/last\s+(year|month|week)/i);
  if (lastUnitMatch) {
    if (anchorTime !== undefined) {
      const unit = lastUnitMatch[1].toLowerCase();
      let ms = 0;
      if (unit === "year") ms = MS_PER_YEAR;
      else if (unit === "month") ms = MS_PER_MONTH_AVG;
      else if (unit === "week") ms = MS_PER_WEEK;
      return {
        referenceTime: anchorTime - ms,
        mode: "relative",
        matchedPhrase: lastUnitMatch[0].trim(),
      };
    }
    return { mode: "relative", matchedPhrase: lastUnitMatch[0].trim() };
  }

  // "recently", "currently", "now", "these days", "nowadays"
  const presentMatch = question.match(
    /\b(recently|currently|now|these days|nowadays|lately|just now)\b/i,
  );
  if (presentMatch) {
    // Present-tense queries want the most recent state — use anchorTime
    // as referenceTime so we see all facts up to "now".
    return {
      referenceTime: anchorTime,
      mode: "relative",
      matchedPhrase: presentMatch[0].trim(),
    };
  }

  return { mode: "unknown" };
}
