import { access, mkdir, readFile, realpath, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile, spawn, type ChildProcess, type ChildProcessByStdio } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer, connect } from 'node:net';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { promisify } from 'node:util';
import type {
  OfficecliInstallPayload,
  OfficecliRenderHtmlPayload,
  OfficecliSkillAgentPayload,
  OfficecliSkillApplyLinksPayload,
  OfficecliSkillContentPayload,
  OfficecliSkillInstallStatus,
  OfficecliSkillLinkOp,
  OfficecliSkillLinkOpResult,
  OfficecliWatchPayload,
} from '@shared/host-api/contract';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { getOpenClawSkillsDir } from '../utils/paths';
import {
  listAgentsSnapshot,
  readAgentBootstrapTools,
  writeAgentBootstrapTools,
  type AgentBootstrapToolsConfig,
  type AgentSummary,
  type AgentsSnapshot,
} from '../utils/agent-config';
import {
  getAllSkillConfigs,
  removeSkillConfigs,
  updateSkillConfigs,
  type SkillConfigUpdates,
} from '../utils/skill-config';
import { isRecord } from './payload-utils';

const execFileAsync = promisify(execFile);
const OFFICE_WATCH_READY_TIMEOUT_MS = 8_000;
const OFFICE_WATCH_CONNECT_TIMEOUT_MS = 500;
const MAX_OFFICE_WATCHES = 32;
const OFFICECLI_INSTALL_TIMEOUT_MS = 600_000;
const OFFICECLI_INSTALL_PS1_MIRROR_URL = 'https://d.officecli.ai/install.ps1';
const OFFICECLI_INSTALL_PS1_GITHUB_URL = 'https://raw.githubusercontent.com/iOfficeAI/OfficeCLI/main/install.ps1';
const OFFICECLI_INSTALL_SH_MIRROR_URL = 'https://d.officecli.ai/install.sh';
const OFFICECLI_INSTALL_SH_GITHUB_URL = 'https://raw.githubusercontent.com/iOfficeAI/OfficeCLI/main/install.sh';

export type OfficecliInfo = {
  installed: boolean;
  version: string | null;
  path: string | null;
  runtimeError: string | null;
};

export type OfficecliSkill = {
  id: string;
  category: string;
  icon: string;
  sortOrder: number;
  displayName: Record<string, string>;
  description: Record<string, string>;
  installedCentrally: boolean;
};

export type OfficecliSkillSyncReport = {
  synced: number;
  errors: string[];
};

export type OfficecliInstallEventKind = 'started' | 'log' | 'completed' | 'failed';
export type OfficecliInstallEvent = {
  taskId: string;
  kind: OfficecliInstallEventKind;
  payload: string;
};

export type OfficeWatchStarted = {
  port: number;
  cap: string;
};

export type RunCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type OfficeCliInstallPlatform = 'windows' | 'unix';

export type OfficeCliInstallCommand = {
  command: string;
  args: string[];
};

export type OfficeCliSkillDefinition = {
  id: string;
  loadId: string;
  category: string;
  icon: string;
  sortOrder: number;
  name: string;
  description: string;
  displayName: Record<string, string>;
  localizedDescription: Record<string, string>;
};

export type SkillConfigUpdate = { skillKey: string; enabled?: boolean; remove?: boolean };

export type OfficeToolsApiOptions = {
  skillsRoot?: string;
  readConfigs?: () => Promise<Record<string, SkillConfigUpdates>>;
  updateConfigs?: (updates: SkillConfigUpdate[]) => Promise<{ success: boolean; error?: string }>;
  listAgents?: () => Promise<Pick<AgentsSnapshot, 'agents'>>;
  readAgentBootstrapTools?: (agentId: string) => Promise<AgentBootstrapToolsConfig>;
  writeAgentBootstrapTools?: (
    agentId: string,
    patch: Partial<AgentBootstrapToolsConfig>,
  ) => Promise<AgentBootstrapToolsConfig>;
  resolveOfficeCli?: () => Promise<string | null>;
  primaryInstallPath?: () => string | null;
  runCommand?: (command: string, args: string[], options?: { timeoutMs?: number }) => Promise<RunCommandResult>;
  installOfficeCli?: (ctx: {
    taskId: string;
    emit?: (event: { kind: 'log'; payload: string }) => void;
  }) => Promise<{ success: boolean; error?: string }>;
  emitInstallEvent?: (event: OfficecliInstallEvent) => void;
};

