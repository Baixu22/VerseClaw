import { describe, expect, it } from 'vitest';

import { resolveRuntimeIntensityPolicy } from '../../openclaw_runtime/src/agents/intensity-policy';
import { resolveLiveToolResultMaxChars } from '../../openclaw_runtime/src/agents/embedded-agent-runner/tool-result-truncation';
import { resolveToolResultContextGuardLimits } from '../../openclaw_runtime/src/agents/embedded-agent-runner/tool-result-context-guard';
import { buildSystemPromptReport } from '../../openclaw_runtime/src/agents/system-prompt-report';
import {
  buildWorkspaceSkillsPrompt,
  resolveSkillsPromptForRun,
} from '../../openclaw_runtime/src/skills/loading/workspace';
import type { SkillEntry } from '../../openclaw_runtime/src/skills/types';

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

describe('resolveRuntimeIntensityPolicy', () => {
  it('keeps auto adaptive off and unset on the baseline policy', () => {
    for (const thinkLevel of [undefined, 'off', 'adaptive', 'auto'] as const) {
      const policy = resolveRuntimeIntensityPolicy({ thinkLevel });

      expect(policy).toMatchObject({
        level: 'baseline',
        policyId: 'baseline',
        promptMode: 'preserve',
        skills: { mode: 'preserve' },
        toolResults: { mode: 'preserve' },
        contextPressure: { mode: 'preserve' },
      });
      expect(policy.systemPromptLines).toEqual([]);
    }
  });

  it('maps minimal and low to lightweight prompt skills and tool-result policy', () => {
    expect(resolveRuntimeIntensityPolicy({ thinkLevel: 'minimal' })).toMatchObject({
      level: 'minimal',
      policyId: 'minimal-lightweight',
      promptMode: 'minimal',
      responseStyle: 'brief',
      orchestrationGuidance: 'ask-before-heavy',
      skills: { mode: 'top-k-compact', maxSkillsInPrompt: 8, preferCompact: true },
      toolResults: { mode: 'tighten', singleToolResultContextShare: 0.12 },
      contextPressure: { mode: 'tighten', preemptiveOverflowRatio: 0.72 },
      shellOutput: { mode: 'compact-preferred', recovery: 'raw-output-pointer' },
    });

    expect(resolveRuntimeIntensityPolicy({ thinkLevel: 'low' })).toMatchObject({
      level: 'low',
      policyId: 'low-lightweight',
      promptMode: 'minimal',
      responseStyle: 'concise',
      orchestrationGuidance: 'ask-before-heavy',
      skills: { mode: 'top-k', maxSkillsInPrompt: 16, preferCompact: false },
      toolResults: { mode: 'tighten', singleToolResultContextShare: 0.25 },
      contextPressure: { mode: 'tighten', preemptiveOverflowRatio: 0.82 },
      shellOutput: { mode: 'compact-preferred', recovery: 'raw-output-pointer' },
    });
  });

  it('keeps medium on the baseline policy', () => {
    expect(resolveRuntimeIntensityPolicy({ thinkLevel: 'medium' })).toMatchObject({
      level: 'baseline',
      policyId: 'baseline',
      promptMode: 'preserve',
      responseStyle: 'normal',
      orchestrationGuidance: 'normal',
    });
  });

  it('maps high xhigh and max to full prompt high-capability guidance', () => {
    expect(resolveRuntimeIntensityPolicy({ thinkLevel: 'high' })).toMatchObject({
      level: 'high',
      policyId: 'high-deliberate',
      promptMode: 'full',
      responseStyle: 'detailed',
      orchestrationGuidance: 'suggest-heavy-when-useful',
      shellOutput: { mode: 'preserve' },
    });

    expect(resolveRuntimeIntensityPolicy({ thinkLevel: 'max' })).toMatchObject({
      level: 'xhigh',
      policyId: 'xhigh-maximum',
      promptMode: 'full',
      responseStyle: 'comprehensive',
      orchestrationGuidance: 'prefer-heavy-when-useful',
      shellOutput: { mode: 'preserve' },
    });
  });

  it('does not override explicit prompt mode none or raw model runs', () => {
    expect(
      resolveRuntimeIntensityPolicy({
        thinkLevel: 'low',
        promptModeExplicit: true,
      }).promptMode,
    ).toBe('preserve');

    expect(
      resolveRuntimeIntensityPolicy({
        thinkLevel: 'xhigh',
        rawModelRun: true,
      }).promptMode,
    ).toBe('preserve');

    expect(
      resolveRuntimeIntensityPolicy({
        thinkLevel: 'minimal',
        requestedPromptMode: 'none',
      }).promptMode,
    ).toBe('preserve');
  });
});

