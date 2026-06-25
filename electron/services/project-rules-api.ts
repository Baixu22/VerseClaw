import { access, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import type {
  ProjectRulesAgentsFile,
  ProjectRulesIssue,
  ProjectRulesIssueSeverity,
  ProjectRulesRuleFile,
  ProjectRulesSnapshot,
  ProjectRulesSnapshotResult,
} from '@shared/host-api/contract';
import type { WorkspaceProfile } from '@shared/types/workspace';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { getActiveWorkspaceProfile } from './workspaces-api';

const AGENTS_FILE_NAME = 'AGENTS.md';
const RULES_DIR_SEGMENTS = ['.clawx', 'rules'] as const;
const AGENTS_MAX_BYTES = 256 * 1024;
const RULE_FILE_MAX_BYTES = 128 * 1024;

type TextSource = {
  path: string;
  relativePath: string;
  content: string;
};

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isPathInside(child: string, parent: string): boolean {
  const c = resolve(child);
  const p = resolve(parent);
  if (process.platform === 'win32') {
    const cl = c.toLowerCase();
    const pl = p.toLowerCase();
    return cl === pl || cl.startsWith(pl + sep);
  }
  return c === p || c.startsWith(p + sep);
}

function toRelative(root: string, path: string): string {
  const rel = relative(root, path) || '.';
  return rel.split(sep).join('/');
}

function issue(
  id: string,
  severity: ProjectRulesIssueSeverity,
  source: ProjectRulesIssue['source'],
  path?: string,
  params?: ProjectRulesIssue['params'],
  relatedPaths?: string[],
): ProjectRulesIssue {
  return {
    id,
    severity,
    source,
    ...(path ? { path } : {}),
    ...(params ? { params } : {}),
    ...(relatedPaths?.length ? { relatedPaths } : {}),
  };
}

function normalizeComparable(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function extractTitle(content: string): string | null {
  for (const line of content.split(/\r?\n/)) {
    const match = /^#\s+(.+?)\s*$/.exec(line);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return null;
}

function collectRuleLikeLines(content: string): string[] {
  const lines: string[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('<!--')) continue;
    if (line.length < 12) continue;
    lines.push(normalizeComparable(line.replace(/^[-*]\s+/, '')));
  }
  return lines;
}

function hasDirectIpcBan(content: string): boolean {
  const lower = content.toLowerCase();
  return lower.includes('ipcrenderer.invoke')
    && /\b(do not|don't|must not|never|no direct)\b/i.test(content);
}

function hasGatewayFetchBan(content: string): boolean {
  const lower = content.toLowerCase();
  const mentionsGatewayEndpoint = lower.includes('127.0.0.1:18789')
    || lower.includes('localhost:18789')
    || lower.includes('gateway http')
    || lower.includes('gateway endpoint');
  return mentionsGatewayEndpoint
    && /\b(do not|don't|must not|never|no direct)\b/i.test(content);
}

function hasHostApiGuidance(content: string): boolean {
  const lower = content.toLowerCase();
  return lower.includes('host-api')
    || lower.includes('hostapi')
    || lower.includes('api-client');
}

function hasAllowedDirectIpc(content: string): boolean {
  return /\b(allow|allowed|can|may|permit|permitted)\b.{0,60}\b(ipcrenderer\.invoke|direct ipc)\b/i.test(content);
}

function hasBannedDirectIpc(content: string): boolean {
  return /\b(do not|don't|must not|never|ban|banned|forbid|forbidden|prohibit|prohibited)\b.{0,80}\b(ipcrenderer\.invoke|direct ipc)\b/i.test(content)
    || /\b(ipcrenderer\.invoke|direct ipc)\b.{0,80}\b(do not|don't|must not|never|ban|banned|forbid|forbidden|prohibit|prohibited)\b/i.test(content);
}

function hasAllowedDirectGateway(content: string): boolean {
  return /\b(allow|allowed|can|may|permit|permitted)\b.{0,80}\b(127\.0\.0\.1:18789|localhost:18789|gateway fetch|gateway http|direct gateway)\b/i.test(content);
}

function hasBannedDirectGateway(content: string): boolean {
  return /\b(do not|don't|must not|never|ban|banned|forbid|forbidden|prohibit|prohibited)\b.{0,100}\b(127\.0\.0\.1:18789|localhost:18789|gateway fetch|gateway http|direct gateway)\b/i.test(content)
    || /\b(127\.0\.0\.1:18789|localhost:18789|gateway fetch|gateway http|direct gateway)\b.{0,100}\b(do not|don't|must not|never|ban|banned|forbid|forbidden|prohibit|prohibited)\b/i.test(content);
}

async function readAgentsFile(rootPath: string): Promise<{
  agentsFile: ProjectRulesAgentsFile;
  textSource?: TextSource;
  issues: ProjectRulesIssue[];
}> {
  const agentsPath = resolve(rootPath, AGENTS_FILE_NAME);
  const relativePath: 'AGENTS.md' = AGENTS_FILE_NAME;
  const issues: ProjectRulesIssue[] = [];

  if (!isPathInside(agentsPath, rootPath) || !(await pathExists(agentsPath))) {
    const agentsFile: ProjectRulesAgentsFile = {
      path: agentsPath,
      relativePath,
      status: 'missing',
      exists: false,
      size: 0,
    };
    issues.push(issue('agents.missing', 'warning', 'agents', relativePath));
    return { agentsFile, issues };
  }

  try {
    const info = await stat(agentsPath);
    if (!info.isFile()) {
      const agentsFile: ProjectRulesAgentsFile = {
        path: agentsPath,
        relativePath,
        status: 'unreadable',
        exists: true,
        size: info.size,
        modifiedAt: info.mtime.toISOString(),
        error: 'notFile',
      };
      issues.push(issue('agents.unreadable', 'error', 'agents', relativePath, { reason: 'notFile' }));
      return { agentsFile, issues };
    }
    if (info.size === 0) {
      const agentsFile: ProjectRulesAgentsFile = {
        path: agentsPath,
        relativePath,
        status: 'empty',
        exists: true,
        size: 0,
        modifiedAt: info.mtime.toISOString(),
        content: '',
      };
      issues.push(issue('agents.empty', 'warning', 'agents', relativePath));
      return { agentsFile, textSource: { path: agentsPath, relativePath, content: '' }, issues };
    }
    if (info.size > AGENTS_MAX_BYTES) {
      const agentsFile: ProjectRulesAgentsFile = {
        path: agentsPath,
        relativePath,
        status: 'tooLarge',
        exists: true,
        size: info.size,
        modifiedAt: info.mtime.toISOString(),
        truncated: true,
      };
      issues.push(issue('agents.tooLarge', 'warning', 'agents', relativePath, { maxBytes: AGENTS_MAX_BYTES, size: info.size }));
      return { agentsFile, issues };
    }

    const content = await readFile(agentsPath, 'utf8');
    const trimmed = content.trim();
    const agentsFile: ProjectRulesAgentsFile = {
      path: agentsPath,
      relativePath,
      status: trimmed ? 'present' : 'empty',
      exists: true,
      size: info.size,
      modifiedAt: info.mtime.toISOString(),
      content,
    };
    if (!trimmed) {
      issues.push(issue('agents.empty', 'warning', 'agents', relativePath));
    }
    return { agentsFile, textSource: { path: agentsPath, relativePath, content }, issues };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const agentsFile: ProjectRulesAgentsFile = {
      path: agentsPath,
      relativePath,
      status: 'unreadable',
      exists: true,
      size: 0,
      error: message,
    };
    issues.push(issue('agents.unreadable', 'error', 'agents', relativePath, { reason: message }));
    return { agentsFile, issues };
  }
}

async function listRuleFiles(rootPath: string): Promise<{
  ruleFiles: ProjectRulesRuleFile[];
  textSources: TextSource[];
  issues: ProjectRulesIssue[];
}> {
  const rulesDir = resolve(rootPath, ...RULES_DIR_SEGMENTS);
  if (!isPathInside(rulesDir, rootPath) || !(await pathExists(rulesDir))) {
    return { ruleFiles: [], textSources: [], issues: [] };
  }

  const ruleFiles: ProjectRulesRuleFile[] = [];
  const textSources: TextSource[] = [];
  const issues: ProjectRulesIssue[] = [];
  const entries = await readdir(rulesDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
    const filePath = resolve(rulesDir, entry.name);
    if (!isPathInside(filePath, rulesDir)) continue;
    const relativePath = toRelative(rootPath, filePath);
    try {
      const info = await stat(filePath);
      const base = {
        name: entry.name,
        path: filePath,
        relativePath,
        size: info.size,
        modifiedAt: info.mtime.toISOString(),
      };
      if (info.size === 0) {
        ruleFiles.push({ ...base, status: 'empty' });
        issues.push(issue('ruleFile.empty', 'warning', 'ruleFile', relativePath));
        textSources.push({ path: filePath, relativePath, content: '' });
      } else if (info.size > RULE_FILE_MAX_BYTES) {
        ruleFiles.push({ ...base, status: 'tooLarge' });
        issues.push(issue('ruleFile.tooLarge', 'warning', 'ruleFile', relativePath, { maxBytes: RULE_FILE_MAX_BYTES, size: info.size }));
      } else {
        const content = await readFile(filePath, 'utf8');
        ruleFiles.push({ ...base, status: content.trim() ? 'present' : 'empty' });
        textSources.push({ path: filePath, relativePath, content });
        if (!content.trim()) {
          issues.push(issue('ruleFile.empty', 'warning', 'ruleFile', relativePath));
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ruleFiles.push({
        name: entry.name,
        path: filePath,
        relativePath,
        status: 'unreadable',
        size: 0,
        error: message,
      });
      issues.push(issue('ruleFile.unreadable', 'error', 'ruleFile', relativePath, { reason: message }));
    }
  }

  ruleFiles.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  textSources.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return { ruleFiles, textSources, issues };
}

function lintTextSources(sources: TextSource[]): ProjectRulesIssue[] {
  const issues: ProjectRulesIssue[] = [];
  const allContent = sources.map((source) => source.content).join('\n\n');

  const titles = new Map<string, string[]>();
  const lines = new Map<string, string[]>();
  for (const source of sources) {
    const title = extractTitle(source.content);
    if (title) {
      const normalized = normalizeComparable(title);
      titles.set(normalized, [...(titles.get(normalized) ?? []), source.relativePath]);
    }
    for (const line of collectRuleLikeLines(source.content)) {
      lines.set(line, [...(lines.get(line) ?? []), source.relativePath]);
    }
  }

  for (const [title, paths] of titles) {
    const uniquePaths = [...new Set(paths)];
    if (uniquePaths.length > 1) {
      issues.push(issue('rules.duplicateTitle', 'warning', 'ruleFile', uniquePaths[0], { title }, uniquePaths));
    }
  }

  for (const [line, paths] of lines) {
    const uniquePaths = [...new Set(paths)];
    if (uniquePaths.length > 1) {
      issues.push(issue('rules.duplicateLine', 'warning', 'ruleFile', uniquePaths[0], { line }, uniquePaths));
    }
  }

  if (sources.length > 0) {
    if (!hasHostApiGuidance(allContent)) {
      issues.push(issue('renderer.hostApiGuidanceMissing', 'info', 'agents', AGENTS_FILE_NAME));
    }
    if (!hasDirectIpcBan(allContent)) {
      issues.push(issue('renderer.ipcBanMissing', 'warning', 'agents', AGENTS_FILE_NAME));
    }
    if (!hasGatewayFetchBan(allContent)) {
      issues.push(issue('renderer.gatewayFetchBanMissing', 'warning', 'agents', AGENTS_FILE_NAME));
    }
    if (hasAllowedDirectIpc(allContent) && hasBannedDirectIpc(allContent)) {
      issues.push(issue('renderer.ipcConflict', 'warning', 'agents', AGENTS_FILE_NAME));
    }
    if (hasAllowedDirectGateway(allContent) && hasBannedDirectGateway(allContent)) {
      issues.push(issue('renderer.gatewayFetchConflict', 'warning', 'agents', AGENTS_FILE_NAME));
    }
  }

  return issues;
}

function buildTemplate(workspace: WorkspaceProfile): string {
  return [
    `# AGENTS.md instructions for ${workspace.name || 'this workspace'}`,
    '',
    '## Project Rules Entry',
    '',
    '- Start here for project-specific agent instructions.',
    '- Keep durable AI coding policy in `harness/specs/**` when this workspace uses the Verse Claw harness.',
    '- Use `.clawx/rules/*.md` only for local supplemental rule notes; do not treat it as a separate source of truth.',
    '- Context Pack docs are recipes or explanations only; runtime Context Packs are bounded injections, not durable truth.',
    '',
    '## Renderer / Main Boundary',
    '',
    '- Renderer code must call backend functionality through `src/lib/host-api.ts` or `src/lib/api-client.ts`.',
    '- Do not call `window.electron.ipcRenderer.invoke(...)` directly from renderer pages or components.',
    '- Do not fetch `http://127.0.0.1:18789` or `http://localhost:18789` from renderer code; use Main-owned proxy or host-api routes.',
    '',
  ].join('\n');
}

async function buildSnapshot(templateCreated = false): Promise<ProjectRulesSnapshotResult> {
  const workspace = await getActiveWorkspaceProfile();
  if (!workspace) {
    const snapshot: ProjectRulesSnapshot = {
      workspace: null,
      agentsFile: null,
      ruleFiles: [],
      issues: [issue('workspace.missing', 'error', 'contextPreview')],
      contextPreview: {
        items: [
          { id: 'agents', status: 'missing' },
          { id: 'harnessSpecs', status: 'referenceOnly' },
          { id: 'clawxRules', status: 'missing', fileCount: 0 },
        ],
      },
      generatedAt: new Date().toISOString(),
    };
    return { success: true, ...snapshot, templateCreated };
  }

  const rootPath = resolve(workspace.rootPath);
  const agents = await readAgentsFile(rootPath);
  const rules = await listRuleFiles(rootPath);
  const textSources = [
    ...(agents.textSource ? [agents.textSource] : []),
    ...rules.textSources,
  ];
  const issues = [
    ...agents.issues,
    ...rules.issues,
    ...lintTextSources(textSources),
  ];

  const snapshot: ProjectRulesSnapshot = {
    workspace: {
      id: workspace.id,
      name: workspace.name,
      rootPath,
    },
    agentsFile: agents.agentsFile,
    ruleFiles: rules.ruleFiles,
    issues,
    contextPreview: {
      items: [
        { id: 'agents', status: agents.agentsFile.exists ? 'included' : 'missing' },
        { id: 'harnessSpecs', status: 'referenceOnly' },
        {
          id: 'clawxRules',
          status: rules.ruleFiles.length > 0 ? 'available' : 'missing',
          fileCount: rules.ruleFiles.length,
        },
      ],
    },
    generatedAt: new Date().toISOString(),
  };
  return { success: true, ...snapshot, templateCreated };
}

async function createAgentsTemplate(): Promise<ProjectRulesSnapshotResult> {
  const workspace = await getActiveWorkspaceProfile();
  if (!workspace) {
    return buildSnapshot(false);
  }
  const rootPath = resolve(workspace.rootPath);
  const agentsPath = resolve(rootPath, AGENTS_FILE_NAME);
  if (!isPathInside(agentsPath, rootPath)) {
    return buildSnapshot(false);
  }
  try {
    await writeFile(agentsPath, buildTemplate(workspace), { encoding: 'utf8', flag: 'wx' });
    return buildSnapshot(true);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return buildSnapshot(false);
    }
    throw error;
  }
}

export function createProjectRulesApi(): CompleteHostServiceRegistry['projectRules'] {
  return {
    snapshot: async () => buildSnapshot(false),
    createAgentsTemplate,
  };
}
