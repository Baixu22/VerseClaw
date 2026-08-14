import { readdir, readFile, stat } from 'fs/promises';
import { join } from 'path';
import { getDataDir, getOpenClawConfigDir } from './paths';
import { logger } from './logger';
import {
  aggregateUsageEntries,
  extractSessionIdFromTranscriptFileName,
  normalizeUsageAggregateWindow,
  parseOpenClawSessionKey,
  parseUsageEntriesFromJsonl,
  summarizeUsageEntries,
  type TokenUsageHistoryEntry,
  type TokenUsageSummary,
} from './token-usage-core';
import type { UsageAggregateSummary, UsageAggregateWindow } from '@shared/host-api/contract';
import { listConfiguredAgentIds } from './agent-config';
import { resolveSessionTranscriptPath } from './session-files';

export {
  extractSessionIdFromTranscriptFileName,
  parseOpenClawSessionKey,
  parseUsageEntriesFromJsonl,
  summarizeUsageEntries,
  type TokenUsageHistoryEntry,
  type TokenUsageSummary,
} from './token-usage-core';

export function getOpenClawUsageDirs(): string[] {
  const sourceRuntimeState = join(getDataDir(), 'openclaw-source-state');
  const sourceRuntimeHome = join(getDataDir(), 'openclaw-source-home');
  const dirs = [sourceRuntimeState, sourceRuntimeHome, getOpenClawConfigDir()];
  const seen = new Set<string>();
  return dirs.filter((dir) => {
    const key = process.platform === 'win32' ? dir.toLowerCase() : dir;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function listAgentIdsWithSessionDirsForRoot(
  openclawDir: string,
  options: { includeConfiguredAgents?: boolean } = {},
): Promise<string[]> {
  const agentsDir = join(openclawDir, 'agents');
  const agentIds = new Set<string>();

  if (options.includeConfiguredAgents) {
    try {
      for (const agentId of await listConfiguredAgentIds()) {
        const normalized = agentId.trim();
        if (normalized) {
          agentIds.add(normalized);
        }
      }
    } catch {
      // Ignore config discovery failures and fall back to disk scan.
    }
  }

  try {
    const agentEntries = await readdir(agentsDir, { withFileTypes: true });
    for (const entry of agentEntries) {
      if (entry.isDirectory()) {
        const normalized = entry.name.trim();
        if (normalized) {
          agentIds.add(normalized);
        }
      }
    }
  } catch {
    // Ignore disk discovery failures and return whatever we already found.
  }

  return [...agentIds];
}

export async function listAgentIdsWithSessionDirs(): Promise<string[]> {
  const agentIds = new Set<string>();
  const globalOpenClawDir = getOpenClawConfigDir();
  for (const openclawDir of getOpenClawUsageDirs()) {
    const includeConfiguredAgents = openclawDir === globalOpenClawDir;
    for (const agentId of await listAgentIdsWithSessionDirsForRoot(openclawDir, { includeConfiguredAgents })) {
      agentIds.add(agentId);
    }
  }
  return [...agentIds];
}

async function listRecentSessionFilesForRoot(openclawDir: string): Promise<Array<{ filePath: string; sessionId: string; agentId: string; mtimeMs: number }>> {
  const agentsDir = join(openclawDir, 'agents');
  try {
    const agentEntries = await listAgentIdsWithSessionDirsForRoot(openclawDir, {
      includeConfiguredAgents: openclawDir === getOpenClawConfigDir(),
    });
    const files: Array<{ filePath: string; sessionId: string; agentId: string; mtimeMs: number }> = [];

    for (const agentId of agentEntries) {
      const sessionsDir = join(agentsDir, agentId, 'sessions');
      try {
        const sessionEntries = await readdir(sessionsDir);

        for (const fileName of sessionEntries) {
          const sessionId = extractSessionIdFromTranscriptFileName(fileName);
          if (!sessionId) continue;
          const filePath = join(sessionsDir, fileName);
          try {
            const fileStat = await stat(filePath);
            files.push({
              filePath,
              sessionId,
              agentId,
              mtimeMs: fileStat.mtimeMs,
            });
          } catch {
            continue;
          }
        }
      } catch {
        continue;
      }
    }

    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return files;
  } catch {
    return [];
  }
}

async function listRecentSessionFiles(): Promise<Array<{ filePath: string; sessionId: string; agentId: string; mtimeMs: number }>> {
  const seen = new Set<string>();
  const files: Array<{ filePath: string; sessionId: string; agentId: string; mtimeMs: number }> = [];

  for (const openclawDir of getOpenClawUsageDirs()) {
    for (const file of await listRecentSessionFilesForRoot(openclawDir)) {
      const key = process.platform === 'win32' ? file.filePath.toLowerCase() : file.filePath;
      if (seen.has(key)) continue;
      seen.add(key);
      files.push(file);
    }
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files;
}

export async function getRecentTokenUsageHistory(limit?: number): Promise<TokenUsageHistoryEntry[]> {
  const files = await listRecentSessionFiles();
  const results: TokenUsageHistoryEntry[] = [];
  const maxEntries = typeof limit === 'number' && Number.isFinite(limit)
    ? Math.max(Math.floor(limit), 0)
    : Number.POSITIVE_INFINITY;

  for (const file of files) {
    if (results.length >= maxEntries) break;
    try {
      const content = await readFile(file.filePath, 'utf8');
      const entries = parseUsageEntriesFromJsonl(content, {
        sessionId: file.sessionId,
        agentId: file.agentId,
      }, Number.isFinite(maxEntries) ? maxEntries - results.length : undefined);
      results.push(...entries);
    } catch (error) {
      logger.debug(`Failed to read token usage transcript ${file.filePath}:`, error);
    }
  }

  results.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  return Number.isFinite(maxEntries) ? results.slice(0, maxEntries) : results;
}

/**
 * Aggregate ALL local transcripts into window-scoped totals, per-day
 * buckets, and per-model / per-agent dimensions. Unlike
 * `getRecentTokenUsageHistory`, this applies no entry cap: the "All"
 * window reflects complete local history.
 */
export async function getUsageAggregateSummary(window?: UsageAggregateWindow): Promise<UsageAggregateSummary> {
  const normalizedWindow = normalizeUsageAggregateWindow(window);
  const files = await listRecentSessionFiles();
  const entries: TokenUsageHistoryEntry[] = [];

  for (const file of files) {
    try {
      const content = await readFile(file.filePath, 'utf8');
      entries.push(...parseUsageEntriesFromJsonl(content, {
        sessionId: file.sessionId,
        agentId: file.agentId,
      }));
    } catch (error) {
      logger.debug(`Failed to read token usage transcript ${file.filePath}:`, error);
    }
  }

  return aggregateUsageEntries(entries, normalizedWindow, { scannedFiles: files.length });
}

export function getTranscriptPathForSessionKey(sessionKey: string): {
  filePath: string;
  agentId: string;
  sessionId: string;
} {
  const { agentId, sessionId } = parseOpenClawSessionKey(sessionKey);
  return {
    agentId,
    sessionId,
    filePath: join(getOpenClawConfigDir(), 'agents', agentId, 'sessions', `${sessionId}.jsonl`),
  };
}

function getTranscriptPathForSessionKeyInRoot(openclawDir: string, sessionKey: string): {
  filePath: string;
  agentId: string;
  sessionId: string;
} {
  const { agentId, sessionId } = parseOpenClawSessionKey(sessionKey);
  return {
    agentId,
    sessionId,
    filePath: join(openclawDir, 'agents', agentId, 'sessions', `${sessionId}.jsonl`),
  };
}

type ResolvedTranscriptPath = {
  filePath: string;
  agentId: string;
  sessionId: string;
  transcriptSessionId: string;
  resolvedFromSessionIndex: boolean;
};

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile();
  } catch {
    return false;
  }
}

async function findLatestSessionTranscriptInRoot(
  openclawDir: string,
  agentId: string,
): Promise<{ filePath: string; transcriptSessionId: string } | null> {
  const sessionsDir = join(openclawDir, 'agents', agentId, 'sessions');
  try {
    const entries = await readdir(sessionsDir);
    const candidates: Array<{ filePath: string; transcriptSessionId: string; mtimeMs: number }> = [];
    for (const fileName of entries) {
      if (
        !fileName.endsWith('.jsonl')
        || fileName.endsWith('.trajectory.jsonl')
        || fileName.endsWith('.deleted.jsonl')
        || fileName.includes('.jsonl.reset.')
      ) {
        continue;
      }
      const transcriptSessionId = extractSessionIdFromTranscriptFileName(fileName);
      if (!transcriptSessionId) continue;
      const filePath = join(sessionsDir, fileName);
      try {
        const fileStat = await stat(filePath);
        if (!fileStat.isFile()) continue;
        candidates.push({ filePath, transcriptSessionId, mtimeMs: fileStat.mtimeMs });
      } catch {
        continue;
      }
    }
    candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
    const latest = candidates[0];
    return latest ? { filePath: latest.filePath, transcriptSessionId: latest.transcriptSessionId } : null;
  } catch {
    return null;
  }
}

async function resolveTranscriptPathForSessionKeyInRoot(
  openclawDir: string,
  sessionKey: string,
): Promise<ResolvedTranscriptPath> {
  const direct = getTranscriptPathForSessionKeyInRoot(openclawDir, sessionKey);
  const fallback = {
    ...direct,
    transcriptSessionId: direct.sessionId,
    resolvedFromSessionIndex: false,
  };

  try {
    const rootSessionsDir = join(openclawDir, 'agents', direct.agentId, 'sessions');
    const raw = await readFile(join(rootSessionsDir, 'sessions.json'), 'utf8');
    if (!raw.trim()) return fallback;
    const sessionsJson = JSON.parse(raw) as Record<string, unknown>;
    const resolved = resolveSessionTranscriptPath(sessionsJson, rootSessionsDir, sessionKey);
    if (!resolved.ok) return fallback;
    return {
      filePath: resolved.resolvedSrcPath,
      agentId: direct.agentId,
      sessionId: direct.sessionId,
      transcriptSessionId: resolved.baseId,
      resolvedFromSessionIndex: true,
    };
  } catch {
    return fallback;
  }
}

export async function resolveTranscriptPathForSessionKey(sessionKey: string): Promise<ResolvedTranscriptPath> {
  const fallbacks: ResolvedTranscriptPath[] = [];
  const parsed = parseOpenClawSessionKey(sessionKey);

  for (const openclawDir of getOpenClawUsageDirs()) {
    const resolved = await resolveTranscriptPathForSessionKeyInRoot(openclawDir, sessionKey);
    fallbacks.push(resolved);
    if (await fileExists(resolved.filePath)) {
      return resolved;
    }
    if (parsed.sessionId === 'main') {
      const latest = await findLatestSessionTranscriptInRoot(openclawDir, parsed.agentId);
      if (latest) {
        return {
          filePath: latest.filePath,
          agentId: parsed.agentId,
          sessionId: parsed.sessionId,
          transcriptSessionId: latest.transcriptSessionId,
          resolvedFromSessionIndex: false,
        };
      }
    }
  }

  return fallbacks[0] ?? {
    ...getTranscriptPathForSessionKey(sessionKey),
    transcriptSessionId: parsed.sessionId,
    resolvedFromSessionIndex: false,
  };
}

export async function getSessionTokenUsageSummary(sessionKey: string): Promise<TokenUsageSummary> {
  const { filePath, agentId, sessionId } = await resolveTranscriptPathForSessionKey(sessionKey);
  try {
    const content = await readFile(filePath, 'utf8');
    const entries = parseUsageEntriesFromJsonl(content, { sessionId, agentId });
    return summarizeUsageEntries(entries, { sessionId, agentId });
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      logger.debug(`Failed to read live token usage transcript ${filePath}:`, error);
    }
    return summarizeUsageEntries([], { sessionId, agentId });
  }
}
