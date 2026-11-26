import assert from 'node:assert/strict';
import { taskScenario } from './v3.scenarios.mjs';

// Proposal wording describes actions. Expected typed source values are never
// copied into the participant's proposal options.
const researchPlans = {
  'owner-version': ['Keep UTF-8 byte ranges exclusive at the end and carry the public owner SDK types.', ['Use Unicode character indices for the source locator.', 'coordinateSpace'], ['Include the ending byte when copying the source quote.', 'endIsExclusive']],
  'wiki-read-policy': ['Read pages through the Wiki query entry and renew the short-lived read context when needed.', ['Treat missing Wiki status as revoked.', 'defaultStatus'], ['Cache the initial read context for a full day.', 'readContextLifetimeMs']],
  'host-knowledge-scope': ['Prepare the Main chat scope, describe its physical generation, and materialize an owned missing generation.', ['Use a generic health check to identify the physical session generation.', 'generationLookupMethod'], ['Refuse every owned logical session that lacks a physical generation.', 'materializeMethod']],
  'bounded-page-read': ['Use bounded page continuation and validate the resulting Knowledge QA output.', ['Stop scanning after the first page regardless of continuation metadata.', 'scanLineCeiling'], ['Continue reading without any accumulated character ceiling.', 'scanCharacterCeiling']],
  'source-set-limit': ['Keep the existing omitted-limit behavior, hard result ceiling and DCS assembly owner.', ['Interpret an omitted result limit as zero results.', 'defaultLimit'], ['Allow one thousand results from a single SourceSet request.', 'maximumLimit']],
  'cjk-tokenizer': ['Use the shared CJK fallback so adjacent Han pairs remain searchable in hybrid retrieval.', ['Emit only one gram for the entire Han run.', 'grams'], ['Create a Han fallback run from any single Han character.', 'minimumHanRun']],
  'memory-temporal': ['Keep the empty-query temporal default and inclusive supported as-of year boundaries.', ['Interpret an empty query as unrestricted history.', 'defaultTemporalPolicy'], ['Reject the lower supported year boundary as out of range.', 'acceptedYearRange']],
  'host-deadline': ['Use the common Host deadline factory and clamp each layer to the remaining logical budget.', ['Give a layer its full local allowance even when the logical request expires earlier.', 'effectiveTimeoutMs'], ['Return a positive retry allowance after the logical deadline.', 'expiredRemainingMs']],
  'host-action-timeouts': ['Send typed Host invocations and apply the existing default and allowlisted long-action timeout classes.', ['Give all ordinary Host actions a one-second timeout.', 'defaultTimeoutMs'], ['Give long actions an unlimited timeout.', 'longTimeoutMs']],
  'development-commands': ['Rebuild the embedded runtime with the documented startup smoke and run every full typecheck project.', ['Use only the renderer build as the embedded runtime rebuild gate.', 'runtimeBuildCommand'], ['Run only web types and call the full typecheck complete.', 'fullTypecheckProjects']],
  'dcs-turn-budget': ['Read the shared turn ceiling from its existing config source and keep the documented drop alert threshold.', ['Allocate separate complete turn budgets to every injection lane.', 'turnCharacterBudget'], ['Suppress every dropped-budget alert regardless of the dropped fraction.', 'dropAlertRatio']],
  'context-candidates': ['Use the declared candidate schema and project through the orchestrator-supported targets.', ['Publish candidates under an unrelated schema identifier.', 'candidateSchema'], ['Introduce an attachment projection target outside the declared union.', 'candidateTargets']],
  'context-resource-contract': ['Keep compact views as navigation, expand supporting evidence, and use the current code-index owner.', ['Emit a PromptBundle with an arbitrary schema version.', 'bundleSchemaVersion'], ['Treat a compact navigation entry as complete claim-support evidence.', 'compactViewsNavigationOnly']],
  'background-admission': ['Keep foreground admission available while applying the shared queue watermarks to background work.', ['Replace all queue watermarks with an unlimited queue.', 'queueWatermarks'], ['Defer foreground work whenever background shedding starts.', 'foregroundDeferred']],
  'bounded-cache': ['Coalesce concurrent same-key requests and preserve absolute TTL semantics on reads and at expiry.', ['Extend absolute TTL implicitly on every cache get.', 'getRefreshesTtl'], ['Return an entry when now exactly equals its expiration time.', 'expiresAtBoundaryIsExpired']],
  'provider-outbound-quota': ['Use the physical-request concurrency owner and retain an occupied alias until it can be rebound.', ['Move physical-request admission into a token-based UI quota.', 'quotaOwner'], ['Immediately rebind an alias while its requests are active.', 'busyOnActiveAliasRebind']],
  'backup-restore': ['Use the archive manifest and roll back only files created by the failing restore.', ['Overwrite every pre-existing target during restore.', 'overwriteExisting'], ['Delete all files in the restore directory after any entry fails.', 'failureRollbackScope']],
  'experience-adoption': ['Keep the master gate and require an active principle before recording or deduplicating adoption.', ['Count a candidate principle as an accepted adoption.', 'requiredPrincipleStatus'], ['Report every duplicate or conflict as a newly recorded adoption.', 'adoptionDispositions']],
  'orchestration-capacity': ['Use lead/worker routing, account for effort and limit unmeasured worker capacity to the existing fallback.', ['Launch sixteen workers without measured worker capacity.', 'unmeasuredConcurrencyCap'], ['Treat high effort as zero scheduling cost.', 'highEffortCost']],
  'role-contracts': ['Keep Reviewer and Skeptic distinct and retain the Security Audit Team verifier role.', ['Rename the Reviewer contract to auditor without updating its owner.', 'reviewerRoleName'], ['Replace the Skeptic contract with the Reviewer role.', 'skepticRoleName']],
};

export function taskScenarioV4(profile, family, facts, index) {
  if (profile === 'quality') return taskScenario(profile, family, facts, index);
  const row = researchPlans[family.id];
  assert(row && new Set(facts.map(f => f.sourceId)).size >= 2, 'missing cross-source proposal scenario');
  const plans = [
    { id: `plan-${index % 3 + 1}`, action: row[0] },
    { id: `plan-${(index + 1) % 3 + 1}`, action: row[1][0] },
    { id: `plan-${(index + 2) % 3 + 1}`, action: row[2][0] },
  ];
  const ordered = [...plans.slice((index + 1) % 3), ...plans.slice(0, (index + 1) % 3)];
  assert(facts.some(f => f.field === row[1][1]) && facts.some(f => f.field === row[2][1]), 'proposal witness missing');
  return {
    request: { objective: `Select an implementable integration plan for ${family.id} using all source contracts and the stated resource constraints.`,
      constraints: ['preserve-source-owner-contracts', 'keep-frozen-default', 'require-measurement-before-capacity-expansion'], proposals: ordered,
      missingObservation: 'measured-integration-capacity', availableResearchRounds: 3,
      instruction: 'Compare every proposal across sources. Return analysis with selectedPlan, rejectedPlans (planId/violatedConstraints), evidenceGaps, and stopReason. Violations name the contradicted required source field. Stop with evidence-complete-capacity-unknown when contract comparison is complete and capacity remains unmeasured.' },
    oracle: { selectedPlan: plans[0].id, rejectedPlans: plans.slice(1).map((plan, i) => ({ planId: plan.id, violatedConstraints: [row[i + 1][1]] })),
      evidenceGaps: ['measured-integration-capacity'], stopReason: 'evidence-complete-capacity-unknown' },
  };
}
