// Regression test for issue #104: snapshot-backed runs must honour the
// transient minimal/low skill catalog limits instead of reusing the untrimmed
// snapshot prompt.
import { describe, expect, it } from 'vitest';

import { resolveRuntimeIntensityPolicy } from '../../openclaw_runtime/src/agents/intensity-policy';
import {
  buildWorkspaceSkillSnapshot,
  buildWorkspaceSkillsPrompt,
  resolveSkillsPromptForRun,
} from '../../openclaw_runtime/src/skills/loading/workspace';
import type { SkillEntry, SkillSnapshot } from '../../openclaw_runtime/src/skills/types';

const WORKSPACE_DIR = 'C:/workspace';
const SKILL_COUNT = 20;
const SKILL_BLOCK_PATTERN = /<skill>/g;
const DESCRIPTION_PATTERN = /<description>/g;

function makeSkillEntry(name: string): SkillEntry {
  const filePath = `C:/skills/${name}/SKILL.md`;
  return {
    skill: {
      name,
      description: `Description for ${name}`,
      filePath,
      baseDir: `C:/skills/${name}`,
      sourceInfo: {
        path: filePath,
        source: 'test',
        scope: 'temporary',
        origin: 'top-level',
        baseDir: `C:/skills/${name}`,
      },
      disableModelInvocation: false,
      source: 'test',
    },
    frontmatter: {},
  };
}

function makeSkillEntries(count: number, offset = 0): SkillEntry[] {
  return Array.from({ length: count }, (_value, index) =>
    makeSkillEntry(`skill-${String(offset + index + 1).padStart(2, '0')}`),
  );
}

function buildSnapshot(): SkillSnapshot {
  return buildWorkspaceSkillSnapshot(WORKSPACE_DIR, { entries: makeSkillEntries(SKILL_COUNT) });
}

