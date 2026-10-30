export const AGENT_FIRST_FRAMEWORK_SCHEMA: 'AgentFirstEvaluationFramework/v1';
export const AGENT_FIRST_FRAMEWORK_VALIDATION_SCHEMA: 'AgentFirstEvaluationFrameworkValidation/v1';
export const AGENT_FIRST_TASK_SCHEMA: 'AgentFirstTask/v1';

export const FRAMEWORK_PATHS: {
  readonly guide: string;
  readonly registry: string;
};

export const SUBJECT_ADAPTER_METHODS: readonly string[];
export const SUBJECT_IDENTITY_FIELDS: readonly string[];
export const GRADER_KINDS: readonly string[];
export const SUBJECT_KINDS: readonly string[];
export const PROFILE_STATUSES: readonly string[];
export const MINIMUM_SUITE_K: number;
export const MINIMUM_SUITE_CASES: number;
export const REQUIRED_FRAMEWORK_GUIDE_PHRASES: readonly string[];

export interface FrameworkViolation {
  code: string;
  path: string;
  message: string;
}

export interface FrameworkCounts {
  subjects: number;
  suites: number;
  graders: number;
  profiles: number;
}

export interface LoadedFrameworkFiles {
  guide: string;
  registry: unknown;
}

export interface FrameworkNegativeControl {
  id: string;
  requirement: string;
  expectedCode: string;
  mutate: (draft: { guide: string; registry: any }) => void;
}

export interface FrameworkNegativeControlResult {
  id: string;
  requirement: string;
  expectedCode: string;
  rejected: boolean;
  observedCodes: string[];
}

export const FRAMEWORK_NEGATIVE_CONTROLS: readonly FrameworkNegativeControl[];

export function countFramework(registry: unknown): FrameworkCounts;

export function validateFrameworkRegistry(
  registry: unknown,
): { violations: FrameworkViolation[]; counts: FrameworkCounts };

export function validateFrameworkContract(
  input?: { registry?: unknown; guide?: string },
): { violations: FrameworkViolation[]; counts: FrameworkCounts };

export function loadFrameworkFiles(root?: string): LoadedFrameworkFiles;

export function runFrameworkNegativeControls(files: LoadedFrameworkFiles): FrameworkNegativeControlResult[];