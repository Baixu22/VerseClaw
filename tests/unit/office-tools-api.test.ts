import { EventEmitter } from 'node:events';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createOfficeToolsApi,
  OFFICECLI_SKILL_DEFS,
  officeCliInstallCommand,
  officeCliRuntimeDependencyHint,
  stopAllOfficeWatches,
} from '@electron/services/office-tools-api';

describe('office tools api', () => {
  let root: string;
  let skillsRoot: string;
  let configs: Record<string, { enabled?: boolean }>;
  let agentTools: Record<string, { defaultSkillIds: string[]; defaultMcpServerIds: string[] }>;
  let runCalls: Array<{ command: string; args: string[] }>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'clawx-office-tools-'));
    skillsRoot = join(root, 'skills');
    configs = {};
    agentTools = {};
    runCalls = [];
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function service(overrides: Partial<Parameters<typeof createOfficeToolsApi>[0]> = {}) {
    return createOfficeToolsApi({
      skillsRoot,
      readConfigs: async () => configs,
      updateConfigs: async (updates) => {
        for (const update of updates) {
          if (update.remove) {
            delete configs[update.skillKey];
            continue;
          }
          configs[update.skillKey] = {
            ...configs[update.skillKey],
            enabled: update.enabled,
          };
        }
        return { success: true };
      },
      listAgents: async () => ({
        agents: [
          {
            id: 'main',
            name: 'Main Agent',
            isDefault: true,
            modelDisplay: 'Not configured',
            inheritedModel: false,
            workspace: join(root, 'workspace'),
            agentDir: join(root, 'agents', 'main'),
            mainSessionKey: 'agent:main:main',
            channelTypes: [],
          },
          {
            id: 'writer',
            name: 'Writer',
            isDefault: false,
            modelDisplay: 'Not configured',
            inheritedModel: false,
            workspace: join(root, 'workspace-writer'),
            agentDir: join(root, 'agents', 'writer'),
            mainSessionKey: 'agent:writer:main',
            channelTypes: [],
          },
        ],
      }),
      readAgentBootstrapTools: async (agentId: string) => (
        agentTools[agentId] ?? { defaultSkillIds: [], defaultMcpServerIds: [] }
      ),
      writeAgentBootstrapTools: async (agentId: string, patch: { defaultSkillIds?: string[] }) => {
        const current = agentTools[agentId] ?? { defaultSkillIds: [], defaultMcpServerIds: [] };
        const next = {
          ...current,
          defaultSkillIds: patch.defaultSkillIds ?? current.defaultSkillIds,
        };
        agentTools[agentId] = next;
        return next;
      },
      resolveOfficeCli: async () => join(root, 'officecli'),
      primaryInstallPath: () => join(root, 'OfficeCLI', process.platform === 'win32' ? 'officecli.exe' : 'officecli'),
      runCommand: async (command, args) => {
        runCalls.push({ command, args });
        if (args.includes('--version')) {
          return { exitCode: 0, stdout: 'officecli 1.2.3\n', stderr: '' };
        }
        const loadIndex = args.indexOf('load_skill');
        if (loadIndex >= 0) {
          const loadId = args[loadIndex + 1] ?? 'unknown';
          return {
            exitCode: 0,
            stdout: `---\nname: officecli-${loadId}\ndescription: Loaded ${loadId}\n---\nUse officecli ${loadId}.`,
            stderr: '',
          };
        }
        if (args[0] === 'view') {
          return { exitCode: 0, stdout: '<html><body>Office preview</body></html>', stderr: '' };
        }
        return { exitCode: 0, stdout: '', stderr: '' };
      },
      installOfficeCli: async ({ emit }) => {
        emit?.({ kind: 'log', payload: 'installer output' });
        return { success: true };
      },
      ...overrides,
    });
  }

  it('detects an installed OfficeCLI binary and reports runnable version details', async () => {
    const api = service();

    const info = await api.detect();

    expect(info).toEqual({
      installed: true,
      version: 'officecli 1.2.3',
      path: join(root, 'officecli'),
      runtimeError: null,
    });
    expect(runCalls[0]).toEqual({ command: join(root, 'officecli'), args: ['--version'] });
  });

  it('maps missing ICU runtime failures to an actionable diagnostic', async () => {
    const api = service({
      runCommand: async (_command, args) => {
        runCalls.push({ command: 'officecli', args });
        return {
          exitCode: 1,
          stdout: '',
          stderr: "Couldn't find a valid ICU package installed on the system.",
        };
      },
    });

    const info = await api.detect();

    expect(info.installed).toBe(true);
    expect(info.runtimeError).toContain('ICU');
    expect(info.runtimeError).toContain('officecli error:');
    expect(officeCliRuntimeDependencyHint('error while loading shared libraries: libfoo.so')).toContain('required system library');
  });

  it('builds Codeg-compatible hardened OfficeCLI installer commands', () => {
    const windows = officeCliInstallCommand('windows');
    const winScript = windows.args.join(' ');
    const unix = officeCliInstallCommand('unix');
    const unixScript = unix.args.join(' ');

    expect(windows.command).toBe('powershell.exe');
    expect(winScript).toContain('SecurityProtocol');
    expect(winScript).toContain('Tls12');
    expect(winScript).toContain('OutputEncoding');
    expect(winScript).toContain('-TimeoutSec 60');
    expect(winScript.indexOf('https://d.officecli.ai/install.ps1')).toBeLessThan(
      winScript.indexOf('https://raw.githubusercontent.com/iOfficeAI/OfficeCLI/main/install.ps1'),
    );

    expect(unix.command).toBe('bash');
    expect(unix.args[0]).toBe('-lc');
    expect(unixScript).toContain('--connect-timeout 20');
    expect(unixScript).toContain('--max-time 60');
    expect(unixScript).toContain('bash "$f"');
    expect(unixScript.indexOf('https://d.officecli.ai/install.sh')).toBeLessThan(
      unixScript.indexOf('https://raw.githubusercontent.com/iOfficeAI/OfficeCLI/main/install.sh'),
    );
  });

  it('lists Codeg-compatible Office skills with central install status', async () => {
    const api = service();

    await api.syncSkills();
    const skills = await api.listSkills();

    expect(skills.map((skill) => skill.id)).toEqual(OFFICECLI_SKILL_DEFS.map((skill) => skill.id));
    expect(skills[0]).toMatchObject({
      id: 'officecli-pptx',
      category: 'presentations',
      icon: 'Presentation',
      sortOrder: 10,
      installedCentrally: true,
    });
    expect(skills.find((skill) => skill.id === 'officecli-docx')?.displayName.en).toBe('Word Document');
  });

  it('syncs skills with a partial report, canonical names, and preserved enabled state', async () => {
    configs['officecli-docx'] = { enabled: true };
    const api = service({
      runCommand: async (command, args) => {
        runCalls.push({ command, args });
        const loadIndex = args.indexOf('load_skill');
        if (loadIndex >= 0 && args[loadIndex + 1] === 'pptx') {
          return { exitCode: 1, stdout: '', stderr: 'pptx failed' };
        }
        if (loadIndex >= 0) {
          const loadId = args[loadIndex + 1] ?? 'unknown';
          return {
            exitCode: 0,
            stdout: `---\nname: officecli-${loadId}\n---\nUse officecli ${loadId}.`,
            stderr: '',
          };
        }
        return { exitCode: 0, stdout: 'officecli 1.2.3', stderr: '' };
      },
    });

    const report = await api.syncSkills();

    expect(report.synced).toBe(OFFICECLI_SKILL_DEFS.length - 1);
    expect(report.errors).toEqual(['officecli-pptx: load_skill failed: pptx failed']);
    await expect(stat(join(skillsRoot, 'officecli-pptx', 'SKILL.md'))).rejects.toThrow();
    const wordSkill = await readFile(join(skillsRoot, 'officecli-docx', 'SKILL.md'), 'utf-8');
    expect(wordSkill).toContain('name: officecli-docx');
    expect(configs['officecli-docx']?.enabled).toBe(true);
    expect(configs['officecli-xlsx']?.enabled).toBe(false);
  });

  it('installs with streamed progress events and returns fresh detection info', async () => {
    const events: Array<{ taskId: string; kind: string; payload: string }> = [];
    const api = service({
      emitInstallEvent: (event) => events.push(event),
    });

    const info = await api.install({ taskId: 'install-1' });

    expect(info.installed).toBe(true);
    expect(events).toEqual([
      { taskId: 'install-1', kind: 'started', payload: '' },
      { taskId: 'install-1', kind: 'log', payload: 'installer output' },
      { taskId: 'install-1', kind: 'completed', payload: 'officecli 1.2.3' },
    ]);
  });

  it('uninstalls the managed binary, central skills, and Office skill configs', async () => {
    const api = service();
    const managedBinary = join(root, 'OfficeCLI', process.platform === 'win32' ? 'officecli.exe' : 'officecli');
    await mkdir(join(root, 'OfficeCLI'), { recursive: true });
    await writeFile(managedBinary, 'binary', 'utf-8');
    await api.syncSkills();
    configs['officecli-docx'] = { enabled: true };

    const info = await api.uninstall();

    expect(info.installed).toBe(true);
    await expect(stat(managedBinary)).rejects.toThrow();
    await expect(stat(join(skillsRoot, 'officecli-docx', 'SKILL.md'))).rejects.toThrow();
    expect(configs['officecli-docx']).toBeUndefined();
  });

  it('reads synced skill content and renders Office documents to HTML inside the requested root', async () => {
    const api = service();
    const docRoot = join(root, 'workspace');
    const docPath = join(docRoot, 'report.docx');
    await mkdir(docRoot, { recursive: true });
    await writeFile(docPath, 'docx', 'utf-8');
    await api.syncSkills();

    const content = await api.readSkillContent({ skillId: 'officecli-docx' });
    const html = await api.renderHtml({ rootPath: docRoot, path: 'report.docx' });

    expect(content).toContain('name: officecli-docx');
    expect(html).toContain('Office preview');
    expect(runCalls.some((call) => call.args[0] === 'view' && call.args[2] === 'html')).toBe(true);
    await expect(api.renderHtml({ rootPath: docRoot, path: '../escape.docx' })).rejects.toThrow(/outside/i);
  });

  it('lists Codeg-style per-agent Office skill link status from agent defaults', async () => {
    agentTools.main = { defaultSkillIds: ['officecli-docx', 'browser'], defaultMcpServerIds: [] };
    agentTools.writer = { defaultSkillIds: [], defaultMcpServerIds: [] };
    const api = service();
    await api.syncSkills();

    const statuses = await api.listAllSkillInstallStatuses();

    const wordMain = statuses.find((status) => status.expertId === 'officecli-docx' && status.agentId === 'main');
    const wordWriter = statuses.find((status) => status.expertId === 'officecli-docx' && status.agentId === 'writer');
    const excelMain = statuses.find((status) => status.expertId === 'officecli-xlsx' && status.agentId === 'main');
    expect(statuses).toHaveLength(OFFICECLI_SKILL_DEFS.length * 2);
    expect(wordMain).toMatchObject({
      expertId: 'officecli-docx',
      skillId: 'officecli-docx',
      agentId: 'main',
      agentName: 'Main Agent',
      state: 'linked_to_codeg',
      copyMode: false,
    });
    expect(wordMain?.linkPath).toBe('agent:main:defaultSkillIds');
    expect(wordMain?.targetPath).toContain(join('skills', 'officecli-docx'));
    expect(wordWriter?.state).toBe('not_linked');
    expect(excelMain?.state).toBe('not_linked');
  });

  it('applies Office skill links per agent without dropping non-Office defaults', async () => {
    agentTools.main = { defaultSkillIds: ['browser', 'officecli-docx'], defaultMcpServerIds: [] };
    agentTools.writer = { defaultSkillIds: ['knowledge'], defaultMcpServerIds: [] };
    const api = service();
    await api.syncSkills();
    await rm(join(skillsRoot, 'officecli-data-dashboard'), { recursive: true, force: true });

    const results = await api.applySkillLinks({
      ops: [
        { expertId: 'officecli-docx', agentId: 'main', enable: false },
        { expertId: 'officecli-xlsx', agentId: 'main', enable: true },
        { expertId: 'officecli-docx', agentId: 'writer', enable: true },
        { expertId: 'officecli-data-dashboard', agentId: 'writer', enable: true },
      ],
    });

    expect(results).toEqual([
      expect.objectContaining({ expertId: 'officecli-docx', agentId: 'main', ok: true, status: null, error: null }),
      expect.objectContaining({ expertId: 'officecli-xlsx', agentId: 'main', ok: true, error: null }),
      expect.objectContaining({ expertId: 'officecli-docx', agentId: 'writer', ok: true, error: null }),
      expect.objectContaining({
        expertId: 'officecli-data-dashboard',
        agentId: 'writer',
        ok: false,
        status: null,
        error: expect.stringContaining('run sync first'),
      }),
    ]);
    expect(agentTools.main.defaultSkillIds).toEqual(['browser', 'officecli-xlsx']);
    expect(agentTools.writer.defaultSkillIds).toEqual(['knowledge', 'officecli-docx']);
  });

  it('shares one watch process when the same Office file is opened concurrently', async () => {
    const docRoot = join(root, 'workspace');
    const docPath = join(docRoot, 'report.docx');
    const spawnLog = join(docRoot, 'watch-spawns.log');
    await mkdir(docRoot, { recursive: true });
    await writeFile(docPath, 'docx', 'utf-8');
    await writeFile(join(docRoot, 'watch'), `
const http = require('node:http');
const fs = require('node:fs');
const portIndex = process.argv.indexOf('--port');
const port = Number(process.argv[portIndex + 1]);
fs.appendFileSync(${JSON.stringify(spawnLog)}, String(process.pid) + '\\n');
setTimeout(() => {
  const server = http.createServer((_req, res) => res.end('office'));
  server.listen(port, '127.0.0.1', () => {
    console.log('Watch: http://127.0.0.1:' + port + '/');
  });
  setTimeout(() => server.close(() => process.exit(0)), 4000);
}, 150);
`, 'utf-8');
    const api = service({ resolveOfficeCli: async () => process.execPath });

    const [first, second] = await Promise.all([
      api.startWatch({ rootPath: docRoot, path: 'report.docx' }),
      api.startWatch({ rootPath: docRoot, path: 'report.docx' }),
    ]);

    expect(second).toEqual(first);
    const spawns = (await readFile(spawnLog, 'utf-8')).trim().split(/\r?\n/).filter(Boolean);
    expect(spawns).toHaveLength(1);
    await api.stopWatch({ rootPath: docRoot, path: 'report.docx' });
    await api.stopWatch({ rootPath: docRoot, path: 'report.docx' });
    await new Promise((resolve) => setTimeout(resolve, 250));
  });

  it('releases an Office watch even if the previewed file was deleted before stop', async () => {
    const docRoot = join(root, 'workspace');
    const docPath = join(docRoot, 'report.docx');
    await mkdir(docRoot, { recursive: true });
    await writeFile(docPath, 'docx', 'utf-8');
    await writeFile(join(docRoot, 'watch'), `
const http = require('node:http');
const portIndex = process.argv.indexOf('--port');
const port = Number(process.argv[portIndex + 1]);
const server = http.createServer((_req, res) => res.end('office'));
server.listen(port, '127.0.0.1', () => {
  console.log('Watch: http://127.0.0.1:' + port + '/');
});
setTimeout(() => server.close(() => process.exit(0)), 4000);
`, 'utf-8');
    const api = service({ resolveOfficeCli: async () => process.execPath });

    await api.startWatch({ rootPath: docRoot, path: 'report.docx' });
    await rm(docPath, { force: true });
    await api.stopWatch({ rootPath: docRoot, path: 'report.docx' });

    expect(stopAllOfficeWatches()).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 250));
  });

  it('routes installer timeout through a process-tree killer', async () => {
    const officeTools = await import('@electron/services/office-tools-api') as Record<string, unknown>;
    const runInstallChild = officeTools.runOfficeCliInstallChildProcess as (
      child: EventEmitter & {
        pid?: number;
        stdout?: EventEmitter;
        stderr?: EventEmitter;
        kill: () => boolean;
      },
      ctx: { taskId: string; emit?: (event: { kind: 'log'; payload: string }) => void },
      options: { timeoutMs: number; killProcessTree: (child: { pid?: number }) => Promise<void> },
    ) => Promise<{ success: boolean; error?: string }>;
    expect(typeof runInstallChild).toBe('function');
    const child = Object.assign(new EventEmitter(), {
      pid: 4242,
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(() => true),
    });
    const killedPids: Array<number | undefined> = [];

    const result = await runInstallChild(
      child,
      { taskId: 'install-1' },
      {
        timeoutMs: 5,
        killProcessTree: async (target) => {
          killedPids.push(target.pid);
        },
      },
    );

    expect(result).toEqual({ success: false, error: 'Office CLI installer timed out' });
    expect(killedPids).toEqual([4242]);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('serializes Office skill sync mutations', async () => {
    let activeLoads = 0;
    let overlapped = false;
    const api = service({
      runCommand: async (_command, args) => {
        if (args.includes('--version')) {
          return { exitCode: 0, stdout: 'officecli 1.2.3', stderr: '' };
        }
        const loadIndex = args.indexOf('load_skill');
        if (loadIndex >= 0) {
          if (activeLoads > 0) overlapped = true;
          activeLoads += 1;
          await new Promise((resolve) => setTimeout(resolve, 5));
          activeLoads -= 1;
          const loadId = args[loadIndex + 1] ?? 'unknown';
          return {
            exitCode: 0,
            stdout: `---\nname: officecli-${loadId}\n---\nUse officecli ${loadId}.`,
            stderr: '',
          };
        }
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    });

    await Promise.all([api.syncSkills(), api.syncSkills()]);

    expect(overlapped).toBe(false);
  });
});
