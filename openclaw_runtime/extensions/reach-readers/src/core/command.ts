import { runCommandWithTimeout } from 'openclaw/plugin-sdk/process-runtime';
import {
  materializeWindowsSpawnProgram,
  resolveWindowsSpawnProgram,
} from 'openclaw/plugin-sdk/windows-spawn';
import { redactSensitiveText } from 'openclaw/plugin-sdk/security-runtime';

export interface ReachCommandOptions {
  timeoutMs: number;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  maxOutputBytes?: number;
  packageName?: string;
}

export interface ReachCommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  termination: string | null;
}

export async function runReachCommand(
  command: string,
  argv: readonly string[],
  options: ReachCommandOptions,
): Promise<ReachCommandResult> {
  const env = options.env ?? process.env;
  const program = resolveWindowsSpawnProgram({
    command,
    env,
    packageName: options.packageName,
  });
  const invocation = materializeWindowsSpawnProgram(program, [...argv]);
  const result = await runCommandWithTimeout([invocation.command, ...invocation.argv], {
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    env,
  });
  const maxOutputBytes = options.maxOutputBytes ?? 20 * 1024 * 1024;
  return {
    code: result.code,
    stdout: truncateUtf8(result.stdout, maxOutputBytes),
    stderr: truncateUtf8(result.stderr, maxOutputBytes),
    termination: result.termination,
  };
}

function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value);
  if (bytes.byteLength <= maxBytes) return value;
  return bytes.subarray(bytes.byteLength - maxBytes).toString('utf8');
}

export function commandError(command: string, argv: readonly string[], result: ReachCommandResult): Error {
  const diagnostic = (result.stderr || result.stdout || `exit ${result.code ?? 'unknown'}`).slice(0, 500);
  return new Error(redactSensitiveText(
    `${command} ${argv.join(' ')} failed: ${diagnostic}`,
    { mode: 'tools' },
  ));
}
