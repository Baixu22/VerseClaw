import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildDeterministicCompressionArtifact,
  type CompressionCvkEvidenceRef,
  type CompressionSemanticAtom,
} from '../../openclaw_runtime/packages/agent-core/src/harness/compaction/compression-artifact';
import {
  compileCvkFixtureSources,
  type CvkCompilerFixtureInput,
  type CvkFixtureArtifact,
} from '../../openclaw_runtime/src/context-engine/cvk/compiler';
import { buildCvkRecoveryContext, type CvkRecoveryRollback } from '../../openclaw_runtime/src/context-engine/cvk/recovery';

function loadCvkArtifact(): CvkFixtureArtifact {
  const fixturePath = join(process.cwd(), 'tests/fixtures/context-runtime-kit/compiler.fixture.json');
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as CvkCompilerFixtureInput;
  return compileCvkFixtureSources(fixture);
}

function refFor(artifact: CvkFixtureArtifact, selector: string): CompressionCvkEvidenceRef {
  const chunk = artifact.chunks.find((item) => item.resourceId === 'toolset:local.shell@v1' && item.selector === selector);
  if (!chunk) throw new Error(`Missing fixture selector ${selector}`);
  return {
    resourceId: chunk.resourceId,
    selector: chunk.selector,
    checksum: chunk.checksum,
    kind: 'toolset',
  };
}

describe('Context Runtime Kit recovery context', () => {
  it('recovers from compact projection plus selectors and reports rollback as unimplemented', () => {
    const cvkArtifact = loadCvkArtifact();
    const requiredRef = refFor(cvkArtifact, 'schema:tool.run_shell.required');
    const compressionArtifact = buildDeterministicCompressionArtifact({
      messages: [
        { role: 'user', content: 'Recover with CRK selector evidence.' },
        { role: 'assistant', content: 'Failed attempt: tried shell call before expanding schema selectors.' },
      ] as never,
      summary: [
        '## Goal',
        '- Resume selector-backed recovery.',
        '### Blocked',
        '- Need shell required selector before hard claim.',
        '## Next Steps',
        '1. Expand the required shell selector and continue.',
      ].join('\n'),
      contextRuntimeKit: {
        requiredSelectors: [requiredRef],
        retrievedContext: [requiredRef],
        retrievalTrace: [{ ...requiredRef, reason: 'recovery' }],
        unverifiedClaims: ['Tool schema is usable only after selector verification.'],
      },
    });

    const result = buildCvkRecoveryContext({ compressionArtifact, cvkArtifact });

    expect(result.ok).toBe(true);
    // No runtime consumer executes a session-transcript rollback, so the
    // declaration must not claim availability or name an implemented strategy.
    expect(result.rollback).toEqual({
      available: false,
      strategy: 'unimplemented',
      reason: 'no_executor_wired',
    });
    expect('executorId' in result.rollback).toBe(false);
    expect(result.projection.resourceMap.map((entry) => entry.resourceId)).toContain('toolset:local.shell@v1');
    expect(result.projection.requiredSelectors).toEqual([requiredRef]);
    expect(result.projection.unverifiedClaims).toContain('Tool schema is usable only after selector verification.');
    expect(result.projection.blockers[0]).toContain('Need shell required selector');
    expect(result.projection.failedAttemptsToAvoid[0]).toContain('tried shell call before expanding schema selectors');
    expect(result.projection.nextAction).toContain('Expand the required shell selector');
    expect(result.projection.missingReferenceDiagnostics).toEqual([]);
  });

  it('fails visibly when required selectors are missing', () => {
    const cvkArtifact = loadCvkArtifact();
    const compressionArtifact = buildDeterministicCompressionArtifact({
      messages: [{ role: 'user', content: 'Recover missing selector.' }] as never,
      contextRuntimeKit: {
        requiredSelectors: [{
          resourceId: 'skill:context-runtime-kit@v1',
          selector: 'skill:missing',
          checksum: `sha256:${'f'.repeat(64)}`,
          kind: 'skill',
        }],
      },
    });

    const result = buildCvkRecoveryContext({ compressionArtifact, cvkArtifact });

    expect(result.ok).toBe(false);
    expect(result.rollback).toEqual({
      available: false,
      strategy: 'unimplemented',
      reason: 'no_executor_wired',
    });
    expect(result.projection.missingReferenceDiagnostics).toEqual([
      expect.objectContaining({
        status: 'missing_selector',
        resourceId: 'skill:context-runtime-kit@v1',
        selector: 'skill:missing',
      }),
    ]);
  });

  it('only allows an available rollback that names the executor wired to it', () => {
    // Type-level contract: the `available: true` member is unreachable for the
    // builders above, and any consumer that switches on `available` must supply
    // an `executorId` proving a real executor exists.
    const wired: CvkRecoveryRollback = {
      available: true,
      strategy: 'legacy_transcript_replay',
      executorId: 'test-only.executor',
    };
    expect(wired.available).toBe(true);
    if (wired.available) {
      expect(wired.executorId).toBe('test-only.executor');
    }
  });

  it('marks stale document or code refs and keeps uncertainty visible', () => {
    const cvkArtifact = loadCvkArtifact();
    const staleRef = {
      resourceId: 'document:missing-doc@v1',
      selector: 'doc:heading.overview',
      checksum: `sha256:${'1'.repeat(64)}`,
      kind: 'document' as const,
    };
    const compressionArtifact = buildDeterministicCompressionArtifact({
      messages: [{ role: 'user', content: 'Recover stale refs.' }] as never,
      contextRuntimeKit: {
        requiredSelectors: [staleRef],
        staleReferences: [staleRef],
        unverifiedClaims: ['Document overview may have changed since compaction.'],
      },
    });

    const result = buildCvkRecoveryContext({ compressionArtifact, cvkArtifact });

    expect(result.ok).toBe(false);
    expect(result.projection.staleReferenceDiagnostics).toEqual([
      expect.objectContaining({
        status: 'stale_reference',
        resourceId: staleRef.resourceId,
        selector: staleRef.selector,
      }),
    ]);
    expect(result.projection.unverifiedClaims).toContain('Document overview may have changed since compaction.');
  });
});

