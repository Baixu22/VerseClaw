import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { Type } from '@sinclair/typebox';
import { buildSystemPromptReport } from '../../../openclaw_runtime/src/agents/system-prompt-report';
import { closeSqliteSessionStoreDatabase, replaceSqliteSessionStore, resolveSqliteSessionStoreDatabasePath } from '../../../openclaw_runtime/src/config/sessions/store-sqlite';

export function persistRuntimeContextEntries(stateDir: string, entries: Parameters<typeof replaceSqliteSessionStore>[1]) {
  const storePath = join(stateDir, 'agents', 'main', 'sessions', 'sessions.json');
  const databasePath = resolveSqliteSessionStoreDatabasePath(storePath);
  const withinFixture = relative(stateDir, databasePath);
  if (withinFixture.startsWith('..') || isAbsolute(withinFixture)) throw new Error('Session database escaped the agent fixture');
  try { replaceSqliteSessionStore(storePath, entries); }
  finally { closeSqliteSessionStoreDatabase(storePath); }
  return { storePath, databasePath };
}

/** Agent-owned files use the production report builder; no context DTO is replayed. */
export async function createComposerContextFiles(homeDir: string) {
  const workspaceDir = join(homeDir, 'composer-workspace');
  await mkdir(workspaceDir, { recursive: true });
  const files = await Promise.all([['AGENTS.md', 'AGENTS.md'], ['docs/dev/chat-model-selection.md', 'TOOLS.md']].map(async ([relative, name]) => {
    const path = join(workspaceDir, name);
    await writeFile(path, await readFile(resolve(relative)));
    return path;
  }));
  return { workspaceDir, files };
}

export async function persistComposerContext(input: {
  homeDir: string; stateDir: string; workspaceDir: string; files: string[]; sessionKey: string; sessionId: string; modelRef: string;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
}, archiveDir: string) {
  const generatedAt = Date.now();
  const bootstrapFiles = await Promise.all(input.files.map(async path => ({
    name: basename(path) as 'AGENTS.md' | 'TOOLS.md', path, content: await readFile(path, 'utf8'), missing: false,
  })));
  const injectedFiles = bootstrapFiles.map(file => ({ path: file.path, content: file.content.slice(0, 4096) }));
  const skillsPrompt = '<available_skills>\n<skill><name>context-review</name><description>Inspect recorded context sources.</description></skill>\n</available_skills>';
  const tool = {
    name: 'read_file', label: 'Read file', description: 'Read a UTF-8 file from the active workspace.',
    parameters: Type.Object({ path: Type.String() }),
    execute: async (_id: string, args: { path: string }) => ({ content: [{ type: 'text' as const, text: await readFile(args.path, 'utf8') }], details: {} }),
  };
  const systemPrompt = [
    'Inspect the current workspace and preserve recorded measurements.', skillsPrompt, tool.description,
    '\n# Project Context\n',
    ...injectedFiles.map(file => `## ${basename(file.path)}\n${file.content}`),
    '\n## Silent Replies\n',
  ].join('\n');
  const turnPrompt = 'Check the model selector and inspect the current context sources.';
  const [provider, ...model] = input.modelRef.split('/');
  const report = buildSystemPromptReport({
    source: 'run', generatedAt, sessionKey: input.sessionKey, sessionId: input.sessionId,
    provider, model: model.join('/'), workspaceDir: input.workspaceDir,
    bootstrapMaxChars: 4096, systemPrompt, bootstrapFiles, injectedFiles, skillsPrompt, tools: [tool],
    currentTurn: { promptChars: turnPrompt.length, runtimeContextChars: 0 },
  });
  const sessionsDir = join(input.stateDir, 'agents', 'main', 'sessions');
  await mkdir(sessionsDir, { recursive: true });
  const indexPath = join(sessionsDir, 'sessions.json');
  const transcriptPath = join(sessionsDir, `${input.sessionId}.jsonl`);
  const index = { [input.sessionKey]: { sessionId: input.sessionId, contextTokens: 32768, updatedAt: generatedAt, systemPromptReport: report } };
  const { databasePath } = persistRuntimeContextEntries(input.stateDir, index);
  const total = input.usage.input + input.usage.output + input.usage.cacheRead + input.usage.cacheWrite;
  const transcript = { type: 'message', timestamp: new Date(generatedAt).toISOString(), message: {
    role: 'assistant', content: [{ type: 'text', text: 'Context sources inspected.' }], usage: { ...input.usage, total },
  } };
  // A contradictory legacy row must never replace the runtime database.
  await writeFile(indexPath, JSON.stringify({ [input.sessionKey]: { sessionId: input.sessionId, totalTokens: 900000, contextTokens: 1000000 } }));
  await writeFile(transcriptPath, `${JSON.stringify(transcript)}\n`);
  await mkdir(archiveDir, { recursive: true });
  await writeFile(join(archiveDir, 'system-prompt.txt'), systemPrompt);
  const paths = [...input.files, indexPath, transcriptPath, databasePath];
  const sources = await Promise.all(paths.map(async (path, index) => {
    const bytes = await readFile(path);
    const archivedName = `${index}-${basename(path)}`;
    await writeFile(join(archiveDir, archivedName), bytes);
    return { path, archivedName, sha256: createHash('sha256').update(bytes).digest('hex') };
  }));
  return { driven_by: 'agent', actor: 'playwright-composer-context', usageSource: 'agent-transcript-fixture',
    metadataStore: 'actual-runtime-SQLite-writer',
    persistedEntry: index[input.sessionKey],
    generator: 'openclaw_runtime/src/agents/system-prompt-report.ts',
    usedTokens: input.usage.input + input.usage.cacheRead + input.usage.cacheWrite, sources, report };
}
