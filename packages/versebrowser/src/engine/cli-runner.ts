import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { agentBrowserScreenshotDir } from '../core/filesystem-boundary.ts';
import { tryElectron } from '../host/electron-optional.ts';
import type { AgentBrowserConnectionSnapshot, AgentBrowserSession } from '../types/host-api.ts';

type ExecFile = typeof execFile;

export type AgentBrowserCliRunnerOptions = {
  binPath?: string;
  execFile?: ExecFile;
  resourcesPath?: string;
  cwd?: string;
  userDataPath?: string;
};

export type AgentBrowserCliOpenPayload = {
  session: AgentBrowserSession;
  url?: string;
  width: number;
  height: number;
};

export type AgentBrowserCliTypePayload = {
  session: AgentBrowserSession;
  selector: string;
  text: string;
  clear?: boolean;
  timeoutMs?: number;
};

export type AgentBrowserCliCommandPayload = {
  session?: AgentBrowserSession;
  args: string[];
  globalOptions?: string[];
  timeoutMs?: number;
  maxOutput?: number;
};

export type AgentBrowserCliCommandResult = {
  session: Partial<AgentBrowserSession>;
  data?: unknown;
  stdout: string;
  stderr: string;
  command: string[];
};

export type AgentBrowserRunner = {
  isAvailable: () => boolean;
  open: (payload: AgentBrowserCliOpenPayload) => Promise<Partial<AgentBrowserSession>>;
  navigate: (session: AgentBrowserSession, url: string, timeoutMs?: number) => Promise<Partial<AgentBrowserSession>>;
  waitForSelector: (session: AgentBrowserSession, selector: string, timeoutMs?: number) => Promise<Partial<AgentBrowserSession>>;
  click: (session: AgentBrowserSession, selector: string, timeoutMs?: number) => Promise<Partial<AgentBrowserSession>>;
  type: (payload: AgentBrowserCliTypePayload) => Promise<Partial<AgentBrowserSession>>;
  evaluate: (
    session: AgentBrowserSession,
    expression: string,
  ) => Promise<{ session: Partial<AgentBrowserSession>; value?: unknown }>;
  screenshot: (session: AgentBrowserSession) => Promise<{ session: Partial<AgentBrowserSession>; dataUrl: string }>;
  command: (payload: AgentBrowserCliCommandPayload) => Promise<AgentBrowserCliCommandResult>;
  textSample: (session: AgentBrowserSession, maxChars: number) => Promise<string | undefined>;
  close: (session: AgentBrowserSession) => Promise<void>;
};

type AgentBrowserCliJson = {
  success?: boolean;
  data?: unknown;
  error?: string | null;
};

type AgentBrowserCliRunResult = {
  data?: unknown;
  stdout: string;
  stderr: string;
  command: string[];
};

const DEFAULT_COMMAND_TIMEOUT_MS = 45_000;
const SCREENSHOT_TIMEOUT_MS = 60_000;

export function getBundledAgentBrowserPath(
  resourcesPath = process.resourcesPath,
  cwd = process.cwd(),
): string {
  const binName = process.platform === 'win32' ? 'agent-browser.exe' : 'agent-browser';
  if (tryElectron()?.app?.isPackaged) {
    return join(resourcesPath, 'bin', binName);
  }
  return join(cwd, 'resources', 'bin', `${process.platform}-${process.arch}`, binName);
}

export function createDefaultAgentBrowserCliRunner(): AgentBrowserCliRunner | undefined {
  const binPath = getBundledAgentBrowserPath();
  return existsSync(binPath) ? new AgentBrowserCliRunner({ binPath }) : undefined;
}

export class AgentBrowserCliRunner {
  private readonly binPath: string;
  private readonly execFileImpl: ExecFile;
  private readonly cwd?: string;
  private readonly userDataPath?: string;

  constructor(options: AgentBrowserCliRunnerOptions = {}) {
    this.binPath = options.binPath ?? getBundledAgentBrowserPath(options.resourcesPath, options.cwd);
    this.execFileImpl = options.execFile ?? execFile;
    this.userDataPath = options.userDataPath;
    this.cwd = options.cwd;
  }

  isAvailable(): boolean {
    return existsSync(this.binPath);
  }

  async open(payload: AgentBrowserCliOpenPayload): Promise<Partial<AgentBrowserSession>> {
    await this.run(payload.session, ['open', ...(payload.url ? [payload.url] : [])], {
      timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
    });
    await this.run(payload.session, ['set', 'viewport', String(payload.width), String(payload.height)], {
      timeoutMs: 15_000,
    });
    return await this.readSessionInfo(payload.session);
  }

