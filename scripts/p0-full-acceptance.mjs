import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const root = process.cwd();
const outDir = path.join(root, 'artifacts/system-maturity/P0-ACCEPTANCE');
fs.mkdirSync(outDir, { recursive: true });

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function run(name, command, args, timeoutMs = 300000) {
  const started = Date.now();
  const r = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: timeoutMs,
    env: process.env,
    shell: process.platform === 'win32',
  });
  const durationMs = Date.now() - started;
  const stdout = r.stdout || '';
  const stderr = r.stderr || '';
  const exitCode = r.error && r.error.code === 'ETIMEDOUT' ? 'timeout' : (r.status ?? 1);
  fs.writeFileSync(path.join(outDir, `${name}.stdout.txt`), stdout);
  fs.writeFileSync(path.join(outDir, `${name}.stderr.txt`), stderr);
  fs.writeFileSync(path.join(outDir, `${name}.exit.txt`), String(exitCode));
  const ok = exitCode === 0;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name} exit=${exitCode} ${durationMs}ms`);
  return { name, command: [command, ...args].join(' '), exitCode, durationMs, ok, stdoutBytes: Buffer.byteLength(stdout), stderrBytes: Buffer.byteLength(stderr) };
}

const gates = [];
gates.push(run('01-audit-baseline', 'node', ['scripts/audit-baseline-check.mjs']));
gates.push(run('02-plan-validate', 'node', ['scripts/validate-system-maturity-plan.mjs']));
gates.push(run('03-gates-validate', 'node', ['scripts/validate-test-gates.mjs']));
gates.push(run('04-evidence-validate', 'node', ['scripts/validate-system-maturity-evidence.mjs']));
gates.push(run('05-maturity-validate', 'pnpm', ['maturity:validate'], 600000));
gates.push(run('06-harness-agent-dev', 'pnpm', ['harness', 'validate', '--spec', 'harness/specs/tasks/agent-dev-ecosystem-regularization.md']));
gates.push(run('07-agent-dev-fast', 'pnpm', ['agent-dev:fast'], 300000));
gates.push(run('08-harness-ci', 'pnpm', ['run', 'harness:ci'], 300000));
gates.push(run('09-typecheck', 'pnpm', ['run', 'typecheck'], 600000));
gates.push(run('11-release-gates-list', 'node', ['scripts/validate-test-gates.mjs', '--loop', 'release', '--list', '--skip-empty-shard']));

// A1 negative probe for evidence gate
const deliveryPath = 'plans/system-maturity/phase0-foundation/tasks/P0-001.delivery.md';
const original = fs.readFileSync(deliveryPath, 'utf8');
const broken = original.replace(/^EVIDENCE:.*$/m, 'EVIDENCE: ');
fs.writeFileSync(deliveryPath, broken);
const neg = run('12-a1-missing-evidence-probe', 'node', ['scripts/validate-system-maturity-evidence.mjs']);
fs.writeFileSync(deliveryPath, original);
const negOk = !neg.ok; // must fail
gates.push({ ...neg, name: '12-a1-missing-evidence-probe', ok: negOk, note: 'expected non-zero exit' });
console.log(`[${negOk ? 'PASS' : 'FAIL'}] 12-a1-missing-evidence-probe expected-fail ok=${negOk}`);

// Restore and reconfirm evidence green
gates.push(run('13-evidence-after-restore', 'node', ['scripts/validate-system-maturity-evidence.mjs']));

// Acceptance matrix from task files
const tasks = ['P0-001', 'P0-002', 'P0-003', 'P0-004'].map((id) => {
  const md = fs.readFileSync(`plans/system-maturity/phase0-foundation/tasks/${id}.md`, 'utf8');
  const delivery = fs.readFileSync(`plans/system-maturity/phase0-foundation/tasks/${id}.delivery.md`, 'utf8');
  const acceptance = [...md.matchAll(/- \[( |x|X)\]\s*(A\d+):\s*(.+)/g)].map((m) => ({
    id: m[2],
    checked: m[1].toLowerCase() === 'x',
    text: m[3].trim(),
  }));
  return {
    id,
    status: (delivery.match(/^STATUS:\s*(.+)$/m) || [])[1],
    acceptance,
    allAcceptanceChecked: acceptance.every((a) => a.checked),
    hasEvidence: /^EVIDENCE:\s*\S+/m.test(delivery),
    hasTests: /^TESTS:\s*\S+/m.test(delivery),
    hasResults: /^RESULTS:\s*\S+/m.test(delivery),
  };
});

const status = JSON.parse(fs.readFileSync('plans/system-maturity/phase0-foundation/STATUS.json', 'utf8'));
const baseline = JSON.parse(fs.readFileSync('plans/system-maturity/BASELINE.json', 'utf8'));
const allGatesPass = gates.every((g) => g.ok);
const phase0Done =
  status.phaseStatus === 'done' &&
  status.allTasksDone === true &&
  Object.values(status.tasks).every((s) => s === 'done');
const tasksOk = tasks.every((t) => t.status === 'done' && t.allAcceptanceChecked && t.hasEvidence);

const verdict = allGatesPass && phase0Done && tasksOk ? 'PASS' : 'FAIL';

const report = {
  schemaVersion: 1,
  title: 'Phase 0 Complete Acceptance',
  checkedAt: new Date().toISOString(),
  branch: spawnSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).stdout.trim(),
  head: spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(),
  productDevelopmentHead: baseline.canonical?.productDevelopmentHead,
  auditEvidenceHead: baseline.canonical?.auditEvidenceHead,
  phase0Status: status,
  tasks,
  gates,
  summary: {
    allGatesPass,
    phase0Done,
    tasksOk,
    verdict,
  },
};

fs.writeFileSync(path.join(outDir, 'ACCEPTANCE-REPORT.json'), JSON.stringify(report, null, 2) + '\n');

const md = `# Phase 0 Complete Acceptance Report

