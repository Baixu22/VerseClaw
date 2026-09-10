/**
 * Canonical top-level section contract for compaction summaries.
 *
 * The model prompt, merge prompt, quality audit, and damage audit all consume
 * this list. Keep it dependency-free so runtime and package-level consumers can
 * share it without pulling in compaction execution code.
 */
export const REQUIRED_COMPACTION_SECTIONS = [
  "## Goal and Progress",
  "## Attempts and Failures",
  "## Key Decisions and Constraints",
  "## Current State",
  "## Key Decisions",
  "## Files Touched",
  "## Tests",
  "## Next Actions",
] as const;

export type RequiredCompactionSection = (typeof REQUIRED_COMPACTION_SECTIONS)[number];

/** Render the canonical sections in their required order. */
export function renderCompactionSummaryShape(
  bodies: Record<RequiredCompactionSection, string>,
): string {
  return REQUIRED_COMPACTION_SECTIONS
    .map((section) => `${section}\n${bodies[section]}`)
    .join("\n\n");
}
