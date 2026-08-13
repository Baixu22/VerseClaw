/**
 * Topics API — Topic/Project memory management within workspaces.
 *
 * Each topic is a subdirectory under <workspace>/topics/ with a CONTEXT.md
 * and an optional memory/ directory for topic-scoped session snapshots.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type {
  TopicCreatePayload,
  TopicContextPayload,
  TopicDeletePayload,
  TopicUpdatePayload,
} from '@shared/host-api/contract';
import { isRecord } from './payload-utils';
import { expandPath } from '../utils/paths';

// ── Types ────────────────────────────────────────────────────────────────────

interface TopicEntry {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
}

interface TopicIndex {
  topics: TopicEntry[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function requireString(payload: unknown, key: string): string {
  if (!isRecord(payload) || typeof payload[key] !== 'string' || !payload[key].trim()) {
    throw new Error(`${key} is required`);
  }
  return payload[key].trim();
}

function safeSlug(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'topic';
}

async function ensureDir(dirPath: string): Promise<void> {
  try {
    await mkdir(dirPath, { recursive: true });
  } catch { /* ignore */ }
}

function resolveTopicsDir(workspacePath: string): string {
  return join(workspacePath, 'topics');
}

function resolveIndexPath(workspacePath: string): string {
  return join(resolveTopicsDir(workspacePath), '_index.json');
}

async function readTopicIndex(workspacePath: string): Promise<TopicIndex> {
  const indexPath = resolveIndexPath(workspacePath);
  try {
    const raw = await readFile(indexPath, 'utf8');
    return JSON.parse(raw) as TopicIndex;
  } catch {
    return { topics: [] };
  }
}

async function writeTopicIndex(workspacePath: string, index: TopicIndex): Promise<void> {
  const indexPath = resolveIndexPath(workspacePath);
  await ensureDir(resolveTopicsDir(workspacePath));
  await writeFile(indexPath, JSON.stringify(index, null, 2), 'utf8');
}

function resolveAgentWorkspace(agentId: string): string {
  const home = expandPath('~/');
  if (agentId === 'main') return expandPath(join(home, '.openclaw', 'workspace'));
  return expandPath(join(home, '.openclaw', `workspace-${agentId}`));
}

type TopicWorkspacePayload = { agentId?: unknown; workspacePath?: unknown };

function resolvePayloadWorkspace(payload: unknown): string {
  const body = isRecord(payload) ? payload as TopicWorkspacePayload : {};
  if (typeof body.workspacePath === 'string' && body.workspacePath.trim()) {
    return expandPath(body.workspacePath.trim());
  }
  const agentId = typeof body.agentId === 'string' ? body.agentId : 'main';
  return resolveAgentWorkspace(agentId);
}

// ── API ──────────────────────────────────────────────────────────────────────

export function createTopicsApi(): CompleteHostServiceRegistry['topics'] {
  return {
    list: async (payload) => {
      const workspacePath = resolvePayloadWorkspace(payload);
      const index = await readTopicIndex(workspacePath);
      return { success: true, topics: index.topics };
    },

    create: async (payload) => {
      const name = requireString(payload, 'name');
      const body = payload as TopicCreatePayload;
      const description = typeof body.description === 'string' ? body.description.trim() : '';
      const workspacePath = resolvePayloadWorkspace(payload);

      const id = safeSlug(name);
      const index = await readTopicIndex(workspacePath);

      // Check duplicate
      if (index.topics.some((t) => t.id === id)) {
        // Generate unique ID
        let suffix = 2;
        let uniqueId = `${id}-${suffix}`;
        while (index.topics.some((t) => t.id === uniqueId)) {
          suffix++;
          uniqueId = `${id}-${suffix}`;
        }
        const topicDir = join(resolveTopicsDir(workspacePath), uniqueId);
        await ensureDir(topicDir);
        await ensureDir(join(topicDir, 'memory'));

        const defaultContext = `# ${name}\n\n${description || 'No description yet.'}\n\n## Tech Stack\n\n## Key Decisions\n\n## Conventions\n`;
        await writeFile(join(topicDir, 'CONTEXT.md'), defaultContext, 'utf8');

        const entry: TopicEntry = {
          id: uniqueId,
          name,
          description,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        index.topics.push(entry);
        await writeTopicIndex(workspacePath, index);
        return { success: true, topic: entry };
      }

      const topicDir = join(resolveTopicsDir(workspacePath), id);
      await ensureDir(topicDir);
      await ensureDir(join(topicDir, 'memory'));

      const defaultContext = `# ${name}\n\n${description || 'No description yet.'}\n\n## Tech Stack\n\n## Key Decisions\n\n## Conventions\n`;
      await writeFile(join(topicDir, 'CONTEXT.md'), defaultContext, 'utf8');

      const entry: TopicEntry = {
        id,
        name,
        description,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      index.topics.push(entry);
      await writeTopicIndex(workspacePath, index);
      return { success: true, topic: entry };
    },

    update: async (payload) => {
      const id = requireString(payload, 'id');
      const body = payload as TopicUpdatePayload;
      const workspacePath = resolvePayloadWorkspace(payload);
      const index = await readTopicIndex(workspacePath);

      const entry = index.topics.find((t) => t.id === id);
      if (!entry) throw new Error(`Topic "${id}" not found`);

      if (typeof body.name === 'string') entry.name = body.name.trim();
      if (typeof body.description === 'string') entry.description = body.description.trim();
      entry.updatedAt = Date.now();

      // Update CONTEXT.md if provided
      if (typeof body.contextMd === 'string') {
        const topicDir = join(resolveTopicsDir(workspacePath), id);
        await writeFile(join(topicDir, 'CONTEXT.md'), body.contextMd, 'utf8');
      }

      await writeTopicIndex(workspacePath, index);
      return { success: true, topic: entry };
    },

    delete: async (payload) => {
      const body = payload as TopicDeletePayload;
      const id = requireString(payload, 'id');
      const workspacePath = resolvePayloadWorkspace(body);
      const index = await readTopicIndex(workspacePath);

      const idx = index.topics.findIndex((t) => t.id === id);
      if (idx === -1) throw new Error(`Topic "${id}" not found`);

      // R0-2: remove the topic directory FIRST. If it cannot be removed, keep
      // the index entry so the topic stays visible/retryable — a half-deleted
      // topic must not be reported as success.
      const topicDir = join(resolveTopicsDir(workspacePath), id);
      try {
        await rm(topicDir, { recursive: true, force: true });
      } catch (error) {
        return { success: false, error: `Could not remove topic directory "${id}": ${String(error)}` };
      }

      index.topics.splice(idx, 1);
      await writeTopicIndex(workspacePath, index);
      return { success: true };
    },

    getContext: async (payload) => {
      const body = payload as TopicContextPayload;
      const id = requireString(payload, 'id');
      const workspacePath = resolvePayloadWorkspace(body);
      const contextPath = join(resolveTopicsDir(workspacePath), id, 'CONTEXT.md');

      try {
        const content = await readFile(contextPath, 'utf8');
        return { success: true, content, path: contextPath };
      } catch {
        return { success: false, error: `CONTEXT.md not found for topic "${id}"` };
      }
    },
  };
}
