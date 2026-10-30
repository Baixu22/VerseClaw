export const AGENT_FIRST_LOOP_SCHEMA: 'AgentFirstEvaluationLoop/v1';
export const AGENT_FIRST_LOOP_VALIDATION_SCHEMA: 'AgentFirstEvaluationLoopValidation/v1';

export const LOOP_PATHS: {
  readonly guide: string;
  readonly registry: string;
  readonly loop: string;
  readonly promotionPolicy: string;
};

export const SIGNAL_STATUSES: readonly string[];
export const FRAMEWORK_AUTHOR: 'framework';
export const REQUIRED_LOOP_GUIDE_PHRASES: readonly string[];

export interface LoopViolation {
  code: string;
  path: string;
  message: string;
}

export interface LoopCounts {
  signals: number;
  candidates: number;
  reEvaluations: number;
  promotions: number;
}

export interface LoadedLoopFiles {
  guide: string;
  registry: unknown;
  loop: unknown;
  promotionPolicyDigest: string;
  inputDigests: Record<string, string>;
}

export interface LoopNegativeControl {
  id: string;
  requirement: string;
  expectedCode: string;
  prepare?: (draft: { guide: string; registry: any; loop: any; promotionPolicyDigest: string }) => void;
  mutate: (draft: { guide: string; registry: any; loop: any; promotionPolicyDigest: string }) => void;
}

export interface LoopNegativeControlResult {
  id: string;
  requirement: string;
  expectedCode: string;
  baselineValid: boolean;
  rejected: boolean;
  observedCodes: string[];
}

export const LOOP_NEGATIVE_CONTROLS: readonly LoopNegativeControl[];

export function computeHeldOutDigest(suite: unknown, suiteContentDigest?: string | null): string | null;
export function computeGraduationPolicyDigest(policy: unknown): string;

export function countLoop(loop: unknown): LoopCounts;

export function validateLoopRecord(
  loop: unknown,
  registry: unknown,
): { violations: LoopViolation[]; counts: LoopCounts };

export function validateLoopContract(
  input?: { registry?: unknown; loop?: unknown; guide?: string; promotionPolicyDigest?: string },
): { violations: LoopViolation[]; counts: LoopCounts };

export function loadLoopFiles(root?: string): LoadedLoopFiles;

export function runLoopNegativeControls(files: LoadedLoopFiles): LoopNegativeControlResult[];
