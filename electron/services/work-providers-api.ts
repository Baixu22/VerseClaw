import { createRequire } from 'node:module';
import { basename, dirname, extname, resolve } from 'node:path';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { expandPath } from '../utils/paths';
import { getSetting } from '../utils/store';
import { getActiveWorkspaceProfile } from './workspaces-api';
import { isRecord } from './payload-utils';
import {
  decideWorkspaceFileWrite,
  isPathInsideWorkspace,
  requireWorkspace,
} from './workspace-permissions';
import { WORK_MODE_KIT_IDS } from '@shared/types/work-mode';
import {
  resolveWorkKitProviderCapabilities,
  resolveWorkProviders,
  summarizeWorkProviderCapabilities,
  summarizeWorkProviderSources,
  type WorkProviderCapability,
  type WorkProviderConfig,
  type WorkProviderId,
  type WorkProviderRunPayload,
  type WorkProviderRunResult,
  type WorkProviderStatusSnapshot,
  type WorkProviderValidateArtifactPayload,
  type WorkProviderValidateArtifactResult,
} from '@shared/types/work-provider';

const require = createRequire(import.meta.url);

const NODE_DEPENDENCIES = [
  'docx',
  'mammoth',
  'xlsx',
  'exceljs',
  'pptxgenjs',
  'pdfjs-dist',
  'pdf-lib',
  '@mozilla/readability',
  'jsdom',
  'turndown',
  'cheerio',
  'papaparse',
];

function dependencyAvailable(dependencyId: string): boolean {
  if (!NODE_DEPENDENCIES.includes(dependencyId)) return false;
  try {
    require.resolve(dependencyId);
    return true;
  } catch {
    return false;
  }
}

function dependencyAvailability(): Record<string, boolean> {
  return Object.fromEntries(NODE_DEPENDENCIES.map((dependencyId) => [
    dependencyId,
    dependencyAvailable(dependencyId),
  ]));
}

async function workProviderConfig(): Promise<WorkProviderConfig> {
  return getSetting('workProviders').catch(() => ({}));
}

export async function resolveWorkProviderStatusSnapshot(params?: {
  runtimeAvailable?: boolean;
}): Promise<WorkProviderStatusSnapshot> {
  const providers = resolveWorkProviders({
    dependencyAvailability: dependencyAvailability(),
    config: await workProviderConfig(),
    runtimeAvailable: params?.runtimeAvailable ?? true,
  });
  const capabilities = providers.flatMap((provider) => provider.capabilities);
  const kitCapabilities = resolveWorkKitProviderCapabilities(WORK_MODE_KIT_IDS, capabilities);
  return {
    success: true,
    providers,
    capabilities,
    kitCapabilities,
    summary: summarizeWorkProviderCapabilities(capabilities),
    sourceSummary: summarizeWorkProviderSources(providers),
  };
}