export const OFFICECLI_SKILL_DEFS: OfficeCliSkillDefinition[] = [
  {
    id: 'officecli-pptx',
    loadId: 'pptx',
    category: 'presentations',
    icon: 'Presentation',
    sortOrder: 10,
    name: 'Presentation',
    description: 'Create, analyze, and edit PowerPoint presentations.',
    displayName: { en: 'Presentation', zh: '演示文稿', 'zh-CN': '演示文稿' },
    localizedDescription: {
      en: 'Generic presentations - board reviews, sales decks, all-hands',
      zh: '通用演示文稿 - 评审、销售汇报、全员大会',
      'zh-CN': '通用演示文稿 - 评审、销售汇报、全员大会',
    },
  },
  {
    id: 'officecli-pitch-deck',
    loadId: 'pitch-deck',
    category: 'presentations',
    icon: 'Rocket',
    sortOrder: 20,
    name: 'Pitch Deck',
    description: 'Create investor and sales pitch decks.',
    displayName: { en: 'Pitch Deck', zh: '融资路演', 'zh-CN': '融资路演' },
    localizedDescription: {
      en: 'Fundraising pitch decks - Seed, Series A-C, SAFE, convertible',
      zh: '融资路演 PPT - 种子轮、A-C 轮、SAFE、可转债',
      'zh-CN': '融资路演 PPT - 种子轮、A-C 轮、SAFE、可转债',
    },
  },
  {
    id: 'morph-ppt',
    loadId: 'morph-ppt',
    category: 'presentations',
    icon: 'Clapperboard',
    sortOrder: 30,
    name: 'Morph PPT',
    description: 'Create cinematic Morph-animated presentations.',
    displayName: { en: 'Morph Animation PPT', zh: 'Morph 动画 PPT', 'zh-CN': 'Morph 动画 PPT' },
    localizedDescription: {
      en: 'Cinematic Morph-animated presentations',
      zh: '电影级 Morph 过渡动画演示文稿',
      'zh-CN': '电影级 Morph 过渡动画演示文稿',
    },
  },
  {
    id: 'morph-ppt-3d',
    loadId: 'morph-ppt-3d',
    category: 'presentations',
    icon: 'Box',
    sortOrder: 40,
    name: '3D Morph PPT',
    description: 'Create 3D Morph presentations with camera moves.',
    displayName: { en: '3D Morph PPT', zh: '3D Morph PPT', 'zh-CN': '3D Morph PPT' },
    localizedDescription: {
      en: '3D Morph with GLB models and camera moves',
      zh: '3D Morph + GLB 模型 + 镜头运动',
      'zh-CN': '3D Morph + GLB 模型 + 镜头运动',
    },
  },
  {
    id: 'officecli-docx',
    loadId: 'word',
    category: 'documents',
    icon: 'FileText',
    sortOrder: 50,
    name: 'Word',
    description: 'Create, analyze, and edit Word documents.',
    displayName: { en: 'Word Document', zh: 'Word 文档', 'zh-CN': 'Word 文档' },
    localizedDescription: {
      en: 'Reports, letters, memos, proposals',
      zh: '报告、信件、备忘录、提案',
      'zh-CN': '报告、信件、备忘录、提案',
    },
  },
  {
    id: 'officecli-academic-paper',
    loadId: 'academic-paper',
    category: 'documents',
    icon: 'GraduationCap',
    sortOrder: 60,
    name: 'Academic Paper',
    description: 'Create academic papers with citations and cross references.',
    displayName: { en: 'Academic Paper', zh: '学术论文', 'zh-CN': '学术论文' },
    localizedDescription: {
      en: 'Journal/thesis with citations, equations, cross-refs',
      zh: '期刊论文 - 引用、公式、交叉引用',
      'zh-CN': '期刊论文 - 引用、公式、交叉引用',
    },
  },
  {
    id: 'officecli-xlsx',
    loadId: 'excel',
    category: 'spreadsheets',
    icon: 'FileSpreadsheet',
    sortOrder: 70,
    name: 'Excel',
    description: 'Create, analyze, and edit Excel workbooks.',
    displayName: { en: 'Excel Workbook', zh: 'Excel 工作簿', 'zh-CN': 'Excel 工作簿' },
    localizedDescription: {
      en: 'Generic workbooks, formulas, pivots, trackers',
      zh: '通用工作簿 - 公式、数据透视表、跟踪表',
      'zh-CN': '通用工作簿 - 公式、数据透视表、跟踪表',
    },
  },
  {
    id: 'officecli-financial-model',
    loadId: 'financial-model',
    category: 'spreadsheets',
    icon: 'TrendingUp',
    sortOrder: 80,
    name: 'Financial Model',
    description: 'Create financial models and projections.',
    displayName: { en: 'Financial Model', zh: '财务模型', 'zh-CN': '财务模型' },
    localizedDescription: {
      en: '3-statement, DCF, LBO, scenarios, projections',
      zh: '三大报表、DCF、LBO、情景分析、预测',
      'zh-CN': '三大报表、DCF、LBO、情景分析、预测',
    },
  },
  {
    id: 'officecli-data-dashboard',
    loadId: 'data-dashboard',
    category: 'spreadsheets',
    icon: 'BarChart3',
    sortOrder: 90,
    name: 'Data Dashboard',
    description: 'Create KPI and analytics Excel dashboards.',
    displayName: { en: 'Data Dashboard', zh: '数据仪表盘', 'zh-CN': '数据仪表盘' },
    localizedDescription: {
      en: 'CSV/tabular data to KPI/analytics Excel dashboards',
      zh: 'CSV/表格数据到 KPI/分析 Excel 仪表盘',
      'zh-CN': 'CSV/表格数据到 KPI/分析 Excel 仪表盘',
    },
  },
];

type OfficeWatchChild = ChildProcessByStdio<null, Readable, Readable>;

type WatchEntry = {
  child: OfficeWatchChild;
  port: number;
  cap: string;
  refCount: number;
  filePath: string;
};

const officeWatches = new Map<string, WatchEntry>();
const watchStartLocks = new Map<string, Promise<void>>();
let officeMutationTail: Promise<void> = Promise.resolve();

