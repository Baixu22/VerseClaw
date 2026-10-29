export const AGENT_FIRST_ACCEPTANCE_SCHEMA: 'AgentFirstAcceptanceMatrix/v1';
export const AGENT_FIRST_ACCEPTANCE_RESEARCH_SCHEMA: 'AgentFirstAcceptanceResearch/v1';
export const AGENT_FIRST_ACCEPTANCE_VALIDATION_SCHEMA: 'AgentFirstAcceptanceValidation/v1';

export const CONTRACT_PATHS: {
  readonly guide: string;
  readonly matrix: string;
  readonly sources: string;
  readonly closeout: string;
};

export const REQUIRED_GATE_FIELDS: readonly string[];
export const REQUIRED_GATE_IDS: readonly string[];
export const REQUIRED_DIMENSIONS: readonly string[];
export const REQUIRED_VERDICT_STATES: readonly string[];
export const REQUIRED_EVIDENCE_PACK: readonly string[];
export const REQUIRED_TASK_FOREST_NODES: Readonly<Record<string, string>>;
export const REQUIRED_LOCKED_BOUNDARIES: Readonly<Record<string, unknown>>;
export const REQUIRED_SOURCE_FAMILIES: readonly string[];
export const MINIMUM_SOURCE_COUNT: number;
export const MINIMUM_AGENT_ERA_SOURCE_COUNT: number;
export const MINIMUM_FINDING_COUNT: number;
export const REQUIRED_GUIDE_PHRASES: readonly string[];
export const REQUIRED_GUIDE_STATEMENTS: readonly string[];

export interface ContractViolation {
  code: string;
  path: string;
  message: string;
}

export interface ContractCounts {
  gates: number;
  dimensions: number;
  verdictStates: number;
  sources: number;
  findings: number;
}

export interface AgentFirstAcceptanceContractInput {
  matrix?: unknown;
  sources?: unknown;
  guide?: string;
  closeout?: string;
}

export interface LoadedAgentFirstAcceptanceContract {
  matrix: unknown;
  sources: unknown;
  guide: string;
  closeout: string;
  raw: { guide: string; matrix: string; sources: string };
}

export interface NegativeControl {
  id: string;
  requirement: string;
  expectedCode: string;
  mutate: (draft: { matrix: any; sources: any; guide: string; closeout: string }) => void;
}

export const NEGATIVE_CONTROLS: readonly NegativeControl[];

export interface NegativeControlResult {
  id: string;
  requirement: string;
  expectedCode: string;
  rejected: boolean;
  observedCodes: string[];
}

export function validateAgentFirstAcceptanceContract(
  input?: AgentFirstAcceptanceContractInput,
): { violations: ContractViolation[]; counts: ContractCounts };

export function countContract(matrix: unknown, sources: unknown): ContractCounts;

export function loadAgentFirstAcceptanceContractFiles(root?: string): LoadedAgentFirstAcceptanceContract;

export function sha256(text: string): string;

export function validateAgentFirstAcceptanceContractFiles(
  root?: string,
): { violations: ContractViolation[]; counts: ContractCounts; hashes: { guide: string; matrix: string; sources: string } };

export function runAgentFirstAcceptanceNegativeControls(
  files: LoadedAgentFirstAcceptanceContract,
): NegativeControlResult[];
