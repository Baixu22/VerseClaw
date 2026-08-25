/**
 * T-C1: single source of truth for the required compaction summary sections.
 *
 * These five headings are load-bearing in three separate places, and before this
 * module they were hardcoded twice:
 *   1. `compaction-safeguard-quality.ts` asks the model to produce them and
 *      audits whether it did.
 *   2. `compaction-damage-rules.ts` scores structural fidelity from how many
 *      survived a compaction.
 *   3. The damage rules' goal-decay check must deliberately *exclude* these
 *      headings, because a heading is not evidence that the goal survived —
 *      see `stripRequiredSectionHeadings`.
 *
 * Two copies that must agree is exactly the defect class §R1 A3 catalogues: the
 * copies drift, and the drift is silent because each side's tests only see its
 * own copy. Kept dependency-free so both consumers can import it without
 * pulling anything transitively.
 */

/**
 * Required compaction summary sections, in prompt order.
 *
 * Changing this list changes both what the model is asked to emit and what the
 * damage rules consider structurally intact — update deliberately.
 */
export const REQUIRED_COMPACTION_SECTIONS = [
  "## Decisions",
  "## Open TODOs",
  "## Constraints/Rules",
  "## Pending user asks",
  "## Exact identifiers",
] as const;

export type RequiredCompactionSection = (typeof REQUIRED_COMPACTION_SECTIONS)[number];

/**
 * Removes the required section headings from `text`, leaving their content.
 *
 * Why this exists: the goal-decay detector looks for goal anchors at line or
 * heading position, and two of its anchor words (`DECISIONS?`, `CONSTRAINTS?`)
 * are also required section headings. That made the detector unfireable — a
 * summary hollowed out to nothing but the five headings and the word "None."
 * still matched `## Decisions` and was scored as goal-intact. Stripping the
 * headings first makes goal survival depend on the summary's *content*.
 *
 * Each heading is replaced with a newline so line-anchored patterns still see
 * correct line boundaries in the remaining prose.
 */
export function stripRequiredSectionHeadings(text: string): string {
  let out = text;
  for (const section of REQUIRED_COMPACTION_SECTIONS) {
    out = out.split(section).join("\n");
  }
  return out;
}

/**
 * Section bodies that mean "nothing survived here". Models reliably emit one of
 * these when a required section has no content, so an empty section is not the
 * only shape of emptiness.
 */
const PLACEHOLDER_BODIES = new Set([
  "",
  "-",
  "—",
  "n/a",
  "na",
  "none",
  "none.",
  "nothing",
  "nothing.",
  "无",
  "无。",
  "（无）",
  "(无)",
  "暂无",
  "暂无。",
]);

/**
 * The body text under each required section heading, keyed by heading.
 *
 * A body runs from its heading to the next required heading (or end of text).
 * Sections absent from `text` are absent from the map — distinguishing "section
 * missing" (structure damage) from "section present but empty" (content damage).
 */
export function extractRequiredSectionBodies(text: string): Map<string, string> {
  const bodies = new Map<string, string>();
  const positions: Array<{ section: string; start: number }> = [];
  for (const section of REQUIRED_COMPACTION_SECTIONS) {
    const index = text.indexOf(section);
    if (index >= 0) positions.push({ section, start: index });
  }
  positions.sort((left, right) => left.start - right.start);
  for (const [i, entry] of positions.entries()) {
    const bodyStart = entry.start + entry.section.length;
    const bodyEnd = i + 1 < positions.length ? positions[i + 1].start : text.length;
    bodies.set(entry.section, text.slice(bodyStart, bodyEnd).trim());
  }
  return bodies;
}

/**
 * True when at least one required section carries real content.
 *
 * This is the content-level test that replaces "does a goal-ish heading exist".
 * A heading proves only that the model followed the template; the body is what
 * proves information survived. `## Decisions\nNone.` is a template followed and
 * a goal lost, and those must not score the same.
 */
export function hasSubstantiveSectionContent(text: string): boolean {
  for (const body of extractRequiredSectionBodies(text).values()) {
    if (!PLACEHOLDER_BODIES.has(body.toLowerCase())) return true;
  }
  return false;
}
