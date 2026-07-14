import { createHash } from 'node:crypto';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import type { MemoryProposal } from '@shared/host-api/contract';

type MarkdownNode = {
  type: string;
  depth?: number;
  value?: string;
  children?: MarkdownNode[];
};

export type AgencyMemorySection = {
  sectionId: string;
  type: 'constraint' | 'procedure' | 'risk' | 'handoff';
  headingPath: string[];
  content: string;
};

export type AgencyMemoryProposalCandidate = AgencyMemorySection & {
  proposal: MemoryProposal;
};

const INCLUDED = new Map<string, AgencyMemorySection['type']>([
  ['critical rules', 'constraint'],
  ['mandatory', 'constraint'],
  ['constraints', 'constraint'],
  ['ethical standards', 'constraint'],
  ['workflow', 'procedure'],
  ['process', 'procedure'],
  ['methodology', 'procedure'],
  ['checklist', 'procedure'],
  ['failure modes', 'risk'],
  ['risks', 'risk'],
  ['automatic fail', 'risk'],
  ['handoff', 'handoff'],
]);

const EXCLUDED = new Set([
  'identity',
  'personality',
  'experience',
  'memory',
  'advanced capabilities',
  'tools',
  'tool list',
  'commands',
  'command examples',
  'installation',
  'install',
  'mission',
  'output template',
  'output templates',
]);

function normalizeHeading(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function textContent(node: MarkdownNode): string {
  if (['code', 'inlineCode', 'html'].includes(node.type)) return '';
  if (node.type === 'text') return node.value ?? '';
  const separator = ['list', 'listItem', 'blockquote'].includes(node.type) ? '\n' : '';
  return (node.children ?? [])
    .map(textContent)
    .filter(Boolean)
    .join(separator)
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function chunkBlocks(blocks: string[], limit = 1800): string[] {
  const chunks: string[] = [];
  let current = '';
  const append = (block: string) => {
    if (!block) return;
    if (block.length > limit) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      for (let offset = 0; offset < block.length; offset += limit) {
        chunks.push(block.slice(offset, offset + limit).trim());
      }
      return;
    }
    const next = current ? `${current}\n\n${block}` : block;
    if (next.length > limit) {
      chunks.push(current);
      current = block;
    } else {
      current = next;
    }
  };
  blocks.forEach(append);
  if (current) chunks.push(current);
  return chunks.filter(Boolean);
}

export function extractAgencyMemorySections(input: {
  packageId: string;
  markdown: string;
}): AgencyMemorySection[] {
  const root = unified().use(remarkParse).parse(input.markdown) as MarkdownNode;
  const headingPath: string[] = [];
  const sections: AgencyMemorySection[] = [];
  let active: { type: AgencyMemorySection['type']; depth: number } | null = null;
  let blocks: string[] = [];

  const flush = () => {
    if (!active || blocks.length === 0) {
      blocks = [];
      return;
    }
    for (const content of chunkBlocks(blocks)) {
      const path = headingPath.slice(active.depth - 1);
      sections.push({
        sectionId: digest(`${input.packageId}\n${path.join(' > ')}\n${content}`),
        type: active.type,
        headingPath: path,
        content,
      });
    }
    blocks = [];
  };

  for (const node of root.children ?? []) {
    if (node.type === 'heading') {
      flush();
      const depth = node.depth ?? 1;
      const heading = textContent(node);
      headingPath.splice(depth - 1);
      headingPath[depth - 1] = heading;
      const normalized = normalizeHeading(heading);
      const included = INCLUDED.get(normalized);
      if (included) {
        active = { type: included, depth };
      } else if (EXCLUDED.has(normalized) || !active || depth <= active.depth) {
        active = null;
      }
      continue;
    }
    if (!active || ['code', 'html', 'thematicBreak'].includes(node.type)) continue;
    const content = textContent(node);
    if (content) blocks.push(content);
  }
  flush();
  return sections;
}

export function buildAgencyMemoryProposalCandidates(input: {
  packageId: string;
  markdown: string;
  materializedRoleName: string;
  sourcePath: string;
}): AgencyMemoryProposalCandidate[] {
  return extractAgencyMemorySections(input).map((section) => ({
    ...section,
    proposal: {
      type: section.type,
      scope: 'role',
      scopeKey: input.materializedRoleName,
      roleTags: [input.materializedRoleName],
      ownerRole: input.materializedRoleName,
      applicableRoles: [input.materializedRoleName],
      content: section.content,
      evidenceRefs: [{
        type: 'file',
        ref: input.sourcePath,
        excerpt: section.content.slice(0, 500),
      }],
      confidence: 0.6,
      importance: ['constraint', 'risk'].includes(section.type) ? 0.8 : 0.65,
      sensitivity: 'normal',
      durability: 'long_term',
      source: 'system',
      reason: `Agency package section ${section.sectionId}`,
    },
  }));
}
