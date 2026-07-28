import { parsePatchFiles } from '@pierre/diffs';
import {
  GIT_PATCH_ARTIFACT_SCHEMA,
  isGitPatchArtifactV1,
  isRepositoryRelativePosixPath,
  type GitPatchContentKind,
  type GitPatchArtifactV1,
  type GitPatchCompleteness,
  type GitPatchFileStatus,
  type GitPatchHunkV1,
  type GitPatchLineageV1,
} from '../types/remote-forge';

export const GIT_PATCH_ADAPTER_LIMITS = Object.freeze({
  maxInputBytes: 1024 * 1024,
  maxFiles: 128,
  maxHunks: 4_096,
  maxLines: 120_000,
});

export type UnifiedDiffAdapterInput = Readonly<{
  patch?: string | null;
  sourceCompleteness: GitPatchCompleteness;
  lineage?: GitPatchLineageV1;
}>;

export type UnifiedDiffAdapterResult =
  | { kind: 'artifacts'; artifacts: GitPatchArtifactV1[] }
  | { kind: 'unavailable'; artifacts: []; message: string };

const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: (.*))?$/;
const NO_NEWLINE_MARKER = '\\ No newline at end of file';
const SAFE_INTEGER_TEXT = /^\d+$/;

type ParsedFileIdentity = {
  file: string;
  status: GitPatchFileStatus;
  oldPath?: string;
  newPath?: string;
};

type BlockMetadata = {
  identity?: ParsedFileIdentity;
  binary: boolean;
  metadataOnlyCandidate: boolean;
  malformed: boolean;
  hunkStart: number;
};

function unavailable(message: string): UnifiedDiffAdapterResult {
  return { kind: 'unavailable', artifacts: [], message };
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

function countLines(value: string): number {
  if (value.length === 0) return 0;
  let lines = 1;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 10) lines += 1;
  }
  return lines;
}

function splitGitFileBlocks(value: string): string[] | null {
  const lines = value.split('\n');
  const starts: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.startsWith('diff --git ')) starts.push(index);
  }

  if (starts.length === 0) return [value];
  if (lines.slice(0, starts[0]).some((line) => line.length > 0)) return null;

  return starts.map((start, index) => {
    const end = starts[index + 1] ?? lines.length;
    return lines.slice(start, end).join('\n').replace(/\n+$/, '');
  });
}