  async navigate(
    session: AgentBrowserSession,
    url: string,
    timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
  ): Promise<Partial<AgentBrowserSession>> {
    await this.run(session, ['open', url], { timeoutMs });
    return await this.readSessionInfo(session);
  }

  async waitForSelector(
    session: AgentBrowserSession,
    selector: string,
    timeoutMs?: number,
  ): Promise<Partial<AgentBrowserSession>> {
    await this.run(session, ['wait', selector], { timeoutMs });
    return await this.readSessionInfo(session);
  }

  async click(
    session: AgentBrowserSession,
    selector: string,
    timeoutMs?: number,
  ): Promise<Partial<AgentBrowserSession>> {
    await this.run(session, ['click', selector], { timeoutMs });
    return await this.readSessionInfo(session);
  }

  async type(payload: AgentBrowserCliTypePayload): Promise<Partial<AgentBrowserSession>> {
    const command = payload.clear === false ? 'type' : 'fill';
    await this.run(payload.session, [command, payload.selector, payload.text], {
      timeoutMs: payload.timeoutMs,
    });
    return await this.readSessionInfo(payload.session);
  }

  async evaluate(
    session: AgentBrowserSession,
    expression: string,
  ): Promise<{ session: Partial<AgentBrowserSession>; value?: unknown }> {
    const data = await this.run(session, ['eval', expression]);
    return {
      session: await this.readSessionInfo(session),
      value: this.extractValue(data),
    };
  }

  async screenshot(session: AgentBrowserSession): Promise<{ session: Partial<AgentBrowserSession>; dataUrl: string }> {
    // P4-002 A3: screenshots stay under agent-browser/screenshots/<sessionId>/ inside userData.
    const shotDir = agentBrowserScreenshotDir(this.getUserDataPath(), session.id);
    await mkdir(shotDir, { recursive: true });
    const screenshotPath = join(shotDir, `${session.id}-${randomUUID()}.png`);
    await this.run(session, ['screenshot', screenshotPath], { timeoutMs: SCREENSHOT_TIMEOUT_MS });
    const buffer = await readFile(screenshotPath);
    await unlink(screenshotPath).catch(() => undefined);
    return {
      session: await this.readSessionInfo(session),
      dataUrl: `data:image/png;base64,${buffer.toString('base64')}`,
    };
  }

  async command(payload: AgentBrowserCliCommandPayload): Promise<AgentBrowserCliCommandResult> {
    const result = await this.runRaw(payload.session, payload.args, {
      timeoutMs: payload.timeoutMs,
      maxOutput: payload.maxOutput,
      globalOptions: payload.globalOptions,
    });
    return {
      ...result,
      session: payload.session ? await this.readSessionInfo(payload.session) : {},
    };
  }

  async textSample(session: AgentBrowserSession, maxChars: number): Promise<string | undefined> {
    try {
      const data = await this.run(session, ['get', 'text', 'body'], {
        timeoutMs: 15_000,
        maxOutput: maxChars,
      });
      const text = this.extractText(data);
      return text ? text.slice(0, maxChars) : undefined;
    } catch {
      return undefined;
    }
  }

  async close(session: AgentBrowserSession): Promise<void> {
    await this.run(session, ['close'], { timeoutMs: 15_000 }).catch(() => undefined);
  }

  private async readSessionInfo(session: AgentBrowserSession): Promise<Partial<AgentBrowserSession>> {
    const [urlData, titleData] = await Promise.all([
      this.run(session, ['get', 'url'], { timeoutMs: 10_000 }).catch(() => undefined),
      this.run(session, ['get', 'title'], { timeoutMs: 10_000 }).catch(() => undefined),
    ]);
    return {
      url: this.extractField(urlData, 'url'),
      title: this.extractField(titleData, 'title'),
    };
  }

  private async run(
    session: AgentBrowserSession,
    commandArgs: string[],
    options: { timeoutMs?: number; maxOutput?: number; globalOptions?: string[] } = {},
  ): Promise<unknown> {
    return (await this.runRaw(session, commandArgs, options)).data;
  }

