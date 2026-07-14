import { describe, expect, it } from 'vitest';
import { extractAgencyMemorySections } from '../../electron/services/agency-role-memory-import';

const markdown = `# Code Reviewer

## Identity
You are a legendary reviewer with twenty years of experience.

## Critical Rules
Never approve a change without evidence.

\`\`\`bash
pnpm install
\`\`\`

### Review Boundary
Keep findings scoped to the supplied diff.

## Workflow
1. Read the diff.
2. Verify each finding.

## Failure Modes
Do not report speculative defects as facts.

## Handoff
Pass unresolved security findings to the security reviewer.

## Advanced Capabilities
Use shell and browser tools.

## Tools
\`bash -lc "pnpm test"\`

## Mission
Produce the perfect review.
`;

describe('Agency role memory import', () => {
  it('extracts only recognized governance sections from the Markdown AST', () => {
    const sections = extractAgencyMemorySections({
      packageId: 'a'.repeat(64),
      markdown,
    });

    expect(sections.map((section) => section.type)).toEqual([
      'constraint',
      'constraint',
      'procedure',
      'risk',
      'handoff',
    ]);
    expect(sections.map((section) => section.headingPath.join(' > '))).toEqual([
      'Critical Rules',
      'Critical Rules > Review Boundary',
      'Workflow',
      'Failure Modes',
      'Handoff',
    ]);
    expect(sections.map((section) => section.content).join('\n')).not.toMatch(
      /legendary|pnpm install|shell|browser|perfect review|bash -lc/i,
    );
  });

  it('keeps ids deterministic and chunks long sections at block boundaries', () => {
    const longMarkdown = `## Checklist\n${Array.from(
      { length: 30 },
      (_, index) => `Paragraph ${index}: ${'verify evidence '.repeat(12)}`,
    ).join('\n\n')}`;
    const first = extractAgencyMemorySections({
      packageId: 'b'.repeat(64),
      markdown: longMarkdown,
    });
    const second = extractAgencyMemorySections({
      packageId: 'b'.repeat(64),
      markdown: longMarkdown,
    });

    expect(first.length).toBeGreaterThan(1);
    expect(first.every((section) => section.content.length <= 1800)).toBe(true);
    expect(first.map((section) => section.sectionId)).toEqual(
      second.map((section) => section.sectionId),
    );
  });
});