function markerPath(skillsRoot: string, skillId: string): string {
  return join(skillsRoot, skillId, '.clawx-pack.json');
}

function skillDir(skillsRoot: string, skillId: string): string {
  return join(skillsRoot, skillId);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isInsideRoot(rootPath: string, candidatePath: string): boolean {
  const rel = relative(resolve(rootPath), resolve(candidatePath));
  return rel === '' || (!rel.startsWith('..') && rel !== '..');
}

function assertInsideRoot(rootPath: string, candidatePath: string): string {
  const resolved = resolve(candidatePath);
  if (!isInsideRoot(rootPath, resolved)) {
    throw new Error(`path is outside the workspace root: ${candidatePath}`);
  }
  return resolved;
}

export function isOfficeCliDocumentPath(path: string): boolean {
  return new Set(['.docx', '.xlsx', '.pptx']).has(extname(path).toLowerCase());
}

function fallbackSkillMarkdown(skill: Pick<OfficeCliSkillDefinition, 'id' | 'name' | 'description'>): string {
  return `---\nname: ${skill.id}\ndescription: ${skill.description}\n---\n\n# ${skill.name}\n\n${skill.description}\n`;
}

export function normalizeOfficeSkillMarkdownName(content: string, skill: Pick<OfficeCliSkillDefinition, 'id' | 'name' | 'description'>): string {
  const body = content.trim();
  if (!body) return fallbackSkillMarkdown(skill);

  const frontmatterMatch = /^---\r?\n([\s\S]*?)\r?\n---/.exec(body);
  if (!frontmatterMatch) {
    return `${fallbackSkillMarkdown(skill)}\n${body}`;
  }

  const frontmatter = frontmatterMatch[1] ?? '';
  const nextFrontmatter = /^\s*name\s*:/m.test(frontmatter)
    ? frontmatter.replace(/^\s*name\s*:\s*.*$/m, `name: ${skill.id}`)
    : `name: ${skill.id}\n${frontmatter}`;
  return `---\n${nextFrontmatter}\n---${body.slice(frontmatterMatch[0].length)}`;
}

async function writeMarker(skillsRoot: string, skillId: string): Promise<void> {
  await writeFile(
    markerPath(skillsRoot, skillId),
    JSON.stringify({ packId: 'officecli', skillId, managedBy: 'clawx', updatedAt: new Date().toISOString() }, null, 2),
    'utf-8',
  );
}

export async function readOfficeSkillMarkerPack(skillsRoot: string, skillId: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(await readFile(markerPath(skillsRoot, skillId), 'utf-8')) as { packId?: unknown };
    return typeof parsed.packId === 'string' ? parsed.packId : null;
  } catch {
    return null;
  }
}

export async function writeOfficeSkill(skillsRoot: string, def: OfficeCliSkillDefinition, content: string): Promise<void> {
  const target = skillDir(skillsRoot, def.id);
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  await writeFile(join(target, 'SKILL.md'), normalizeOfficeSkillMarkdownName(content, def), 'utf-8');
  await writeMarker(skillsRoot, def.id);
}

export function officeCliRuntimeDependencyHint(stderr: string): string | null {
  const lower = stderr.toLowerCase();
  const missingIcu = lower.includes('valid icu package')
    || lower.includes('libicu')
    || (lower.includes('icu') && lower.includes('globalization'));
  if (missingIcu) {
    return 'officecli could not start: the server is missing the ICU library its embedded .NET runtime needs. Install it in the runtime image and restart (Debian/Ubuntu: `apt-get install -y libicu72`; Alpine: `apk add icu-libs`), or use an app/runtime image that already includes it.';
  }
  if (lower.includes('error while loading shared libraries')) {
    return 'officecli could not start: a required system library is missing on the server. Install the library named in the error below and restart.';
  }
  return null;
}

function boundedTail(value: string, maxChars: number): string {
  const trimmed = value.trim();
  return trimmed.length <= maxChars ? trimmed : trimmed.slice(trimmed.length - maxChars);
}

export function officeCliRunFailureMessage(stderr: string): string {
  const trimmed = stderr.trim();
  const hint = officeCliRuntimeDependencyHint(trimmed);
  if (hint && trimmed) return `${hint}\n\nofficecli error: ${boundedTail(trimmed, 600)}`;
  if (hint) return hint;
  if (!trimmed) return 'officecli exited with an error and produced no output';
  return `officecli error: ${boundedTail(trimmed, 600)}`;
}

