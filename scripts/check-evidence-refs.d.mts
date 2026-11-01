export function collectEvidenceRefs(root?: string): Map<string, string[]>;
export function checkEvidenceRefs(root?: string): { ok: boolean; missing: Array<{ owner: string; ref: string }> };

export const EVIDENCE_REPORT_SCHEMA: 'ProductSemanticEvidenceReport/v1';
export const SEMANTIC_REGISTRY_PATH: 'shared/product-semantics.ts';
/** Contract versions this checker can bind; any other version is reported as unsupported. */
export const SUPPORTED_CONTRACT_VERSIONS: readonly string[];
export type SourceDiagnosticRule =
  | 'source-missing'
  | 'source-outside-root'
  | 'source-untracked'
  | 'source-symlink-escape'
  | 'source-digest-mismatch'
  | 'candidate-mismatch'
  | 'version-unsupported'
  | 'report-field-missing';
export const SOURCE_DIAGNOSTIC_RULES: readonly SourceDiagnosticRule[];
/** Both digests are taken over the candidate blob (`git cat-file blob HEAD:<path>`), never over working-tree bytes. */
export const EVIDENCE_NORMALIZATION: { readonly policy: string; readonly rawDigestPolicy: string };

export type SourceRefFacts = {
  path: string;
  exists: boolean;
  insideRoot: boolean;
  /** true when the candidate commit (HEAD) holds a blob at this path; null when git could not be asked — never assumed. */
  tracked: boolean | null;
  symlinkEscape: boolean;
  /** sha256 of the canonical (line-ending normalized) candidate blob, or null when no candidate blob was hashed. */
  digest: string | null;
  /** sha256 of the raw candidate blob bytes, or null when no candidate blob was hashed. */
  rawDigest: string | null;
};
export type EvidenceDiagnostic = {
  relationKey: string | null;
  field: string;
  rule: string;
  message: string;
  path?: string;
};
export type EvidenceCandidate = {
  commit: string | null;
  tree: string | null;
  dirty: boolean | null;
  dirtyPaths: string[];
  error?: string;
};
export type ProductSemanticEvidenceReport = {
  schema: 'ProductSemanticEvidenceReport/v1';
  contractVersion: string | null;
  generatedAt: string;
  node: string;
  actor: { driven_by: 'agent'; actor: string };
  command: string[];
  exitCode: number;
  candidate: EvidenceCandidate;
  normalization: { policy: string; rawDigestPolicy: string };
  /** Ids of in-memory fixtures applied while generating; non-empty marks a negative-test artifact. */
  fixtures: string[];
  /** Relation rules the registry validator actually reported under RELATION_RULE_PROBES, then the checker's own source rules. */
  rulesEvaluated: string[];
  relations: Array<{ relationKey: string; sourceRefs: SourceRefFacts[] }>;
  diagnostics: EvidenceDiagnostic[];
  unverified: Array<{ relationKey: string; path: string; reason: string }>;
  status: 'valid' | 'invalid';
  /** Present only on an exit-2 report whose registry or fixtures could not be loaded. */
  loadError?: string;
};
export type RelationValidationContext = { concepts?: readonly string[]; contractVersion?: string; sessionScope?: 'same-session' | 'cross-session' };
/** The subset of shared/product-semantics.ts exports the report consumes. */
export type SemanticRegistryModule = {
  PRODUCT_SEMANTIC_CONTRACT_VERSION: string;
  PRODUCT_SEMANTIC_RELATION_RULES: readonly string[];
  PRODUCT_SEMANTIC_RELATIONS: readonly unknown[];
  relationKey(relation: { from: string; kind: string; to: string }): string;
  validateProductSemanticRelations(candidates: readonly unknown[], context?: RelationValidationContext): {
    ok: boolean;
    diagnostics: Array<{ relationKey: string; field: string; rule: string; message: string }>;
  };
};
/** One probe per declared relation rule: input a working validator must reject with exactly that rule. */
export type RelationRuleProbe = { rule: string; candidates: readonly unknown[]; context?: RelationValidationContext };
export const RELATION_RULE_PROBES: readonly RelationRuleProbe[];
export type RelationRuleObservation = {
  /** Declared rules the validator actually reported, in declared order, followed by reported-but-undeclared rules. */
  observed: string[];
  missing: string[];
  unknown: string[];
};

export function normalizeRef(ref: string): string;
export function digestEvidenceBytes(bytes: Uint8Array): { digest: string; rawDigest: string };
/** Candidate blobs (HEAD:<ref>) for every ref, from one `git cat-file --batch`; absent when HEAD has no blob there; null when git could not answer. */
export function collectCandidateBlobs(root: string, refs: readonly string[]): Map<string, Buffer> | null;
export function describeSourceRef(
  root: string,
  ref: string,
  options?: { candidateBlobs?: Map<string, Uint8Array> | null; rewrites?: Record<string, string>; readPaths?: Set<string> },
): SourceRefFacts;
export function sourceRefDiagnostics(relationKey: string, facts: SourceRefFacts): EvidenceDiagnostic[];
export function describeCandidate(root: string): EvidenceCandidate;
export function observeRelationRules(registry: SemanticRegistryModule, extraDiagnostics?: readonly { rule: string }[]): RelationRuleObservation;
export function buildEvidenceReport(input: {
  root: string;
  registry: SemanticRegistryModule;
  candidate: EvidenceCandidate;
  actor: string;
  command: string[];
  fixtures?: string[];
  rewrites?: Record<string, string>;
  readPaths?: Set<string>;
  generatedAt?: string;
}): ProductSemanticEvidenceReport;
export function verifyEvidenceReport(
  report: unknown,
  options: {
    root: string;
    contractVersion: string;
    candidate: EvidenceCandidate;
    rewrites?: Record<string, string>;
    readPaths?: Set<string>;
    registry?: SemanticRegistryModule | null;
  },
): { status: 'valid' | 'invalid'; diagnostics: EvidenceDiagnostic[]; rulesEvaluated: string[] };
