/**
 * Built-in Skill Catalog
 * Curated list of skills available for installation.
 * Each entry points to a GitHub repo containing SKILL.md and related files.
 */

export interface SkillCatalogEntry {
  slug: string;
  name: string;
  description: string;
  version: string;
  author: string;
  /** GitHub repo in owner/repo format for installation */
  github: string;
  /** Search tags */
  tags: string[];
  /** Optional homepage / documentation URL */
  homepage?: string;
}

/**
 * Built-in skill catalog.
 *
 * To add a new skill, add an entry to the array below.
 * The `github` field should point to a GitHub repo (owner/repo)
 * that contains a SKILL.md file at the root.
 */
export const BUILTIN_SKILL_CATALOG: SkillCatalogEntry[] = [
  {
    slug: 'skill-creator',
    name: 'Skill Creator',
    description: 'Guide for creating effective skills. This skill should be used when users want to create a new skill (or update an existing skill) that extends AI capabilities with specialized knowledge, workflows, or tool integrations.',
    version: '1.0.0',
    author: 'ClawHub',
    github: 'openclaw/skill-creator',
    tags: ['skill', 'creator', 'guide', 'development'],
  },
  {
    slug: 'pdf',
    name: 'PDF Reader',
    description: 'Read and extract text from PDF files. Supports form filling, annotations, and basic PDF manipulation.',
    version: '1.2.0',
    author: 'ClawHub',
    github: 'openclaw/skill-pdf',
    tags: ['pdf', 'document', 'reader', 'extract'],
  },
  {
    slug: 'xlsx',
    name: 'Excel / Spreadsheet',
    description: 'Create, read, and manipulate Excel and CSV spreadsheet files. Supports formulas, formatting, charts, and data analysis.',
    version: '1.1.0',
    author: 'ClawHub',
    github: 'openclaw/skill-xlsx',
    tags: ['excel', 'spreadsheet', 'csv', 'data', 'xlsx'],
  },
  {
    slug: 'pptx',
    name: 'PowerPoint / Presentation',
    description: 'Create, read, and edit PowerPoint presentations. Supports slides, layouts, text, images, and charts.',
    version: '1.0.0',
    author: 'ClawHub',
    github: 'openclaw/skill-pptx',
    tags: ['powerpoint', 'pptx', 'presentation', 'slides'],
  },
  {
    slug: 'docx',
    name: 'Word Document',
    description: 'Create, read, and edit Word documents (.docx). Supports formatting, styles, tables, images, and tracked changes.',
    version: '1.1.0',
    author: 'ClawHub',
    github: 'openclaw/skill-docx',
    tags: ['word', 'docx', 'document', 'office'],
  },
  {
    slug: 'mcp-builder',
    name: 'MCP Server Builder',
    description: 'Guide for creating high-quality MCP (Model Context Protocol) servers that enable LLMs to interact with external services through well-designed tools.',
    version: '1.0.0',
    author: 'ClawHub',
    github: 'openclaw/skill-mcp-builder',
    tags: ['mcp', 'server', 'builder', 'guide', 'development'],
  },
  {
    slug: 'webapp-testing',
    name: 'Web Application Testing',
    description: 'Toolkit for interacting with and testing local web applications using Playwright. Supports verifying frontend functionality, debugging UI behavior, capturing browser screenshots, and viewing browser logs.',
    version: '1.0.0',
    author: 'ClawHub',
    github: 'openclaw/skill-webapp-testing',
    tags: ['testing', 'playwright', 'web', 'browser', 'e2e'],
  },
  {
    slug: 'algorithmic-art',
    name: 'Algorithmic Art Generator',
    description: 'Creating algorithmic art using p5.js with seeded randomness, interactive parameter exploration, and various artistic techniques. Generate original visual art from code.',
    version: '1.0.0',
    author: 'ClawHub',
    github: 'openclaw/skill-algorithmic-art',
    tags: ['art', 'p5js', 'creative', 'generative', 'visual'],
  },
  {
    slug: 'internal-comms',
    name: 'Internal Communications',
    description: 'A set of resources to help me write all kinds of internal communications. This skill should be used when asked to write status reports, leadership updates, company newsletters, FAQs, project updates, or other internal communications.',
    version: '1.0.0',
    author: 'ClawHub',
    github: 'openclaw/skill-internal-comms',
    tags: ['communication', 'writing', 'status', 'newsletter', 'faq'],
  },
  {
    slug: 'brand-guidelines',
    name: 'Brand Guidelines',
    description: 'Applies Anthropic brand colors and typography to any sort of artifact that may benefit from having Anthropics look-and-feel. This skill should be used when brand colors, style or formatting should be applied.',
    version: '1.0.0',
    author: 'ClawHub',
    github: 'openclaw/skill-brand-guidelines',
    tags: ['brand', 'design', 'style', 'formatting', 'colors'],
  },
  {
    slug: 'theme-factory',
    name: 'Theme Factory',
    description: 'Toolkit for styling artifacts with themes. Generates beautiful artifacts with 10 pre-set themes and 20 colorable themes that can be applied to slides, docs, reportings, HTML landing pages, etc.',
    version: '1.0.0',
    author: 'ClawHub',
    github: 'openclaw/skill-theme-factory',
    tags: ['theme', 'style', 'design', 'visual', 'color'],
  },
  {
    slug: 'slack-gif-creator',
    name: 'Slack GIF Creator',
    description: 'Knowledge and utilities for creating animated GIFs optimized for Slack. Provides constraints, validation tools, and animation concepts for creating effective GIFs.',
    version: '1.0.0',
    author: 'ClawHub',
    github: 'openclaw/skill-slack-gif-creator',
    tags: ['gif', 'slack', 'animation', 'visual'],
  },
  {
    slug: 'web-artifacts-builder',
    name: 'Web Artifacts Builder',
    description: 'Suite of tools for creating elaborate, multi-component HTML artifacts using modern frontend web technologies (React, Tailwind CSS, shadcn/ui). Use for complex artifacts requiring state management, routing, or shadcn/ui components.',
    version: '1.0.0',
    author: 'ClawHub',
    github: 'openclaw/skill-web-artifacts-builder',
    tags: ['react', 'web', 'artifact', 'frontend', 'tailwind'],
  },
  {
    slug: 'canvas-design',
    name: 'Canvas Design',
    description: 'Create beautiful visual art in .png and .pdf documents using design philosophy. You should use this skill when the user asks to create a poster, piece of art, design, or other static piece.',
    version: '1.0.0',
    author: 'ClawHub',
    github: 'openclaw/skill-canvas-design',
    tags: ['design', 'canvas', 'art', 'poster', 'visual'],
  },
  {
    slug: 'frontend-design',
    name: 'Frontend Design',
    description: 'Create distinctive, production-grade frontend interfaces with high design quality. Use this skill when the user asks to build web components, pages, artifacts, or applications.',
    version: '1.0.0',
    author: 'ClawHub',
    github: 'openclaw/skill-frontend-design',
    tags: ['frontend', 'design', 'ui', 'web', 'component'],
  },
];

