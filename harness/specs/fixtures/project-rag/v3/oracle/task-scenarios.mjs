// Evaluator-only incident and proposal seeds. Decisions are derived from the
// pinned source facts before any participant trial is run.
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';

const incidents = [
  ['session-continuity', 'The renderer keeps 900 messages, loads 500 and mounts all 900 rows; navigation becomes slow.', 'unbounded-history-view', 'restore-history-bounds', 'rendererHistoryLimits'],
  ['workspace-preflight', 'A readable plain directory with no Git metadata is rejected; a readable but unwritable directory requests fullAccess.', 'preflight-permission-mismatch', 'apply-readable-workspace-policy', 'unwritableFallback'],
  ['provider-accounts', 'The compatibility models URL stops at a missing page and a renderer response contains an unmasked provider secret.', 'provider-route-and-secret-boundary', 'restore-route-and-masked-projection', 'rendererSecrets'],
  ['usage-aggregation', 'An invalid aggregate window is accepted and the prompt-cache risk ledger grows without a ceiling.', 'usage-input-and-retention-regression', 'restore-default-and-ledger-bound', 'defaultUsageWindow'],
  ['knowledge-governance', 'A captured draft is written directly into a durable Wiki page without review or an explicit apply.', 'governance-stage-bypass', 'resume-governed-change-proposal', 'durableSequence'],
  ['local-embedding-model', 'Offline startup attempts to load a Q4_0 artifact while the configured default artifact is unavailable.', 'embedding-artifact-mismatch', 'resolve-the-documented-artifact', 'localModel'],
  ['existing-semantic-provider', 'A selected-source embedding request sends 32 texts in one batch and gives every retry a new operation deadline.', 'embedding-batch-and-deadline-regression', 'bound-batches-and-share-operation-deadline', 'embeddingTimeoutsMs'],
  ['role-memory-store', 'A role-card repair overwrites MEMORY.md because both stores are assumed to be one authority.', 'memory-authority-conflation', 'repair-only-role-store', 'sameAsNativeMemory'],
  ['file-path-boundary', 'A broker accepts a 5000-character path and a UNC path, then fails while opening a network share.', 'unsafe-file-broker-input', 'reject-invalid-path-before-io', 'maximumPathCharacters'],
  ['task-working-context', 'A task importer emits node status pending and silently removes Evidence from Working Context.', 'task-ledger-contract-drift', 'restore-context-and-status-schema', 'nodeStatuses'],
  ['dcs-turn-budget', 'Two injection handlers each spend the full turn limit, so their combined injected text exceeds the shared ceiling.', 'double-spent-turn-budget', 'share-the-turn-budget-owner', 'turnCharacterBudget'],
  ['context-candidates', 'An adapter invents an attachment target and bypasses the candidate projector to assemble prompt text.', 'candidate-projection-bypass', 'restore-canonical-projection', 'candidateTargets'],
  ['context-resource-contract', 'A compact navigation entry is used as complete claim support; a removed orphan index is treated as current.', 'navigation-promoted-to-evidence', 'expand-evidence-through-current-owner', 'compactViewsNavigationOnly'],
  ['background-admission', 'Queue pressure is high, and the scheduler defers an interactive foreground request together with background work.', 'foreground-shed-as-background', 'admit-foreground-with-shared-watermarks', 'foregroundDeferred'],
  ['bounded-cache', 'Reading an entry extends its absolute TTL; at exactly expiresAt the caller still receives the cached value.', 'cache-expiry-regression', 'expire-at-boundary-without-read-refresh', 'expiresAtBoundaryIsExpired'],
  ['provider-outbound-quota', 'An occupied quota alias is rebound during a physical provider request; the UI reports token quota exhaustion.', 'physical-request-owner-rebind', 'report-busy-and-preserve-occupied-binding', 'busyOnActiveAliasRebind'],
  ['backup-restore', 'A later archive entry fails after restore created two new files; rollback also deletes a pre-existing target.', 'restore-rollback-scope-regression', 'rollback-only-created-files', 'failureRollbackScope'],
  ['experience-adoption', 'A candidate principle is counted as an observed adoption and retried records are all reported as new.', 'adoption-admission-and-dedup-drift', 'validate-active-principle-and-disposition', 'requiredPrincipleStatus'],
  ['orchestration-capacity', 'Without a measured worker cap, a high-effort wave starts sixteen workers immediately.', 'unmeasured-wave-overadmission', 'bound-wave-by-measured-cap', 'unmeasuredConcurrencyCap'],
  ['role-contracts', 'A Security Audit Team omits its skeptical verifier because reviewer and skeptic are treated as aliases.', 'verifier-role-conflation', 'restore-distinct-security-verifier', 'securityTeamVerifier'],
];