function criticalAtom(
  id: string,
  type: CompressionSemanticAtom['type'],
  text: string,
): CompressionSemanticAtom {
  return {
    id,
    type,
    canonicalIdentity: `${type}:${id}`,
    severity: 'critical',
    confidence: 0.95,
    scope: 'session',
    polarity: 'neutral',
    status: 'verified',
    text,
    evidenceRefs: [{ type: 'file', ref: `file:${id}` }],
  };
}

describe('P3 stale, superseded, failed-action, and recursive-loss fixtures', () => {
  it('keeps stale branch atoms in the ledger but never uses them as the active next action', () => {
    const previous = buildDeterministicCompressionArtifact({
      messages: [{ role: 'user', content: 'Preserve a stale branch atom.' }] as never,
      semanticAtoms: [{
        ...criticalAtom('atom-next-stale', 'next_action', 'Run the stale branch migration.'),
        status: 'stale',
      }],
    });

    const artifact = buildDeterministicCompressionArtifact({
      messages: [{ role: 'user', content: 'Continue on the current branch.' }] as never,
      previousArtifact: previous,
      semanticAtoms: [
        criticalAtom('atom-next-current', 'next_action', 'Run the current branch migration.'),
      ],
    });

    expect(artifact.semanticAtoms?.some((atom) => atom.id === 'atom-next-stale' && atom.status === 'stale')).toBe(true);
    expect(artifact.nextAction).toContain('current branch migration');
    expect(artifact.nextAction).not.toContain('stale branch migration');
  });

  it('keeps superseded decision atoms in the ledger but not in active legacy decisions', () => {
    const previous = buildDeterministicCompressionArtifact({
      messages: [{ role: 'user', content: 'Preserve an old decision.' }] as never,
      semanticAtoms: [
        criticalAtom('atom-decision-old', 'decision', 'Use the old plan.'),
      ],
    });

    const artifact = buildDeterministicCompressionArtifact({
      messages: [{ role: 'user', content: 'Supersede the old decision.' }] as never,
      previousArtifact: previous,
      semanticAtoms: [{
        ...criticalAtom('atom-decision-new', 'decision', 'Use the new plan.'),
        supersedes: ['atom-decision-old'],
      }],
    });

    expect(artifact.semanticAtoms?.some((atom) => atom.id === 'atom-decision-old' && atom.status === 'superseded')).toBe(true);
    expect(artifact.semanticAtoms?.some((atom) => atom.id === 'atom-decision-new' && atom.status === 'verified')).toBe(true);
    expect(artifact.decisions.some((item) => item.text.includes('old plan'))).toBe(false);
    expect(artifact.decisions.some((item) => item.text.includes('new plan'))).toBe(true);
  });

  it('exposes failed attempts for recovery and never repeats the failed command as next action', () => {
    const cvkArtifact = loadCvkArtifact();
    const artifact = buildDeterministicCompressionArtifact({
      messages: [{ role: 'user', content: 'Recover after a failed command.' }] as never,
      semanticAtoms: [
        criticalAtom('atom-failed-cmd', 'failed_attempt', 'Run `pnpm run broken-command` and verify.'),
        criticalAtom('atom-next-fixed', 'next_action', 'Run `pnpm run fixed-command` instead.'),
      ],
    });

    const recovery = buildCvkRecoveryContext({ compressionArtifact: artifact, cvkArtifact });

    expect(recovery.ok).toBe(true);
    expect(recovery.projection.failedAttemptsToAvoid.some((item) => item.includes('broken-command'))).toBe(true);
    expect(recovery.projection.nextAction).toContain('fixed-command');
    expect(recovery.projection.nextAction).not.toContain('broken-command');
  });

  it('preserves the first critical atom across three consecutive compactions', () => {
    const first = buildDeterministicCompressionArtifact({
      messages: [{ role: 'user', content: 'First compaction.' }] as never,
      semanticAtoms: [
        criticalAtom('atom-goal-first', 'goal', 'Ship the first critical goal.'),
      ],
    });
    const second = buildDeterministicCompressionArtifact({
      messages: [{ role: 'user', content: 'Second compaction.' }] as never,
      previousArtifact: first,
      semanticAtoms: [
        criticalAtom('atom-goal-second', 'goal', 'Ship the second critical goal.'),
      ],
    });
    const third = buildDeterministicCompressionArtifact({
      messages: [{ role: 'user', content: 'Third compaction.' }] as never,
      previousArtifact: second,
      semanticAtoms: [
        criticalAtom('atom-goal-third', 'goal', 'Ship the third critical goal.'),
      ],
    });

    const ids = third.semanticAtoms?.map((atom) => atom.id) ?? [];
    expect(ids).toEqual(expect.arrayContaining([
      'atom-goal-first',
      'atom-goal-second',
      'atom-goal-third',
    ]));
    expect(third.semanticAtoms?.some((atom) => atom.id === 'atom-goal-first' && atom.status === 'verified')).toBe(true);
  });
});
