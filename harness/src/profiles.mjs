export const PROFILES = {
  fast: [
    { name: 'Generate extension bridge', command: 'pnpm', args: ['-w', 'run', 'ext:bridge'] },
    { name: 'Lint without autofix', command: 'pnpm', args: ['-w', 'run', 'lint:check'] },
    { name: 'Build workspace browser package', command: 'pnpm', args: ['-w', 'run', 'versebrowser:build'] },
    { name: 'Typecheck', command: 'pnpm', args: ['-w', 'run', 'typecheck'] },
    { name: 'Unit tests', command: 'pnpm', args: ['-w', 'test'] },
  ],
  comms: [
    { name: 'Comms replay', command: 'pnpm', args: ['-w', 'run', 'comms:replay'] },
    { name: 'Comms compare', command: 'pnpm', args: ['-w', 'run', 'comms:compare'] },
  ],
  e2e: [
    { name: 'Electron E2E', command: 'pnpm', args: ['-w', 'run', 'test:e2e'] },
  ],
  rsi: [
    { name: 'RSI decision acceptance readback', command: 'pnpm', args: ['-w', 'run', 'rsi:decision:check'] },
    { name: 'RSI feedback pilot protocol', command: 'pnpm', args: ['-w', 'run', 'rsi:feedback:check'] },
    { name: 'RSI three-arm protocol', command: 'node', args: ['scripts/rsi-sekb-arms.mjs', '--check', '--json'] },
    { name: 'RSI TF-0604 corpus', command: 'pnpm', args: ['-w', 'run', 'rsi:tf0604:check'] },
    { name: 'RSI TF-0590 corpus', command: 'pnpm', args: ['-w', 'run', 'rsi:corpus:check'] },
    { name: 'RSI TF-0592 statistics', command: 'pnpm', args: ['-w', 'run', 'rsi:tf0592:check'] },
    { name: 'RSI measurement archive', command: 'node', args: ['scripts/rsi-measurement-archive.mjs', '--check', '--json'] },
  ],
  'concurrency-aux': [
    { name: 'VerseGit concurrency diagnostic', command: 'node', args: ['scripts/versegit-wp2-profile.mjs'] },
  ],
};

export function selectSteps(requiredProfiles) {
  const selected = [];
  const seen = new Set();
  for (const profile of requiredProfiles) {
    for (const step of PROFILES[profile] ?? []) {
      const key = `${step.command} ${step.args.join(' ')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      selected.push({ profile, ...step });
    }
  }
  return selected;
}
