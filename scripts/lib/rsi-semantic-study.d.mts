import type { IndependentCodingPack } from './rsi-constructed-tasks.mjs';
export const SEMANTIC_CASES_PATH: string;
export const SEMANTIC_OBSERVED_POPULATION_PATH: string;
export type SemanticCasePack = IndependentCodingPack & { datasetVersion: 'RsiSemanticIndependentCases/v1'; realHumanEvidence: false;
  cases: Array<IndependentCodingPack['cases'][number] & { independenceGroup: string }> };
export function semanticPowerPlan(discordance?: number): { method: string; inferenceUnit: string; confidenceLevel: number; targetPower: number;
  minimumDetectableEffect: number; discordanceAssumption: number; varianceAssumption: number; requiredIndependentCases: number; repeatsPerArm: number; observedPower: null };
export type SemanticStudyDesign = { schemaVersion: 'RsiSemanticStudyDesign/v1'; driven_by: 'agent'; actor: string; realHumanEvidence: false;
  populationDigest: string; priorPopulationDigests: string[]; trainingCaseIds: string[]; splits: Record<'validation' | 'heldOut', Array<{
    caseId: string; split: string; independenceGroup: string; contractDigest: string; privateOracleDigest: string; referenceDigest: string;
    safetyRequired: boolean; anchor: string | null }>>; independentCases: Record<'validation' | 'heldOut', number>;
  power: ReturnType<typeof semanticPowerPlan>; sensitivity: Array<ReturnType<typeof semanticPowerPlan>>;
  cost: { toolBudget: typeof import('./rsi-coding-protocol.mjs').FILE_WRITE_TOOL_COST_POLICY; toolComparison: string; reporting: string[]; unknownUsage: string };
  headroom: { status: string; maximumBaselinePass3ForPilot: number; action: string }; measurementReady: boolean; gaps: string[];
  experienceBenefit: false; promotionReady: false; status: 'NO_GO'; [key: string]: unknown };
export function buildSemanticStudyDesign(pack: SemanticCasePack, priorPacks: IndependentCodingPack[], trainingCaseIds?: string[]): SemanticStudyDesign;
export function assertSemanticMeasurementReady(design: { schemaVersion: string; [key: string]: unknown }, inputs?: {
  pack: SemanticMeasuredCasePack; priorPacks: IndependentCodingPack[]; headroom: SemanticVerifiedHeadroom; trainingCaseIds?: readonly string[];
  observedPacks?: SemanticMeasuredCasePack[] }): true;
export const SEMANTIC_MEASURED_THRESHOLDS: Readonly<{ minimumCompleteCaseFloor: 20; minimumAbsoluteImprovement: 0.05;
  intervalLowerBoundExclusive: 0; maximumRelativeTokenIncrease: 0.1; requireEveryPlannedCaseComplete: true;
  requireKnownUsage: true; requireNoSafetyOrAnchorViolation: true; requireOffOnOffRollback: true; requireProductAcceptance: true }>;
export type SemanticFamilyReview = { schemaVersion: 'RsiSemanticFamilyReview/v1'; driven_by: 'agent'; actor: string; basis: string;
  sourceId: string; sourceIds?: string[]; sourceIdentities?: string[]; familyId: string; contractDigest: string;
  referenceDigest: string; privateOracleDigest: string };
export type SemanticMeasuredCasePack = Omit<IndependentCodingPack, 'cases'> & { datasetVersion: 'RsiSemanticIndependentCases/v2';
  usage: 'scripted-control' | 'prospective-measurement'; realHumanEvidence: false; executionKind?: 'stdio-program'; cases: Array<IndependentCodingPack['cases'][number] & {
    familyId: string; independenceGroup: string; provenance: { sourceId: string; sourceIdentities?: string[]; upstreamIds?: string[];
      selectedUpstreamId?: string; familyReview: SemanticFamilyReview } }> };
export type SemanticNativeTarget = { populationDigest: string; executionKind: 'stdio-program';
  cases: Array<{ caseId: string; familyId: string; caseDigest: string }> };
