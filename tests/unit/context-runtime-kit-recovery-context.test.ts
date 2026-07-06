import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildDeterministicCompressionArtifact,
  type CompressionCvkEvidenceRef,
} from '../../openclaw_runtime/packages/agent-core/src/harness/compaction/compression-artifact';
import {
  compileCvkFixtureSources,
  type CvkCompilerFixtureInput,
  type CvkFixtureArtifact,
} from '../../openclaw_runtime/src/context-engine/cvk/compiler';
import { buildCvkRecoveryContext } from '../../openclaw_runtime/src/context-engine/cvk/recovery';

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
  it('recovers from compact projection plus selectors while preserving rollback', () => {
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
    expect(result.rollback).toEqual({
      available: true,
      strategy: 'legacy_transcript_replay',
    });
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
    expect(result.projection.missingReferenceDiagnostics).toEqual([
      expect.objectContaining({
        status: 'missing_selector',
        resourceId: 'skill:context-runtime-kit@v1',
        selector: 'skill:missing',
      }),
    ]);
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
