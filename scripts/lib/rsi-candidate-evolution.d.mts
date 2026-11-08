import type { KnowledgeStore } from '../../openclaw_runtime/src/knowledge/sekb/knowledge-store.js';
import type { Trajectory, SekbAttributionReceipt } from '../../openclaw_runtime/src/knowledge/sekb/types.js';
import type { BenefitCandidate, BenefitTask } from './rsi-benefit-eval.mjs';
import type { evaluateAblation, PromotionVerdict } from './paired-ablation.mjs';

type Store = Pick<KnowledgeStore, 'create_trajectory' | 'find_trajectory' | 'get_trajectory' | 'query_trajectories' | 'list_adoption_events'>;
export type EvolutionCase = { caseId: string; inputDigest: string; graderDigest: string; safetyRequired?: boolean;
  anchor?: 'positive' | 'negative' | null; negativeExpectedOutcome?: 'pass' | 'fail' };
type Envelope = { providerCalls: number; tokens: number; costUsd: number; wallClockMs: number };
export type EvolutionRunInput = { runId: string; actor: string; baseline: BenefitCandidate;
  splits: { training: EvolutionCase[]; validation: EvolutionCase[]; heldOut: EvolutionCase[] };
  budget: { maxGenerations: number; perGeneration: Envelope; wholeRun: Envelope } };
export type EvolutionPlan = EvolutionRunInput & { schemaVersion: 'RsiCandidateEvolutionPlan/v1'; driven_by: 'agent'; heldOutDigest: string;
  policy: { sourceDigest: string; k: number; minCases: number; minimumImprovement: number; costIncreaseMaximum: number;
    maxFlakeCases: number; minSafetyCases: number; minPositiveAnchors: number; minNegativeAnchors: number;
    selectionRule: 'first-qualified-generation' } };
export type EvolutionSource = { trajectoryId: string; runId: string; caseId: string; inputDigest: string; graderDigest: string;
  outcome: Trajectory['outcome']; summary: string; observations: Array<{ stage: 'initial' | 'repaired'; toolCallId: string; exitCode: number;
    sourceDigest: string; inputDigest: string; outputDigest: string; stdoutDigest: string; stderrDigest: string }>;
  steps: Trajectory['steps']; cost: Trajectory['cost']; attribution: SekbAttributionReceipt[]; digest: string };
export type EvolutionCandidate = { id: string; kind: 'evolved-prompt'; version: string; context: string; runId: string; generation: number;
  planDigest: string; parent: { id: string; version: string }; sourceDigest: string; sourceCaseIds: string[] };
type Usage = { providerCalls: number | null; tokens: number | null; costUsd: number | null };
export type EvolutionGeneration = { status: 'generated' | 'failed'; candidate: EvolutionCandidate | null; failure: string | null;
  usage: Usage | null; generatorActor: string | null; elapsedMs: number; attemptDigest: string; originalOutputDigest: string | null };
export type EvolutionRawResult = { command: string; source: string; sourceDigest: string; exitCode: number | null; stdout: string; stderr: string; elapsedMs: number };
export type EvolutionValidationRow = { caseId: string; repeat: number; outcome: 'pass' | 'fail' | 'missing' | 'timeout' | 'crash' | 'skip';
  tokens: number | null; toolCalls: number | null; safetyViolation: boolean; rawResult: EvolutionRawResult | null; rawDigest: string | null };
export type EvolutionValidation = { evidenceKind: 'agent-scripted-control'; actor: string;
  baselineRuns: EvolutionValidationRow[]; treatmentRuns: EvolutionValidationRow[] };
export type EvolutionDecision = { candidateId: string; candidateVersion: string; status: 'eliminate' | 'hold'; numerical: PromotionVerdict;
  evaluation: ReturnType<typeof evaluateAblation>; costs: Record<'tokens' | 'toolCalls', { baseline: number | null; treatment: number | null; increase: number | 'unbounded' | null }>;
  requiredCoverage: boolean; measurementEligible: boolean; reasons: string[]; validationDigest: string; validation: EvolutionValidation };
export type EvolutionAttempt = { generation: number; planDigest: string; parent: { id: string; version: string; context: string };
  sources: EvolutionSource[]; reservation: Envelope; inputDigest: string };
export type EvolutionEntry = { schemaVersion: 'RsiCandidateEvolutionEntry/v1'; runId: string; generation: number; digest: string } & (
  { kind: 'plan'; payload: EvolutionPlan } | { kind: 'attempt'; payload: EvolutionAttempt } |
  { kind: 'candidate'; payload: EvolutionGeneration } | { kind: 'decision'; payload: EvolutionDecision }
);
export type EvolutionExport = { schemaVersion: 'RsiCandidateEvolutionExport/v1'; driven_by: 'agent'; actor: string; runId: string; plan: EvolutionPlan;
  entries: EvolutionEntry[]; unfinishedGenerations: number[]; candidates: EvolutionGeneration[]; decisions: EvolutionDecision[];
  budget: Usage & { reserved: Envelope; unknownGenerations: number[] }; measurementCandidateId: string | null; selectedCandidateId: null;
  claims: { benefit: false; promotionReady: false; paidProviderMeasurement: false; productDefaultsChanged: false; realHuman: false } };
export type EvolutionBenefitBinding = { schemaVersion: 'RsiBenefitEvolutionBinding/v1'; generation: number; exportDigest: string;
  candidateVersion: string; heldOutDigest: string; export: EvolutionExport };

export function freezeEvolutionRun(store: Store, input: EvolutionRunInput): EvolutionPlan;
export function generateEvolutionCandidate(store: Store, input: { runId: string; generation: number; parentId: string; sourceTrajectoryIds: string[] },
  generator: (view: { generation: number; parent: EvolutionAttempt['parent']; sources: EvolutionSource[]; budget: Envelope }, signal: AbortSignal) =>
    Promise<{ context: string; usage: Usage; actor: string }>): Promise<EvolutionGeneration>;
export function screenEvolutionCandidate(store: Store, input: { runId: string; generation: number; validation: EvolutionValidation }): EvolutionDecision;
export function resolveEvolutionPrompt(previousPrompt: string, candidate: EvolutionCandidate | null, enabled?: boolean): string;
export function exportEvolutionRun(store: Store, runId: string): EvolutionExport;
export function buildEvolutionExport(entries: EvolutionEntry[]): EvolutionExport;
export function checkEvolutionExport(exported: unknown): { passed: boolean; errors: string[]; entries?: number; generations?: number };
export function bindEvolutionCandidate(exported: EvolutionExport, generation: number, tasks: BenefitTask[]): { candidate: BenefitCandidate; evolution: EvolutionBenefitBinding };
