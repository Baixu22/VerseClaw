export const CODE_EXTENSIONS: Set<string>;
export const CONTRACT_EXTENSIONS: Set<string>;
export const ISSUE_METHOD_EXTENSIONS: Set<string>;
export const DEFAULT_EXCLUDED_PREFIXES: string[];
export const LOCKFILE_BASENAMES: Set<string>;
export const DEFAULT_AREAS: string[];
export const DEFAULT_MAX_REFERENCES: number;
export const HELP: string;
export const ROOT: string;

export type SourceCategory = 'code' | 'contract' | 'other';
export type Reference = { file: string; line: number };
export type ReferenceCounts = { code: number; contract: number; issueMethod: number; any: number };
export type CandidateFile = {
  path: string;
  selfReferenced: boolean;
  truncated: boolean;
  counts: ReferenceCounts;
  codeReferences: Reference[];
  contractReferences: Reference[];
  issueMethodReferences: Reference[];
  anyReferences: Reference[];
  size?: number | null;
  sha256?: string | null;
};
export type AreaSummary = {
  area: string;
  fileCount: number;
  referencedCode: number;
  zeroCode: number;
  zeroCodePct: number;
  referencedContract: number;
  zeroContract: number;
  zeroIssueMethod: number;
  zeroIssueMethodPct: number;
  referencedAny: number;
  zeroAny: number;
  zeroAnyPct: number;
  selfReferenced: number;
  zeroCodeFiles: string[];
  files: CandidateFile[];
};
export type ReferenceRecord = {
  codeReferences: Reference[];
  contractReferences: Reference[];
  issueMethodReferences: Reference[];
  anyReferences: Reference[];
  selfReferenced: boolean;
  truncated: boolean;
};
export type CorpusFile = { path: string; content: string; size: number };

export function normalizePath(filePath: string): string;
export function stripTrailingSlash(area: string): string;
export function isLockfile(filePath: string): boolean;
export function exclusionReason(
  filePath: string,
  options?: { includeRuntime?: boolean; includeLockfiles?: boolean },
): 'runtime' | 'lockfile' | null;
export function categorizeSource(filePath: string): SourceCategory;
export function isIssueMethodSource(filePath: string): boolean;
export function listTrackedFiles(root?: string): string[];
export function selectCandidates(tracked: string[], areas: string[]): Map<string, string[]>;
export function isProbablyBinary(bytes: Uint8Array): boolean;
export function computeLineStarts(content: string): number[];
export function lineAt(lineStarts: number[], offset: number): number;
export function collectOccurrences(
  content: string,
  needle: string,
  lineStarts: number[],
  cap: number,
): { line: number; offset: number }[];
export function groupCandidatesByDirectory(candidates: string[]): Map<string, string[]>;
export function analyzeReferences(input: {
  candidates: string[];
  corpus: { path: string; content: string }[];
  excludeSelf?: boolean;
  maxReferences?: number;
}): Map<string, ReferenceRecord>;
export function summarizeArea(area: string, candidates: string[], results: Map<string, ReferenceRecord>): AreaSummary;
export function renderTable(areas: AreaSummary[], options?: { zeroOnly?: boolean }): string;
export function findMentions(
  corpus: { path: string; content: string }[],
  tokens: string[],
): Map<string, { file: string; line: number; category: SourceCategory }[]>;
