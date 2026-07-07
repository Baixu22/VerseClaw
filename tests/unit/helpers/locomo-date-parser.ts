// Parser for LoCoMo session date strings.
// Format: "1:56 pm on 8 May, 2023" or "10:37 am on 27 June, 2023"
// Returns epoch milliseconds in UTC.

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

/**
 * Parse a LoCoMo date-time string like "1:56 pm on 8 May, 2023" to epoch ms.
 * Returns undefined if parsing fails.
 */
export function parseLocomoDateTime(str: string): number | undefined {
  if (!str || typeof str !== "string") return undefined;

  // Match: "H:MM am/pm on D MonthName, YYYY"
  const match = str.match(
    /(\d{1,2}):(\d{2})\s*(am|pm)\s+on\s+(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})/i,
  );
  if (!match) return undefined;

  const [, hourStr, minStr, ampm, dayStr, monthStr, yearStr] = match;
  let hour = parseInt(hourStr, 10);
  const minute = parseInt(minStr, 10);
  const day = parseInt(dayStr, 10);
  const monthName = monthStr.toLowerCase();
  const year = parseInt(yearStr, 10);

  const month = MONTH_MAP[monthName];
  if (month === undefined) return undefined;

  // Convert to 24-hour
  if (ampm.toLowerCase() === "pm" && hour < 12) hour += 12;
  if (ampm.toLowerCase() === "am" && hour === 12) hour = 0;

  // Use UTC to avoid timezone issues in tests
  return Date.UTC(year, month, day, hour, minute, 0);
}

/**
 * Extract session dates from a LoCoMo conversation object.
 * Returns a map of sessionKey → epoch ms, sorted by session number.
 */
export function extractSessionDates(
  conversation: Record<string, unknown>,
): Array<{ sessionKey: string; sessionIndex: number; date: number }> {
  const result: Array<{ sessionKey: string; sessionIndex: number; date: number }> = [];
  for (const key of Object.keys(conversation)) {
    const match = key.match(/^session_(\d+)_date_time$/);
    if (!match) continue;
    const sessionIndex = parseInt(match[1], 10);
    const dateStr = conversation[key] as string;
    const date = parseLocomoDateTime(dateStr);
    if (date !== undefined) {
      result.push({ sessionKey: key, sessionIndex, date });
    }
  }
  result.sort((a, b) => a.sessionIndex - b.sessionIndex);
  return result;
}

/**
 * Map a turn's dia_id (e.g. "D1:3") to a session index.
 * D1 = session 1, D2 = session 2, etc.
 */
export function diaIdToSessionIndex(diaId: string): number | undefined {
  const match = diaId.match(/^D(\d+):/);
  if (!match) return undefined;
  return parseInt(match[1], 10);
}

/**
 * Get the session date for a turn based on its dia_id.
 * Returns the epoch ms for the session, or undefined if not found.
 */
export function getSessionDateForTurn(
  diaId: string,
  sessionDates: Array<{ sessionIndex: number; date: number }>,
): number | undefined {
  const sessionIndex = diaIdToSessionIndex(diaId);
  if (sessionIndex === undefined) return undefined;
  const entry = sessionDates.find((s) => s.sessionIndex === sessionIndex);
  return entry?.date;
}
