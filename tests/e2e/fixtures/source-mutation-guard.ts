import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;

export type TrackedSourceState = {
  status: string;
  trackedFilesSha256: string;
  diffSha256: string;
};

async function gitText(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    windowsHide: true,
  });
  return String(stdout);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function captureTrackedSourceState(root: string): Promise<TrackedSourceState> {
  const status = await gitText(root, ['status', '--porcelain=v1', '--untracked-files=no']);
  const trackedFiles = await gitText(root, ['ls-files', '-z']);
  const diff = await gitText(root, ['diff', '--binary', '--no-ext-diff', 'HEAD', '--']);
  return {
    status,
    trackedFilesSha256: sha256(trackedFiles),
    diffSha256: sha256(diff),
  };
}

export function assertTrackedSourceStateUnchanged(
  before: TrackedSourceState,
  after: TrackedSourceState,
): void {
  const changed = (Object.keys(before) as Array<keyof TrackedSourceState>)
    .filter((key) => before[key] !== after[key]);
  if (changed.length > 0) {
    throw new Error(`tracked source changed during Electron E2E run: ${changed.join(', ')}`);
  }
}
