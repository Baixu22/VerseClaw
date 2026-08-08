import { createHash } from 'node:crypto';
import {
  type CvkChecksum,
  type ResourceId,
  type Selector,
  normalizeChecksum,
  normalizeResourceId,
  normalizeSelector,
  stableStringifyContextRuntimeKit,
} from '../../../../shared/types/context-runtime-kit.js';

export type CvkCodebaseFileInput = {
  path: string;
  content: string;
  relatedTests?: string[];
};

export type CvkCodebaseIndexInput = {
  id: string;
  files: CvkCodebaseFileInput[];
};

export type CvkCodebaseLineRange = {
  startLine: number;
  endLine: number;
};

export type CvkCodebaseSymbolEntry = {
  name: string;
  selector: Selector;
  filePath: string;
  lineRange: CvkCodebaseLineRange;
  checksum: CvkChecksum;
};

export type CvkCodebaseFileEntry = {
  path: string;
  lineCount: number;
  checksum: CvkChecksum;
  imports: string[];
  relatedTests: string[];
};

export type CvkCodebaseIndex = {
  resourceId: ResourceId;
  sourceHash: CvkChecksum;
  artifactHash: CvkChecksum;
  files: CvkCodebaseFileEntry[];
  symbols: CvkCodebaseSymbolEntry[];
  selectors: Selector[];
  relatedTests: Record<string, string[]>;
};

export type CvkCodebaseResolutionStatus =
  | 'missing_file'
  | 'missing_range'
  | 'missing_symbol'
  | 'stale_resource'
  | 'invalid_selector';

export type CvkCodebaseResolutionSuccess = {
  ok: true;
  resourceId: ResourceId;
  selector: Selector;
  text: string;
  filePath: string;
  lineRange: CvkCodebaseLineRange;
  checksum: CvkChecksum;
  importHints: string[];
  relatedTests: string[];
};

export type CvkCodebaseResolutionFailure = {
  ok: false;
  status: CvkCodebaseResolutionStatus;
  resourceId: string;
  selector: string;
  message: string;
};

export type CvkCodebaseResolutionResult =
  | CvkCodebaseResolutionSuccess
  | CvkCodebaseResolutionFailure;

export type CvkCodebaseSelectorRef = {
  resourceId: string;
  selector: string;
};

function checksumFor(value: unknown): CvkChecksum {
  return normalizeChecksum(`sha256:${createHash('sha256')
    .update(stableStringifyContextRuntimeKit(value))
    .digest('hex')}`);
}

function sanitizeResourceName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._/-]+/g, '-').replace(/^-+|-+$/g, '') || 'codebase';
}

function fileSelector(path: string, startLine: number, endLine: number): Selector {
  return normalizeSelector(`code:file.${path}#L${startLine}-L${endLine}`);
}

function symbolSelector(name: string): Selector {
  return normalizeSelector(`code:symbol.${name}`);
}

function importsSelector(path: string): Selector {
  return normalizeSelector(`code:imports.${path}`);
}

function relatedTestSelector(path: string): Selector {
  return normalizeSelector(`code:related-test.${path}`);
}

function lines(content: string): string[] {
  return content.split(/\r?\n/);
}

function extractImports(fileLines: string[]): string[] {
  return fileLines
    .map((line) => line.trim())
    .filter((line) => /^import\b/.test(line))
    .sort();
}

function findBlockEnd(fileLines: string[], startIndex: number): number {
  let depth = 0;
  for (let index = startIndex; index < fileLines.length; index += 1) {
    const line = fileLines[index] ?? '';
    depth += (line.match(/{/g) ?? []).length;
    depth -= (line.match(/}/g) ?? []).length;
    if (depth <= 0 && index > startIndex) return index + 1;
  }
  return startIndex + 1;
}

function extractSymbols(file: CvkCodebaseFileInput): CvkCodebaseSymbolEntry[] {
  const fileLines = lines(file.content);
  return fileLines.flatMap((line, index) => {
    const match = line.match(/^\s*(?:export\s+)?(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)\b/)
      ?? line.match(/^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\b/);
    if (!match?.[1]) return [];
    const endLine = /\b(function|class)\b/.test(line) ? findBlockEnd(fileLines, index) : index + 1;
    const range = { startLine: index + 1, endLine };
    const text = fileLines.slice(range.startLine - 1, range.endLine).join('\n');
    return [{
      name: match[1],
      selector: symbolSelector(match[1]),
      filePath: file.path,
      lineRange: range,
      checksum: checksumFor({ path: file.path, range, text }),
    }];
  });
}

function fileEntry(file: CvkCodebaseFileInput): CvkCodebaseFileEntry {
  const fileLines = lines(file.content);
  return {
    path: file.path,
    lineCount: fileLines.length,
    checksum: checksumFor({ path: file.path, content: file.content }),
    imports: extractImports(fileLines),
    relatedTests: [...(file.relatedTests ?? [])].sort(),
  };
}

