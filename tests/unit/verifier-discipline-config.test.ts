import { describe, expect, it } from 'vitest';
import { createOrchestratorPlan } from '../../openclaw_runtime/src/agents/orchestrator';

describe('verifier runtime config', () => {
  it('reads canonical configuration and preserves an explicit request override', () => {
    const request = { task: 'Review the implementation', cfg: { runtime: { coding: { verifier: { noSelfRepair: false } } } } };
    expect(createOrchestratorPlan(request).verifierNoSelfRepair).toBe(false);
    expect(createOrchestratorPlan({ ...request, verifierNoSelfRepair: true }).verifierNoSelfRepair).toBe(true);
    expect(createOrchestratorPlan({ task: request.task }).verifierNoSelfRepair).toBe(true);
  });
});
