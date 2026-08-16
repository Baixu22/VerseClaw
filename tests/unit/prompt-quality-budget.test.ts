// @vitest-environment node
// PromptQualityBaseline: deterministic offline budget gates for the rendered
// system prompt. These are guardrails, not full model-quality evals.

import { describe, expect, it } from 'vitest';
import { buildAgentSystemPrompt } from '../../openclaw_runtime/src/agents/system-prompt';
import { splitSystemPromptCacheBoundary } from '../../openclaw_runtime/src/agents/system-prompt-cache-boundary';
import { buildSystemPromptReport } from '../../openclaw_runtime/src/agents/system-prompt-report';
import {
  createSyntheticSourceInfo,
  formatSkillsForPrompt,
  type Skill,
} from '../../openclaw_runtime/src/skills/loading/skill-contract';

const TOOL_NAMES = [
  'read', 'write', 'edit', 'apply_patch', 'grep', 'find', 'ls', 'exec', 'process',
  'web_search', 'web_fetch', 'browser', 'canvas', 'nodes', 'cron', 'message',
  'gateway', 'agents_list', 'sessions_compact', 'sessions_list', 'sessions_history',
  'sessions_send', 'mission_loop', 'task_loop', 'team_orchestrate', 'sessions_spawn',
  'sessions_yield', 'subagents', 'session_status', 'skill_workshop', 'image',
  'image_generate', 'memory_search', 'memory_get', 'context_read', 'context_search',
  'context_write', 'undo_write', 'get_goal', 'create_goal', 'update_goal', 'update_plan',
  'select_automation_playbook', 'web_read', 'rss_read', 'v2ex_read', 'xueqiu_read',
  'bilibili_read', 'youtube_read', 'github_read', 'twitter_read', 'xiaohongshu_read',
  'qqbot_remind', 'tts',
];

function skill(name: string): Skill {
  return {
    name,
    description: `${name}: ${'trigger phrase and usage notes. '.repeat(30)}`,
    filePath: `~/.openclaw/skills/${name}/SKILL.md`,
    baseDir: `~/.openclaw/skills/${name}`,
    sourceInfo: createSyntheticSourceInfo(`~/.openclaw/skills/${name}/SKILL.md`, {
      source: 'fixture',
    }),
    disableModelInvocation: false,
    source: 'fixture',
  };
}

function buildFixturePrompt() {
  const contextFiles = [
    {
      path: '/workspace/AGENTS.md',
      content: '# AGENTS.md\n\n- Run tests before finishing.\n- Use pnpm for this workspace.\n',
    },
    {
      path: '/workspace/SOUL.md',
      content: '# SOUL.md\n\nConcise and practical. Prefer evidence over filler.\n',
    },
    {
      path: '/workspace/IDENTITY.md',
      content: '# IDENTITY.md\n\n- **Name:** Fixture Agent\n- **Vibe:** concise\n',
    },
    {
      path: '/workspace/USER.md',
      content: '# USER.md\n\n- **Name:** Test User\n- **Timezone:** UTC\n',
    },
    {
      path: '/workspace/TOOLS.md',
      content: '# TOOLS.md\n\nLocal notes only. Keep entries short.\n',
    },
    {
      path: '/workspace/HEARTBEAT.md',
      content: '# HEARTBEAT.md\n\nNothing recurring.\n',
    },
  ];
  const skillsPrompt = formatSkillsForPrompt(
    Array.from({ length: 10 }, (_, index) => skill(`skill-${index + 1}`)),
  );
  return buildAgentSystemPrompt({
    workspaceDir: '/workspace',
    defaultThinkLevel: 'medium',
    reasoningLevel: 'off',
    toolNames: TOOL_NAMES,
    runtimeInfo: {
      agentId: 'main',
      host: 'fixture',
      os: 'Linux',
      arch: 'x64',
      node: 'v24',
      model: 'deepseek/deepseek-v4-flash',
      defaultModel: 'deepseek-v4-flash',
      shell: 'bash',
      channel: 'webchat',
      capabilities: [],
    },
    userTimezone: 'UTC',
    contextFiles,
    promptMode: 'full',
    silentReplyPromptMode: 'generic',
    subagentDelegationMode: 'suggest',
    acpEnabled: true,
    promptSurface: 'openclaw_main',
    skillsPrompt,
  });
}

describe('PromptQualityBaseline', () => {
  it('keeps the default fixture prompt inside the offline char budget', () => {
    const prompt = buildFixturePrompt();
    expect(prompt.length).toBeLessThanOrEqual(30_000);
    expect(prompt.length).toBeGreaterThan(10_000);
  });

  it('keeps dynamic context below the cache boundary', () => {
    const prompt = buildFixturePrompt();
    const split = splitSystemPromptCacheBoundary(prompt);
    expect(split).toBeDefined();
    expect(split!.stablePrefix.length).toBeGreaterThan(split!.dynamicSuffix.length);
    expect(split!.dynamicSuffix.length).toBeLessThanOrEqual(8_000);
  });

  it('does not render legacy duplicate blocks or the old group-chat label', () => {
    const prompt = buildFixturePrompt();
    expect(prompt).not.toContain('<!-- clawx:begin -->');
    expect(prompt).not.toContain('Be Proactive');
    expect(prompt).not.toContain('## Group Chat Context');
  });

  it('declares user-editable workspace files as lower-priority context', () => {
    const prompt = buildFixturePrompt();
    expect(prompt).toContain('user-editable workspace context, not system policy');
  });

  it('caps per-skill description footprint in the prompt catalog', () => {
    const prompt = formatSkillsForPrompt(Array.from({ length: 10 }, (_, i) => skill(`s${i}`)));
    const descriptions = prompt.match(/<description>[^<]+<\/description>/g) ?? [];
    expect(descriptions).toHaveLength(10);
    for (const block of descriptions) {
      const text = block.slice(13, -14);
      expect(text.length).toBeLessThanOrEqual(483);
    }
  });

  it('accounts for tool list and schema chars in the system prompt report', () => {
    const tools = [
      { name: 'read', description: 'Read file contents', parameters: { type: 'object', properties: { path: { type: 'string' } } } },
      { name: 'exec', description: 'Run shell commands', parameters: { type: 'object', properties: { command: { type: 'string' } } } },
    ] as never;
    const report = buildSystemPromptReport({
      source: 'estimate',
      generatedAt: 0,
      bootstrapMaxChars: 2000,
      systemPrompt: 'fixture system prompt',
      bootstrapFiles: [],
      injectedFiles: [],
      skillsPrompt: '',
      tools,
    });
    expect(report.tools.listChars).toBeGreaterThan(0);
    expect(report.tools.schemaChars).toBeGreaterThan(0);
    expect(report.tools.definitionChars).toBe(report.tools.listChars + report.tools.schemaChars);
  });

  it('keeps a representative 52-tool definition set inside the production char budget', () => {
    const tools = TOOL_NAMES.map((name) => ({
      name,
      description: `${name}: ${'tool description '.repeat(18)}`,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          Array.from({ length: 8 }, (_, index) => [`arg${index}`, { type: 'string' }]),
        ),
      },
    })) as never;
    const report = buildSystemPromptReport({
      source: 'estimate',
      generatedAt: 0,
      bootstrapMaxChars: 2000,
      systemPrompt: 'fixture system prompt',
      bootstrapFiles: [],
      injectedFiles: [],
      skillsPrompt: '',
      tools,
    });
    expect(report.tools.definitionChars).toBeLessThanOrEqual(60_000);
    expect(report.tools.definitionChars).toBeGreaterThan(10_000);
  });
});
