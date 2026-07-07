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
import {
  buildCvkEvalReport,
  type CvkBenchmarkKind,
  type CvkMetricMap,
} from '../../openclaw_runtime/src/context-engine/cvk/eval-report';
import { buildDefaultCvkRecoveryProjection } from '../../openclaw_runtime/src/context-engine/cvk/recovery-default';

const PASSING_METRICS: CvkMetricMap = {
  TSR: 0.65,
  CRR: 0.82,
  SC: 1,
  SS: 1,
  AR: 1,
  RRR: 1,
  HCR: 0.99,
  UCR: 0,
  ERR: 1,
  RFS: 0.96,
  ToolCallValidity: 0.99,
};

const REQUIRED_BENCHMARKS: CvkBenchmarkKind[] = [
  'tool_schema',
  'skill_routing',
  'project_rule',
  'codebase',
  'compact_recovery',
];

function loadCvkArtifact(): CvkFixtureArtifact {
  const fixturePath = join(process.cwd(), 'tests/fixtures/context-runtime-kit/compiler.fixture.json');
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as CvkCompilerFixtureInput;
  return compileCvkFixtureSources(fixture);
}

function passingReport() {
  return buildCvkEvalReport({
    benchmarks: REQUIRED_BENCHMARKS.map((benchmark) => ({
      id: `${benchmark}-passing`,
      benchmark,
      metrics: PASSING_METRICS,
      failures: [],
    })),
    generatedArtifacts: [],
  });
}

function refFor(artifact: CvkFixtureArtifact, selector: string): CompressionCvkEvidenceRef {
  const chunk = artifact.chunks.find((item) => (
    item.resourceId === 'toolset:local.shell@v1' && item.selector === selector
  ));
  if (!chunk) {
    throw new Error(`Missing fixture selector ${selector}`);
  }
  return {
    resourceId: chunk.resourceId,
    selector: chunk.selector,
    checksum: chunk.checksum,
    kind: 'toolset',
  };
}

describe('Context Runtime Kit default recovery gate', () => {
  it('uses selector-backed CRK recovery when Level 2 passes and refs resolve', () => {
    const cvkArtifact = loadCvkArtifact();
    const requiredRef = refFor(cvkArtifact, 'schema:tool.run_shell.required');
    const compressionArtifact = buildDeterministicCompressionArtifact({
      messages: [{ role: 'user', content: 'Recover with CRK.' }] as never,
      contextRuntimeKit: {
        requiredSelectors: [requiredRef],
        retrievedContext: [requiredRef],
        retrievalTrace: [{ ...requiredRef, reason: 'recovery' }],
      },
    });

    const result = buildDefaultCvkRecoveryProjection({
      compressionArtifact,
      cvkArtifact,
      evalReport: passingReport(),
      legacyProjection: 'legacy transcript replay',
    });

    expect(result.mode).toBe('context-runtime-kit');
    expect(result.projection?.requiredSelectors).toEqual([requiredRef]);
    expect(result.legacyProjection).toBe('legacy transcript replay');
    expect(result.diagnostics).toEqual([]);
  });

  it('falls back to legacy with visible diagnostics when refs are missing', () => {
    const cvkArtifact = loadCvkArtifact();
    const compressionArtifact = buildDeterministicCompressionArtifact({
      messages: [{ role: 'user', content: 'Missing ref.' }] as never,
      contextRuntimeKit: {
        requiredSelectors: [{
          resourceId: 'toolset:local.shell@v1',
          selector: 'schema:tool.run_shell.missing',
          checksum: `sha256:${'f'.repeat(64)}`,
          kind: 'toolset',
        }],
      },
    });

    const result = buildDefaultCvkRecoveryProjection({
      compressionArtifact,
      cvkArtifact,
      evalReport: passingReport(),
      legacyProjection: 'legacy transcript replay',
    });

    expect(result.mode).toBe('legacy');
    expect(result.projection).toBeUndefined();
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'selector_resolution_failed',
        status: 'missing_selector',
      }),
    ]);
  });

  it('falls back to legacy when Level 2 is blocked by evidence or secret-scan failures', () => {
    const cvkArtifact = loadCvkArtifact();
    const requiredRef = refFor(cvkArtifact, 'schema:tool.run_shell.required');
    const compressionArtifact = buildDeterministicCompressionArtifact({
      messages: [{ role: 'user', content: 'Do not recover from blocked eval.' }] as never,
      contextRuntimeKit: {
        requiredSelectors: [requiredRef],
      },
    });
    const blockedReport = buildCvkEvalReport({
      benchmarks: REQUIRED_BENCHMARKS.map((benchmark) => ({
        id: `${benchmark}-blocked`,
        benchmark,
        metrics: {
          ...PASSING_METRICS,
          ERR: benchmark === 'compact_recovery' ? 0.5 : 1,
        },
        failures: benchmark === 'compact_recovery' ? ['Evidence retention dropped.'] : [],
      })),
      generatedArtifacts: [{
        path: 'artifacts/context-runtime-kit/report.json',
        content: 'OPENAI_API_KEY=sk-proj-1234567890abcdef1234567890abcdef',
      }],
    });

    const result = buildDefaultCvkRecoveryProjection({
      compressionArtifact,
      cvkArtifact,
      evalReport: blockedReport,
      legacyProjection: 'legacy transcript replay',
    });

    expect(result.mode).toBe('legacy');
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'eval_gate_blocked',
        reason: 'secret_scan_failed',
      }),
    ]);
  });
});
