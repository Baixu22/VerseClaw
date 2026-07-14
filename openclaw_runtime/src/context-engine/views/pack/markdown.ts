// Markdown formatter for the ContextPack contract. The section order below is the
// SPEC §6.1 iron rule and may not be reordered:
// brief → freshness → ownerChain → topology → snippets → missingEvidence → nextQueries.
// Conclusion/confidence/gaps come before evidence so the agent can judge "够不够动手"
// before reading details.
import type { ContextPack } from "../../fact-types.js";
import { markdownFenceFor } from "./context-budget.js";

export function formatContextPackMarkdown(pack: ContextPack): string {
  const sections: string[] = [];

  sections.push(`# Context: ${pack.query}`);
  sections.push(
    [
      `- mode: ${pack.mode}`,
      `- answerable: ${pack.answerable} (confidence: ${pack.confidence})`,
      `- edit-readiness: ${pack.editReadiness}`,
      `- budget: ${pack.usedChars}/${pack.budgetChars} chars`,
    ].join("\n"),
  );

  sections.push(`## Brief\n${pack.brief}`);

  const freshnessLines = [
    `- mode: ${pack.freshness.mode}`,
    `- fresh: ${listOrNone(pack.freshness.fresh)}`,
    `- stale: ${listOrNone(pack.freshness.stale)}`,
    `- missing: ${listOrNone(pack.freshness.missing)}`,
    `- refreshed this query: ${listOrNone(pack.freshness.refreshed)}`,
  ];
  sections.push(`## Freshness\n${freshnessLines.join("\n")}`);

  const owners = pack.ownerChain.length
    ? pack.ownerChain
        .map((owner) => {
          const symbols = owner.symbols.map((symbol) => `${symbol.name} (${symbol.kind} L${symbol.startLine})`).join(", ");
          return `- **${owner.filePath}** [${owner.role}] score=${owner.score} — ${owner.reason}${symbols ? `\n  - symbols: ${symbols}` : ""}`;
        })
        .join("\n")
    : "_none_";
  sections.push(`## Owner chain\n${owners}`);

  const topology = pack.topology.length
    ? pack.topology.map((edge) => `- ${edge.from} —${edge.edge}→ ${edge.to} (${edge.confidence})`).join("\n")
    : "_none_";
  sections.push(`## Topology\n${topology}`);

  const snippets = pack.snippets.length
    ? pack.snippets
        .map((snippet) => {
          const fence = markdownFenceFor(snippet.content);
          const elided = snippet.elidedLineCount > 0 ? ` (+${snippet.elidedLineCount} lines elided)` : "";
          return [
            `### ${snippet.filePath}:${snippet.startLine}-${snippet.endLine} [${snippet.expansionLevel}]${elided}`,
            `score=${snippet.score} role=${snippet.role} — ${snippet.reason}`,
            fence.open,
            snippet.content,
            fence.close,
          ].join("\n");
        })
        .join("\n\n")
    : "_none_";
  sections.push(`## Snippets\n${snippets}`);

  const missing = pack.missingEvidence.length
    ? pack.missingEvidence.map((entry) => `- ${entry}`).join("\n")
    : "_none — evidence is complete for this query_";
  sections.push(`## Missing evidence\n${missing}`);

  const next = pack.nextQueries.length ? pack.nextQueries.map((query) => `- ${query}`).join("\n") : "_none_";
  sections.push(`## Next queries\n${next}`);

  return sections.join("\n\n");
}

function listOrNone(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}
