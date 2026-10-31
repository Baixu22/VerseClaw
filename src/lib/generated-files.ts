/**
 * Generated files extraction.
 *
 * Inspects a run segment of chat messages (the slice from a user trigger
 * to its terminating assistant reply) and surfaces files the AI wrote /
 * edited via tool calls. Used by `GeneratedFilesPanel` to render inline
 * file cards under each run, and by `FilePreviewBody` / `ArtifactPanel`
 * to power the diff view.
 */
import { diffLines } from 'diff';
import type { ContentBlock, RawMessage } from '@/stores/chat';
import {
  isGitPatchArtifactV1,
  type GitPatchArtifactV1,
} from '@shared/types/remote-forge';
import { normalizeRemoteForgeErrorV1 } from '@shared/remote-forge/error-envelope';

export type FileContentType =
  | 'snapshot'
  | 'code'
  | 'document'
  | 'video'
  | 'audio'
  | 'other';

/** A single (old_string -> new_string) replacement extracted from an edit tool. */
export interface FileEditOp {
  old: string;
  new: string;
}

export type GeneratedFileBaseline =
  | { status: 'ok'; content: string }
  | { status: 'missing' }
  | { status: 'unavailable'; reason: string };

export type GeneratedFilePatchProjection =
  | { status: 'ok'; artifact: GitPatchArtifactV1 }
  | { status: 'pending' }
  | { status: 'unavailable'; reason: string };

export interface FileLineStats {
  added: number;
  removed: number;
}

export interface GeneratedFile {
  filePath: string;
  fileName: string;
  ext: string;
  mimeType: string;
  contentType: FileContentType;
  size?: number;
  action: 'created' | 'modified';
  /**
   * Full new content of the file when known (only set by `Write`-family
   * tools that provide the whole document in their input).
   */
  fullContent?: string;
  /**
   * Ordered list of edits applied to this file during the run (Edit /
   * StrReplace / MultiEdit). The diff view renders these directly as a
   * snippet diff (joined `old` vs joined `new`), matching WorkBuddy /
   * Codex behaviour.
   */
  edits?: FileEditOp[];
  /**
   * File content captured immediately before a Write-family tool executed.
   * `missing` means the file did not exist yet. `unavailable` means the
   * renderer could not read the existing file precisely enough to build a
   * trustworthy before/after diff (outside sandbox, binary, too large, ...).
   */
  baseline?: GeneratedFileBaseline;
  /** Journal-linked artifact for DCS edit/write. Presence disables inferred diff fallback. */
  patchProjection?: GeneratedFilePatchProjection;
  /** Index of the latest tool call that touched this file (for stable ordering). */
  lastSeenIndex: number;
}

/** Visual separator between multiple edit hunks. */
const SNIPPET_SEPARATOR = '\n\n';

/**
 * True when the chat extraction captured enough tool payload to render a
 * diff (Write `fullContent` and/or non-empty Edit ops). Entries without
 * this should not appear in generated-file UIs.
 */
export function generatedFileHasDiffPayload(
  file: Pick<GeneratedFile, 'fullContent' | 'edits' | 'patchProjection'>,
): boolean {
  if (file.patchProjection) return file.patchProjection.status === 'ok';
  if (file.fullContent != null) return true;
  if (file.edits?.length) {
    return file.edits.some((op) => (op.old ?? '') !== '' || (op.new ?? '') !== '');
  }
  return false;
}

const WRITE_TOOLS = new Set([
  'Write',
  'write_file',
  'create_file',
  'WriteFile',
  'createFile',
  'write',
]);

const EDIT_TOOLS = new Set([
  'Edit',
  'edit',
  'edit_file',
  'EditFile',
  'StrReplace',
  'str_replace',
  'str_replace_editor',
  'MultiEdit',
  'multi_edit',
  'multiEdit',
]);

const FILE_PATH_KEYS = ['file_path', 'filepath', 'path', 'fileName', 'file_name', 'target_path'];