function decodeQuotedPath(value: string): string | undefined {
  if (!value.startsWith('"')) return value;
  try {
    const decoded = JSON.parse(value) as unknown;
    return typeof decoded === 'string' ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function normalizePath(value: string, side?: 'a' | 'b'): string | null | undefined {
  const decoded = decodeQuotedPath(value.trim());
  if (decoded === undefined) return undefined;
  if (decoded === '/dev/null') return null;
  const prefix = side ? `${side}/` : undefined;
  const withoutPrefix = prefix && decoded.startsWith(prefix) ? decoded.slice(prefix.length) : decoded;
  return isRepositoryRelativePosixPath(withoutPrefix) ? withoutPrefix : undefined;
}

function readHeaderToken(value: string, offset: number): { value: string; next: number } | undefined {
  let index = offset;
  while (value[index] === ' ') index += 1;
  if (index >= value.length) return undefined;

  if (value[index] !== '"') {
    const end = value.indexOf(' ', index);
    return { value: value.slice(index, end === -1 ? value.length : end), next: end === -1 ? value.length : end };
  }

  let escaped = false;
  for (let end = index + 1; end < value.length; end += 1) {
    const char = value[end];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') return { value: value.slice(index, end + 1), next: end + 1 };
  }
  return undefined;
}

function parseDiffHeader(line: string): { oldPath: string; newPath: string } | undefined {
  const first = readHeaderToken(line, 'diff --git'.length);
  if (!first) return undefined;
  const second = readHeaderToken(line, first.next);
  if (!second || line.slice(second.next).trim().length > 0) return undefined;
  const oldPath = normalizePath(first.value, 'a');
  const newPath = normalizePath(second.value, 'b');
  if (typeof oldPath !== 'string' || typeof newPath !== 'string') return undefined;
  return { oldPath, newPath };
}

function parseFileHeaderPath(line: string, prefix: '--- ' | '+++ '): string | null | undefined {
  const raw = line.slice(prefix.length).split('\t', 1)[0]?.trim() ?? '';
  return normalizePath(raw, prefix === '--- ' ? 'a' : 'b');
}

function parseMetadataPath(line: string, prefix: string): string | undefined {
  const raw = line.slice(prefix.length).trim();
  const decoded = decodeQuotedPath(raw);
  return decoded !== undefined && isRepositoryRelativePosixPath(decoded) ? decoded : undefined;
}

function pathsAgree(left: string | null | undefined, right: string | null | undefined): boolean {
  return typeof left !== 'string' || typeof right !== 'string' || left === right;
}

function resolveIdentity(params: {
  diffPaths?: { oldPath: string; newPath: string };
  oldHeader?: string | null;
  newHeader?: string | null;
  renameFrom?: string;
  renameTo?: string;
  copyFrom?: string;
  copyTo?: string;
  added: boolean;
  deleted: boolean;
}): ParsedFileIdentity | undefined {
  if (!pathsAgree(params.oldHeader, params.diffPaths?.oldPath)
    || !pathsAgree(params.newHeader, params.diffPaths?.newPath)) {
    return undefined;
  }

  if (params.renameFrom !== undefined || params.renameTo !== undefined) {
    if (!params.renameFrom || !params.renameTo || params.renameFrom === params.renameTo) return undefined;
    if (!pathsAgree(params.renameFrom, params.diffPaths?.oldPath)
      || !pathsAgree(params.renameTo, params.diffPaths?.newPath)) return undefined;
    return {
      file: params.renameTo,
      status: 'renamed',
      oldPath: params.renameFrom,
      newPath: params.renameTo,
    };
  }

  if (params.copyFrom !== undefined || params.copyTo !== undefined) {
    if (!params.copyFrom || !params.copyTo || params.copyFrom === params.copyTo) return undefined;
    if (!pathsAgree(params.copyFrom, params.diffPaths?.oldPath)
      || !pathsAgree(params.copyTo, params.diffPaths?.newPath)) return undefined;
    return {
      file: params.copyTo,
      status: 'copied',
      oldPath: params.copyFrom,
      newPath: params.copyTo,
    };
  }

  const oldPath = params.oldHeader === null
    ? null
    : params.oldHeader ?? params.diffPaths?.oldPath;
  const newPath = params.newHeader === null
    ? null
    : params.newHeader ?? params.diffPaths?.newPath;
  if (oldPath === undefined || newPath === undefined) return undefined;
  if (params.added || oldPath === null) {
    return typeof newPath === 'string' ? { file: newPath, status: 'added' } : undefined;
  }
  if (params.deleted || newPath === null) {
    return typeof oldPath === 'string' ? { file: oldPath, status: 'deleted' } : undefined;
  }
  if (oldPath !== newPath) {
    return { file: newPath, status: 'renamed', oldPath, newPath };
  }
  return { file: newPath, status: 'modified' };
}

function inspectBlockMetadata(lines: string[]): BlockMetadata {
  const binaryPatchStart = lines.indexOf('GIT binary patch');
  const firstHunk = binaryPatchStart === -1
    ? lines.findIndex((line) => line.startsWith('@@'))
    : -1;
  const hunkStart = firstHunk === -1 ? lines.length : firstHunk;
  let diffPaths: { oldPath: string; newPath: string } | undefined;
  let oldHeader: string | null | undefined;
  let newHeader: string | null | undefined;
  let renameFrom: string | undefined;
  let renameTo: string | undefined;
  let copyFrom: string | undefined;
  let copyTo: string | undefined;
  let added = false;
  let deleted = false;
  let binary = false;
  let metadataOnlyCandidate = false;
  let malformed = false;

  for (let index = 0; index < hunkStart; index += 1) {
    const line = lines[index] ?? '';
    if (line.startsWith('diff --git ')) {
      if (index !== 0 || diffPaths !== undefined) malformed = true;
      diffPaths = parseDiffHeader(line);
      if (!diffPaths) malformed = true;
    } else if (line.startsWith('--- ')) {
      if (oldHeader !== undefined) malformed = true;
      oldHeader = parseFileHeaderPath(line, '--- ');
      if (oldHeader === undefined) malformed = true;
    } else if (line.startsWith('+++ ')) {
      if (newHeader !== undefined) malformed = true;
      newHeader = parseFileHeaderPath(line, '+++ ');
      if (newHeader === undefined) malformed = true;
    } else if (line.startsWith('rename from ')) {
      if (renameFrom !== undefined) malformed = true;
      renameFrom = parseMetadataPath(line, 'rename from ');
      if (!renameFrom) malformed = true;
      metadataOnlyCandidate = true;
    } else if (line.startsWith('rename to ')) {
      if (renameTo !== undefined) malformed = true;
      renameTo = parseMetadataPath(line, 'rename to ');
      if (!renameTo) malformed = true;
      metadataOnlyCandidate = true;
    } else if (line.startsWith('copy from ')) {
      if (copyFrom !== undefined) malformed = true;
      copyFrom = parseMetadataPath(line, 'copy from ');
      if (!copyFrom) malformed = true;
      metadataOnlyCandidate = true;
    } else if (line.startsWith('copy to ')) {
      if (copyTo !== undefined) malformed = true;
      copyTo = parseMetadataPath(line, 'copy to ');
      if (!copyTo) malformed = true;
      metadataOnlyCandidate = true;
    } else if (line.startsWith('new file mode ')) {
      added = true;
      metadataOnlyCandidate = true;
    } else if (line.startsWith('deleted file mode ')) {
      deleted = true;
      metadataOnlyCandidate = true;
    } else if (line.startsWith('old mode ') || line.startsWith('new mode ')) {
      metadataOnlyCandidate = true;
    } else if (line.startsWith('Binary files ')) {
      binary = true;
    } else if (line === 'GIT binary patch') {
      binary = true;
      break;
    } else if (line.startsWith('index ')
      || line.startsWith('similarity index ')
      || line.startsWith('dissimilarity index ')) {
      // Structural metadata used with text, binary, rename, or copy changes.
    } else if (line.length > 0) {
      malformed = true;
    }
  }

  if ((renameFrom !== undefined || renameTo !== undefined)
    && (copyFrom !== undefined || copyTo !== undefined)) malformed = true;
  if (added && (deleted || (oldHeader !== undefined && oldHeader !== null))) malformed = true;
  if (deleted && (newHeader !== undefined && newHeader !== null)) malformed = true;
  if (binary && firstHunk !== -1) malformed = true;

  const identity = resolveIdentity({
    ...(diffPaths ? { diffPaths } : {}),
    ...(oldHeader !== undefined ? { oldHeader } : {}),
    ...(newHeader !== undefined ? { newHeader } : {}),
    ...(renameFrom ? { renameFrom } : {}),
    ...(renameTo ? { renameTo } : {}),
    ...(copyFrom ? { copyFrom } : {}),
    ...(copyTo ? { copyTo } : {}),
    added,
    deleted,
  });
  return { identity, binary, metadataOnlyCandidate, malformed, hunkStart };
}

function parseInteger(value: string): number | undefined {
  if (!SAFE_INTEGER_TEXT.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function parseHunks(
  lines: string[],
  start: number,
  completeness: GitPatchCompleteness,
): { hunks: GitPatchHunkV1[]; malformed: boolean } {
  const hunks: GitPatchHunkV1[] = [];
  let index = start;

  while (index < lines.length) {
    const headerLine = lines[index];
    if (!headerLine) {
      index += 1;
      continue;
    }
    const match = HUNK_HEADER_PATTERN.exec(headerLine);
    if (!match) return { hunks, malformed: true };
    const oldStart = parseInteger(match[1] ?? '');
    const oldLines = parseInteger(match[2] ?? '1');
    const newStart = parseInteger(match[3] ?? '');
    const newLines = parseInteger(match[4] ?? '1');
    if (oldStart === undefined || oldLines === undefined || newStart === undefined || newLines === undefined) {
      return { hunks, malformed: true };
    }

    index += 1;
    let oldLine = oldStart;
    let newLine = newStart;
    let observedOld = 0;
    let observedNew = 0;
    let previousWasContent = false;
    const mappedLines: GitPatchHunkV1['lines'] = [];

    while (index < lines.length && !lines[index]?.startsWith('@@')) {
      const rawLine = lines[index] ?? '';
      if (rawLine === NO_NEWLINE_MARKER) {
        if (!previousWasContent) return { hunks, malformed: true };
        mappedLines.push({
          kind: 'no-newline',
          text: NO_NEWLINE_MARKER.slice(2),
          oldLine: null,
          newLine: null,
        });
        previousWasContent = false;
        index += 1;
        continue;
      }

      const marker = rawLine[0];
      const text = rawLine.slice(1);
      if (marker === ' ') {
        mappedLines.push({ kind: 'context', text, oldLine, newLine });
        oldLine += 1;
        newLine += 1;
        observedOld += 1;
        observedNew += 1;
      } else if (marker === '+') {
        mappedLines.push({ kind: 'addition', text, oldLine: null, newLine });
        newLine += 1;
        observedNew += 1;
      } else if (marker === '-') {
        mappedLines.push({ kind: 'deletion', text, oldLine, newLine: null });
        oldLine += 1;
        observedOld += 1;
      } else {
        return { hunks, malformed: true };
      }
      if (observedOld > oldLines || observedNew > newLines) return { hunks, malformed: true };
      previousWasContent = true;
      index += 1;
    }

    const countsMatch = observedOld === oldLines && observedNew === newLines;
    if (completeness === 'complete' && !countsMatch) return { hunks, malformed: true };
    if (!countsMatch && index < lines.length) return { hunks, malformed: true };
    if (mappedLines.length === 0) {
      if (completeness === 'complete') return { hunks, malformed: true };
      continue;
    }
    const heading = match[5]?.trim();
    hunks.push({
      oldStart,
      oldLines,
      newStart,
      newLines,
      ...(heading ? { heading } : {}),
      lines: mappedLines,
    });
  }

  return { hunks, malformed: false };
}

function strictBlockIsValid(block: string): boolean {
  try {
    const parsed = parsePatchFiles(block, undefined, true);
    return parsed.flatMap((entry) => entry.files ?? []).length === 1;
  } catch {
    return false;
  }
}

function unavailableArtifact(
  identity: ParsedFileIdentity,
  lineage: GitPatchLineageV1 | undefined,
): GitPatchArtifactV1 | undefined {
  const artifact: GitPatchArtifactV1 = {
    schema: GIT_PATCH_ARTIFACT_SCHEMA,
    ...identity,
    contentKind: 'unknown',
    hunks: [],
    completeness: 'unavailable',
    message: 'Unified diff could not be parsed safely.',
    ...(lineage ? { lineage } : {}),
  };
  return isGitPatchArtifactV1(artifact) ? artifact : undefined;
}

function artifactMessage(contentKind: GitPatchContentKind, completeness: GitPatchCompleteness): string | undefined {
  if (completeness === 'truncated') {
    return 'Unified diff input is truncated; parsed evidence may be partial.';
  }
  if (contentKind === 'binary') return 'Binary content changed; no text hunks are available.';
  if (contentKind === 'metadata') return 'File metadata changed; no text hunks are available.';
  return undefined;
}

function parseBlock(
  block: string,
  sourceCompleteness: GitPatchCompleteness,
  lineage: GitPatchLineageV1 | undefined,
): GitPatchArtifactV1 | undefined {
  const lines = block.split('\n');
  while (lines.at(-1) === '') lines.pop();
  const metadata = inspectBlockMetadata(lines);
  if (!metadata.identity) return undefined;
  if (metadata.malformed) return unavailableArtifact(metadata.identity, lineage);

  if (metadata.binary) {
    const artifact: GitPatchArtifactV1 = {
      schema: GIT_PATCH_ARTIFACT_SCHEMA,
      ...metadata.identity,
      contentKind: 'binary',
      hunks: [],
      patch: block,
      completeness: sourceCompleteness,
      message: artifactMessage('binary', sourceCompleteness) ?? 'Binary content changed.',
      ...(lineage ? { lineage } : {}),
    };
    return isGitPatchArtifactV1(artifact) ? artifact : unavailableArtifact(metadata.identity, lineage);
  }

  const parsedHunks = parseHunks(lines, metadata.hunkStart, sourceCompleteness);
  if (parsedHunks.malformed) return unavailableArtifact(metadata.identity, lineage);
  if (sourceCompleteness === 'complete' && !strictBlockIsValid(block)) {
    return unavailableArtifact(metadata.identity, lineage);
  }

  const contentKind: GitPatchContentKind = parsedHunks.hunks.length > 0
    ? 'text'
    : metadata.metadataOnlyCandidate ? 'metadata' : 'unknown';
  if (sourceCompleteness === 'complete' && contentKind === 'unknown') {
    return unavailableArtifact(metadata.identity, lineage);
  }
  const artifact: GitPatchArtifactV1 = {
    schema: GIT_PATCH_ARTIFACT_SCHEMA,
    ...metadata.identity,
    contentKind,
    hunks: parsedHunks.hunks,
    patch: block,
    completeness: sourceCompleteness,
    ...(artifactMessage(contentKind, sourceCompleteness) ? {
      message: artifactMessage(contentKind, sourceCompleteness),
    } : {}),
    ...(lineage ? { lineage } : {}),
  };
  return isGitPatchArtifactV1(artifact) ? artifact : unavailableArtifact(metadata.identity, lineage);
}

/**
 * Converts bounded unified diff observations into the sole shared patch
 * artifact. A result-level unavailable outcome means no safe file identity
 * could be recovered; a file-scoped parse failure becomes an unavailable v1.
 */
export function adaptUnifiedDiffToGitPatchArtifacts(
  input: UnifiedDiffAdapterInput,
): UnifiedDiffAdapterResult {
  try {
    if (input.sourceCompleteness === 'unavailable') {
      return unavailable('Unified diff input is unavailable.');
    }
    if (input.sourceCompleteness !== 'complete' && input.sourceCompleteness !== 'truncated') {
      return unavailable('Unified diff completeness is invalid.');
    }
    if (typeof input.patch !== 'string' || input.patch.length === 0) {
      return unavailable('Unified diff input is empty or unavailable.');
    }
    if (utf8ByteLength(input.patch) > GIT_PATCH_ADAPTER_LIMITS.maxInputBytes) {
      return unavailable(`Unified diff input exceeds the ${GIT_PATCH_ADAPTER_LIMITS.maxInputBytes}-byte limit.`);
    }

    const normalized = normalizeLineEndings(input.patch);
    const lineCount = countLines(normalized);
    if (lineCount > GIT_PATCH_ADAPTER_LIMITS.maxLines) {
      return unavailable(`Unified diff input exceeds the ${GIT_PATCH_ADAPTER_LIMITS.maxLines}-line limit.`);
    }
    const hunkCount = normalized.split('\n').filter((line) => line.startsWith('@@')).length;
    if (hunkCount > GIT_PATCH_ADAPTER_LIMITS.maxHunks) {
      return unavailable(`Unified diff input exceeds the ${GIT_PATCH_ADAPTER_LIMITS.maxHunks}-hunk limit.`);
    }

    const blocks = splitGitFileBlocks(normalized);
    if (!blocks || blocks.length === 0) {
      return unavailable('Unified diff input has no trustworthy file boundary.');
    }
    if (blocks.length > GIT_PATCH_ADAPTER_LIMITS.maxFiles) {
      return unavailable(`Unified diff input exceeds the ${GIT_PATCH_ADAPTER_LIMITS.maxFiles}-file limit.`);
    }

    const artifacts: GitPatchArtifactV1[] = [];
    for (const block of blocks) {
      const artifact = parseBlock(block, input.sourceCompleteness, input.lineage);
      if (!artifact) return unavailable('Unified diff input has no trustworthy file boundary.');
      artifacts.push(artifact);
    }
    if (artifacts.length === 0) return unavailable('Unified diff input produced no file artifacts.');
    return { kind: 'artifacts', artifacts };
  } catch {
    return unavailable('Unified diff input could not be parsed safely.');
  }
}
