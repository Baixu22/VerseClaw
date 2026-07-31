const REQUIRED_PROFILES = ['dcs-coding', 'sekb-assisted', 'browser-supervised'];

function addError(errors, condition, message) {
  if (!condition) errors.push(message);
}

export function validateTf0009AgentSurrogateCharter(charter) {
  const errors = [];
  addError(errors, charter?.schema === 'tf0009-agent-surrogate-charter/v1', 'charter schema mismatch');
  addError(errors, charter?.authority === 'user-directed-agent-surrogate', 'charter authority mismatch');
  addError(errors, charter?.evidenceClass === 'engineering-agent-surrogate', 'charter evidence class mismatch');
  addError(errors, charter?.humanEquivalent === false, 'charter must keep humanEquivalent=false');
  addError(errors, charter?.liveEvidence === false, 'charter must keep liveEvidence=false');
  addError(errors, charter?.requiredRunsPerProfile === 10, 'charter requires exactly 10 runs per profile');
  addError(errors, charter?.terminalTaskStatus === 'review_needed', 'charter terminal status must be review_needed');
  addError(errors, charter?.mayMarkDone === false, 'charter must prohibit done');
  addError(errors, charter?.mayReleaseTF0011 === false, 'charter must not self-authorize TF-0011 release');
  addError(errors, charter?.hardBounds?.liveReady === false, 'liveReady lock drifted');
  addError(errors, charter?.hardBounds?.productApproved === false, 'productApproved lock drifted');
  addError(errors, charter?.hardBounds?.defaultOn === false, 'defaultOn lock drifted');
  addError(errors, charter?.hardBounds?.c1ReductionFactor === 4.5, 'C1 reduction lock drifted');
  addError(errors, charter?.hardBounds?.c1MeetsGate === false, 'C1 gate lock drifted');
  addError(errors, charter?.hardBounds?.c1Recommendation === 'keep-off', 'C1 recommendation drifted');
  addError(errors, charter?.hardBounds?.tf0006 === 'blocked', 'TF-0006 lock drifted');
  addError(errors, charter?.hardBounds?.sekbAutoWriteback === false, 'SEKB auto-writeback lock drifted');
  addError(errors, charter?.hardBounds?.browserPrivateNetwork === 'deny', 'Browser private-network lock drifted');
  addError(errors, charter?.hardBounds?.runtimeMemory === 'diagnostics-only', 'Runtime Memory boundary drifted');

  const profiles = new Map((charter?.profiles ?? []).map((profile) => [profile.id, profile]));
  for (const id of REQUIRED_PROFILES) {
    const profile = profiles.get(id);
    addError(errors, Boolean(profile), `missing charter profile ${id}`);
    addError(errors, profile?.operator?.kind === 'agent', `${id} operator must be an agent`);
    addError(errors, typeof profile?.componentPath === 'string' && profile.componentPath.length > 0, `${id} componentPath missing`);
    addError(errors, Array.isArray(profile?.stopConditions) && profile.stopConditions.length > 0, `${id} stopConditions missing`);
  }
  return { ok: errors.length === 0, errors };
}

export function validateTf0009AgentSurrogateReport(report) {
  const errors = [];
  addError(errors, report?.schema === 'tf0009-agent-surrogate-report/v1', 'report schema mismatch');
  addError(errors, report?.authority === 'engineering-agent-surrogate-only', 'report authority mismatch');
  addError(errors, report?.result === 'degraded-engineering-complete', 'report result must remain degraded');
  addError(errors, report?.humanEquivalent === false, 'report must keep humanEquivalent=false');
  addError(errors, report?.liveEvidence === false, 'report must keep liveEvidence=false');
  addError(errors, report?.taskForest?.recommendedStatus === 'review_needed', 'recommended status must be review_needed');
  addError(errors, report?.taskForest?.canMarkDone === false, 'report must prohibit done');
  addError(errors, report?.taskForest?.canReleaseTF0011 === false, 'report must not self-authorize TF-0011 release');
  addError(errors, report?.humanQualifyingRuns?.['dcs-coding'] === 0, 'DCS human count must stay zero');
  addError(errors, report?.humanQualifyingRuns?.['sekb-assisted'] === 0, 'SEKB human count must stay zero');
  addError(errors, report?.humanQualifyingRuns?.['browser-supervised'] === 0, 'Browser human count must stay zero');

  const runs = Array.isArray(report?.runs) ? report.runs : [];
  addError(errors, runs.length === 30, 'report must contain exactly 30 agent runs');
  for (const id of REQUIRED_PROFILES) {
    const profileRuns = runs.filter((run) => run?.profile === id);
    addError(errors, profileRuns.length === 10, `${id} must contain exactly 10 agent runs`);
    addError(errors, report?.agentSurrogateRuns?.[id] === 10, `${id} summary count must be 10`);
    for (const run of profileRuns) {
      addError(errors, run?.actor?.kind === 'agent', `${id} run actor must be agent`);
      addError(errors, run?.humanEquivalent === false, `${id} run must keep humanEquivalent=false`);
      addError(errors, run?.liveEvidence === false, `${id} run must keep liveEvidence=false`);
      addError(errors, run?.result === 'pass', `${id} run did not pass`);
      addError(errors, typeof run?.lineage?.componentEntrypoint === 'string', `${id} run lineage missing`);
    }
  }

  addError(errors, report?.killRollbackDrill?.actor?.kind === 'agent', 'kill drill actor must be agent');
  addError(errors, report?.killRollbackDrill?.humanEquivalent === false, 'kill drill must not claim human equivalence');
  addError(errors, report?.killRollbackDrill?.result === 'pass', 'kill drill must pass');
  addError(errors, report?.decision?.value === 'deferred-human-validation', 'decision must defer human validation');
  addError(errors, report?.decision?.productApproval === false, 'decision must not grant product approval');
  addError(errors, report?.frozenBoundaries?.liveReady === false, 'report liveReady lock drifted');
  addError(errors, report?.frozenBoundaries?.productApproved === false, 'report productApproved lock drifted');
  addError(errors, report?.frozenBoundaries?.defaultOn === false, 'report defaultOn lock drifted');
  addError(errors, report?.frozenBoundaries?.c1ReductionFactor === 4.5, 'report C1 reduction lock drifted');
  addError(errors, report?.frozenBoundaries?.c1MeetsGate === false, 'report C1 gate lock drifted');
  addError(errors, report?.frozenBoundaries?.c1Recommendation === 'keep-off', 'report C1 recommendation drifted');
  addError(errors, report?.frozenBoundaries?.tf0006 === 'blocked', 'report TF-0006 lock drifted');
  return { ok: errors.length === 0, errors };
}
