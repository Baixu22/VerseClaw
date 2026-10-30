import type { ContractCounts, ContractViolation, NegativeControlResult } from './lib/agent-first-acceptance-contract.d.mts';

export interface AgentFirstAcceptanceValidationReport {
  schemaVersion: string;
  checkedAt: string;
  driven_by: string;
  actor: string;
  command: string;
  scope: string;
  counts: ContractCounts;
  negativeControls: NegativeControlResult[];
  violations: ContractViolation[];
  limitations: string[];
}

export function checkAgentFirstAcceptanceContract(
  root?: string,
  actor?: string,
  checkedAt?: string,
): {
  ok: boolean;
  report: AgentFirstAcceptanceValidationReport;
  counts: ContractCounts;
  controls: NegativeControlResult[];
  violations: ContractViolation[];
};