/**
 * Search the built-in catalog by query.
 * Matches against name, description, slug, and tags.
 */
export function searchCatalog(query: string): SkillCatalogEntry[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) {
    // Return all entries sorted by name
    return [...BUILTIN_SKILL_CATALOG].sort((a, b) => a.name.localeCompare(b.name));
  }

  const tokens = q.split(/\s+/).filter(Boolean);

  const scored = BUILTIN_SKILL_CATALOG.map((entry) => {
    let score = 0;
    const nameLower = entry.name.toLowerCase();
    const descLower = entry.description.toLowerCase();
    const slugLower = entry.slug.toLowerCase();
    const tagsLower = entry.tags.map((t) => t.toLowerCase());
    const authorLower = entry.author.toLowerCase();

    for (const token of tokens) {
      // Exact slug match
      if (slugLower === token) score += 100;
      // Name starts with token
      if (nameLower.startsWith(token)) score += 50;
      // Name contains token
      if (nameLower.includes(token)) score += 30;
      // Tag exact match
      if (tagsLower.includes(token)) score += 25;
      // Description contains token
      if (descLower.includes(token)) score += 10;
      // Tag partial match
      if (tagsLower.some((t) => t.includes(token))) score += 5;
      // Author match
      if (authorLower.includes(token)) score += 3;
    }

    return { entry, score };
  });

  return scored
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ entry }) => entry);
}

/**
 * Find a skill in the catalog by slug.
 */
export function findCatalogEntry(slug: string): SkillCatalogEntry | undefined {
  return BUILTIN_SKILL_CATALOG.find(
    (entry) => entry.slug.toLowerCase() === slug.toLowerCase(),
  );
}
