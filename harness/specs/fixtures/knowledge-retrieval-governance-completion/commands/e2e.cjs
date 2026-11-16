const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const root = 'D:/ClawX-work/knowledge-relay-20261105';
const output = 'D:/tmp/knowledge-relay-20261105/final/e2e-r2';
fs.mkdirSync(output,{recursive:true});
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
const candidate = { commit: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), dirty: Boolean(git('status', '--porcelain')) };
if (candidate.dirty) throw Error('Expected a clean candidate');
const report = { driven_by: 'agent', actor: 'codex-knowledge-relay', candidate, steps: [] };
const env = { ...process.env, TEMP: 'D:/tmp', TMP: 'D:/tmp',
  CLAWX_E2E_RUN_ROOT_BASE: 'C:/Users/27933/AppData/LocalLow/clawx-knowledge-relay-20261105',
  CLAWX_E2E_APP_LOGS: '1',
  CLAWX_KNOWLEDGE_BOT_EVIDENCE_DIR: path.join(output, 'ui-screens'),
  PLAYWRIGHT_JSON_OUTPUT_NAME: path.join(output, 'ui.json') };
async function run(name, executable, args, extraEnv = {}) {
  if (git('rev-parse', 'HEAD') !== candidate.commit || git('status', '--porcelain')) throw Error('Candidate changed');
  const startedAt = new Date().toISOString();
  const fd = fs.openSync(path.join(output, name + '.txt'), 'w');
  console.log('START ' + name);
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, env: { ...env, ...extraEnv }, stdio: ['ignore', fd, fd], windowsHide: true });
    child.on('error', reject); child.on('exit', code => resolve(code ?? 1));
  });
  fs.closeSync(fd);
  report.steps.push({ name, command: [executable, ...args], startedAt, finishedAt: new Date().toISOString(), exitCode,
    dirtyAfter: Boolean(git('status', '--porcelain')), commitAfter: git('rev-parse', 'HEAD') });
  fs.writeFileSync(path.join(output, 'e2e-binding.json'), JSON.stringify(report, null, 2));
  console.log('END ' + name + ' exit=' + exitCode);
  return exitCode;
}
(async () => {
  const code = await run('ui', process.execPath, ['node_modules/@playwright/test/cli.js', 'test',
    'tests/e2e/knowledge-bot.spec.ts', 'tests/e2e/knowledge-hub.spec.ts', '--workers=1', '--retries=0',
    '--reporter=list,json', '--max-failures=1', '--output=' + path.join(output, 'ui-output')]);
  if (code) { process.exitCode = code; return; }
  process.exitCode = await run('live-electron-run', 'py', ['-3', '-X', 'utf8', 'D:/tmp/knowledge-relay-20261105/run-live.py', 'e2e'], { CLAWX_KNOWLEDGE_LIVE: '1' });
})().catch(error => { console.error(error); process.exitCode = 1; });