async function defaultRunCommand(command: string, args: string[], options?: { timeoutMs?: number }): Promise<RunCommandResult> {
  try {
    const result = await execFileAsync(command, args, {
      timeout: options?.timeoutMs ?? 60_000,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const err = error as Error & { code?: unknown; stdout?: unknown; stderr?: unknown };
    return {
      exitCode: typeof err.code === 'number' ? err.code : 1,
      stdout: typeof err.stdout === 'string' ? err.stdout : '',
      stderr: typeof err.stderr === 'string' ? err.stderr : err.message,
    };
  }
}

export function officeCliInstallCommand(
  platform: OfficeCliInstallPlatform = process.platform === 'win32' ? 'windows' : 'unix',
): OfficeCliInstallCommand {
  if (platform === 'windows') {
    return {
      command: 'powershell.exe',
      args: [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        [
          "$ErrorActionPreference='Stop'",
          'try { $sp=[Net.ServicePointManager]::SecurityProtocol; if([int]$sp -ne 0){ [Net.ServicePointManager]::SecurityProtocol=$sp -bor [Net.SecurityProtocolType]::Tls12 } } catch {}',
          "$ProgressPreference='SilentlyContinue'",
          'try { [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false) } catch {}',
          `try { $s = irm -TimeoutSec 60 ${OFFICECLI_INSTALL_PS1_MIRROR_URL} } catch { $s = irm -TimeoutSec 60 ${OFFICECLI_INSTALL_PS1_GITHUB_URL} }`,
          'iex $s',
        ].join('; '),
      ],
    };
  }

  return {
    command: 'bash',
    args: [
      '-lc',
      `f=$(mktemp) || exit 1; (curl -fsSL --connect-timeout 20 --max-time 60 ${OFFICECLI_INSTALL_SH_MIRROR_URL} -o "$f" || curl -fsSL --connect-timeout 20 --max-time 60 ${OFFICECLI_INSTALL_SH_GITHUB_URL} -o "$f") && bash "$f"; s=$?; rm -f "$f"; exit $s`,
    ],
  };
}

function officeCliKnownInstallPaths(): string[] {
  const paths: string[] = [];
  if (process.platform === 'win32') {
    if (process.env.LOCALAPPDATA) {
      paths.push(join(process.env.LOCALAPPDATA, 'OfficeCLI', 'officecli.exe'));
    }
  } else if (process.env.HOME) {
    paths.push(join(process.env.HOME, '.local', 'bin', 'officecli'));
  }
  return paths;
}

function officeCliPrimaryInstallPath(): string | null {
  return officeCliKnownInstallPaths()[0] ?? null;
}

async function resolveCommandOnPath(command: string): Promise<string | null> {
  const pathEnv = process.env.PATH || process.env.Path || '';
  const dirs = pathEnv.split(process.platform === 'win32' ? ';' : ':').filter(Boolean);
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')
    : [''];
  for (const dir of dirs) {
    const candidates = process.platform === 'win32'
      ? extensions.map((ext) => join(dir, `${command}${ext.toLowerCase()}`))
      : [join(dir, command)];
    for (const candidate of candidates) {
      if (await pathExists(candidate)) return candidate;
    }
  }
  return null;
}

async function defaultResolveOfficeCli(): Promise<string | null> {
  const onPath = await resolveCommandOnPath('officecli');
  if (onPath) return onPath;
  for (const candidate of officeCliKnownInstallPaths()) {
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

export async function killOfficeCliInstallProcessTree(
  child: Pick<ChildProcess, 'pid' | 'kill'>,
  options: {
    platform?: NodeJS.Platform;
    execFileAsync?: typeof execFileAsync;
    processKill?: typeof process.kill;
  } = {},
): Promise<void> {
  const pid = child.pid;
  const platform = options.platform ?? process.platform;
  const runExecFile = options.execFileAsync ?? execFileAsync;
  const killProcess = options.processKill ?? process.kill;

  if (typeof pid === 'number' && pid > 0) {
    if (platform === 'win32') {
      await runExecFile('taskkill', ['/pid', String(pid), '/t', '/f'], {
        windowsHide: true,
        timeout: 10_000,
        maxBuffer: 256 * 1024,
      }).catch(() => undefined);
    } else {
      try {
        killProcess(-pid, 'SIGKILL');
      } catch {
        try {
          killProcess(pid, 'SIGKILL');
        } catch {
          // best-effort
        }
      }
    }
  }

  try {
    child.kill();
  } catch {
    // best-effort
  }
}

export async function runOfficeCliInstallChildProcess(
  child: Pick<ChildProcess, 'pid' | 'kill' | 'on'> & {
    stdout?: Readable | null;
    stderr?: Readable | null;
  },
  ctx: {
    taskId: string;
    emit?: (event: { kind: 'log'; payload: string }) => void;
  },
  options: {
    timeoutMs?: number;
    killProcessTree?: (child: Pick<ChildProcess, 'pid' | 'kill'>) => Promise<void> | void;
  } = {},
): Promise<{ success: boolean; error?: string }> {
  const timeoutMs = options.timeoutMs ?? OFFICECLI_INSTALL_TIMEOUT_MS;
  const killProcessTree = options.killProcessTree ?? killOfficeCliInstallProcessTree;

  return new Promise((resolvePromise) => {
    let output = '';
    let settled = false;
    let timedOut = false;
    const finish = (result: { success: boolean; error?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      void Promise.resolve(killProcessTree(child)).finally(() => {
        finish({ success: false, error: 'Office CLI installer timed out' });
      });
    }, timeoutMs);
    const collect = (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      for (const line of text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
        ctx.emit?.({ kind: 'log', payload: line });
      }
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    child.on('error', (error: Error) => finish({ success: false, error: error.message }));
    child.on('exit', (code: number | null) => {
      if (timedOut) return;
      finish(code === 0
        ? { success: true }
        : { success: false, error: output.trim() || `Office CLI installer exited with code ${code}` });
    });
  });
}

async function defaultInstallOfficeCli(ctx: {
  emit?: (event: { kind: 'log'; payload: string }) => void;
}): Promise<{ success: boolean; error?: string }> {
  const { command, args } = officeCliInstallCommand();
  const child = spawn(command, args, {
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return runOfficeCliInstallChildProcess(child, { taskId: '', emit: ctx.emit });
}

async function defaultUpdateConfigs(updates: SkillConfigUpdate[]): Promise<{ success: boolean; error?: string }> {
  const removals = updates.filter((update) => update.remove).map((update) => update.skillKey);
  const changes = updates.filter((update) => !update.remove).map(({ skillKey, enabled }) => ({ skillKey, enabled }));
  const changeResult = changes.length > 0 ? await updateSkillConfigs(changes) : { success: true };
  if (!changeResult.success) return changeResult;
  const removeResult: { success: boolean; error?: string } = removals.length > 0
    ? await removeSkillConfigs(removals)
    : { success: true };
  return removeResult.success ? { success: true } : { success: false, error: removeResult.error };
}

function normalizeSkillId(payload: unknown): string {
  const body = isRecord(payload) ? payload : {};
  const skillId = body.skillId ?? body.expertId;
  if (typeof skillId === 'string' && skillId.trim() && basename(skillId) === skillId.trim()) return skillId.trim();
  throw new Error('skillId is required');
}

function normalizeAgentId(payload: unknown): string {
  const body = isRecord(payload) ? payload : {};
  const agentId = body.agentId ?? body.agentType;
  if (typeof agentId === 'string' && agentId.trim()) return agentId.trim();
  throw new Error('agentId is required');
}

function normalizeSkillAgentPayload(payload: unknown): { skillId: string; agentId: string } {
  return {
    skillId: normalizeSkillId(payload),
    agentId: normalizeAgentId(payload),
  };
}

function normalizeLinkOp(value: unknown): OfficecliSkillLinkOp {
  const body = isRecord(value) ? value : {};
  return {
    expertId: normalizeSkillId(body),
    skillId: normalizeSkillId(body),
    agentId: normalizeAgentId(body),
    agentType: normalizeAgentId(body),
    enable: body.enable === true,
  };
}

function normalizeApplyLinksPayload(payload: unknown): OfficecliSkillLinkOp[] {
  const rawOps = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.ops)
      ? payload.ops
      : null;
  if (!rawOps) throw new Error('ops is required');
  return rawOps.map((op) => normalizeLinkOp(op));
}

function normalizeInstallTaskId(payload: unknown): string {
  const body = isRecord(payload) ? payload : {};
  return typeof body.taskId === 'string' && body.taskId.trim() ? body.taskId.trim() : randomUUID();
}

function normalizeRenderPayload(payload: unknown): { rootPath: string; path: string } {
  const body = isRecord(payload) ? payload : {};
  if (typeof body.rootPath !== 'string' || !body.rootPath.trim()) throw new Error('rootPath is required');
  if (typeof body.path !== 'string' || !body.path.trim()) throw new Error('path is required');
  return { rootPath: body.rootPath, path: body.path };
}

async function resolveOfficeTarget(rootPath: string, relPath: string): Promise<string> {
  const root = resolve(rootPath);
  const lexicalTarget = resolve(root, relPath);
  assertInsideRoot(root, lexicalTarget);
  const target = await realpath(lexicalTarget);
  const canonicalRoot = await realpath(root);
  assertInsideRoot(canonicalRoot, target);
  const targetStat = await stat(target);
  if (!targetStat.isFile()) throw new Error('path is not a file');
  if (!isOfficeCliDocumentPath(target)) {
    throw new Error('not a supported Office file (.docx, .xlsx, .pptx)');
  }
  return target;
}

async function probeOfficeCli(
  binary: string,
  runCommand: OfficeToolsApiOptions['runCommand'],
): Promise<OfficecliInfo> {
  const runner = runCommand ?? defaultRunCommand;
  const result = await runner(binary, ['--version'], { timeoutMs: 30_000 });
  if (result.exitCode === 0) {
    const version = result.stdout.trim() || null;
    return { installed: true, version, path: binary, runtimeError: null };
  }
  return {
    installed: true,
    version: null,
    path: binary,
    runtimeError: officeCliRunFailureMessage(result.stderr || result.stdout),
  };
}

function metadataForSkill(def: OfficeCliSkillDefinition, skillsRoot: string): Promise<OfficecliSkill> {
  return Promise.resolve()
    .then(async () => {
      const installedCentrally = await pathExists(join(skillDir(skillsRoot, def.id), 'SKILL.md'))
        && await readOfficeSkillMarkerPack(skillsRoot, def.id) === 'officecli';
      return {
        id: def.id,
        category: def.category,
        icon: def.icon,
        sortOrder: def.sortOrder,
        displayName: def.displayName,
        description: def.localizedDescription,
        installedCentrally,
      };
    });
}

function findOfficeSkillDef(skillId: string): OfficeCliSkillDefinition {
  const def = OFFICECLI_SKILL_DEFS.find((item) => item.id === skillId);
  if (!def) throw new Error(`Office skill "${skillId}" not found`);
  return def;
}

async function isOfficeSkillInstalled(skillsRoot: string, skillId: string): Promise<boolean> {
  return await pathExists(join(skillDir(skillsRoot, skillId), 'SKILL.md'))
    && await readOfficeSkillMarkerPack(skillsRoot, skillId) === 'officecli';
}

function statusPaths(skillsRoot: string, skillId: string, agentId: string): {
  linkPath: string;
  expectedTargetPath: string;
} {
  return {
    linkPath: `agent:${agentId}:defaultSkillIds`,
    expectedTargetPath: skillDir(skillsRoot, skillId),
  };
}

function parseWatchPort(line: string): number | null {
  const match = /Watch:\s+.*:(\d+)/i.exec(line);
  if (!match) return null;
  const port = Number(match[1]);
  return Number.isInteger(port) && port > 0 ? port : null;
}

async function allocateFreePort(): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolvePromise(port));
    });
  });
}

