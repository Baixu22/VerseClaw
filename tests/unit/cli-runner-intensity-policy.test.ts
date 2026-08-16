// @vitest-environment node
// W4: CLI-backed harness receives and renders the runtime intensity policy
// for prompt mode, skills limits are consumed upstream, and the report can
// declare prompt-only adherence.

import { describe, expect, it } from 'vitest';
import { buildCliAgentSystemPrompt } from '../../openclaw_runtime/src/agents/cli-runner/helpers';
import { resolveRuntimeIntensityPolicy } from '../../openclaw_runtime/src/agents/intensity-policy';
import { buildSystemPromptReport } from '../../openclaw_runtime/src/agents/system-prompt-report';

describe('CLI runner runtime intensity policy surface', () => {
  it('renders minimal prompt mode for lightweight intensity', () => {
    const full = buildCliAgentSystemPrompt({
      workspaceDir: '/tmp/ws',
      cwd: '/tmp/ws',
      tools: [],
      modelDisplay: 'deepseek/deepseek-v4-flash',
    });
    const minimal = buildCliAgentSystemPrompt({
      workspaceDir: '/tmp/ws',
      cwd: '/tmp/ws',
      tools: [],
      modelDisplay: 'deepseek/deepseek-v4-flash',
      promptMode: 'minimal',
    });

    expect(full.length).toBeGreaterThan(minimal.length);
    expect(full).toContain('## Silent Replies');
    expect(minimal).not.toContain('## Silent Replies');
  });

  it('reports prompt-only adherence for CLI-backed runs', () => {
    const policy = resolveRuntimeIntensityPolicy({ thinkLevel: 'low' });
    const report = buildSystemPromptReport({
      source: 'run',
      generatedAt: 123,
      bootstrapMaxChars: 1000,
      systemPrompt: 'cli prompt',
      bootstrapFiles: [],
      injectedFiles: [],
      skillsPrompt: '',
      tools: [],
      runtimeIntensity: {
        policy,
        promptMode: 'minimal',
        policyAdherence: 'prompt-only',
        requestedReasoning: 'low',
        effectiveReasoning: 'low',
      },
    });

    expect(report.runtimeIntensity).toMatchObject({
      level: 'low',
      promptMode: 'minimal',
      policyAdherence: 'prompt-only',
      requestedReasoning: 'low',
      effectiveReasoning: 'low',
    });
  });
});
