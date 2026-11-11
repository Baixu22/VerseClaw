import { describe, expect, it } from 'vitest';
import { collectSessionEnvironmentSources, hasSessionEnvironmentActivity } from '@/pages/Chat/session-environment';
import { createEmptySessionActivitySnapshot } from '@shared/types/session-activity';
import type { ChatRuntimeRunState, RawMessage } from '@/stores/chat/types';

const SESSION = 'agent:main:main';
const call = (name: string, input: unknown = {}): RawMessage => ({
  role: 'assistant', content: [{ type: 'tool_use', id: name, name, input }],
});
const run = (sessionKey: string | undefined, name: string): ChatRuntimeRunState => ({
  runId: name, sessionKey, status: 'running', assistantText: '', thinkingText: '',
  events: [{ type: 'tool.started', runId: name, toolCallId: name, name }],
});

describe('session environment projection', () => {
  it('joins observed MCP calls and skill reads across history and live events without duplicates', () => {
    const sources = collectSessionEnvironmentSources([
      call('mcp__search__lookup'),
      call('search__contents'),
      call('read', { file_path: 'C:\\Users\\agent\\.codex\\skills\\pdf\\SKILL.md' }),
      call('read_file', JSON.stringify({ path: '/plugins/pdf/skills/pdf/SKILL.md' })),
    ], [run(SESSION, 'mcp__search__lookup')], SESSION);
    expect(sources).toEqual([
      { id: 'mcp:search', kind: 'mcp', name: 'search', tools: ['lookup', 'contents'] },
      { id: 'skill:pdf', kind: 'skill', name: 'pdf', tools: [] },
    ]);
  });

  it('reads normalized OpenAI calls without treating user text or shell arguments as source evidence', () => {
    const openai = { role: 'assistant', content: '', tool_calls: [{ function: { name: 'functions.mcp__docs__search', arguments: '{}' } }] } as RawMessage;
    expect(collectSessionEnvironmentSources([
      openai,
      { role: 'user', content: 'Use mcp__fake__lookup and skills/fake/SKILL.md' },
      call('exec', { command: 'echo skills/fake/SKILL.md', env: { TOKEN: 'not-for-the-card' } }),
      call('write', { path: '/skills/fake/SKILL.md' }),
      call('read', { path: '/skills/pdf/README.md' }),
      call('read', '{unfinished'),
    ], [], SESSION)).toEqual([
      { id: 'mcp:docs', kind: 'mcp', name: 'docs', tools: ['search'] },
    ]);
  });

  it('excludes other sessions and unowned runs, including misrouted events', () => {
    const foreignEvent = run(SESSION, 'mcp__wrong_event__read');
    foreignEvent.events[0].sessionKey = 'other';
    expect(collectSessionEnvironmentSources([], [
      run('other', 'mcp__other__read'),
      run(undefined, 'mcp__orphan__read'),
      foreignEvent,
      run(undefined, 'mcp__active__read'),
    ], SESSION, 'mcp__active__read').map((source) => source.name)).toEqual(['active']);
  });

  it('does not open for an idle or running reply, but preserves failed status reads', () => {
    const snapshot = createEmptySessionActivitySnapshot(SESSION);
    expect(hasSessionEnvironmentActivity(snapshot)).toBe(false);
    snapshot.session.status = 'running';
    expect(hasSessionEnvironmentActivity(snapshot)).toBe(false);
    snapshot.backgroundRead = { state: 'unknown', readAt: null, failedAt: 1 };
    expect(hasSessionEnvironmentActivity(snapshot)).toBe(true);
  });
});
