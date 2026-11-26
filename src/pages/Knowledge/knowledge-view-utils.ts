import type { KnowledgeLibrarianGroundedAnswer } from '@/lib/knowledge-librarian';
import type { KnowledgeSearchResult } from '@/lib/host-api';

export type SearchRow = Record<string, unknown>;

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
export function getString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export function getSearchRows(result: KnowledgeSearchResult | null): SearchRow[] {
  if (!result) return [];
  if (Array.isArray(result.results)) return result.results as SearchRow[];
  const candidates = ['items', 'matches', 'pages'];
  for (const key of candidates) {
    const value = (result as Record<string, unknown>)[key];
    if (Array.isArray(value)) return value.filter((entry): entry is SearchRow => !!asRecord(entry));
  }
  return [];
}

export function getLookup(row: SearchRow): string {
  return getString(row, ['pagePath', 'path', 'relativePath', 'id', 'pageId', 'lookup']);
}

export function getTitle(row: SearchRow): string {
  return getString(row, ['title', 'pageTitle', 'name', 'id', 'pageId', 'pagePath']) || 'Result';
}

export function getSnippet(row: SearchRow): string {
  return getString(row, ['snippet', 'excerpt', 'text', 'summary', 'content']);
}

export function getScore(row: SearchRow): number | undefined {
  const value = row.score ?? row.rank ?? row.similarity;
  if (typeof value === 'number' && Number.isFinite(value)) return value > 1 ? value / 100 : value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed > 1 ? parsed / 100 : parsed;
  }
  return undefined;
}

export function getPageBody(page: Record<string, unknown> | null): string {
  if (!page) return '';
  const direct = getString(page, ['content', 'markdown', 'text', 'body', 'raw']);
  if (direct) return direct;
  const nested = asRecord(page.page);
  return nested ? getPageBody(nested) : JSON.stringify(page, null, 2);
}

export function markdownSummary(body: string): string {
  const compact = body
    .replace(/^---[\s\S]*?---/u, '')
    .replace(/[#>*_`[\]()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!compact) return '';
  return compact.length > 180 ? `${compact.slice(0, 180)}...` : compact;
}

export function readableExcerpt(body: string, fallback = ''): string {
  const compact = (body || fallback)
    .replace(/^---[\s\S]*?---/u, '')
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/[#>*_`[\]()[\]-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!compact) return '';
  return compact.length > 220 ? `${compact.slice(0, 220)}...` : compact;
}

export type KnowledgeLibrarianCitation = {
  lookup: string;
  title: string;
  excerpt: string;
  path?: string;
  score?: number;
  sourceRef?: import('@shared/knowledge/owner-read-contract').SourceRefV2;
};

export type KnowledgeLibrarianMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  citations?: KnowledgeLibrarianCitation[];
  groundedAnswer?: KnowledgeLibrarianGroundedAnswer;
  operation?: {
    requestId: string;
    phase: 'waiting' | 'searching' | 'reading' | 'thinking' | 'verifying' | 'finished' | 'confused' | 'failed';
    steps: Array<'searching' | 'reading' | 'thinking' | 'verifying'>;
    error?: string;
    answerId?: string;
  };
  mainChatDeliveries?: Array<{ sessionKey: string; generation?: string; runId?: string; idempotencyKey: string }>;
};

export type KnowledgeLibrarianCheckpoint = {
  version: 1;
  updatedAt: string;
  vaultPath?: string;
  editorTitle: string;
  editorSource: string;
  sourceSetTitle?: string;
  sourceRefs?: import('@/lib/host-api').KnowledgeSourceSet['sourceRefs'];
  mainSessionKey?: string;
  messages: KnowledgeLibrarianMessage[];
};

export const KNOWLEDGE_LIBRARIAN_STORAGE_KEY = 'clawx.knowledge.librarian.checkpoint.v1';

export function makeLibrarianMessage(
  role: KnowledgeLibrarianMessage['role'],
  content: string,
  citations?: KnowledgeLibrarianCitation[],
  groundedAnswer?: KnowledgeLibrarianGroundedAnswer,
): KnowledgeLibrarianMessage {
  return {
    id: `kl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    createdAt: new Date().toISOString(),
    ...(citations && citations.length > 0 ? { citations } : {}),
    ...(groundedAnswer ? { groundedAnswer } : {}),
  };
}

export function parseLibrarianCheckpoint(raw: string | null): KnowledgeLibrarianCheckpoint | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<KnowledgeLibrarianCheckpoint>;
    if (parsed.version !== 1 || !Array.isArray(parsed.messages)) return null;
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      vaultPath: typeof parsed.vaultPath === 'string' ? parsed.vaultPath : undefined,
      editorTitle: typeof parsed.editorTitle === 'string' ? parsed.editorTitle : '',
      editorSource: typeof parsed.editorSource === 'string' ? parsed.editorSource : '',
      sourceSetTitle: typeof parsed.sourceSetTitle === 'string' ? parsed.sourceSetTitle : undefined,
      sourceRefs: Array.isArray(parsed.sourceRefs) ? parsed.sourceRefs : undefined,
      mainSessionKey: typeof parsed.mainSessionKey === 'string' ? parsed.mainSessionKey : undefined,
      messages: parsed.messages.filter((message): message is KnowledgeLibrarianMessage => (
        !!message
        && typeof message.id === 'string'
        && (message.role === 'user' || message.role === 'assistant' || message.role === 'system')
        && typeof message.content === 'string'
        && typeof message.createdAt === 'string'
      )),
    };
  } catch {
    return null;
  }
}
