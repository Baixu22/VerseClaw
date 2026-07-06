import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compileCvkFixtureSources,
  type CvkCompilerFixtureInput,
  type CvkFixtureArtifact,
  type CvkSkillFixtureSource,
} from '../../openclaw_runtime/src/context-engine/cvk/compiler';
import { generateCvkViews } from '../../openclaw_runtime/src/context-engine/cvk/views';

function loadArtifact(): CvkFixtureArtifact {
  const fixturePath = join(process.cwd(), 'tests/fixtures/context-runtime-kit/compiler.fixture.json');
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as CvkCompilerFixtureInput;
  return compileCvkFixtureSources(fixture);
}

function manySkillFixture(count: number): CvkCompilerFixtureInput {
  const skills: CvkSkillFixtureSource[] = Array.from({ length: count }, (_, index) => {
    const ordinal = String(index + 1).padStart(2, '0');
    return {
      kind: 'skill',
      id: `fixture-skill-${ordinal}`,
      version: 'v1',
      title: `Fixture Skill ${ordinal}`,
      summary: `Skill ${ordinal} summary.`,
      triggers: [`trigger-${ordinal}`],
      requiredWorkflow: [`Run workflow ${ordinal}.`],
      safetyRules: [`Keep skill ${ordinal} safe.`],
      examples: [`Use skill ${ordinal}.`],
      source: `# Fixture Skill ${ordinal}\n\nFull source ${ordinal}.`,
    };
  });
  return { sources: skills };
}

describe('Context Runtime Kit view generator', () => {
  it('generates navigation-only registry and compact views with source-backed hard selectors', () => {
    const artifact = loadArtifact();
    const projection = generateCvkViews(artifact);
    const toolView = projection.compactViews.find((view) => view.resourceId === 'toolset:local.shell@v1');

    expect(projection.registryView.level).toBe(0);
    expect(projection.registryView.navigationOnly).toBe(true);
    expect(projection.registryView.entries.map((entry) => entry.resourceId)).toEqual([
      'project_rule:agents@v1',
      'project_rule:context-runtime-kit-boundary@v1',
      'skill:context-runtime-kit@v1',
      'toolset:local.shell@v1',
    ]);
    expect(projection.rawChunkSelectors).toEqual([]);
    expect(projection.compactViews.every((view) => view.navigationOnly && view.level === 1)).toBe(true);
    expect(toolView?.hardSelectors).toEqual([
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
    expect(toolView?.hardSelectorRefs.every((ref) => (
      ref.checksum === artifact.selectorIndex[ref.resourceId]?.[ref.selector]?.checksum
    ))).toBe(true);
  });

  it('keeps a 50-skill fixture at registry view only by default', () => {
    const artifact = compileCvkFixtureSources(manySkillFixture(50));
    const projection = generateCvkViews(artifact);

    expect(projection.registryView.entries).toHaveLength(50);
    expect(projection.compactViews).toEqual([]);
    expect(projection.rawChunkSelectors).toEqual([]);
  });

  it('expands only required workflow selectors for a selected skill and keeps token estimates deterministic', () => {
    const artifact = compileCvkFixtureSources(manySkillFixture(2));
    const first = generateCvkViews(artifact, {
      selectedSkillResourceIds: ['skill:fixture-skill-01@v1'],
    });
    const second = generateCvkViews(artifact, {
      selectedSkillResourceIds: ['skill:fixture-skill-01@v1'],
    });

    expect(first.compactViews).toHaveLength(1);
    expect(first.compactViews[0]).toMatchObject({
      resourceId: 'skill:fixture-skill-01@v1',
      hardSelectors: ['skill:required_workflow'],
      mustExpandBeforeCall: ['skill:required_workflow'],
      sourceSelectors: ['skill:required_workflow'],
    });
    expect(first.registryView.tokenEstimate).toBe(second.registryView.tokenEstimate);
    expect(first.compactViews[0]?.tokenEstimate).toBe(second.compactViews[0]?.tokenEstimate);
  });
});