async function canConnect(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = connect({ host: '127.0.0.1', port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolvePromise(false);
    }, OFFICE_WATCH_CONNECT_TIMEOUT_MS);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolvePromise(true);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      resolvePromise(false);
    });
  });
}

async function awaitOfficeWatchReady(child: OfficeWatchChild, expectedPort: number): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('PORT_TIMEOUT: officecli watch did not become ready in time'));
    }, OFFICE_WATCH_READY_TIMEOUT_MS);

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolvePromise();
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      const port = parseWatchPort(stdout);
      if (port == null) return;
      if (port !== expectedPort) {
        finish(new Error(`PORT_TIMEOUT: officecli bound port ${port}, expected ${expectedPort}`));
        return;
      }
      void canConnect(port).then((ok) => {
        finish(ok ? undefined : new Error('PORT_TIMEOUT: officecli announced ready but the port did not accept'));
      });
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once('error', (error) => finish(new Error(`START_FAILED: ${error.message}`)));
    child.once('exit', (code) => {
      finish(new Error(`START_FAILED: officecli watch exited before readiness (${code ?? 'unknown'}): ${stderr.trim()}`));
    });
  });
}

function normalizeWatchKey(resolved: string): string {
  const normalized = resolved.replace(/\\/g, '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

async function watchKey(path: string): Promise<string> {
  return normalizeWatchKey(await realpath(path));
}

async function looseWatchKey(path: string): Promise<string> {
  try {
    return await watchKey(path);
  } catch {
    return normalizeWatchKey(resolve(path));
  }
}

async function withWatchStartLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = watchStartLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolvePromise) => {
    release = resolvePromise;
  });
  const chained = previous.catch(() => undefined).then(() => current);
  watchStartLocks.set(key, chained);
  await previous.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    if (watchStartLocks.get(key) === chained) {
      watchStartLocks.delete(key);
    }
  }
}