async function workspacePath(inputPath: string, mode: 'read' | 'write'): Promise<string> {
  const workspace = requireWorkspace(await getActiveWorkspaceProfile());
  const expanded = expandPath(inputPath);
  let resolvedPath = resolve(expanded);
  if (mode === 'read') {
    try {
      resolvedPath = await realpath(expanded);
    } catch {
      resolvedPath = resolve(expanded);
    }
    if (!isPathInsideWorkspace(resolvedPath, workspace.rootPath)) {
      throw new Error('outsideSandbox');
    }
    const fileStat = await stat(resolvedPath);
    if (!fileStat.isFile()) throw new Error('notFile');
    return resolvedPath;
  }

  const decision = decideWorkspaceFileWrite(resolvedPath, workspace);
  if (!decision.allowed) {
    throw new Error(decision.requiresApproval ? 'approvalRequired' : decision.reason || 'writeDenied');
  }
  await mkdir(dirname(resolvedPath), { recursive: true }).catch(() => {});
  return resolvedPath;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} is required`);
  }
  return value;
}

function getInput(payload: WorkProviderRunPayload): Record<string, unknown> {
  return isRecord(payload.input) ? payload.input : {};
}

function hasProviderCapability(snapshot: WorkProviderStatusSnapshot, capability: WorkProviderCapability, providerId?: WorkProviderId): boolean {
  return snapshot.capabilities.some((entry) => (
    entry.capability === capability
    && entry.status === 'ready'
    && (!providerId || entry.providerId === providerId)
  ));
}

async function ensureReady(payload: WorkProviderRunPayload): Promise<void> {
  const snapshot = await resolveWorkProviderStatusSnapshot();
  if (!hasProviderCapability(snapshot, payload.capability, payload.providerId)) {
    const candidate = snapshot.capabilities.find((entry) => (
      entry.capability === payload.capability
      && (!payload.providerId || entry.providerId === payload.providerId)
    ));
    throw new Error(candidate?.status || 'missingProvider');
  }
}

function simpleHtmlToText(html: string): { title: string; text: string; markdown: string } {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() || '';
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const withBreaks = withoutScripts
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n');
  const text = withBreaks
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n\s+\n/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
  return {
    title,
    text,
    markdown: text,
  };
}

function normalizeHttpUrl(value: unknown): string {
  const url = typeof value === 'string' ? value.trim() : '';
  if (!url) throw new Error('url is required');
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('unsupportedUrlProtocol');
  }
  return parsed.toString();
}

function numberInRange(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

async function extractReadableHtml(html: string, url?: string): Promise<{
  title: string;
  text: string;
  markdown: string;
  html: string;
}> {
  let articleHtml = html;
  let articleTitle = '';
  let articleText = '';

  if (dependencyAvailable('@mozilla/readability') && dependencyAvailable('jsdom')) {
    try {
      const { JSDOM } = require('jsdom') as {
        JSDOM: new (markup: string, options?: Record<string, unknown>) => { window: { document: unknown } };
      };
      const { Readability } = require('@mozilla/readability') as {
        Readability: new (document: unknown) => {
          parse(): { title?: string; content?: string; textContent?: string } | null;
        };
      };
      const dom = new JSDOM(html, { url: url || 'https://clawx.local/' });
      const article = new Readability(dom.window.document).parse();
      if (article) {
        articleTitle = article.title || '';
        articleHtml = article.content || html;
        articleText = compactWhitespace(article.textContent || '');
      }
    } catch {
      articleHtml = html;
      articleTitle = '';
      articleText = '';
    }
  }

  if (dependencyAvailable('turndown')) {
    try {
      const TurndownService = require('turndown') as new () => { turndown(markup: string): string };
      const markdown = new TurndownService().turndown(articleHtml).trim();
      const fallback = simpleHtmlToText(articleHtml);
      return {
        title: articleTitle || fallback.title,
        text: articleText || fallback.text,
        markdown: markdown || articleText || fallback.markdown,
        html: articleHtml,
      };
    } catch {
      /* fall through to text fallback */
    }
  }

  const fallback = simpleHtmlToText(articleHtml);
  return {
    title: articleTitle || fallback.title,
    text: articleText || fallback.text,
    markdown: articleText || fallback.markdown,
    html: articleHtml,
  };
}

function configString(config: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = config[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function normalizeSearchResults(value: unknown): Array<{
  title: string;
  url: string;
  snippet?: string;
}> {
  const record = isRecord(value) ? value : {};
  const candidates = [
    record.results,
    record.items,
    record.webPages && isRecord(record.webPages) ? record.webPages.value : undefined,
    record.organic,
  ];
  const items = candidates.find(Array.isArray);
  if (!Array.isArray(items)) return [];

  return items.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const url = configString(entry, ['url', 'link', 'href']);
    if (!url) return [];
    const title = configString(entry, ['title', 'name']) || url;
    const snippet = configString(entry, ['snippet', 'description', 'content', 'summary']);
    return [{
      title,
      url,
      ...(snippet ? { snippet } : {}),
    }];
  });
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 160)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('invalidSearchResponse');
  }
}

async function readPdfPageCount(bytes: Buffer): Promise<number | undefined> {
  if (!dependencyAvailable('pdfjs-dist')) return undefined;
  try {
    const pdfjs = await import('pdfjs-dist') as {
      getDocument(options: { data: Uint8Array }): { promise: Promise<{ numPages: number; destroy(): Promise<void> | void }> };
    };
    const document = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
    const pageCount = document.numPages;
    await document.destroy();
    return pageCount;
  } catch {
    return undefined;
  }
}

async function fetchSearchResults(
  query: string,
  maxResults: number,
  config: Record<string, unknown>,
): Promise<{ provider: string; results: Array<{ title: string; url: string; snippet?: string }> }> {
  const provider = (configString(config, ['provider', 'type']) || 'customHttp').toLowerCase();
  const apiKey = configString(config, ['apiKey', 'token', 'key']);
  const endpoint = configString(config, ['endpoint', 'baseUrl', 'url']);

  if (provider === 'tavily') {
    if (!apiKey) throw new Error('missingConfig');
    const response = await fetch(endpoint || 'https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: maxResults,
      }),
    });
    return { provider, results: normalizeSearchResults(await readJsonResponse(response)).slice(0, maxResults) };
  }

  if (provider === 'brave') {
    if (!apiKey) throw new Error('missingConfig');
    const url = new URL(endpoint || 'https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(maxResults));
    const response = await fetch(url, {
      headers: { 'x-subscription-token': apiKey, accept: 'application/json' },
    });
    return { provider, results: normalizeSearchResults(await readJsonResponse(response)).slice(0, maxResults) };
  }

  if (provider === 'bing') {
    if (!apiKey) throw new Error('missingConfig');
    const url = new URL(endpoint || 'https://api.bing.microsoft.com/v7.0/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(maxResults));
    const response = await fetch(url, {
      headers: { 'ocp-apim-subscription-key': apiKey, accept: 'application/json' },
    });
    return { provider, results: normalizeSearchResults(await readJsonResponse(response)).slice(0, maxResults) };
  }

  if (!endpoint) throw new Error('missingConfig');
  const url = new URL(normalizeHttpUrl(endpoint));
  url.searchParams.set(configString(config, ['queryParam']) || 'q', query);
  url.searchParams.set(configString(config, ['limitParam']) || 'limit', String(maxResults));
  if (provider === 'searxng') url.searchParams.set('format', 'json');
  const headers: Record<string, string> = { accept: 'application/json' };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const response = await fetch(url, { headers });
  return { provider, results: normalizeSearchResults(await readJsonResponse(response)).slice(0, maxResults) };
}

async function runDocumentRead(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const path = await workspacePath(requireString(input.path, 'path'), 'read');
  const ext = extname(path).toLowerCase();
  if (ext === '.docx') {
    await ensureReady({ capability: 'document.read' });
    const mammoth = require('mammoth') as {
      extractRawText(options: { path: string }): Promise<{ value: string }>;
      convertToHtml(options: { path: string }): Promise<{ value: string }>;
    };
    const [raw, html] = await Promise.all([
      mammoth.extractRawText({ path }),
      mammoth.convertToHtml({ path }),
    ]);
    return {
      kind: 'document',
      path,
      fileName: basename(path),
      text: raw.value,
      html: html.value,
      markdown: simpleHtmlToText(html.value).markdown,
    };
  }

  const content = await readFile(path, 'utf8');
  if (ext === '.html' || ext === '.htm') {
    const extracted = await extractReadableHtml(content);
    return { kind: 'document', path, fileName: basename(path), ...extracted, sourceHtml: content };
  }
  return { kind: 'document', path, fileName: basename(path), text: content, markdown: content };
}

async function runDocumentWrite(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  await ensureReady({ capability: 'document.write' });
  const outputPath = await workspacePath(requireString(input.outputPath, 'outputPath'), 'write');
  const content = typeof input.content === 'string' ? input.content : '';
  const title = typeof input.title === 'string' ? input.title : 'Document';
  const docx = require('docx') as {
    Document: new (options: unknown) => unknown;
    Paragraph: new (options: unknown) => unknown;
    TextRun: new (text: string) => unknown;
    Packer: { toBuffer(document: unknown): Promise<Buffer> };
  };
  const paragraphs = [title, '', ...content.split(/\r?\n/)].map((line) => (
    new docx.Paragraph({ children: [new docx.TextRun(line)] })
  ));
  const document = new docx.Document({ sections: [{ children: paragraphs }] });
  const buffer = await docx.Packer.toBuffer(document);
  await writeFile(outputPath, buffer);
  return { kind: 'document', path: outputPath, fileName: basename(outputPath), bytes: buffer.length };
}

async function runSheetRead(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  await ensureReady({ capability: 'sheet.read' });
  const path = await workspacePath(requireString(input.path, 'path'), 'read');
  const xlsx = require('xlsx') as {
    readFile(path: string): { SheetNames: string[]; Sheets: Record<string, unknown> };
    utils: { sheet_to_json(sheet: unknown, options: unknown): unknown[] };
  };
  const workbook = xlsx.readFile(path);
  const sheets = workbook.SheetNames.map((name) => {
    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[name], { header: 1, blankrows: false, defval: '' });
    return { name, rows: rows.slice(0, 100), rowCount: rows.length };
  });
  return { kind: 'sheet', path, fileName: basename(path), sheetNames: workbook.SheetNames, sheets };
}

async function runCsvRead(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const path = await workspacePath(requireString(input.path, 'path'), 'read');
  const text = await readFile(path, 'utf8');
  let rows: unknown[][] | undefined;
  if (dependencyAvailable('papaparse')) {
    try {
      const Papa = require('papaparse') as {
        parse(value: string, options: Record<string, unknown>): { data?: unknown[] };
      };
      const parsed = Papa.parse(text, { skipEmptyLines: true });
      rows = Array.isArray(parsed.data)
        ? parsed.data.filter(Array.isArray) as unknown[][]
        : undefined;
    } catch {
      rows = undefined;
    }
  }
  rows ??= text
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => line.split(',').map((cell) => cell.trim()));
  return { kind: 'csv', path, fileName: basename(path), rows: rows.slice(0, 200), rowCount: rows.length };
}

async function runSheetWrite(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  await ensureReady({ capability: 'sheet.write' });
  const outputPath = await workspacePath(requireString(input.outputPath, 'outputPath'), 'write');
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const xlsx = require('xlsx') as {
    utils: {
      book_new(): unknown;
      aoa_to_sheet(rows: unknown[]): unknown;
      book_append_sheet(workbook: unknown, sheet: unknown, name: string): void;
    };
    writeFile(workbook: unknown, path: string): void;
  };
  const workbook = xlsx.utils.book_new();
  const sheet = xlsx.utils.aoa_to_sheet(rows);
  xlsx.utils.book_append_sheet(workbook, sheet, typeof input.sheetName === 'string' ? input.sheetName : 'Sheet1');
  xlsx.writeFile(workbook, outputPath);
  return { kind: 'sheet', path: outputPath, fileName: basename(outputPath), rowCount: rows.length };
}

async function runSlideWrite(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  await ensureReady({ capability: 'slide.write' });
  const outputPath = await workspacePath(requireString(input.outputPath, 'outputPath'), 'write');
  const PptxGenJS = require('pptxgenjs') as new () => {
    layout: string;
    author: string;
    subject: string;
    title: string;
    addSlide(): { addText(text: string, options: Record<string, unknown>): void };
    writeFile(options: { fileName: string }): Promise<void>;
  };
  const deck = new PptxGenJS();
  deck.layout = 'LAYOUT_WIDE';
  deck.author = 'Verse Claw';
  deck.title = typeof input.title === 'string' ? input.title : 'Presentation';
  const slides = Array.isArray(input.slides) ? input.slides : [{ title: deck.title, body: '' }];
  for (const entry of slides) {
    const record = isRecord(entry) ? entry : {};
    const slide = deck.addSlide();
    slide.addText(typeof record.title === 'string' ? record.title : 'Slide', { x: 0.5, y: 0.4, w: 12, h: 0.6, fontSize: 28, bold: true });
    slide.addText(typeof record.body === 'string' ? record.body : '', { x: 0.7, y: 1.3, w: 11.4, h: 5, fontSize: 16, breakLine: false });
  }
  await deck.writeFile({ fileName: outputPath });
  return { kind: 'slide', path: outputPath, fileName: basename(outputPath), slideCount: slides.length };
}

async function runPdfMerge(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  await ensureReady({ capability: 'pdf.merge' });
  const outputPath = await workspacePath(requireString(input.outputPath, 'outputPath'), 'write');
  const paths = Array.isArray(input.paths) ? input.paths.filter((value): value is string => typeof value === 'string') : [];
  if (paths.length === 0) throw new Error('paths are required');
  const pdfLib = require('pdf-lib') as {
    PDFDocument: {
      create(): Promise<unknown>;
      load(bytes: Uint8Array): Promise<unknown>;
    };
  };
  const merged = await pdfLib.PDFDocument.create() as {
    copyPages(source: unknown, pages: number[]): Promise<Array<{ }>>;
    addPage(page: unknown): void;
    save(): Promise<Uint8Array>;
  };
  for (const item of paths) {
    const path = await workspacePath(item, 'read');
    const source = await pdfLib.PDFDocument.load(await readFile(path)) as { getPageIndices(): number[] };
    const pages = await merged.copyPages(source, source.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  const bytes = await merged.save();
  await writeFile(outputPath, Buffer.from(bytes));
  return { kind: 'pdf', path: outputPath, fileName: basename(outputPath), bytes: bytes.length };
}

async function runWebExtract(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  await ensureReady({ capability: 'web.extract' });
  const url = typeof input.url === 'string' ? input.url.trim() : '';
  let html = typeof input.html === 'string' ? input.html : '';
  if (!html && url) {
    const response = await fetch(normalizeHttpUrl(url));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    html = await response.text();
  }
  if (!html) throw new Error('html or url is required');
  const extracted = await extractReadableHtml(html, url || undefined);
  return {
    kind: 'sourceBundle',
    url: url || undefined,
    title: typeof input.title === 'string' ? input.title : extracted.title,
    text: extracted.text,
    markdown: extracted.markdown,
    html: extracted.html,
    citations: url ? [{ url, title: extracted.title || url }] : [],
  };
}

async function runWebSearch(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  await ensureReady({ capability: 'web.search', providerId: 'web-search-configured' });
  const query = requireString(input.query, 'query');
  const maxResults = numberInRange(input.maxResults, 8, 1, 20);
  const config = (await workProviderConfig())['web-search-configured']?.config;
  if (!config || Object.keys(config).length === 0) throw new Error('missingConfig');
  const { provider, results } = await fetchSearchResults(query, maxResults, config);
  return {
    kind: 'searchResults',
    query,
    provider,
    results,
    citations: results.map((result) => ({ url: result.url, title: result.title })),
  };
}

async function dispatchRun(payload: WorkProviderRunPayload): Promise<Record<string, unknown>> {
  switch (payload.capability) {
    case 'document.read':
      return runDocumentRead(getInput(payload));
    case 'document.write':
      return runDocumentWrite(getInput(payload));
    case 'sheet.read':
      return runSheetRead(getInput(payload));
    case 'sheet.write':
      return runSheetWrite(getInput(payload));
    case 'csv.read':
      return runCsvRead(getInput(payload));
    case 'slide.write':
      return runSlideWrite(getInput(payload));
    case 'pdf.validate':
      return { ...await validateArtifact({ path: requireString(getInput(payload).path, 'path') }) };
    case 'pdf.merge':
      return runPdfMerge(getInput(payload));
    case 'web.extract':
      return runWebExtract(getInput(payload));
    case 'web.search':
      return runWebSearch(getInput(payload));
    default:
      throw new Error('unsupportedCapability');
  }
}

async function validateArtifact(payload: WorkProviderValidateArtifactPayload): Promise<WorkProviderValidateArtifactResult> {
  const path = await workspacePath(payload.path, 'read');
  const extension = extname(path).toLowerCase();
  const details: Record<string, unknown> = { fileName: basename(path) };

  if (extension === '.pdf') {
    const bytes = await readFile(path);
    const header = bytes.subarray(0, 5).toString('utf8');
    const pageCount = await readPdfPageCount(bytes);
    if (pageCount !== undefined) details.pageCount = pageCount;
    return { success: true, path, artifactType: 'pdf', valid: header === '%PDF-', previewAvailable: true, details };
  }
  if (extension === '.xlsx' || extension === '.xls') {
    if (!dependencyAvailable('xlsx')) {
      return { success: false, path, artifactType: 'xlsx', valid: false, previewAvailable: false, error: 'missingDependency:xlsx' };
    }
    const xlsx = require('xlsx') as {
      readFile(path: string): { SheetNames: string[]; Sheets: Record<string, unknown> };
      utils: { sheet_to_json(sheet: unknown, options: unknown): unknown[] };
    };
    const workbook = xlsx.readFile(path);
    details.sheetNames = workbook.SheetNames;
    details.sheetCount = workbook.SheetNames.length;
    details.rowCounts = Object.fromEntries(workbook.SheetNames.map((name) => [
      name,
      xlsx.utils.sheet_to_json(workbook.Sheets[name], { header: 1, blankrows: false }).length,
    ]));
    return { success: true, path, artifactType: 'xlsx', valid: workbook.SheetNames.length > 0, previewAvailable: true, details };
  }
  if (extension === '.csv') {
    const text = await readFile(path, 'utf8');
    details.rowCount = text.split(/\r?\n/).filter(Boolean).length;
    return { success: true, path, artifactType: 'csv', valid: true, previewAvailable: true, details };
  }
  if (extension === '.docx') {
    const header = (await readFile(path)).subarray(0, 2).toString('utf8');
    return { success: true, path, artifactType: 'docx', valid: header === 'PK', previewAvailable: dependencyAvailable('mammoth'), details };
  }
  if (extension === '.pptx') {
    const header = (await readFile(path)).subarray(0, 2).toString('utf8');
    return { success: true, path, artifactType: 'pptx', valid: header === 'PK', previewAvailable: false, details };
  }
  if (['.md', '.txt', '.html', '.htm'].includes(extension)) {
    const text = await readFile(path, 'utf8');
    details.characterCount = text.length;
    return { success: true, path, artifactType: extension.slice(1), valid: true, previewAvailable: true, details };
  }
  return { success: true, path, artifactType: extension.slice(1) || 'unknown', valid: false, previewAvailable: false, details };
}

function normalizeRunPayload(payload: unknown): WorkProviderRunPayload {
  if (!isRecord(payload) || typeof payload.capability !== 'string') {
    throw new Error('capability is required');
  }
  return {
    capability: payload.capability as WorkProviderCapability,
    providerId: typeof payload.providerId === 'string' ? payload.providerId as WorkProviderId : undefined,
    input: isRecord(payload.input) ? payload.input : {},
  };
}

function normalizeValidatePayload(payload: unknown): WorkProviderValidateArtifactPayload {
  if (!isRecord(payload)) throw new Error('path is required');
  return { path: requireString(payload.path, 'path') };
}

export function createWorkProvidersApi(): CompleteHostServiceRegistry['workProviders'] {
  return {
    status: async () => resolveWorkProviderStatusSnapshot(),
    run: async (payload): Promise<WorkProviderRunResult> => {
      try {
        const normalized = normalizeRunPayload(payload);
        const output = await dispatchRun(normalized);
        return {
          success: true,
          providerId: normalized.providerId,
          capability: normalized.capability,
          output,
        };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    validateArtifact: async (payload): Promise<WorkProviderValidateArtifactResult> => {
      try {
        return await validateArtifact(normalizeValidatePayload(payload));
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
