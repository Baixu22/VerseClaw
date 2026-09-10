/**
 * TF-0124: ClawX quality/damage helpers consume agent-core's canonical
 * compaction section contract. The required-heading array is defined once in
 * agent-core, where the model prompt is generated, and re-exported here to keep
 * the existing runtime API stable.
 */
export {
  REQUIRED_COMPACTION_SECTIONS,
  renderCompactionSummaryShape,
  type RequiredCompactionSection,
} from "../../../packages/agent-core/src/harness/compaction/summary-contract.js";
import { REQUIRED_COMPACTION_SECTIONS } from "../../../packages/agent-core/src/harness/compaction/summary-contract.js";

/**
 * Removes the required section headings from `text`, leaving their content.
 *
 * Why this exists: the goal-decay detector looks for goal anchors at line or
 * heading position, and two of its anchor words (`DECISIONS?`, `CONSTRAINTS?`)
 * are also required section headings. That made the detector unfireable — a
 * summary hollowed out to nothing but the required headings and the word "None."
 * still matched `## Decisions` and was scored as goal-intact. Stripping the
 * headings first makes goal survival depend on the summary's *content*.
 *
 * Each heading is replaced with a newline so line-anchored patterns still see
 * correct line boundaries in the remaining prose.
 */
export function stripRequiredSectionHeadings(text: string): string {
  const required = new Set<string>(REQUIRED_COMPACTION_SECTIONS);
  return text
    .split(/\r?\n/u)
    .map((line) => (required.has(line.trim()) ? "" : line))
    .join("\n");
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
  const required = new Set<string>(REQUIRED_COMPACTION_SECTIONS);
  let current: string | undefined;
  let lines: string[] = [];
  for (const line of text.split(/\r?\n/u)) {
    const heading = line.trim();
    if (required.has(heading)) {
      if (current) bodies.set(current, lines.join("\n").trim());
      current = heading;
      lines = [];
      continue;
    }
    if (current) lines.push(line);
  }
  if (current) bodies.set(current, lines.join("\n").trim());
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