export function buildCvkCodebaseIndex(input: CvkCodebaseIndexInput): CvkCodebaseIndex {
  const files = [...input.files].sort((left, right) => left.path.localeCompare(right.path));
  const sourceHash = checksumFor(files.map((file) => ({
    path: file.path,
    content: file.content,
    relatedTests: [...(file.relatedTests ?? [])].sort(),
  })));
  const resourceId = normalizeResourceId(`codebase:${sanitizeResourceName(input.id)}@${sourceHash.slice('sha256:'.length, 'sha256:'.length + 12)}`);
  const fileEntries = files.map(fileEntry);
  const symbols = files.flatMap(extractSymbols)
    .sort((left, right) => left.selector.localeCompare(right.selector));
  const selectors = [
    ...fileEntries.map((file) => fileSelector(file.path, 1, file.lineCount)),
    ...symbols.map((symbol) => symbol.selector),
    ...fileEntries.filter((file) => file.imports.length).map((file) => importsSelector(file.path)),
    ...fileEntries.filter((file) => file.relatedTests.length).map((file) => relatedTestSelector(file.path)),
  ].sort();
  const relatedTests = Object.fromEntries(
    fileEntries
      .filter((file) => file.relatedTests.length)
      .map((file) => [file.path, file.relatedTests]),
  );
  const artifactHash = checksumFor({
    resourceId,
    sourceHash,
    files: fileEntries,
    symbols,
    selectors,
    relatedTests,
  });

  return withSourceFiles({
    resourceId,
    sourceHash,
    artifactHash,
    files: fileEntries,
    symbols,
    selectors,
    relatedTests,
  }, files);
}

function sourceFile(input: CvkCodebaseIndex, filePath: string): CvkCodebaseFileEntry | undefined {
  return input.files.find((file) => file.path === filePath);
}

function inputFileContent(index: CvkCodebaseIndex, filePath: string): string | undefined {
  const file = (index as CvkCodebaseIndex & { __sourceFiles?: CvkCodebaseFileInput[] }).__sourceFiles
    ?.find((item) => item.path === filePath);
  return file?.content;
}

function parseFileSelector(selector: string): { filePath: string; range: CvkCodebaseLineRange } | undefined {
  const match = selector.match(/^code:file\.(.+)#L(\d+)-L(\d+)$/);
  if (!match?.[1] || !match[2] || !match[3]) return undefined;
  return {
    filePath: match[1],
    range: {
      startLine: Number(match[2]),
      endLine: Number(match[3]),
    },
  };
}

function failure(
  status: CvkCodebaseResolutionStatus,
  ref: CvkCodebaseSelectorRef,
  message: string,
): CvkCodebaseResolutionFailure {
  return {
    ok: false,
    status,
    resourceId: ref.resourceId,
    selector: ref.selector,
    message,
  };
}

function withSourceFiles(index: CvkCodebaseIndex, files: CvkCodebaseFileInput[]): CvkCodebaseIndex {
  Object.defineProperty(index, '__sourceFiles', {
    value: files,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return index;
}

export function resolveCvkCodebaseSelector(
  index: CvkCodebaseIndex,
  ref: CvkCodebaseSelectorRef,
): CvkCodebaseResolutionResult {
  if (ref.resourceId !== index.resourceId) {
    return failure('stale_resource', ref, 'Codebase resource id is stale for the current index.');
  }
  const selector = normalizeSelector(ref.selector);
  const fileMatch = parseFileSelector(selector);
  const sourceFiles = (index as CvkCodebaseIndex & { __sourceFiles?: CvkCodebaseFileInput[] }).__sourceFiles ?? [];
  void sourceFiles;

  if (fileMatch) {
    const file = sourceFile(index, fileMatch.filePath);
    const content = inputFileContent(index, fileMatch.filePath);
    if (!file || content === undefined) return failure('missing_file', ref, 'File selector does not match an indexed file.');
    if (
      fileMatch.range.startLine < 1 ||
      fileMatch.range.endLine < fileMatch.range.startLine ||
      fileMatch.range.endLine > file.lineCount
    ) {
      return failure('missing_range', ref, 'File selector line range is outside the indexed file.');
    }
    const selectedText = lines(content).slice(fileMatch.range.startLine - 1, fileMatch.range.endLine).join('\n');
    return {
      ok: true,
      resourceId: index.resourceId,
      selector,
      text: selectedText,
      filePath: file.path,
      lineRange: fileMatch.range,
      checksum: checksumFor({ path: file.path, range: fileMatch.range, text: selectedText }),
      importHints: file.imports,
      relatedTests: file.relatedTests,
    };
  }

  const symbolMatch = selector.match(/^code:symbol\.([A-Za-z_$][\w$]*)$/);
  if (symbolMatch?.[1]) {
    const symbol = index.symbols.find((item) => item.name === symbolMatch[1]);
    if (!symbol) return failure('missing_symbol', ref, 'Symbol selector does not match an indexed symbol.');
    return resolveCvkCodebaseSelector(index, {
      resourceId: ref.resourceId,
      selector: fileSelector(symbol.filePath, symbol.lineRange.startLine, symbol.lineRange.endLine),
    });
  }

  return failure('invalid_selector', ref, 'Unsupported codebase selector.');
}

export function buildCvkCodebaseIndexWithSources(input: CvkCodebaseIndexInput): CvkCodebaseIndex {
  return withSourceFiles(buildCvkCodebaseIndex(input), [...input.files]);
}