describe('runtime intensity skills prompt limits', () => {
  it('limits and compacts the prompt catalog without mutating runtime entries', () => {
    const entries = [
      makeSkillEntry('alpha'),
      makeSkillEntry('beta'),
      makeSkillEntry('gamma'),
    ];

    const prompt = buildWorkspaceSkillsPrompt('C:/workspace', {
      entries,
      transientLimits: {
        maxSkillsInPrompt: 2,
        preferCompact: true,
      },
    });

    expect(prompt).toContain('included 2 of 3');
    expect(prompt).toContain('<name>alpha</name>');
    expect(prompt).toContain('<name>beta</name>');
    expect(prompt).not.toContain('<name>gamma</name>');
    expect(prompt).not.toContain('<description>Description for alpha</description>');
    expect(entries).toHaveLength(3);
  });

  it('rebuilds cached snapshot prompts when transient runtime limits are present', () => {
    const entries = [
      makeSkillEntry('alpha'),
      makeSkillEntry('beta'),
      makeSkillEntry('gamma'),
    ];
    const snapshotPrompt = buildWorkspaceSkillsPrompt('C:/workspace', { entries });

    const prompt = resolveSkillsPromptForRun({
      skillsSnapshot: {
        prompt: snapshotPrompt,
        skills: entries.map((entry) => ({ name: entry.skill.name })),
      },
      entries,
      workspaceDir: 'C:/workspace',
      transientLimits: {
        maxSkillsInPrompt: 1,
        preferCompact: true,
      },
    });

    expect(prompt).toContain('included 1 of 3');
    expect(prompt).toContain('<name>alpha</name>');
    expect(prompt).not.toContain('<name>beta</name>');
    expect(prompt).not.toContain('<description>Description for alpha</description>');
  });
});

describe('runtime intensity tool-result caps', () => {
  it('tightens live tool result caps only when the policy asks for it', () => {
    const baseline = resolveRuntimeIntensityPolicy({ thinkLevel: 'medium' });
    const minimal = resolveRuntimeIntensityPolicy({ thinkLevel: 'minimal' });

    expect(
      resolveLiveToolResultMaxChars({
        contextWindowTokens: 10_000,
        intensityPolicy: baseline,
      }),
    ).toBe(12_000);

    expect(
      resolveLiveToolResultMaxChars({
        contextWindowTokens: 10_000,
        intensityPolicy: minimal,
      }),
    ).toBe(4_800);
  });

  it('tightens live tool-loop context guard ratios only when the policy asks for it', () => {
    const low = resolveRuntimeIntensityPolicy({ thinkLevel: 'low' });

    expect(resolveToolResultContextGuardLimits({ contextWindowTokens: 10_000 })).toMatchObject({
      maxContextChars: 36_000,
      maxSingleToolResultChars: 10_000,
    });

    expect(
      resolveToolResultContextGuardLimits({
        contextWindowTokens: 10_000,
        intensityPolicy: low,
      }),
    ).toMatchObject({
      maxContextChars: 32_800,
      maxSingleToolResultChars: 5_000,
    });
  });
});

describe('runtime intensity system prompt reporting', () => {
  it('stores additive intensity metadata without raw prompt text', () => {
    const low = resolveRuntimeIntensityPolicy({ thinkLevel: 'low' });

    const report = buildSystemPromptReport({
      source: 'run',
      generatedAt: 123,
      bootstrapMaxChars: 1000,
      systemPrompt: 'system prompt text',
      bootstrapFiles: [],
      injectedFiles: [],
      skillsPrompt: '<available_skills><skill><name>alpha</name></skill></available_skills>',
      tools: [],
      runtimeIntensity: {
        policy: low,
        promptMode: 'minimal',
        skillsIncluded: 1,
        skillsTotal: 3,
        toolResultMaxChars: 5000,
        estimatedSavedChars: 250,
      },
    });

    expect(report.runtimeIntensity).toEqual({
      level: 'low',
      policyId: 'low-lightweight',
      promptMode: 'minimal',
      skillsMode: 'top-k',
      shellOutputMode: 'compact-preferred',
      shellOutputRecovery: 'raw-output-pointer',
      skillsIncluded: 1,
      skillsTotal: 3,
      toolResultMaxChars: 5000,
      estimatedSavedChars: 250,
      estimatedSavedTokens: 63,
    });
    expect(JSON.stringify(report)).not.toContain('system prompt text');
  });

  it('keeps required zero-valued savings fields in runtime intensity metadata', () => {
    const baseline = resolveRuntimeIntensityPolicy({ thinkLevel: 'medium' });

    const report = buildSystemPromptReport({
      source: 'run',
      generatedAt: 123,
      bootstrapMaxChars: 1000,
      systemPrompt: 'system prompt text',
      bootstrapFiles: [],
      injectedFiles: [],
      skillsPrompt:
        '<available_skills><skill><name>alpha</name></skill></available_skills>',
      tools: [],
      runtimeIntensity: {
        policy: baseline,
        promptMode: 'full',
        skillsIncluded: 3,
        skillsTotal: 3,
        toolResultMaxChars: 12_000,
      },
    });

    expect(report.runtimeIntensity).toMatchObject({
      level: 'baseline',
      policyId: 'baseline',
      promptMode: 'full',
      skillsMode: 'preserve',
      shellOutputMode: 'preserve',
      skillsIncluded: 3,
      skillsTotal: 3,
      toolResultMaxChars: 12_000,
      estimatedSavedChars: 0,
      estimatedSavedTokens: 0,
    });
  });
});