function wrong(value) {
  if (typeof value === 'boolean') return !value;
  if (typeof value === 'number') return value + 1;
  if (typeof value === 'string') return value + '-unsupported';
  if (Array.isArray(value)) return value.slice(1);
  return Object.fromEntries(Object.entries(value).map(([k, v], i) => [k, i ? v : wrong(v)]));
}

export function taskScenario(profile, family, facts, index) {
  const values = Object.fromEntries(facts.map(f => [f.field, f.value]));
  if (profile === 'quality') {
    const incident = incidents.find(row => row[0] === family.id);
    assert(incident && Object.hasOwn(values, incident[4]), `missing diagnostic witness: ${family.id}`);
    const hypotheses = [incident[2], 'provider-temporary-unavailability', 'insufficient-project-evidence'];
    const actions = [incident[3], 'increase-all-budgets-and-retry', 'change-the-frozen-product-default'];
    const order = rows => [...rows.slice(index % rows.length), ...rows.slice(0, index % rows.length)];
    return {
      request: { incident: incident[1], hypotheses: order(hypotheses), actions: order(actions),
        verification: facts.map(f => ({ probeId: `verify-${f.field}`, request: `Predict the correct documented behavior for ${f.field} after the repair.` })),
        missingObservation: 'post-repair-runtime-trace',
        instruction: 'Diagnose the incident causally, select a hypothesis and corrective action, predict every verification result from the source contracts, and name the missing runtime observation. Return analysis with diagnosis, action, predictions (probeId/result), and evidenceGaps. Filling values alone is incomplete.' },
      oracle: { diagnosis: incident[2], action: incident[3], predictions: facts.map(f => ({ probeId: `verify-${f.field}`, result: f.value })), evidenceGaps: ['post-repair-runtime-trace'] },
    };
  }
  assert.equal(profile, 'research');
  assert(new Set(facts.map(f => f.sourceId)).size >= 2, 'research needs independent source owners');
  const fields = facts.map(f => f.field);
  const plans = [
    { id: 'retain', commitments: values, changesDefault: false, requiresUnmeasuredCapacity: false },
    { id: 'expand', commitments: { ...values, [fields[0]]: wrong(values[fields[0]]) }, changesDefault: false, requiresUnmeasuredCapacity: false },
    { id: 'merge', commitments: { ...values, [fields.at(-1)]: wrong(values[fields.at(-1)]) }, changesDefault: true, requiresUnmeasuredCapacity: true },
  ].map((row, i) => ({ ...row, id: `plan-${(i + index) % 3 + 1}` }));
  const feasible = plans.filter(plan => isDeepStrictEqual(plan.commitments, values) && !plan.changesDefault && !plan.requiresUnmeasuredCapacity);
  assert.equal(feasible.length, 1);
  const violations = plan => [
    ...fields.filter(field => !isDeepStrictEqual(plan.commitments[field], values[field])),
    ...(plan.changesDefault ? ['frozen-default'] : []), ...(plan.requiresUnmeasuredCapacity ? ['unmeasured-capacity'] : []),
  ];
  const ordered = [...plans.slice(index % 3), ...plans.slice(0, index % 3)];
  return {
    request: { objective: `Select an implementable integration plan for ${family.id} using all source contracts and the stated resource constraints.`,
      constraints: ['preserve-source-owner-contracts', 'keep-frozen-default', 'require-measurement-before-capacity-expansion'], proposals: ordered,
      missingObservation: 'measured-integration-capacity', availableResearchRounds: 3,
      instruction: 'Compare every proposal across sources. Return analysis with selectedPlan, rejectedPlans (planId/violatedConstraints), evidenceGaps, and stopReason. Violations name the contradicted field or frozen-default/unmeasured-capacity. Stop with evidence-complete-capacity-unknown when contract comparison is complete and capacity remains unmeasured.' },
    oracle: { selectedPlan: feasible[0].id, rejectedPlans: ordered.filter(plan => plan !== feasible[0]).map(plan => ({ planId: plan.id, violatedConstraints: violations(plan) })),
      evidenceGaps: ['measured-integration-capacity'], stopReason: 'evidence-complete-capacity-unknown' },
  };
}
