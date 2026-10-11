/* Auto-generated test typing surface for check-runtime-deep-refs.mjs */
export const SCAN_DIRS: string[];
export const VENDOR_PREFIX: string;
export const PROBE_EXTENSIONS: string[];
export const TS_SOURCE_ALIASES: Record<string, string[]>;

export type ReferenceKind = 'import' | 'string' | 'package-script';

export type BaselineEntry = {
  file?: string;
  target?: string;
  reason: string;
};

export type RuntimeDeepReference = {
  file: string;
  line: number;
  kind: ReferenceKind;
  specifier: string;
  target: string;
};

export type ExemptedReference = RuntimeDeepReference & { reason: string };

export type RuntimeDeepRefsReport = {
  ok: boolean;
  referenceCount: number;
  countsByKind: Record<string, number>;
  dangling: RuntimeDeepReference[];
  exempted: ExemptedReference[];
  staleExemptions: BaselineEntry[];
  errors: string[];
};

export function loadBaseline(root?: string): { entries: BaselineEntry[] };
export function resolvesToExistingPath(root: string, target: string): boolean;
export function listScannedFiles(root?: string): string[];
export function normalizeSpecifier(specifier: string, fromFile: string): string | null;
export function collectReferences(root?: string, files?: string[]): RuntimeDeepReference[];
export function checkRuntimeDeepRefs(options?: {
  root?: string;
  baseline?: { entries: BaselineEntry[] };
  files?: string[];
}): RuntimeDeepRefsReport;
