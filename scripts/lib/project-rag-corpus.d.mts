import type { SourceRefV2 } from 'openclaw/plugin-sdk/memory-owner-read-types';
export type RagFact = { schema: 'SourceSpanGold/v1'; field: string; value: unknown; sourceId: string; quote: string; sourceRef: SourceRefV2; support?: { startByte: number; endByteExclusive: number }; authorship: Record<string, unknown> };
export type RagSource = { id: string; familyId: string; split: string; path: string; ref: SourceRefV2; ownerRevision: string; origin: { repository: string; commit: string; path: string; gitBlob: string; digest: string; startByte: number; endByteExclusive: number } };
export type RagQuery = { id: string; baseId: string; familyId: string; split: string; locale: string; intent: string; question: string };
export type RagTask = { id: string; familyId: string; split: string; profile: string; locale: string; kind: string; outputPath: string; proofPath?: string;
  code?: { programPath: string; symbol: string; originPath: string; starterDigest: string };
  scenario?: Record<string, any>; requiredFields: string[]; input: { values: Record<string, unknown>; untouched: Record<string, unknown> }; scope: Record<string, unknown> };
export type RagSlot = { id: string; taskId: string; repeat: number; arm: string; profile: string; status: 'not-run'; envelopeDigest: string };
export type FrozenRagBundle = { root: string; freezeDigest: string; corpus: { id: string; owner: { namespaceId: string; workspaceId: string }; sources: RagSource[]; families: Array<{ id: string; split: string; sourceIds: string[] }> };
  queries: RagQuery[]; tasks: RagTask[]; plan: { slots: RagSlot[] }; gold: Array<{ queryId: string; facts: RagFact[] }>; taskGold: Array<{ taskId: string; facts: RagFact[]; code?: Record<string, any>; analysis?: Record<string, any> }>;
  negatives: Array<{ id: string; kind: string; locale: string; sourceId: string; expected: string; canary: string }>; policy: Record<string, any>; baseline: Record<string, any> };
export const RAG_LOCALES: string[];
export const RAG_SPLITS: string[];
export const RAG_ARMS: string[];
export const RAG_INTENTS: string[];
export function sha256(bytes: string | Uint8Array): string;
export function jsonBytes(value: unknown): Buffer;
export function safeCorpusFile(root: string, name: string): string;
export function spanText(raw: Uint8Array, locator: NonNullable<SourceRefV2['locator']>): string;
export function loadFrozenRagCorpus(root: string, expectedFreezeDigest: string): FrozenRagBundle;
export function materializeRagTask(bundle: FrozenRagBundle, taskId: string, workspace: string, receiptDirectory: string,
  namespaceForVault: (vault: string) => string, options?: { anonymizationSeed?: string; heldOutRelease?: { corpusDigest: string; cleanCandidate: string; calibrationFrozen: boolean; calibrationReceiptDigest: string } }): { workspace: string; receiptPath: string; receipt: Record<string, any> };
export function gradeRagTaskArtifact(bundle: FrozenRagBundle, taskId: string, workspace: string, materializationReceipt: string): {
  schema: string; actor: string; driven_by: string; taskId: string; corpusDigest: string; query_result_match: boolean | null; behavior_match?: boolean; passed: boolean; artifactDigest: string | null;
  issues: Array<{ kind: string; reason: string; field?: string }>; gradingMode: string };
export type RagExecutionEvidence = { directory: string; experimentDigest: string; safetyDigest: string; attemptDigests: Record<string, string> };
export function evaluateRagTaskPromotion(bundle: FrozenRagBundle, runs: Array<Record<string, any>>, evidence?: RagExecutionEvidence): Record<string, any>;
export function bindRagExperiment(bundle: FrozenRagBundle, input: Record<string, any>): { binding: Record<string, any>; digest: string };
