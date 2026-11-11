import type { ChatRuntimeRunState, RawMessage } from '@/stores/chat/types';
import { backgroundReadFailed, type SessionActivitySnapshot } from '@shared/types/session-activity';
import { extractToolUse } from './message-utils';

export type SessionEnvironmentSource = {
  id: string;
  kind: 'mcp' | 'skill';
  name: string;
  tools: string[];
};

/** Project observed calls only. Configured tools, prose and raw environment values are not sources. */
export function collectSessionEnvironmentSources(
  messages: RawMessage[],
  runs: ChatRuntimeRunState[],
  sessionKey: string,
  activeRunId?: string | null,
): SessionEnvironmentSource[] {
  const sources = new Map<string, SessionEnvironmentSource>();
  const add = (kind: SessionEnvironmentSource['kind'], name: string, tool?: string) => {
    const id = `${kind}:${name}`;
    const source = sources.get(id) ?? { id, kind, name, tools: [] };
    if (tool && !source.tools.includes(tool)) source.tools.push(tool);
    sources.set(id, source);
  };
  const readCall = (name: string, input: unknown) => {
    const normalized = name.replace(/^functions\./, '').replace(/^mcp__/, '');
    // Bundle MCP tools use server__tool; native MCP tools use mcp__server__tool.
    const mcp = /^([\w-]+)__(.+)$/.exec(normalized);
    if (mcp) add('mcp', mcp[1], mcp[2]);

    let args = input;
    if (typeof args === 'string') {
      try { args = JSON.parse(args); } catch { return; }
    }
    if (!args || typeof args !== 'object' || Array.isArray(args)) return;
    const fields = args as Record<string, unknown>;
    const tool = mcp?.[2] ?? normalized;
    if (!['read', 'read_file', 'read_text_file'].includes(tool)) return;
    const path = fields.path ?? fields.file_path ?? fields.filePath;
    if (typeof path !== 'string') return;
    const skill = /(?:^|\/)skills\/(?:.*\/)?([^/]+)\/SKILL\.md$/i.exec(path.replace(/\\/g, '/'));
    if (skill) add('skill', skill[1]);
  };

  for (const message of messages) {
    if (message.role === 'assistant') {
      for (const call of extractToolUse(message)) readCall(call.name, call.input);
    } else if (message.role === 'toolresult' && message.toolName) {
      readCall(message.toolName, undefined);
    }
  }
  for (const run of runs) {
    if (run.sessionKey ? run.sessionKey !== sessionKey : run.runId !== activeRunId) continue;
    for (const event of run.events) {
      if (event.sessionKey && event.sessionKey !== sessionKey) continue;
      if (event.type === 'tool.started') readCall(event.name, event.args);
      else if (event.type === 'tool.completed') readCall(event.name, undefined);
    }
  }
  return [...sources.values()];
}

/** A clean repository, policy snapshot or running reply alone does not change the environment. */
export function hasSessionEnvironmentActivity(
  snapshot: SessionActivitySnapshot,
  { showGit = true, showCommands = true }: { showGit?: boolean; showCommands?: boolean } = {},
): boolean {
  return Boolean(
    (showGit && snapshot.git?.isRepository && (!snapshot.git.clean || snapshot.git.hasConflicts))
    || snapshot.subagents.length
    || (showCommands && snapshot.processes.length)
    || snapshot.goals.length
    || snapshot.lineage.length
    || snapshot.session.error
    || snapshot.continuity.blockedReason
    || backgroundReadFailed(snapshot.backgroundRead),
  );
}
