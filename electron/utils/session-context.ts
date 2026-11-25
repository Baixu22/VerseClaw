import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadExistingSqliteSessionStoreReadOnly, resolveSqliteSessionStoreDatabasePath } from '../../openclaw_runtime/src/config/sessions/store-sqlite';
import type { ContextSourceEntry, ContextSourceGroup, SessionContextComposition } from '@shared/types/context-display';
import { isRecord } from '../services/payload-utils';
import { resolveSessionTranscriptPath } from './session-files';
import { getOpenClawUsageDirs, parseUsageEntriesFromJsonl, summarizeUsageEntries } from './token-usage';

const MAX_SOURCE_ENTRIES = 100;

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function name(value: unknown, limit = 512): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : undefined;
}

function group(chars: number | null, value: unknown, kind: 'files' | 'skills' | 'tools'): ContextSourceGroup {
  const entries = Array.isArray(value) ? value.filter(isRecord) : [];
  return {
    chars,
    totalEntries: entries.length,
    entries: entries.slice(0, MAX_SOURCE_ENTRIES).flatMap((entry): ContextSourceEntry[] => {
      const entryName = name(entry.name);
      if (!entryName) return [];
      if (kind === 'files') return [{
        name: entryName,
        path: name(entry.path, 1024),
        chars: count(entry.injectedChars),
        rawChars: count(entry.rawChars),
        status: entry.missing === true ? 'missing' : entry.truncated === true ? 'truncated' : 'included',
      }];
      const summary = count(entry.summaryChars);
      const schema = count(entry.schemaChars);
      return [{
        name: entryName,
        chars: kind === 'skills' ? count(entry.blockChars) : summary != null && schema != null ? count(summary + schema) : schema,
        status: 'included',
      }];
    }),
  };
}

export function projectContextComposition(value: unknown, sessionKey: string, sessionId: string): SessionContextComposition | null {
  if (!isRecord(value) || !isRecord(value.systemPrompt)
    || !['run', 'estimate'].includes(String(value.source)) || count(value.generatedAt) == null
    || (typeof value.sessionKey === 'string' && value.sessionKey !== sessionKey)
    || (typeof value.sessionId === 'string' && value.sessionId !== sessionId)) return null;
  const skills = isRecord(value.skills) ? value.skills : {};
  const tools = isRecord(value.tools) ? value.tools : {};
  const turn = isRecord(value.currentTurn) ? value.currentTurn : {};
  const skillsChars = count(skills.promptChars);
  const toolListChars = count(tools.listChars);
  const schemaChars = count(tools.schemaChars);
  const nonProjectChars = count(value.systemPrompt.nonProjectContextChars);
  return {
    sessionId,
    generatedAt: value.generatedAt as number,
    source: value.source as 'run' | 'estimate',
    modelRef: name(value.provider) && name(value.model) ? `${name(value.provider)}/${name(value.model)}` : null,
    systemPromptChars: count(value.systemPrompt.chars),
    // Skills and the tool list are already inside the system prompt's non-project portion.
    instructionsChars: nonProjectChars != null && skillsChars != null && toolListChars != null
      ? count(nonProjectChars - skillsChars - toolListChars) : null,
    currentTurnChars: count(turn.promptChars),
    runtimeContextChars: count(turn.runtimeContextChars),
    workspaceFiles: group(count(value.systemPrompt.projectContextChars), value.injectedWorkspaceFiles, 'files'),
    skills: group(skillsChars, skills.entries, 'skills'),
    tools: group(count(tools.definitionChars) ?? (toolListChars != null && schemaChars != null ? count(toolListChars + schemaChars) : null), tools.entries, 'tools'),
  };
}

export interface SessionContextSnapshot {
  sessionId: string;
  usedTokens: number | null;
  contextTokens: number | null;
  usageSource: 'runtime' | 'last-request' | 'unavailable';
  measuredAt: number | null;
  composition: SessionContextComposition | null;
}

/** Read only the requested session; never substitute another transcript for an empty main session. */
export async function getSessionContextSnapshot(sessionKey: string, expectedSessionId?: string): Promise<SessionContextSnapshot | null> {
  const match = /^agent:([A-Za-z0-9_-]+):(.+)$/.exec(sessionKey);
  if (!match) return null;
  const agentId = match[1];
  for (const root of getOpenClawUsageDirs()) {
    const sessionsDir = join(root, 'agents', agentId, 'sessions');
    let index: Record<string, unknown>;
    try {
      const storePath = join(sessionsDir, 'sessions.json');
      // The runtime writes SQLite metadata. JSON is only a legacy source when no database exists.
      const parsed: unknown = existsSync(resolveSqliteSessionStoreDatabasePath(storePath))
        ? loadExistingSqliteSessionStoreReadOnly(storePath)
        : JSON.parse(await readFile(storePath, 'utf8'));
      if (!isRecord(parsed)) continue;
      index = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    const rawEntry = index[sessionKey] ?? (Array.isArray(index.sessions)
      ? index.sessions.find(entry => isRecord(entry) && (entry.key === sessionKey || entry.sessionKey === sessionKey)) : undefined);
    if (rawEntry == null) continue;
    const resolved = resolveSessionTranscriptPath(index, sessionsDir, sessionKey);
    if (!resolved.ok) return null;
    const sessionId = resolved.baseId;
    if (expectedSessionId && sessionId !== expectedSessionId) return null;
    const entry = isRecord(rawEntry) ? rawEntry : {};
    if (typeof entry.sessionId === 'string' && entry.sessionId !== sessionId) return null;
    let usedTokens = entry.totalTokensFresh === false ? null : count(entry.totalTokens);
    let usageSource: SessionContextSnapshot['usageSource'] = usedTokens != null ? 'runtime' : 'unavailable';
    let measuredAt = usedTokens != null ? count(entry.updatedAt) : null;
    // A stale runtime marker follows compaction/reset; the previous request cannot fill that gap.
    if (usedTokens == null && entry.totalTokensFresh !== false) {
      try {
        const content = await readFile(resolved.resolvedSrcPath, 'utf8');
        const summary = summarizeUsageEntries(parseUsageEntriesFromJsonl(content, { sessionId, agentId }), { sessionId, agentId });
        if (summary.entryCount > 0 && summary.usageStatus === 'available') {
          usedTokens = summary.lastTurnPromptTokens;
          usageSource = 'last-request';
          measuredAt = summary.latestTimestamp ? Date.parse(summary.latestTimestamp) : null;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return {
      sessionId,
      usedTokens,
      contextTokens: count(entry.contextTokens),
      usageSource,
      measuredAt,
      composition: projectContextComposition(entry.systemPromptReport, sessionKey, sessionId),
    };
  }
  return null;
}
