import { spawnSync } from 'node:child_process';

export function runReleaseGateCommand(command, options = {}) {
  const common = {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    shell: false,
    timeout: options.timeout,
    maxBuffer: options.maxBuffer,
  };
  if (process.platform === 'win32') {
    return spawnSync(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `& { ${command}; if ($null -eq $LASTEXITCODE) { exit 1 }; exit $LASTEXITCODE }`,
      ],
      common,
    );
  }
  return spawnSync('/bin/sh', ['-c', command], common);
}