/** Best-effort detector that mirrors the buckets WorkBuddy uses internally. */
const SNAPSHOT_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico',
]);
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v']);
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.oga', '.opus', '.aac', '.flac', '.m4a']);
const DOCUMENT_EXTS = new Set([
  '.md', '.markdown', '.txt', '.rst', '.adoc', '.html', '.htm',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
]);
const TEXT_DOCUMENT_EXTS = new Set([
  '.md', '.markdown', '.txt', '.rst', '.adoc', '.html', '.htm',
]);
const PDF_PREVIEW_EXTS = new Set(['.pdf']);
const SHEET_PREVIEW_EXTS = new Set(['.xlsx', '.xls']);
const OFFICE_PREVIEW_EXTS = new Set(['.docx', '.xlsx', '.pptx']);
const CODE_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift',
  '.c', '.cc', '.cpp', '.h', '.hpp', '.cs',
  '.json', '.yaml', '.yml', '.toml', '.xml',
  '.sh', '.bash', '.zsh', '.ps1',
  '.html', '.htm', '.css', '.scss', '.sass', '.less',
  '.sql', '.lua', '.r', '.dart',
]);

const EXT_MIME_MAP: Record<string, string> = {
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.toml': 'application/toml',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.jsx': 'text/javascript',
  '.mjs': 'text/javascript',
  '.cjs': 'text/javascript',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.py': 'text/x-python',
  '.sh': 'text/x-shellscript',
  '.bash': 'text/x-shellscript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.m4v': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/opus',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv',
};

export function getMimeTypeForExt(ext: string): string {
  return EXT_MIME_MAP[ext.toLowerCase()] ?? 'application/octet-stream';
}

export function classifyFileExt(ext: string): FileContentType {
  const lower = ext.toLowerCase();
  if (SNAPSHOT_EXTS.has(lower)) return 'snapshot';
  if (VIDEO_EXTS.has(lower)) return 'video';
  if (AUDIO_EXTS.has(lower)) return 'audio';
  if (DOCUMENT_EXTS.has(lower)) return 'document';
  if (CODE_EXTS.has(lower)) return 'code';
  return 'other';
}

export function supportsInlineDocumentPreview(ext: string): boolean {
  const lower = ext.toLowerCase();
  return (
    TEXT_DOCUMENT_EXTS.has(lower)
    || PDF_PREVIEW_EXTS.has(lower)
    || SHEET_PREVIEW_EXTS.has(lower)
    || OFFICE_PREVIEW_EXTS.has(lower)
  );
}

/** True for binary documents we render via dedicated viewers (PDF / spreadsheet). */
export function supportsRichDocumentPreview(ext: string): boolean {
  const lower = ext.toLowerCase();
  return PDF_PREVIEW_EXTS.has(lower) || SHEET_PREVIEW_EXTS.has(lower) || OFFICE_PREVIEW_EXTS.has(lower);
}

export function isOfficePreviewExt(ext: string | null | undefined): boolean {
  if (!ext) return false;
  return OFFICE_PREVIEW_EXTS.has(ext.toLowerCase());
}

export function isHtmlPreviewExt(ext: string | null | undefined): boolean {
  if (!ext) return false;
  const lower = ext.toLowerCase();
  return lower === '.html' || lower === '.htm';
}

export function isPdfPreviewExt(ext: string | null | undefined): boolean {
  if (!ext) return false;
  return PDF_PREVIEW_EXTS.has(ext.toLowerCase());
}

export function isSheetPreviewExt(ext: string | null | undefined): boolean {
  if (!ext) return false;
  return SHEET_PREVIEW_EXTS.has(ext.toLowerCase());
}

export function supportsInlineDiff(file: Pick<GeneratedFile, 'ext' | 'contentType'>): boolean {
  if (file.contentType === 'document') {
    if (supportsRichDocumentPreview(file.ext)) return false;
    return supportsInlineDocumentPreview(file.ext);
  }
  if (file.contentType === 'snapshot' || file.contentType === 'video' || file.contentType === 'audio') return false;
  return true;
}

export function basenameOf(path: string): string {
  if (!path) return '';
  const norm = path.replace(/\\/g, '/');
  const last = norm.lastIndexOf('/');
  return last >= 0 ? norm.slice(last + 1) : norm;
}

export function extnameOf(path: string): string {
  const name = basenameOf(path);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return '';
  return name.slice(dot);
}

function asRecord(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== 'object') return null;
  return input as Record<string, unknown>;
}

