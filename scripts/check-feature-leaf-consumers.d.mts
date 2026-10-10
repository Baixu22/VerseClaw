/* Auto-generated test typing surface for check-feature-leaf-consumers.mjs */
export const RUNTIME_FEATURE_LEAVES_SOURCE: string;
export const RUNTIME_FEATURE_LEAVES_EXPORT: string;
export const SCAN_DIRS: string[];
export const EXCLUDED_PATH_PARTS: string[];
export const EXCLUDED_FILE_RE: RegExp;
export const SCANNED_EXT_RE: RegExp;
export const GENERIC_SEGMENTS: Set<string>;
export const FEATURE_LEAF_CONSUMER_BASELINE: readonly string[];

export function listLeafPaths(node: unknown, prefix?: string): string[];
export function extractRuntimeFeatureLeaves(sourceText: string): string[];
export function listConsumerFiles(root: string): string[];
export function loadConsumerSources(root: string): { path: string; text: string }[];
export function mostSpecificSegment(leafPath: string): string | null;
export function buildLeafPatterns(leafPath: string): {
  quotedFullPath: string[];
  chains: RegExp[];
  specificPatterns: RegExp[];
  specific: string | null;
};
export function hasConsumer(leafPath: string, sources: { path: string; text: string }[]): boolean;

export function checkFeatureLeafConsumers(options?: {
  root?: string;
  baseline?: readonly string[];
  sources?: { path: string; text: string }[];
  leafPaths?: string[];
}): {
  ok: boolean;
  leafCount: number;
  consumerFileCount: number;
  unpinnedZeroConsumerLeaves: string[];
  pinnedZeroConsumerLeaves: string[];
  baselineLeavesNowConsumed: string[];
  staleBaselineEntries: string[];
  errors: string[];
};

export function runSelfTest(): boolean;