/** Transient limits exactly as the attempt runner derives them from intensity. */
function transientLimitsFor(thinkLevel: 'minimal' | 'low'): {
  maxSkillsInPrompt: number;
  preferCompact: boolean;
} {
  const policy = resolveRuntimeIntensityPolicy({ thinkLevel });
  if (policy.skills.mode === 'preserve') {
    throw new Error(`expected a top-k skills policy for ${thinkLevel}`);
  }
  return {
    maxSkillsInPrompt: policy.skills.maxSkillsInPrompt,
    preferCompact: policy.skills.preferCompact,
  };
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

describe('issue #104 snapshot-backed transient skill limits', () => {
  it('projects the minimal policy onto a snapshot-backed run (8 skills, compact)', () => {
    const snapshot = buildSnapshot();

    const prompt = resolveSkillsPromptForRun({
      skillsSnapshot: snapshot,
      workspaceDir: WORKSPACE_DIR,
      transientLimits: transientLimitsFor('minimal'),
    });

    expect(countMatches(prompt, SKILL_BLOCK_PATTERN)).toBe(8);
    expect(countMatches(prompt, DESCRIPTION_PATTERN)).toBe(0);
    expect(prompt).toContain('included 8 of 20');
    expect(prompt).toContain('<name>skill-01</name>');
    expect(prompt).not.toContain('<name>skill-09</name>');
  });

  it('projects the low policy onto a snapshot-backed run (16 skills, descriptions kept)', () => {
    const snapshot = buildSnapshot();

    const prompt = resolveSkillsPromptForRun({
      skillsSnapshot: snapshot,
      workspaceDir: WORKSPACE_DIR,
      transientLimits: transientLimitsFor('low'),
    });

    expect(countMatches(prompt, SKILL_BLOCK_PATTERN)).toBe(16);
    expect(countMatches(prompt, DESCRIPTION_PATTERN)).toBe(16);
    expect(prompt).toContain('included 16 of 20');
    expect(prompt).toContain('<description>Description for skill-16</description>');
    expect(prompt).not.toContain('<name>skill-17</name>');
  });

  it('saves characters against the untrimmed snapshot prompt for both transient tiers', () => {
    const snapshot = buildSnapshot();
    const baseline = snapshot.prompt.trim();

    const minimal = resolveSkillsPromptForRun({
      skillsSnapshot: snapshot,
      workspaceDir: WORKSPACE_DIR,
      transientLimits: transientLimitsFor('minimal'),
    });
    const low = resolveSkillsPromptForRun({
      skillsSnapshot: snapshot,
      workspaceDir: WORKSPACE_DIR,
      transientLimits: transientLimitsFor('low'),
    });

    expect(baseline.length).toBeGreaterThan(minimal.length);
    expect(baseline.length).toBeGreaterThan(low.length);
  });

  it('keeps the no-transient-limits control path on the snapshot prompt', () => {
    const snapshot = buildSnapshot();

    const control = resolveSkillsPromptForRun({
      skillsSnapshot: snapshot,
      workspaceDir: WORKSPACE_DIR,
    });

    expect(control).toBe(snapshot.prompt.trim());
    expect(countMatches(control, SKILL_BLOCK_PATTERN)).toBe(SKILL_COUNT);
    expect(countMatches(control, DESCRIPTION_PATTERN)).toBe(SKILL_COUNT);
  });

  it('keeps the explicit-entries control path driven by the supplied entries', () => {
    const snapshot = buildSnapshot();
    const entries = makeSkillEntries(3);

    const prompt = resolveSkillsPromptForRun({
      skillsSnapshot: snapshot,
      entries,
      workspaceDir: WORKSPACE_DIR,
      transientLimits: { maxSkillsInPrompt: 2, preferCompact: true },
    });

    expect(countMatches(prompt, SKILL_BLOCK_PATTERN)).toBe(2);
    expect(prompt).toContain('included 2 of 3');
    expect(prompt).toContain('<name>skill-01</name>');
    expect(prompt).not.toContain('<name>skill-03</name>');
    expect(countMatches(prompt, DESCRIPTION_PATTERN)).toBe(0);
  });

  it('matches the prompt a full entry rebuild renders for the same skills', () => {
    const entries = makeSkillEntries(SKILL_COUNT);
    const snapshot = buildWorkspaceSkillSnapshot(WORKSPACE_DIR, { entries });

    for (const level of ['minimal', 'low'] as const) {
      const transientLimits = transientLimitsFor(level);
      const fromSnapshot = resolveSkillsPromptForRun({
        skillsSnapshot: snapshot,
        workspaceDir: WORKSPACE_DIR,
        transientLimits,
      });
      const fromEntries = buildWorkspaceSkillsPrompt(WORKSPACE_DIR, {
        entries,
        transientLimits,
      });

      expect(fromSnapshot).toBe(fromEntries);
    }
    expect(entries).toHaveLength(SKILL_COUNT);
  });

  it('does not mutate the reusable snapshot or its resolved skills', () => {
    const snapshot = buildSnapshot();
    const promptBefore = snapshot.prompt;
    const resolvedBefore = structuredClone(snapshot.resolvedSkills);

    resolveSkillsPromptForRun({
      skillsSnapshot: snapshot,
      workspaceDir: WORKSPACE_DIR,
      transientLimits: transientLimitsFor('minimal'),
    });
    resolveSkillsPromptForRun({
      skillsSnapshot: snapshot,
      workspaceDir: WORKSPACE_DIR,
      transientLimits: transientLimitsFor('low'),
    });
    resolveSkillsPromptForRun({
      skillsSnapshot: snapshot,
      workspaceDir: WORKSPACE_DIR,
    });

    expect(snapshot.prompt).toBe(promptBefore);
    expect(snapshot.resolvedSkills).toEqual(resolvedBefore);
    expect(snapshot.resolvedSkills).toHaveLength(SKILL_COUNT);
    expect(snapshot.resolvedSkills?.map((skill) => skill.name)).toEqual(
      resolvedBefore?.map((skill) => skill.name),
    );
  });
});