- **Verdict**: ${verdict}
- **Checked at**: ${report.checkedAt}
- **Branch**: \`${report.branch}\`
- **HEAD**: \`${report.head}\`
- **Product baseline**: \`${report.productDevelopmentHead}\`
- **Audit baseline**: \`${report.auditEvidenceHead}\`

## Phase STATUS

\`\`\`json
${JSON.stringify(status, null, 2)}
\`\`\`

## Task Acceptance Matrix

| Task | Delivery STATUS | A1 | A2 | A3 | Evidence | Tests | Results |
|---|---|---|---|---|---|---|---|
${tasks
  .map((t) => {
    const a = Object.fromEntries(t.acceptance.map((x) => [x.id, x.checked ? 'x' : ' ']));
    return `| ${t.id} | ${t.status} | [${a.A1 || ' '}] | [${a.A2 || ' '}] | [${a.A3 || ' '}] | ${t.hasEvidence ? 'yes' : 'NO'} | ${t.hasTests ? 'yes' : 'NO'} | ${t.hasResults ? 'yes' : 'NO'} |`;
  })
  .join('\n')}

## Gate Results

| Gate | Exit | Duration ms | Result |
|---|---:|---:|---|
${gates.map((g) => `| ${g.name} | ${g.exitCode} | ${g.durationMs} | ${g.ok ? 'PASS' : 'FAIL'} |`).join('\n')}

## P0 Task Spec Mapping

### P0-001
- Tests: \`node scripts/audit-baseline-check.mjs\`, harness agent-dev-ecosystem-regularization
- A1 baseline hash / A2 Finding IDs / A3 exit 0

### P0-002
- Tests: \`node scripts/validate-system-maturity-plan.mjs\`
- A1 unique IDs / A2 status enums / A3 done requires evidence

### P0-003
- Tests: \`pnpm agent-dev:fast\`, \`pnpm run harness:ci\`, \`pnpm run typecheck\`, \`node scripts/validate-test-gates.mjs\`
- A1 empty shard fails / A2 fast ≠ release / A3 machine-executable release list

### P0-004
- Tests: evidence validator + plan validator + harness
- A1 missing evidence fails / A2 rehashable / A3 status consistency

## Overall

Phase 0 acceptance **${verdict}**.
`;

fs.writeFileSync(path.join(outDir, 'ACCEPTANCE-REPORT.md'), md);
console.log('\n=== VERDICT:', verdict, '===');
console.log('Report:', path.join(outDir, 'ACCEPTANCE-REPORT.md'));
process.exit(verdict === 'PASS' ? 0 : 1);
