import type {
  LoopCounts,
  LoopNegativeControlResult,
  LoopViolation,
} from './lib/agent-first-evaluation-loop.d.mts';

export interface AgentFirstLoopValidationReport {
  schemaVersion: string;
  checkedAt: string;
  driven_by: string;
  actor: string;
  command: string;
  scope: string;
  counts: LoopCounts;
  inputDigests: Record<string, string>;
  evaluationStatus: 'not-run' | 'recorded-results-not-replayed';
  negativeControls: LoopNegativeControlResult[];
  violations: LoopViolation[];
  limitations: string[];
}

export function checkAgentFirstLoopContract(
  root?: string,
  actor?: string,
  checkedAt?: string,
): {
  ok: boolean;
  report: AgentFirstLoopValidationReport;
  counts: LoopCounts;
  controls: LoopNegativeControlResult[];
  violations: LoopViolation[];
};