export async function withOfficeCliMutationLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = officeMutationTail;
  let release!: () => void;
  const current = new Promise<void>((resolvePromise) => {
    release = resolvePromise;
  });
  officeMutationTail = previous.catch(() => undefined).then(() => current);
  await previous.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
  }
}

function reuseWatchEntry(key: string): OfficeWatchStarted | null {
  const existing = officeWatches.get(key);
  if (!existing) return null;
  if (existing.child.exitCode !== null || existing.child.killed) {
    officeWatches.delete(key);
    return null;
  }
  existing.refCount += 1;
  return { port: existing.port, cap: existing.cap };
}

function stopWatchEntry(key: string): void {
  const entry = officeWatches.get(key);
  if (!entry) return;
  entry.refCount -= 1;
  if (entry.refCount > 0) return;
  officeWatches.delete(key);
  entry.child.kill();
}

export function stopAllOfficeWatches(): number {
  const entries = Array.from(officeWatches.values());
  officeWatches.clear();
  for (const entry of entries) {
    try {
      entry.child.kill();
    } catch {
      // best-effort
    }
  }
  return entries.length;
}

export function createOfficeToolsApi(options: OfficeToolsApiOptions = {}): CompleteHostServiceRegistry['officeTools'] {
  const skillsRoot = options.skillsRoot ?? getOpenClawSkillsDir();
  const readConfigs = options.readConfigs ?? getAllSkillConfigs;
  const saveConfigs = options.updateConfigs ?? defaultUpdateConfigs;
  const resolveOfficeCli = options.resolveOfficeCli ?? defaultResolveOfficeCli;
  const primaryInstallPath = options.primaryInstallPath ?? officeCliPrimaryInstallPath;
  const runCommand = options.runCommand ?? defaultRunCommand;
  const installOfficeCli = options.installOfficeCli ?? defaultInstallOfficeCli;
  const emitInstallEvent = options.emitInstallEvent;
  const listAgents = options.listAgents ?? listAgentsSnapshot;
  const readAgentTools = options.readAgentBootstrapTools ?? readAgentBootstrapTools;
  const writeAgentTools = options.writeAgentBootstrapTools ?? writeAgentBootstrapTools;

  async function setSkillConfigs(updates: SkillConfigUpdate[]): Promise<void> {
    if (updates.length === 0) return;
    const result = await saveConfigs(updates);
    if (!result.success) throw new Error(result.error || 'Failed to update skill configs');
  }

  async function detect(): Promise<OfficecliInfo> {
    const binary = await resolveOfficeCli();
    if (!binary) return { installed: false, version: null, path: null, runtimeError: null };
    return probeOfficeCli(binary, runCommand);
  }

  async function syncSkills(options?: { resetEnabled?: boolean }): Promise<OfficecliSkillSyncReport> {
    const binary = await resolveOfficeCli();
    if (!binary) throw new Error('officecli is not installed');
    const configsBeforeSync = await readConfigs();
    await mkdir(skillsRoot, { recursive: true });
    const report: OfficecliSkillSyncReport = { synced: 0, errors: [] };
    const syncedIds: string[] = [];

    for (const def of OFFICECLI_SKILL_DEFS) {
      const result = await runCommand(binary, ['load_skill', def.loadId], { timeoutMs: 60_000 });
      if (result.exitCode !== 0) {
        const stderr = (result.stderr || result.stdout).trim();
        const hint = officeCliRuntimeDependencyHint(stderr);
        report.errors.push(hint ? `${def.id}: ${hint}` : `${def.id}: load_skill failed: ${stderr}`);
        continue;
      }
      if (!result.stdout.trim()) {
        report.errors.push(`${def.id}: empty skill content`);
        continue;
      }
      await writeOfficeSkill(skillsRoot, def, result.stdout);
      report.synced += 1;
      syncedIds.push(def.id);
    }

    if (options?.resetEnabled) {
      await setSkillConfigs(OFFICECLI_SKILL_DEFS.map((skill) => ({ skillKey: skill.id, enabled: false })));
    } else {
      await setSkillConfigs(
        syncedIds
          .filter((skillId) => configsBeforeSync[skillId]?.enabled === undefined)
          .map((skillKey) => ({ skillKey, enabled: false })),
      );
    }

    return report;
  }

  async function agentList(): Promise<AgentSummary[]> {
    const snapshot = await listAgents();
    return snapshot.agents;
  }

  async function findAgent(agentId: string): Promise<AgentSummary> {
    const agent = (await agentList()).find((item) => item.id === agentId);
    if (!agent) throw new Error(`Agent "${agentId}" not found`);
    return agent;
  }

  async function statusFor(def: OfficeCliSkillDefinition, agent: AgentSummary): Promise<OfficecliSkillInstallStatus> {
    const tools = await readAgentTools(agent.id);
    const installedCentrally = await isOfficeSkillInstalled(skillsRoot, def.id);
    const linked = tools.defaultSkillIds.includes(def.id);
    const { linkPath, expectedTargetPath } = statusPaths(skillsRoot, def.id, agent.id);
    const state = linked
      ? installedCentrally
        ? 'linked_to_codeg'
        : 'broken'
      : 'not_linked';
    return {
      expertId: def.id,
      skillId: def.id,
      agentId: agent.id,
      agentType: agent.id,
      agentName: agent.name,
      state,
      linkPath,
      targetPath: linked ? expectedTargetPath : null,
      expectedTargetPath,
      copyMode: false,
      installedCentrally,
    };
  }

  async function listSkillInstallStatuses(skillId: string): Promise<OfficecliSkillInstallStatus[]> {
    const def = findOfficeSkillDef(skillId);
    const agents = await agentList();
    return Promise.all(agents.map((agent) => statusFor(def, agent)));
  }

  async function linkSkillToAgent(skillId: string, agentId: string): Promise<OfficecliSkillInstallStatus> {
    const def = findOfficeSkillDef(skillId);
    if (!await isOfficeSkillInstalled(skillsRoot, skillId)) {
      throw new Error(`skill '${skillId}' is not synced - run sync first`);
    }
    const agent = await findAgent(agentId);
    const tools = await readAgentTools(agentId);
    if (!tools.defaultSkillIds.includes(skillId)) {
      await writeAgentTools(agentId, {
        defaultSkillIds: [...tools.defaultSkillIds, skillId],
      });
    }
    return statusFor(def, agent);
  }

  async function unlinkSkillFromAgent(skillId: string, agentId: string): Promise<void> {
    findOfficeSkillDef(skillId);
    await findAgent(agentId);
    const tools = await readAgentTools(agentId);
    const nextSkillIds = tools.defaultSkillIds.filter((id) => id !== skillId);
    if (nextSkillIds.length !== tools.defaultSkillIds.length) {
      await writeAgentTools(agentId, {
        defaultSkillIds: nextSkillIds,
      });
    }
  }

  async function applySkillLinks(payload?: OfficecliSkillApplyLinksPayload): Promise<OfficecliSkillLinkOpResult[]> {
    const ops = normalizeApplyLinksPayload(payload);
    const results: OfficecliSkillLinkOpResult[] = [];
    for (const op of ops) {
      const skillId = op.expertId;
      const agentId = op.agentId;
      try {
        const status = op.enable
          ? await linkSkillToAgent(skillId, agentId)
          : (await unlinkSkillFromAgent(skillId, agentId), null);
        results.push({
          expertId: skillId,
          skillId,
          agentId,
          agentType: agentId,
          ok: true,
          status,
          error: null,
        });
      } catch (error) {
        results.push({
          expertId: skillId,
          skillId,
          agentId,
          agentType: agentId,
          ok: false,
          status: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  }

  return {
    detect,
    install: async (payload?: OfficecliInstallPayload): Promise<OfficecliInfo> => withOfficeCliMutationLock(async () => {
      const taskId = normalizeInstallTaskId(payload);
      const emit = (kind: OfficecliInstallEventKind, payload = '') => {
        emitInstallEvent?.({ taskId, kind, payload });
      };
      emit('started');
      const result = await installOfficeCli({
        taskId,
        emit: (event) => emit(event.kind, event.payload),
      });
      if (!result.success) {
        const error = result.error || 'Office CLI install failed';
        emit('failed', error);
        throw new Error(error);
      }
      const info = await detect();
      const completedPayload = info.version || info.path || 'Office CLI installed';
      emit('completed', completedPayload);
      return info;
    }),
    uninstall: async (): Promise<OfficecliInfo> => withOfficeCliMutationLock(async () => {
      const managedPath = primaryInstallPath();
      if (managedPath && await pathExists(managedPath)) {
        await unlink(managedPath);
      }

      for (const def of OFFICECLI_SKILL_DEFS) {
        const markerPack = await readOfficeSkillMarkerPack(skillsRoot, def.id);
        if (markerPack === 'officecli') {
          await rm(skillDir(skillsRoot, def.id), { recursive: true, force: true });
        }
      }
      await setSkillConfigs(OFFICECLI_SKILL_DEFS.map((skill) => ({ skillKey: skill.id, remove: true })));
      return detect();
    }),
    listSkills: async (): Promise<OfficecliSkill[]> => Promise.all(
      OFFICECLI_SKILL_DEFS.map((def) => metadataForSkill(def, skillsRoot)),
    ),
    syncSkills: (options?: { resetEnabled?: boolean }) => withOfficeCliMutationLock(() => syncSkills(options)),
    linkSkillToAgent: async (payload: OfficecliSkillAgentPayload): Promise<OfficecliSkillInstallStatus> => withOfficeCliMutationLock(async () => {
      const { skillId, agentId } = normalizeSkillAgentPayload(payload);
      return linkSkillToAgent(skillId, agentId);
    }),
    unlinkSkillFromAgent: async (payload: OfficecliSkillAgentPayload): Promise<void> => withOfficeCliMutationLock(async () => {
      const { skillId, agentId } = normalizeSkillAgentPayload(payload);
      await unlinkSkillFromAgent(skillId, agentId);
    }),
    getSkillInstallStatus: async (payload: OfficecliSkillContentPayload): Promise<OfficecliSkillInstallStatus[]> => (
      listSkillInstallStatuses(normalizeSkillId(payload))
    ),
    listAllSkillInstallStatuses: async (): Promise<OfficecliSkillInstallStatus[]> => {
      const agents = await agentList();
      const rows = await Promise.all(
        OFFICECLI_SKILL_DEFS.flatMap((def) => agents.map((agent) => statusFor(def, agent))),
      );
      return rows;
    },
    applySkillLinks: (payload?: OfficecliSkillApplyLinksPayload) => withOfficeCliMutationLock(() => applySkillLinks(payload)),
    readSkillContent: async (payload: OfficecliSkillContentPayload): Promise<string> => {
      const skillId = normalizeSkillId(payload);
      if (await readOfficeSkillMarkerPack(skillsRoot, skillId) !== 'officecli') {
        throw new Error('Skill is not installed by Office CLI');
      }
      return readFile(join(skillDir(skillsRoot, skillId), 'SKILL.md'), 'utf-8');
    },
    renderHtml: async (payload: OfficecliRenderHtmlPayload): Promise<string> => {
      const { rootPath, path } = normalizeRenderPayload(payload);
      const binary = await resolveOfficeCli();
      if (!binary) throw new Error('officecli is not installed');
      const target = await resolveOfficeTarget(rootPath, path);
      const result = await runCommand(binary, ['view', target, 'html'], { timeoutMs: 60_000 });
      if (result.exitCode !== 0) {
        throw new Error(officeCliRunFailureMessage(result.stderr || result.stdout));
      }
      if (!result.stdout.trim()) throw new Error('officecli produced empty output');
      return result.stdout;
    },
    startWatch: async (payload: OfficecliWatchPayload): Promise<OfficeWatchStarted> => {
      const { rootPath, path } = normalizeRenderPayload(payload);
      const target = await resolveOfficeTarget(rootPath, path);
      const key = await watchKey(target);
      const existing = reuseWatchEntry(key);
      if (existing) return existing;

      return withWatchStartLock(key, async () => {
        const lockedExisting = reuseWatchEntry(key);
        if (lockedExisting) return lockedExisting;
        if (officeWatches.size >= MAX_OFFICE_WATCHES) {
          throw new Error('TOO_MANY: too many office preview servers are already running');
        }
        const binary = await resolveOfficeCli();
        if (!binary) throw new Error('NOT_INSTALLED: officecli is not installed');
        const port = await allocateFreePort();
        const cap = randomUUID().replace(/-/g, '');
        const child = spawn(binary, ['watch', target, '--port', String(port)], {
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          cwd: dirname(target),
        });
        try {
          await awaitOfficeWatchReady(child, port);
        } catch (error) {
          child.kill();
          throw error;
        }
        officeWatches.set(key, { child, port, cap, refCount: 1, filePath: target });
        child.once('exit', () => {
          const current = officeWatches.get(key);
          if (current?.child === child) officeWatches.delete(key);
        });
        return { port, cap };
      });
    },
    stopWatch: async (payload: OfficecliWatchPayload): Promise<void> => {
      const { rootPath, path } = normalizeRenderPayload(payload);
      const root = resolve(rootPath);
      const target = assertInsideRoot(root, resolve(root, path));
      stopWatchEntry(await looseWatchKey(target));
    },
  };
}
