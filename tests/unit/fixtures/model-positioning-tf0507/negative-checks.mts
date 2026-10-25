// TF-0507 cross-axis negative evidence.
// The fixture reuses the frozen profile builders; it does not call the provider.
import fs from 'node:fs';
import path from 'node:path';
import { buildFixtureProfile, probeToolDecision, type PositioningProtocol } from './fixture-lib.mts';
import { buildModelCapabilityProfile } from '../../../../shared/model-capability-profile';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../../../..');
const dir = 'tests/unit/fixtures/model-positioning-tf0507';
const protocol = JSON.parse(fs.readFileSync(path.join(root, dir, 'protocol-v11.json'), 'utf8')) as PositioningProtocol;
const baseline = buildFixtureProfile(protocol, 'P1').profile;
const outputDir = path.join(root, dir, 'negative');
fs.mkdirSync(outputDir, { recursive: true });
const cases: any[] = [];

// 1. Cross-scope: a cloned profile with a different session must not reuse the original scope as its own.
const otherScope = { ...baseline.scope, sessionKey: baseline.scope.sessionKey + ':other' };
const crossScope = buildModelCapabilityProfile({
  scope: otherScope,
  runtimeGeneration: baseline.runtimeGeneration,
  observedAt: baseline.observedAt,
  generatedAt: baseline.generatedAt,
  facts: buildFixtureProfile(protocol, 'P1').facts,
});
cases.push({
  axis: 'cross-scope',
  status: otherScope.sessionKey !== baseline.scope.sessionKey && crossScope.effectiveDigest !== baseline.effectiveDigest ? 'pass' : 'fail',
  baselineDigest: baseline.effectiveDigest,
  observedDigest: crossScope.effectiveDigest,
  baselineScope: baseline.scope,
  observedScope: otherScope,
  assertion: 'different session scope changes the effective digest and cannot inherit the P1 scope unchanged',
});

// 2. Unapplied knowledge: stale knowledge must not be usable, and the prompt must say stale.
const degraded = buildFixtureProfile(protocol, 'P2').profile;
const knowledgeEntry = degraded.entries.find((entry) => entry.capabilityId === 'component.knowledge-retrieval-source');
cases.push({
  axis: 'unapplied-knowledge',
  status: knowledgeEntry?.knowledge.appliedState === 'stale' && degraded.promptAddition.text.includes('Knowledge retrieval=knowledge:stale') ? 'pass' : 'fail',
  observedKnowledgeState: knowledgeEntry?.knowledge.appliedState ?? null,
  promptContainsStale: degraded.promptAddition.text.includes('Knowledge retrieval=knowledge:stale'),
  assertion: 'stale knowledge stays unusable and the model-facing profile does not relabel it as applied',
});

// 3. Restart degradation: a new runtime generation with missing ack must degrade, not preserve old enabled facts.
const restart = buildModelCapabilityProfile({
  scope: degraded.scope,
  runtimeGeneration: degraded.runtimeGeneration + ':restart',
  observedAt: degraded.observedAt,
  generatedAt: degraded.generatedAt,
  facts: buildFixtureProfile(protocol, 'P2').facts.map((fact) => ({
    ...fact,
    ack: { ...fact.ack, state: 'unknown', generation: null, source: null, observedAt: null },
  })),
});
const restartEntry = restart.entries.find((entry) => entry.capabilityId === 'component.knowledge-retrieval-source');
cases.push({
  axis: 'restart-degradation',
  status: restartEntry?.ack.state === 'unknown' && restart.effectiveDigest !== degraded.effectiveDigest ? 'pass' : 'fail',
  baselineDigest: degraded.effectiveDigest,
  observedDigest: restart.effectiveDigest,
  observedAck: restartEntry?.ack.state ?? null,
  assertion: 'a new generation without a matching ack degrades to unknown and refreshes the effective digest',
});

// 4. Revoked browser grant: tool probe must be denied and remain consistent with the P2 profile.
const probe = probeToolDecision(degraded, { capabilityId: 'component.browser-session-owner', actionId: 'navigate', expectedOutcome: 'denied' });
cases.push({
  axis: 'revoked-grant',
  status: probe.outcome === 'denied' && probe.bindingFound && probe.profileConsistent ? 'pass' : 'fail',
  probe,
  assertion: 'revoked browser navigate is actually denied at the permission-effect checkpoint and matches the profile',
});

const result = {
  schemaVersion: 'ModelPositioningNegativeChecks/v1',
  taskForestNodeId: 'TF-0507',
  generatedAt: new Date().toISOString(),
  driven_by: 'agent',
  actor: 'codex',
  status: cases.every((testCase) => testCase.status === 'pass') ? 'pass' : 'fail',
  cases,
  boundary: 'These are deterministic fixture checks for cross-axis facts. They are not model outputs and are not real-human evidence.',
};
const outputPath = path.join(outputDir, 'negative-checks.json');
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(result, null, 2));
if (result.status !== 'pass') process.exitCode = 1;
