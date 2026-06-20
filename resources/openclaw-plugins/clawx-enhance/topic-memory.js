/**
 * Topic Memory Plugin Supplement for ClawX Enhance.
 *
 * Registers a memory prompt supplement that injects the active topic's
 * CONTEXT.md into the system prompt, and a corpus supplement so
 * memory_search corpus=all includes topic files.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// ── Resolve active topic ─────────────────────────────────────────────────────

/**
 * Active topic is stored in a marker file at <workspace>/.clawx-active-topic
 */
function getActiveTopic(workspaceDir) {
  try {
    const markerPath = path.join(workspaceDir, '.clawx-active-topic');
    if (!fs.existsSync(markerPath)) return null;
    return fs.readFileSync(markerPath, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

function resolveTopicsDir(workspaceDir) {
  return path.join(workspaceDir, 'topics');
}

// ── Read CONTEXT.md ──────────────────────────────────────────────────────────

function readTopicContextFile(workspaceDir, topicId) {
  if (!topicId) return null;
  try {
    const contextPath = path.join(resolveTopicsDir(workspaceDir), topicId, 'CONTEXT.md');
    if (!fs.existsSync(contextPath)) return null;
    return fs.readFileSync(contextPath, 'utf8');
  } catch {
    return null;
  }
}

// ── Full-text search in topics directory ─────────────────────────────────────

function fullTextSearchInTopicsDir(workspaceDir, query, maxResults = 10) {
  const results = [];
  const topicsDir = resolveTopicsDir(workspaceDir);
  if (!fs.existsSync(topicsDir)) return results;

  const queryLower = query.toLowerCase();
  const entries = fs.readdirSync(topicsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    const topicDir = path.join(topicsDir, entry.name);
    const contextPath = path.join(topicDir, 'CONTEXT.md');
    if (!fs.existsSync(contextPath)) continue;

    try {
      const content = fs.readFileSync(contextPath, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(queryLower)) {
          const start = Math.max(0, i - 1);
          const end = Math.min(lines.length, i + 3);
          results.push({
            corpus: 'topics',
            path: `${entry.name}/CONTEXT.md`,
            title: entry.name,
            score: 0.8,
            snippet: lines.slice(start, end).join('\n'),
            sourcePath: contextPath,
          });
          break; // one match per file
        }
      }

      // Also search memory files
      const memoryDir = path.join(topicDir, 'memory');
      if (fs.existsSync(memoryDir)) {
        const memFiles = fs.readdirSync(memoryDir).filter((f) => f.endsWith('.md'));
        for (const memFile of memFiles) {
          try {
            const memContent = fs.readFileSync(path.join(memoryDir, memFile), 'utf8');
            if (memContent.toLowerCase().includes(queryLower)) {
              results.push({
                corpus: 'topics',
                path: `${entry.name}/memory/${memFile}`,
                title: `${entry.name}: ${memFile.replace('.md', '')}`,
                score: 0.6,
                snippet: memContent.slice(0, 300),
                sourcePath: path.join(memoryDir, memFile),
              });
            }
          } catch { /* skip */ }
        }
      }
    } catch { /* skip */ }

    if (results.length >= maxResults) break;
  }

  return results.slice(0, maxResults);
}

// ── Get corpus supplement lookup ─────────────────────────────────────────────

function getTopicFileLookup(workspaceDir, lookup) {
  try {
    // lookup = "<topicId>/CONTEXT.md" or "<topicId>/memory/<filename>.md"
    const fullPath = path.join(resolveTopicsDir(workspaceDir), lookup);
    if (!fs.existsSync(fullPath)) return null;
    const content = fs.readFileSync(fullPath, 'utf8');
    return {
      corpus: 'topics',
      path: lookup,
      title: lookup.split('/')[0],
      content,
      fromLine: 0,
      lineCount: content.split('\n').length,
      sourcePath: fullPath,
    };
  } catch {
    return null;
  }
}

// ── Plugin exports ───────────────────────────────────────────────────────────

/**
 * Register topic memory as a prompt supplement.
 * Called from the clawx-enhance plugin's register() function.
 */
function registerTopicMemorySupplement(api) {
  // Prompt supplement: inject active topic's CONTEXT.md
  api.registerMemoryPromptSupplement(({ availableTools }) => {
    try {
      // workspace dir from api config
      const agentId = api.agentId || 'main';
      const workspaceDir = resolveWorkspaceDir(api, agentId);
      if (!workspaceDir) return [];

      const activeTopic = getActiveTopic(workspaceDir);
      if (!activeTopic) return [];

      const contextMd = readTopicContextFile(workspaceDir, activeTopic);
      if (!contextMd) return [];

      return [
        `## Active Project Context: ${activeTopic}`,
        contextMd,
        '',
        'When working on this project, use memory_search to find related prior work across all memory files.',
      ];
    } catch {
      return [];
    }
  });

  // Corpus supplement: make topics searchable via memory_search corpus=all
  api.registerMemoryCorpusSupplement({
    search: async (params) => {
      try {
        const agentId = api.agentId || 'main';
        const workspaceDir = resolveWorkspaceDir(api, agentId);
        if (!workspaceDir) return [];
        return fullTextSearchInTopicsDir(workspaceDir, params.query, params.maxResults);
      } catch {
        return [];
      }
    },
    get: async (params) => {
      try {
        const agentId = api.agentId || 'main';
        const workspaceDir = resolveWorkspaceDir(api, agentId);
        if (!workspaceDir) return null;
        return getTopicFileLookup(workspaceDir, params.lookup);
      } catch {
        return null;
      }
    },
  });
}

function resolveWorkspaceDir(api, agentId) {
  try {
    const cfg = api.config;
    if (cfg && cfg.agents && cfg.agents.list) {
      const agentEntry = cfg.agents.list.find((a) => a.id === agentId);
      if (agentEntry && agentEntry.workspace) {
        let wsPath = agentEntry.workspace;
        if (wsPath.startsWith('~')) {
          wsPath = path.join(os.homedir(), wsPath.slice(1));
        }
        return wsPath;
      }
    }
    // Fallback
    if (agentId === 'main') return path.join(os.homedir(), '.openclaw', 'workspace');
    return path.join(os.homedir(), '.openclaw', `workspace-${agentId}`);
  } catch {
    return null;
  }
}

module.exports = { registerTopicMemorySupplement };