export type SemanticVerifiedHeadroom = { executorRoot: string; directory: string; sourceCommit: string;
  planDigest: string; reportSha256: string; qualified: true; baselinePass3: number; independentCases: number;
  exclusions: SemanticHeadroomDesign['excludedFromFutureMeasurement'] | SemanticNativeHeadroomDesign['excludedFromFutureMeasurement'];
  providerCallsDuringReplay: 0 } & ({ schemaVersion: 'RsiVerifiedHeadroom/v1' } | { schemaVersion: 'RsiVerifiedHeadroom/v2';
    target: SemanticNativeTarget; measurement: NativeMeasurementReservation });
export type SemanticMeasurementDesign = {
  schemaVersion: 'RsiSemanticStudyDesign/v2' | 'RsiSemanticStudyDesign/v3'; headroom: SemanticVerifiedHeadroom; usage: SemanticMeasuredCasePack['usage'];
  driven_by: 'agent'; actor: string; realHumanEvidence: false; populationDigest: string; priorPopulationDigests: string[];
  trainingCaseIds: string[]; measurementReady: boolean; gaps: string[]; experienceBenefit: false; promotionReady: false; status: 'NO_GO';
  splits: Record<'validation' | 'heldOut', Array<{ caseId: string; split: string; familyId: string; contractDigest: string;
    privateOracleDigest: string; referenceDigest: string; implementationShape: string; sourceId: string; provenanceDigest: string;
    sourceIdentities?: string[]; safetyRequired: boolean; anchor: string | null }>>; thresholds: typeof SEMANTIC_MEASURED_THRESHOLDS;
  power: ReturnType<typeof semanticPowerPlan>; independentCases: Record<'validation' | 'heldOut', number>; [key: string]: unknown };
export function semanticImplementationShape(source: string): string;
export function verifyStdioOracleReport(registry: Record<string, any>, pack: Record<string, any>, phase: 'baseline' | 'reference' | 'no-output',
  execution: Record<string, any>, report: Record<string, any>, options?: { allowReferenceFailure?: boolean }): Record<string, any>;
export function buildSemanticMeasurementDesign(pack: SemanticMeasuredCasePack, priorPacks: IndependentCodingPack[],
  headroom: SemanticVerifiedHeadroom, trainingCaseIds?: readonly string[], observedPacks?: SemanticMeasuredCasePack[]): SemanticMeasurementDesign;
export function semanticControlPopulation(pack: SemanticCasePack, headroom: SemanticVerifiedHeadroom): SemanticMeasuredCasePack;
export const SEMANTIC_HEADROOM_ENVELOPE: Readonly<{ maxProviderCalls: 145; maxTotalTokens: 2000000; currency: 'CNY'; maxCost: 0;
  route: 'existing-free-quota'; newPurchaseAllowed: false }>;
