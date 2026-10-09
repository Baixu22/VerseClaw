// @vitest-environment node
// P2-105: tool disclosure must follow the effective tool list instead of a
// hardcoded catalog, and positive tool guidance must be gated on availability.

import { describe, expect, it } from 'vitest';
import { buildEmbeddedSystemPrompt } from '../../openclaw_runtime/src/agents/embedded-agent-runner/system-prompt';
import { buildAgentSystemPrompt } from '../../openclaw_runtime/src/agents/system-prompt';

const WORKSPACE_DIR = '/workspace';

const RUNTIME_INFO = {
  agentId: 'main',
  host: 'fixture',
  os: 'Linux',
  arch: 'x64',
  node: 'v24',
  model: 'deepseek/deepseek-v4-flash',
  shell: 'bash',
  channel: 'webchat',
  capabilities: [] as string[],
};

// Every line of the hardcoded fallback catalog (prompt-surface.ts) that must not
// be advertised when the effective tool list is known and empty.
const TOOL_CATALOG_LINES = [
  '- grep: search file contents for patterns',
  '- find: find files by glob pattern',
  '- ls: list directory contents',
  '- apply_patch: apply multi-file patches',
  '- exec: run shell commands',
  '- process: manage background exec sessions',
  "- browser: control OpenClaw's dedicated browser",
  '- canvas: present/eval/snapshot the Canvas',
  '- nodes: list/describe/notify/camera/screen on paired nodes',
  '- cron: manage cron jobs and wake events',
  '- sessions_compact: compact the current session after this turn',
  '- sessions_list: list sessions',
  '- sessions_history: fetch session history',
  '- sessions_send: send to another session',
  '- sessions_spawn: spawn an isolated sub-agent session',
  '- sessions_yield: end this turn and wait for sub-agent completion events',
  '- subagents: list active/recent sub-agent runs',
  '- session_status: show usage/time/model state',
];

const POPULATED_TOOL_NAMES = [
  'read',
  'write',
  'edit',
  'apply_patch',
  'grep',
  'find',
  'ls',
  'exec',
  'process',
  'sessions_compact',
  'sessions_list',
  'sessions_history',
  'sessions_send',
  'sessions_spawn',
  'sessions_yield',
  'subagents',
  'session_status',
  'gateway',
];

function buildMainPrompt(params: {
  toolNames?: string[];
  promptMode?: 'full' | 'minimal' | 'none';
}) {
  return buildAgentSystemPrompt({
    workspaceDir: WORKSPACE_DIR,
    toolNames: params.toolNames,
    runtimeInfo: { ...RUNTIME_INFO },
    userTimezone: 'UTC',
    promptMode: params.promptMode ?? 'full',
    promptSurface: 'openclaw_main',
  });
}

describe('P2-105 tool disclosure', () => {
  it('omits the "This runtime enables:" catalog for an explicitly empty tool list', () => {
    const prompt = buildMainPrompt({ toolNames: [] });

    expect(prompt).not.toContain('This runtime enables:');
    expect(prompt).not.toContain('OpenClaw lists the standard tools above');
    for (const catalogLine of TOOL_CATALOG_LINES) {
      expect(prompt).not.toContain(catalogLine);
    }
    expect(prompt).toContain('Available tools are policy-filtered.');
    expect(prompt.toLowerCase()).toContain('no tools are enabled for this run');
  });

  it('omits the catalog when an embedded run has an empty tool array', () => {
    const prompt = buildEmbeddedSystemPrompt({
      agentId: 'main',
      workspaceDir: WORKSPACE_DIR,
      reasoningTagHint: false,
      runtimeInfo: { ...RUNTIME_INFO },
      tools: [],
      userTimezone: 'UTC',
    });

    expect(prompt).not.toContain('This runtime enables:');
    expect(prompt).not.toContain('OpenClaw lists the standard tools above');
    for (const catalogLine of TOOL_CATALOG_LINES) {
      expect(prompt).not.toContain(catalogLine);
    }
    expect(prompt.toLowerCase()).toContain('no tools are enabled for this run');
  });

  it('keeps the legacy catalog only when tool metadata is unavailable', () => {
    const prompt = buildMainPrompt({});

    expect(prompt).toContain('OpenClaw lists the standard tools above. This runtime enables:');
    expect(prompt).toContain('- grep: search file contents for patterns');
  });

  it('does not advertise sessions_spawn for a read-only main surface', () => {
    const prompt = buildMainPrompt({ toolNames: ['read'], promptMode: 'minimal' });

    expect(prompt).toContain('- read: Read file contents');
    expect(prompt).not.toContain('Larger work: use `sessions_spawn`');
    expect(prompt).not.toContain('omit `context` unless transcript needed');
    expect(prompt).not.toContain('For long waits, avoid rapid poll loops');
    expect(prompt).not.toContain('Do not poll `subagents list` / `sessions_list` in a loop');
  });

  it('does not advertise gateway or session_status for a read-only subagent surface', () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: WORKSPACE_DIR,
      toolNames: ['read'],
      runtimeInfo: { ...RUNTIME_INFO },
      userTimezone: 'UTC',
      promptMode: 'minimal',
      promptSurface: 'subagent',
    });

    expect(prompt).not.toContain('Config/restart: prefer `gateway`');
    expect(prompt).not.toContain('run session_status');
    expect(prompt).not.toContain('## OpenClaw Self-Update');
  });

  it('keeps the long-wait guidance when only exec is available', () => {
    const prompt = buildMainPrompt({ toolNames: ['read', 'exec'], promptMode: 'minimal' });

    expect(prompt).toContain('For long waits, avoid rapid poll loops: use');
    expect(prompt).not.toContain('Larger work: use `sessions_spawn`');
  });

  it('renders the full tool list, workflow hints, and gateway sections for a populated list', () => {
    const prompt = buildMainPrompt({ toolNames: POPULATED_TOOL_NAMES });

    expect(prompt).toContain('- read: Read file contents');
    expect(prompt).toContain('- gateway: Restart, apply config, or run updates');
    expect(prompt).not.toContain('This runtime enables:');
    expect(prompt).toContain(
      'For long waits, avoid rapid poll loops: use exec with enough yieldMs or process(action=poll, timeout=<ms>).',
    );
    expect(prompt).toContain('Larger work: use `sessions_spawn`; completion is push-based.');
    expect(prompt).toContain(
      '`sessions_spawn`: omit `context` unless transcript needed; then set `context:"fork"`.',
    );
    expect(prompt).toContain(
      'Do not poll `subagents list` / `sessions_list` in a loop; use `sessions_yield` when waiting for spawned sub-agent completion events, and check status only on-demand (for intervention, debugging, or when explicitly asked).',
    );
    expect(prompt).toContain(
      'Config/restart: prefer `gateway` tool (`config.schema.lookup|get|patch|apply`, `restart`).',
    );
    expect(prompt).toContain('## OpenClaw Self-Update');
    expect(prompt).toContain(
      'If you need the current date, time, or day of week, run session_status (📊 session_status).',
    );
  });
});