function pickFilePath(input: unknown): string | null {
  const rec = asRecord(input);
  if (!rec) return null;
  for (const key of FILE_PATH_KEYS) {
    const value = rec[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function pickWriteContent(input: unknown): string | undefined {
  const rec = asRecord(input);
  if (!rec) return undefined;
  for (const key of [
    'content',
    'contents',
    'text',
    'body',
    'data',
    'new_content',
    'new_string',
    'newString',
    'string',
    'source',
  ]) {
    const value = rec[key];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

// Aliases mirror WorkBuddy's tool-arg normaliser so we accept whichever
// naming convention the agent emits (Codex, Claude, Cursor, Cline …).
const OLD_KEYS = [
  'old_string', 'oldString', 'old_str', 'oldStr',
  'old_text', 'oldText',
  'old', 'oldContent', 'before', 'find', 'search',
];
const NEW_KEYS = [
  'new_string', 'newString', 'new_str', 'newStr',
  'new_text', 'newText',
  'new', 'newContent', 'after', 'replace', 'replacement',
];

function pickStringByKeys(rec: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === 'string') return v;
  }
  return undefined;
}

function pickEditOps(input: unknown): FileEditOp[] {
  const rec = asRecord(input);
  if (!rec) return [];
  const ops: FileEditOp[] = [];
  const singleOld = pickStringByKeys(rec, OLD_KEYS);
  const singleNew = pickStringByKeys(rec, NEW_KEYS);
  if (singleOld !== undefined || singleNew !== undefined) {
    ops.push({ old: singleOld ?? '', new: singleNew ?? '' });
  }
  const edits = rec.edits;
  if (Array.isArray(edits)) {
    for (const edit of edits as Array<Record<string, unknown>>) {
      const o = pickStringByKeys(edit, OLD_KEYS) ?? '';
      const n = pickStringByKeys(edit, NEW_KEYS) ?? '';
      if (o !== '' || n !== '') ops.push({ old: o, new: n });
    }
  }
  return ops;
}

function determineWriteAction(
  existing: GeneratedFile | undefined,
  baseline: GeneratedFileBaseline | undefined,
): 'created' | 'modified' {
  if (existing?.action === 'created') return 'created';
  if (!baseline) return existing ? 'modified' : 'created';
  return baseline.status === 'missing' ? 'created' : 'modified';
}

function buildGeneratedFile(
  filePath: string,
  action: 'created' | 'modified',
  parts: {
    fullContent?: string;
    edits?: FileEditOp[];
    baseline?: GeneratedFileBaseline;
    patchProjection?: GeneratedFilePatchProjection;
  } | undefined,
  index: number,
): GeneratedFile {
  const fileName = basenameOf(filePath);
  const ext = extnameOf(filePath);
  return {
    filePath,
    fileName,
    ext,
    mimeType: getMimeTypeForExt(ext),
    contentType: classifyFileExt(ext),
    action,
    fullContent: parts?.fullContent,
    edits: parts?.edits,
    baseline: parts?.baseline,
    patchProjection: parts?.patchProjection,
    lastSeenIndex: index,
  };
}

function unavailablePatchProjection(reason: string): GeneratedFilePatchProjection {
  return { status: 'unavailable', reason };
}

function resultTextBlocks(result: unknown): string[] {
  // A folded tool result keeps the transcript's raw content array, while a
  // structured tool result nests the same blocks under `content`.
  const record = asRecord(result);
  const content: unknown[] = Array.isArray(result)
    ? result
    : Array.isArray(record?.content) ? (record!.content as unknown[]) : [];
  return content
    .map((block) => asRecord(block))
    .filter((block): block is Record<string, unknown> => block != null && block.type === 'text')
    .map((block) => typeof block.text === 'string' ? block.text : '');
}

function parseTrustedEditResult(result: unknown): {
  filePath?: string;
  edits?: FileEditOp[];
} {
  const blocks = resultTextBlocks(result);
  const summary = blocks.find((text) => /^Successfully replaced \d+ block\(s\) in .+\.$/m.test(text.trim())) ?? '';
  const pathMatch = /^Successfully replaced \d+ block\(s\) in (.+)\.$/m.exec(summary.trim());
  const diffBlock = blocks.find((text) => /(?:^|\n)diff:\n/.test(text));
  const filePath = pathMatch?.[1]?.trim();
  if (!filePath || !/\.[a-z0-9]{1,8}$/i.test(basenameOf(filePath))) return {};
  if (!diffBlock) return { filePath };
  const diff = diffBlock.slice(diffBlock.indexOf('diff:') + 'diff:'.length);
  const edits: FileEditOp[] = [];
  let oldLines: string[] = [];
  let newLines: string[] = [];
  const flush = () => {
    if (oldLines.length > 0 || newLines.length > 0) {
      edits.push({ old: oldLines.join('\n'), new: newLines.join('\n') });
      oldLines = [];
      newLines = [];
    }
  };
  for (const line of diff.split(/\r?\n/)) {
    const match = /^([-+ ])(\d+)\s(.*)$/.exec(line);
    if (!match) continue;
    if (match[1] === '-') oldLines.push(match[3] ?? '');
    else if (match[1] === '+') newLines.push(match[3] ?? '');
    else {
      flush();
    }
  }
  flush();
  return { filePath, edits: edits.length > 0 ? edits : undefined };
}

function mutationPatchProjection(
  message: RawMessage,
  toolCallId: string | undefined,
): GeneratedFilePatchProjection | undefined {
  if (!toolCallId) return unavailablePatchProjection('Mutation tool call has no request id.');
  const matches = (message._toolResults ?? []).filter((result) => result.toolCallId === toolCallId);
  if (matches.length === 0) return { status: 'pending' };
  if (matches.length !== 1) return unavailablePatchProjection('Mutation tool result is ambiguous.');
  const details = asRecord(matches[0]?.result);
  if (!details) return unavailablePatchProjection('Mutation tool result details are unavailable.');
  if (details.patchArtifactError !== undefined) {
    const error = normalizeRemoteForgeErrorV1(details.patchArtifactError, {
      requestId: toolCallId,
      code: 'incomplete_response',
    });
    return unavailablePatchProjection(error.safeMessage);
  }
  if (details.patchArtifacts === undefined) {
    // Older tool results carry only display text plus the edit arguments. The
    // caller can still render the exact old/new hunks it submitted; absence of
    // structured patch evidence must not hide that trusted payload. Any present
    // patch artifact remains strict: malformed, stale or incomplete evidence
    // below still fails closed instead of falling back.
    return undefined;
  }
  if (!Array.isArray(details.patchArtifacts) || details.patchArtifacts.length !== 1) {
    return unavailablePatchProjection('Mutation tool result has no single patch artifact.');
  }
  const artifact = details.patchArtifacts[0];
  if (!isGitPatchArtifactV1(artifact)) {
    return unavailablePatchProjection('Mutation patch artifact failed strict validation.');
  }
  if (artifact.completeness !== 'complete') {
    return unavailablePatchProjection('Mutation patch artifact is not complete.');
  }
  if (artifact.lineage?.requestId !== toolCallId || !artifact.lineage.journalEntryId) {
    return unavailablePatchProjection('Mutation patch artifact lineage is stale or missing.');
  }
  const journal = asRecord(details.write_journal);
  const snapshots = Array.isArray(journal?.snapshots) ? journal.snapshots : [];
  const matchingSnapshot = snapshots
    .map(asRecord)
    .find((snapshot) =>
      snapshot != null
      && snapshot.journalEntryId === artifact.lineage?.journalEntryId
      && snapshot.path === artifact.file);
  if (!matchingSnapshot) {
    return unavailablePatchProjection('Mutation patch artifact does not match its journal snapshot.');
  }
  return { status: 'ok', artifact };
}

function normaliseEol(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

function joinEditText(edits: FileEditOp[], side: 'old' | 'new'): string {
  return edits.map((op) => normaliseEol(op[side] ?? '')).join(SNIPPET_SEPARATOR);
}

function countLogicalLines(text: string): number {
  const normalized = normaliseEol(text);
  if (!normalized) return 0;
  const parts = normalized.split('\n');
  return normalized.endsWith('\n') ? Math.max(1, parts.length - 1) : parts.length;
}

function diffLineStats(oldText: string, newText: string): FileLineStats {
  const pieces = diffLines(normaliseEol(oldText), normaliseEol(newText));
  let added = 0;
  let removed = 0;
  for (const piece of pieces) {
    const count = typeof piece.count === 'number' ? piece.count : countLogicalLines(piece.value);
    if (piece.added) added += count;
    if (piece.removed) removed += count;
  }
  return { added, removed };
}

export function computeLineStats(file: GeneratedFile): FileLineStats | null {
  if (!supportsInlineDiff(file)) return null;

  if (file.patchProjection) {
    if (file.patchProjection.status !== 'ok') return null;
    let added = 0;
    let removed = 0;
    for (const hunk of file.patchProjection.artifact.hunks) {
      for (const line of hunk.lines) {
        if (line.kind === 'addition') added += 1;
        if (line.kind === 'deletion') removed += 1;
      }
    }
    return { added, removed };
  }

  if (file.edits?.length) {
    return diffLineStats(joinEditText(file.edits, 'old'), joinEditText(file.edits, 'new'));
  }

  if (file.fullContent == null) return null;

  if (file.baseline?.status === 'ok') {
    return diffLineStats(file.baseline.content, file.fullContent);
  }

  if (file.baseline?.status === 'missing') {
    return { added: countLogicalLines(file.fullContent), removed: 0 };
  }

  if (file.baseline?.status === 'unavailable') {
    return null;
  }

  if (file.action === 'created') {
    return { added: countLogicalLines(file.fullContent), removed: 0 };
  }

  return null;
}

/**
 * Walk the messages in `[triggerIndex, segmentEnd]` (inclusive) and
 * collect the unique files written or edited by tool calls in that
 * window. Deduplicates by `filePath`; if the file is touched by both
 * a `Write` and a later `Edit`, the action is upgraded to `'modified'`
 * but the diff content is kept from the last edit.
 */
export function extractGeneratedFiles(
  messages: RawMessage[],
  triggerIndex: number,
  segmentEnd: number,
  baselineGetter?: (filePath: string) => GeneratedFileBaseline | undefined,
): GeneratedFile[] {
  const map = new Map<string, GeneratedFile>();
  const start = Math.max(0, Math.min(triggerIndex + 1, messages.length));
  const end = Math.max(start - 1, Math.min(segmentEnd, messages.length - 1));
  const consumedResultIds = new Set<string>();

  const upsertEdit = (
    filePath: string,
    ops: FileEditOp[],
    patchProjection: GeneratedFilePatchProjection | undefined,
    index: number,
  ) => {
    const existing = map.get(filePath);
    map.set(filePath, buildGeneratedFile(
      filePath,
      'modified',
      {
        fullContent: existing?.fullContent,
        edits: [...(existing?.edits ?? []), ...ops],
        baseline: existing?.baseline,
        patchProjection,
      },
      index,
    ));
  };

  for (let i = start; i <= end; i += 1) {
    const message = messages[i];
    if (!message || message.role !== 'assistant') continue;
    const content = message.content;
    if (!Array.isArray(content)) continue;

    for (const block of content as ContentBlock[]) {
      if (block.type !== 'tool_use' && block.type !== 'toolCall') continue;
      const name = typeof block.name === 'string' ? block.name : '';
      if (!name) continue;
      const input = block.input ?? block.arguments;
      const filePath = pickFilePath(input);
      if (!filePath) continue;

      const isWrite = WRITE_TOOLS.has(name);
      const isEdit = EDIT_TOOLS.has(name);
      const looksLikeFile = isWrite || isEdit || /\.[a-z0-9]{1,8}$/i.test(basenameOf(filePath));
      if (!isWrite && !isEdit && !looksLikeFile) continue;

      const existing = map.get(filePath);
      const patchProjection = isWrite || isEdit
        ? mutationPatchProjection(message, block.id)
        : undefined;
      if (block.id) consumedResultIds.add(block.id);

      if (isWrite) {
        const newContent = pickWriteContent(input);
        const baseline = baselineGetter?.(filePath);
        const next = buildGeneratedFile(
          filePath,
          determineWriteAction(existing, baseline),
          { fullContent: newContent, edits: undefined, baseline, patchProjection },
          i,
        );
        map.set(filePath, next);
        continue;
      }

      if (isEdit) {
        upsertEdit(filePath, pickEditOps(input), patchProjection, i);
        continue;
      }

      // Unknown tool but its input mentions a file path with extension —
      // surface as best-effort "modified" without diff content.
      if (!existing) {
        map.set(filePath, buildGeneratedFile(filePath, 'modified', undefined, i));
      } else {
        existing.lastSeenIndex = i;
      }
    }
  }

  // Gateway display projection can omit an intermediate assistant tool-call
  // row while retaining its toolResult. Recover only from the trusted edit
  // result text itself; assistant prose is never accepted as patch evidence.
  for (let i = start; i <= end; i += 1) {
    const message = messages[i];
    if (!message || message.role !== 'assistant') continue;
    for (const result of message._toolResults ?? []) {
      if (result.toolName !== 'edit') continue;
      if (result.toolCallId && consumedResultIds.has(result.toolCallId)) continue;
      const parsed = parseTrustedEditResult(result.result);
      if (!parsed.filePath || !parsed.edits?.length) continue;
      upsertEdit(parsed.filePath, parsed.edits, undefined, i);
      if (result.toolCallId) consumedResultIds.add(result.toolCallId);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.lastSeenIndex - b.lastSeenIndex);
}
