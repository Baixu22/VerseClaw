import type {
  FrameworkCounts,
  FrameworkNegativeControlResult,
  FrameworkViolation,
} from './lib/agent-first-evaluation-framework.d.mts';

export interface AgentFirstFrameworkValidationReport {
  schemaVersion: string;
  checkedAt: string;
  driven_by: string;
  actor: string;
  command: string;
  scope: string;
  counts: FrameworkCounts;
  negativeControls: FrameworkNegativeControlResult[];
  violations: FrameworkViolation[];
  limitations: string[];
}

export function checkAgentFirstFrameworkContract(
  root?: string,
  actor?: string,
  checkedAt?: string,
): {
  ok: boolean;
  report: AgentFirstFrameworkValidationReport;
  counts: FrameworkCounts;
  controls: FrameworkNegativeControlResult[];
  violations: FrameworkViolation[];
};