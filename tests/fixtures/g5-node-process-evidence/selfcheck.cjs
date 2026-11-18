const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const repoRoot = path.resolve(process.argv[2] || process.cwd());
const observerPath = path.join(repoRoot, 'scripts/g5/node-gateway-process-evidence.cjs');
const observer = require(observerPath);
const root = fs.mkdtempSync(path.join('D:/tmp', 'verse-claw-e2e-run-'));
const entry = path.join(root, 'entry.cjs');
const config = path.join(root, 'openclaw.json');
const marker = path.join(root, 'electron-process-run.json');
const observerConfig = path.join(root, 'observer-config.json');
const actor = 'codex/g5-node-process-observer-selfcheck';
const candidate = cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', windowsHide: true }).trim();
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
fs.writeFileSync(entry, 'setTimeout(() => process.exit(0), 2500);\n');
fs.writeFileSync(config, JSON.stringify({ model: 'scripted-local-selfcheck' }));
fs.writeFileSync(marker, JSON.stringify({ runRoot: root, runnerPid: process.pid }));
fs.writeFileSync(observerConfig, JSON.stringify({ candidate, actor, entry, runMarker: marker }));
const wrapper = path.join(root, 'wrapper.mjs');
fs.writeFileSync(wrapper, `import { spawn } from 'node:child_process';
import { once } from 'node:events';
for (const generation of ['selfcheck-first', 'selfcheck-second']) {
 const child=spawn(process.execPath,[${JSON.stringify(entry)},'gateway','run'],{
   windowsHide:true,stdio:'ignore',env:{...process.env,VERSE_CLAW_GATEWAY_GENERATION:generation,OPENCLAW_CONFIG_PATH:${JSON.stringify(config)}}});
 await once(child,'exit');
}
`);
const startedAt = Date.now();
const execution = cp.spawnSync(process.execPath, ['--require', observerPath, wrapper], {
 windowsHide: true, encoding: 'utf8', timeout: 30000,
 env: { ...process.env, TEMP: 'D:/tmp', TMP: 'D:/tmp', CLAWX_E2E_RUN_ROOT: root, CLAWX_A5_NODE_OBSERVER_CONFIG: observerConfig },
});
assert(!execution.error && execution.status === 0, execution.stderr);
const events = fs.readFileSync(path.join(root, observer.LEDGER), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
const launches = events.filter(row => row.event === 'launch');
const owner = { driven_by: 'agent', actor: 'codex-a5-runtime-integration', candidate,
 firstAck: { childPid: launches[0]?.pid, gatewayGeneration: 'selfcheck-first' },
 secondAck: { childPid: launches[1]?.pid, gatewayGeneration: 'selfcheck-second' } };
const expected = { candidate, actor, runRoot: root, entry, entrySha256: sha(entry), startedAt, finishedAt: Date.now() };
const checks = [];
assert.equal(observer.validateLedger(events, owner, expected).length, 2);
checks.push({ name: 'real Node launch, native birth and exit capture', passed: true });
for (const [name, mutate] of [
 ['missing native creation time', rows => delete rows[0].creationTime],
 ['wrong Gateway generation', rows => rows[0].gatewayGeneration = 'wrong-generation'],
 ['foreign run root', rows => rows[0].runRoot = 'D:/tmp/another-run'],
 ['missing exit', rows => rows.splice(rows.findIndex(row => row.event === 'exit'), 1)],
 ['duplicate launch', rows => rows.push(rows[0])],
 ['native capture failure', rows => rows.push({ event: 'observation-error' })],
 ['wrong input digest', rows => rows[0].configSha256 = '0'.repeat(64)],
 ['stale build digest', rows => rows[0].entrySha256 = '0'.repeat(64)],
 ['human attribution', rows => rows[0].realHumanEvidence = true],
]) {
 const invalid = structuredClone(events); mutate(invalid);
 assert.throws(() => observer.validateLedger(invalid, owner, expected), name);
 checks.push({ name, passed: true });
}
const helper = path.join(repoRoot, 'tests/e2e/fixtures/windows-process.ts');
require(helper).checkWindowsProcesses(launches.map(({ pid, creationTime }) => ({ pid, creationTime }))).then(native => {
 assert(native.every(row => ['exited', 'replaced'].includes(row.status)));
 checks.push({ name: 'independent native exit census', passed: true });
 const receipt = { driven_by: 'agent', actor, realHumanEvidence: false, status: 'passed', checks,
   passed: checks.length, runRoot: root, ledgerSha256: sha(path.join(root, observer.LEDGER)),
   observerSha256: sha(observerPath), native };
 const result = path.join(root, 'node-process-selfcheck.json');
 assert(!fs.existsSync(result), 'Fresh selfcheck result required');
 fs.writeFileSync(result, JSON.stringify(receipt, null, 2) + '\n');
 console.log(JSON.stringify({ status: receipt.status, passed: receipt.passed, native, result }));
}).catch(error => { console.error(error); process.exitCode = 1; });