export const SEMANTIC_TRAINING_CASE_IDS: readonly string[];
export type SemanticHeadroomDesign = {
  schemaVersion: 'RsiSemanticHeadroomDesign/v1'; driven_by: 'agent'; actor: string; realHumanEvidence: false;
  prototypeDigest: string; priorPopulationDigests: string[]; trainingCaseIds: string[];
  sampling: { seed: string; method: string; selected: Array<SemanticStudyDesign['splits']['validation'][number] & { familyId: string }> };
  excludedFromFutureMeasurement: { cases: SemanticHeadroomDesign['sampling']['selected']; priorFamilies: string[]; rule: string };
  primaryMetric: string; repeatsPerCase: 3; collectorVersion: 'RsiCodingCollector/v7'; arms: ['sekb-off'];
  acceptance: { requireEveryPlannedCaseComplete: true; requireEverySlotIndependentlyGraded: true; requireKnownUsage: true;
    maximumBaselinePass3: number; inferenceScope: string };
  futurePower: ReturnType<typeof semanticPowerPlan>; authorizationRequest: { approved: false } & typeof SEMANTIC_HEADROOM_ENVELOPE;
  measurementReady: false; experienceBenefit: false; promotionReady: false; status: 'NO_GO';
};
export function buildSemanticHeadroomDesign(pack: SemanticCasePack, priorPacks: IndependentCodingPack[], trainingCaseIds?: readonly string[]): SemanticHeadroomDesign;
export function semanticHeadroomPack(pack: SemanticCasePack, design: SemanticHeadroomDesign): IndependentCodingPack & { datasetVersion: 'RsiSemanticHeadroomCases/v1' };
export type SemanticNativeHeadroomDesign = Omit<SemanticHeadroomDesign, 'schemaVersion' | 'sampling' | 'excludedFromFutureMeasurement'> & {
  schemaVersion: 'RsiSemanticHeadroomDesign/v2'; target: SemanticNativeTarget; measurement: NativeMeasurementReservation;
  sampling: { seed: string; method: string; selected: SemanticMeasurementDesign['splits']['validation'];
    strata: Array<{ key: string; families: number; selected: number }> };
  excludedFromFutureMeasurement: { cases: SemanticMeasurementDesign['splits']['validation']; priorFamilies: string[]; rule: string };
};
export function buildNativeHeadroomDesign(pack: SemanticMeasuredCasePack, priorPacks: IndependentCodingPack[],
  observedPacks: SemanticMeasuredCasePack[], trainingCaseIds?: readonly string[]): SemanticNativeHeadroomDesign;
export function nativeHeadroomPack(pack: SemanticMeasuredCasePack, design: SemanticNativeHeadroomDesign): SemanticMeasuredCasePack;
export type NativeMeasurementReservation = { schemaVersion: 'RsiNativeMeasurementReservation/v1'; seed: string;
  requiredPerSplit: number; minimumTargetFamilies: number; reservedPilotFamilies: string[];
  assignments: Array<{ caseId: string; familyId: string; split: 'validation' | 'heldOut' }>; gaps: string[]; ready: boolean };
export function reserveNativeMeasurementCases(cases: Array<{ caseId: string; familyId: string; safetyRequired: boolean;
  anchor: string | null }>, pilotFamilies: string[]): NativeMeasurementReservation;
export function nativeMeasurementPack(pack: SemanticMeasuredCasePack, design: SemanticNativeHeadroomDesign): SemanticMeasuredCasePack;
export type SemanticHeadroomSummary = { complete: boolean; allGraded: boolean; knownUsage: boolean;
  cases: Array<{ caseId: string; familyId: string; outcomes: string[]; pass3: boolean }>;
  baselinePass3: number | null; qualified: boolean; gaps: string[]; headroomStatus: string;
  observedTaskTokens: number | null; knownTaskTokens: number; tokenMeasurementBasis: 'provider-reported' | 'scripted-proxy'; providerCalls: number; inferenceScope: string;
  measurementReady: false; experienceBenefit: false; promotionReady: false };
export function summarizeSemanticHeadroom(plan: import('./rsi-coding-study.mjs').SemanticHeadroomPlan,
  observations: Array<ReturnType<typeof import('./rsi-guided-evidence.mjs').readGuidedTrialEvidence>>,
  accounting: ReturnType<ReturnType<typeof import('./rsi-campaign-budget.mjs').createCampaignLedger>['snapshot']> | null,
  ended: { stopReason: string | null } | null): SemanticHeadroomSummary;
export type SemanticOracleReport = { success: boolean; numTotalTests: number; numPassedTests: number; numFailedTests: number;
  numPendingTests: number; numTodoTests?: number; testResults: Array<{ name: string; status: string; message: string;
    assertionResults: Array<{ fullName: string; status: string; failureMessages: string[] }> }> };
export function verifySemanticOracleReport(registry: ReturnType<typeof import('./rsi-constructed-tasks.mjs').createConstructedTasks>,
  pack: Pick<IndependentCodingPack, 'cases'>, phase: 'baseline' | 'reference', execution: { cwd: string; exitCode: number | null; signal: string | null; error: string | null },
  report: SemanticOracleReport): { cases: Array<{ caseId: string; outcome: string; passedAssertions: number; failedAssertions: number }>;
    passedAssertions: number; failedAssertions: number };