  private async runRaw(
    session: AgentBrowserSession | undefined,
    commandArgs: string[],
    options: { timeoutMs?: number; maxOutput?: number; globalOptions?: string[] } = {},
  ): Promise<AgentBrowserCliRunResult> {
    const cwd = this.getCwd();
    await mkdir(cwd, { recursive: true });
    if (session && this.usesManagedProfile(session.connection)) {
      await mkdir(this.profileDir(session.profile), { recursive: true });
    }

    const args = [
      '--json',
      ...(session ? [
        '--session',
        session.id,
        '--profile',
        this.profileArg(session),
      ] : []),
      ...(session?.mode === 'visible' ? ['--headed'] : []),
      ...(session ? this.sessionGlobalOptions(session) : []),
      ...(options.maxOutput ? ['--max-output', String(options.maxOutput)] : []),
      ...(options.globalOptions ?? []),
      ...commandArgs,
    ];
    const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    const env = {
      ...process.env,
      AGENT_BROWSER_DEFAULT_TIMEOUT: String(timeoutMs),
    };

    try {
      const { stdout, stderr } = await new Promise<{ stdout: string | Buffer; stderr: string | Buffer }>((resolve, reject) => {
        this.execFileImpl(this.binPath, args, {
          cwd,
          env,
          timeout: timeoutMs,
          windowsHide: true,
          maxBuffer: 10 * 1024 * 1024,
        }, (error, stdout, stderr) => {
          if (error) {
            const detail = stderr ? String(stderr).trim() : '';
            reject(new Error(detail || error.message));
            return;
          }
          resolve({ stdout, stderr });
        });
      });
      const stdoutText = String(stdout ?? '');
      const stderrText = String(stderr ?? '');
      const parsed = parseJsonOutput(stdoutText);
      if (parsed.success === false) {
        throw new Error(parsed.error || `agent-browser command failed: ${commandArgs.join(' ')}`);
      }
      return {
        data: parsed.data,
        stdout: stdoutText,
        stderr: stderrText,
        command: args,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`agent-browser CLI failed (${commandArgs.join(' ')}): ${message}`, { cause: error });
    }
  }

  private profileDir(profile: string): string {
    return join(this.getUserDataPath(), 'agent-browser', 'profiles', profile);
  }

  private profileArg(session: AgentBrowserSession): string {
    return session.connection?.mode === 'external-profile' && session.connection.externalProfile
      ? session.connection.externalProfile
      : this.profileDir(session.profile);
  }

  private usesManagedProfile(connection: AgentBrowserConnectionSnapshot | undefined): boolean {
    return connection?.mode !== 'external-profile';
  }

  private sessionGlobalOptions(session: AgentBrowserSession): string[] {
    const args: string[] = [];
    if (session.authPersistence === 'session-name' && session.authStateName) {
      args.push('--session-name', session.authStateName);
    }
    switch (session.connection?.mode) {
      case 'auto-connect':
        args.push('--auto-connect');
        break;
      case 'cdp':
        if (session.connection.cdpEndpoint) {
          args.push('--cdp', session.connection.cdpEndpoint);
        }
        break;
      case 'external-profile':
        if (session.connection.executablePath) {
          args.push('--executable-path', session.connection.executablePath);
        }
        break;
    }
    return args;
  }

  private getCwd(): string {
    return this.cwd ?? join(this.getUserDataPath(), 'agent-browser');
  }

  private getUserDataPath(): string {
    return this.userDataPath ?? tryElectron()?.app?.getPath('userData') ?? join(process.cwd(), '.agent-browser-data');
  }

  private extractField(data: unknown, field: string): string | undefined {
    if (data && typeof data === 'object' && field in data) {
      const value = (data as Record<string, unknown>)[field];
      return typeof value === 'string' ? value : undefined;
    }
    return undefined;
  }

  private extractText(data: unknown): string | undefined {
    if (typeof data === 'string') return data;
    return this.extractField(data, 'text');
  }

  private extractValue(data: unknown): unknown {
    if (data && typeof data === 'object' && 'value' in data) {
      return (data as Record<string, unknown>).value;
    }
    if (data && typeof data === 'object' && 'result' in data) {
      return (data as Record<string, unknown>).result;
    }
    return data;
  }
}

function parseJsonOutput(stdout: string): AgentBrowserCliJson {
  const trimmed = stdout.trim();
  if (!trimmed) return { success: true };
  try {
    return JSON.parse(trimmed) as AgentBrowserCliJson;
  } catch {
    const jsonLine = trimmed
      .split(/\r?\n/)
      .reverse()
      .find((line) => line.trim().startsWith('{'));
    if (!jsonLine) {
      throw new Error(`Invalid agent-browser JSON output: ${trimmed.slice(0, 500)}`);
    }
    return JSON.parse(jsonLine) as AgentBrowserCliJson;
  }
}
