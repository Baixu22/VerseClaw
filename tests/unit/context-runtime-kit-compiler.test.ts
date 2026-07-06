import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compileCvkFixtureSources,
  type CvkCompilerFixtureInput,
} from '../../openclaw_runtime/src/context-engine/cvk/compiler';

function loadFixture(): CvkCompilerFixtureInput {
  const fixturePath = join(process.cwd(), 'tests/fixtures/context-runtime-kit/compiler.fixture.json');
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as CvkCompilerFixtureInput;
}

describe('Context Runtime Kit fixture compiler', () => {
  it('compiles tool, skill, and project rule fixtures with perfect coverage and resolvable refs', () => {
    const artifact = compileCvkFixtureSources(loadFixture());

    expect(artifact.buildReport.metrics.sourceCoverage.rate).toBe(1);
    expect(artifact.buildReport.metrics.referenceResolutionRate.rate).toBe(1);
    expect(artifact.buildReport.metrics.artifactReproducibilityRate.rate).toBe(1);
    expect(artifact.buildReport.llmDependency).toBe(false);
    expect(artifact.resources.map((resource) => resource.resourceId)).toEqual([
      'project_rule:agents@v1',
      'project_rule:context-runtime-kit-boundary@v1',
      'skill:context-runtime-kit@v1',
      'toolset:local.shell@v1',
    ]);
    expect(artifact.chunks.map((chunk) => chunk.selector)).toEqual(expect.arrayContaining([
      'schema:tool.run_shell.required',
      'schema:tool.run_shell.field.command.type',
      'schema:tool.run_shell.field.mode.enum',
      'schema:tool.run_shell.field.mode.default',
      'schema:tool.run_shell.field.cwd.nullable',
      'schema:tool.run_shell.permission',
      'schema:tool.run_shell.side_effect',
      'skill:summary',
      'skill:triggers',
      'skill:required_workflow',
      'skill:safety_rules',
      'skill:examples',
      'skill:source',
      'rule:agents.corepack-pnpm',
      'rule:context-runtime-boundary.hard-claim-evidence',
    ]));
    expect(artifact.views.every((view) => view.navigationOnly)).toBe(true);
    expect(artifact.views.find((view) => view.resourceId === 'toolset:local.shell@v1')?.hardSelectors).toEqual([
      'schema:tool.run_shell.field.command.type',
      'schema:tool.run_shell.field.cwd.default',
      'schema:tool.run_shell.field.cwd.nullable',
      'schema:tool.run_shell.field.cwd.type',
      'schema:tool.run_shell.field.mode.default',
      'schema:tool.run_shell.field.mode.enum',
      'schema:tool.run_shell.field.mode.type',
      'schema:tool.run_shell.permission',
      'schema:tool.run_shell.required',
      'schema:tool.run_shell.side_effect',
    ]);
  });

  it('is reproducible for identical fixture inputs and changes metadata when sources change', () => {
    const fixture = loadFixture();
    const first = compileCvkFixtureSources(fixture);
    const second = compileCvkFixtureSources(fixture);

    expect(first.buildReport.artifactHash).toBe(second.buildReport.artifactHash);
    expect(first.selectorIndex).toEqual(second.selectorIndex);

    const changed = structuredClone(fixture);
    const toolset = changed.sources.find((source) => source.kind === 'toolset');
    if (!toolset || toolset.kind !== 'toolset') {
      throw new Error('Fixture must include toolset source.');
    }
    toolset.tools[0]!.inputSchema.properties.command.description = 'Command text to execute after checksum drift.';

    const changedArtifact = compileCvkFixtureSources(changed);
    const originalResource = first.resources.find((resource) => resource.resourceId === 'toolset:local.shell@v1');
    const changedResource = changedArtifact.resources.find((resource) => resource.resourceId === 'toolset:local.shell@v1');
    const originalChunk = first.chunks.find((chunk) => chunk.selector === 'schema:tool.run_shell.field.command.type');
    const changedChunk = changedArtifact.chunks.find((chunk) => chunk.selector === 'schema:tool.run_shell.field.command.type');

    expect(changedArtifact.buildReport.artifactHash).not.toBe(first.buildReport.artifactHash);
    expect(changedResource?.sourceChecksum).not.toBe(originalResource?.sourceChecksum);
    expect(changedChunk?.checksum).not.toBe(originalChunk?.checksum);
  });
});
