const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const LEDGER = 'node-gateway-pids.jsonl';
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const ref = file => ({ path: path.resolve(file), sha256: sha(file) });
const key = row => `${row.pid}:${row.creationTime}`;
const normalize = file => path.resolve(file).toLowerCase();

function captureCreationTime(pid) {
  assert.equal(process.platform, 'win32', 'Native process birth capture requires Windows');
  assert(Number.isSafeInteger(pid) && pid > 0, 'A valid PID is required');
  const script = '$ErrorActionPreference="Stop"; $p=[Diagnostics.Process]::GetProcessById([int]$env:CLAWX_NODE_OBSERVER_PID); try { $null=$p.Handle; if($p.HasExited){throw "Gateway exited before capture"}; ([DateTimeOffset]$p.StartTime).ToUnixTimeMilliseconds() } finally { $p.Dispose() }';
  const capture = cp.spawnSync('pwsh.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true, encoding: 'utf8', timeout: 10000, env: { ...process.env, CLAWX_NODE_OBSERVER_PID: String(pid) },
  });
  assert(!capture.error && capture.status === 0, `Native creation query failed: ${capture.error ?? capture.stderr}`);
  const creationTime = Number(capture.stdout?.trim());
  assert(Number.isSafeInteger(creationTime) && creationTime > 0, 'Native creation time is unavailable');
  return creationTime;
}

function validateLedger(events, owner, expected) {
  assert.equal(owner.driven_by, 'agent');
  assert.equal(owner.actor, 'codex-a5-runtime-integration');
  assert.equal(owner.candidate, expected.candidate);
  assert.equal(owner.realHumanEvidence ?? false, false);
  const launches = events.filter(row => row.event === 'launch');
  const exits = events.filter(row => row.event === 'exit');
  assert.equal(launches.length, 2, 'Exactly two actual Gateway launches are required');
  assert.equal(exits.length, 2, 'Every Gateway launch requires an observed exit');
  assert.deepEqual(events.map(row => row.event), ['launch', 'exit', 'launch', 'exit'],
    'Gateway launches and exits must alternate without observation errors');
  assert(Date.parse(events[1].at) <= launches[1].creationTime, 'Second Gateway started before the first exit');
  assert.equal(new Set(launches.map(key)).size, 2, 'Gateway identities must be distinct');
  assert.equal(new Set(exits.map(key)).size, 2, 'Exit identities must be distinct');
  for (const launch of launches) {
    assert.equal(launch.schema, 'NodeGatewayProcessObservation/v1');
    assert.equal(launch.driven_by, 'agent');
    assert.equal(launch.actor, expected.actor);
    assert.equal(launch.realHumanEvidence, false);
    assert.equal(launch.candidate, expected.candidate);
    assert.equal(normalize(launch.runRoot), normalize(expected.runRoot));
    assert.equal(normalize(launch.entry), normalize(expected.entry));
    assert.equal(launch.entrySha256, expected.entrySha256);
    assert(Number.isSafeInteger(launch.pid) && launch.pid > 0);
    assert(Number.isSafeInteger(launch.creationTime) && launch.creationTime > 0);
    assert(launch.gatewayGeneration && /^[a-f0-9]{64}$/.test(launch.configSha256));
    assert.equal(normalize(path.dirname(launch.inputConfig.path)), normalize(expected.runRoot));
    assert.equal(launch.inputConfig.sha256, launch.configSha256);
    assert.equal(sha(launch.inputConfig.path), launch.configSha256, 'Captured Gateway input changed');
    assert(expected.startedAt <= launch.creationTime && launch.creationTime <= Date.parse(launch.at));
    const exit = exits.find(row => key(row) === key(launch));
    assert(exit, 'Gateway exit is not bound to its creation time');
    for (const field of ['schema', 'driven_by', 'actor', 'realHumanEvidence', 'candidate', 'runRoot', 'gatewayGeneration']) {
      assert.equal(exit[field], launch[field], `Exit ${field} differs from launch`);
    }
    assert(Date.parse(launch.at) <= Date.parse(exit.at) && Date.parse(exit.at) <= expected.finishedAt);
    assert(Number.isInteger(exit.exitCode) || typeof exit.signal === 'string');
  }
  for (const [index, ack] of [owner.firstAck, owner.secondAck].entries()) {
    assert(launches[index].pid === ack.childPid && launches[index].gatewayGeneration === ack.gatewayGeneration,
      'Runtime acknowledgement does not match its observed launch');
  }
  assert.notEqual(owner.firstAck.gatewayGeneration, owner.secondAck.gatewayGeneration);
  assert.notEqual(owner.firstAck.childPid, owner.secondAck.childPid);
  return launches;
}

async function collect({ outputDir, markerPath = path.join(outputDir, 'electron-process-run.json'), ownerPath, candidate, actor, entry, processHelper, startedAt, finishedAt }) {
  const marker = read(markerPath);
  const ledgerPath = path.join(marker.runRoot, LEDGER);
  const events = fs.readFileSync(ledgerPath, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const expected = { candidate, actor, runRoot: marker.runRoot, entry, entrySha256: sha(entry),
    startedAt: Date.parse(startedAt), finishedAt: Date.parse(finishedAt) };
  const launches = validateLedger(events, read(ownerPath), expected);
  const identities = launches.map(({ pid, creationTime }) => ({ pid, creationTime }));
  const checks = await require(processHelper).checkWindowsProcesses(identities);
  assert(checks.every(row => ['exited', 'replaced'].includes(row.status)), 'Gateway process exit is unresolved');
  const cleanupPath = path.join(outputDir, 'node-gateway-process-cleanup.json');
  assert(!fs.existsSync(cleanupPath), 'Fresh Node cleanup receipt required');
  const cleanup = { schema: 'NodeGatewayProcessCleanup/v1', driven_by: 'agent', actor, realHumanEvidence: false,
    candidate, runRoot: marker.runRoot, processKind: 'node-gateway', status: 'passed',
    ledgerEntries: launches.length, checks, remaining: [], survivors: [], unavailable: [], pendingLaunches: 0,
    owner: ref(ownerPath), ledger: ref(ledgerPath), observer: ref(__filename), nativeChecker: ref(processHelper),
    inputs: launches.map(row => row.inputConfig),
    checkedAt: new Date().toISOString() };
  fs.writeFileSync(cleanupPath, JSON.stringify(cleanup, null, 2) + '\n', { flag: 'wx' });
  return { processKind: 'node-gateway', cleanup: ref(cleanupPath), runMarker: ref(markerPath), ledger: ref(ledgerPath),
    ledgerEntries: launches.length, firstCreationTime: Math.min(...launches.map(row => row.creationTime)),
    observer: ref(__filename), nativeChecker: ref(processHelper), inputs: launches.map(row => row.inputConfig) };
}

function install(config) {
  assert.equal(process.platform, 'win32', 'Native Gateway observation requires Windows');
  const spawn = cp.spawn;
  cp.spawn = function(command, args, options) {
    if (!Array.isArray(args) || normalize(String(command)) !== normalize(process.execPath)
      || normalize(args[0] || '.') !== normalize(config.entry) || args[1] !== 'gateway' || args[2] !== 'run') return spawn.apply(this, arguments);
    const env = options?.env ?? process.env;
    const runRoot = process.env.CLAWX_E2E_RUN_ROOT;
    const marker = read(config.runMarker);
    assert(runRoot && normalize(runRoot) === normalize(marker.runRoot), 'Observer run identity mismatch');
    const child = spawn.apply(this, arguments);
    const ledgerPath = path.join(runRoot, LEDGER);
    const identity = { schema: 'NodeGatewayProcessObservation/v1', driven_by: 'agent', actor: config.actor,
      realHumanEvidence: false, candidate: config.candidate, runRoot, gatewayGeneration: env.VERSE_CLAW_GATEWAY_GENERATION };
    const append = row => fs.appendFileSync(ledgerPath, JSON.stringify({ ...identity, ...row, at: new Date().toISOString() }) + '\n');
    child.once('spawn', () => {
      try {
        assert(identity.gatewayGeneration, 'Gateway generation is required');
        const creationTime = captureCreationTime(child.pid);
        assert.equal(child.exitCode, null, 'Gateway exited before identity capture completed');
        assert.equal(child.signalCode, null, 'Gateway was signalled before identity capture completed');
        Object.assign(identity, { pid: child.pid, creationTime });
        const inputPath = path.join(runRoot, `node-gateway-config-${child.pid}-${creationTime}.json`);
        fs.copyFileSync(env.OPENCLAW_CONFIG_PATH, inputPath, fs.constants.COPYFILE_EXCL);
        const configSha256 = sha(env.OPENCLAW_CONFIG_PATH);
        assert.equal(sha(inputPath), configSha256, 'Gateway config changed while being captured');
        append({ event: 'launch', entry: path.resolve(args[0]), entrySha256: sha(args[0]),
          command: [command, ...args], configPath: env.OPENCLAW_CONFIG_PATH, configSha256, inputConfig: ref(inputPath) });
      } catch (error) { append({ event: 'observation-error', pid: child.pid, error: String(error) }); }
    });
    child.once('exit', (exitCode, signal) => append({ event: 'exit', exitCode, signal }));
    child.once('error', error => append({ event: 'spawn-error', error: String(error) }));
    return child;
  };
  require('node:module').syncBuiltinESMExports();
}

async function runRuntimeReadiness(output) {
  assert.equal(process.platform, 'win32', 'Runtime evidence requires Windows');
  const root = process.cwd();
  const git = args => cp.execFileSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8' }).trim();
  const source = () => ({ head: git(['rev-parse', 'HEAD']), tree: git(['rev-parse', 'HEAD^{tree}']), dirty: git(['status', '--porcelain']) });
  const before = source();
  assert.equal(before.dirty, '', 'Freeze the test candidate before running');
  const outputDir = path.resolve(output || path.join('D:/tmp', 'g5-node-runtime-' + crypto.randomUUID()));
  assert.equal(path.parse(outputDir).root.toLowerCase(), path.parse('D:/tmp').root.toLowerCase(), 'Runtime output must be on D:');
  assert(!fs.existsSync(outputDir), 'Fresh Runtime evidence directory required');
  fs.mkdirSync(outputDir, { recursive: true });
  const actor = 'codex/g5-node-process-observer';
  const resultsDir = path.join(outputDir, 'test-results');
  const ownerPath = path.join(outputDir, 'runtime-owner.json');
  const reportPath = path.join(outputDir, 'playwright.json');
  const runMarker = path.join(resultsDir, 'electron-process-run.json');
  const configPath = path.join(outputDir, 'node-observer-config.json');
  const entry = path.join(root, 'openclaw_runtime/dist/entry.js');
  const runtimeEntry = ref(entry);
  fs.writeFileSync(configPath, JSON.stringify({ candidate: before.head, actor, entry, runMarker }, null, 2) + '\n');
  const args = [path.join(root, 'node_modules/@playwright/test/cli.js'), 'test',
    'tests/e2e/autonomy-runtime-readiness.spec.ts', '--workers=1', '--retries=0', '--reporter=list,json', '--output=' + resultsDir];
  const startedAt = new Date().toISOString();
  const logPath = path.join(outputDir, 'command.log');
  const fd = fs.openSync(logPath, 'wx');
  let exitCode, signal, spawnError;
  try {
    [exitCode, signal] = await new Promise(resolve => {
      const child = cp.spawn(process.execPath, args, { cwd: root, windowsHide: true, stdio: ['ignore', fd, fd], env: {
        ...process.env, TEMP: 'D:/tmp', TMP: 'D:/tmp', TMPDIR: 'D:/tmp',
        CLAWX_A5_NODE_OBSERVER_CONFIG: configPath, CLAWX_A5_RUNTIME_RECEIPT: ownerPath,
        CLAWX_E2E_CANDIDATE: before.head, CLAWX_TEST_CANDIDATE: before.head, CLAWX_E2E_KEEP_TEMP: '1',
        CLAWX_E2E_RUN_ROOT_BASE: path.join(outputDir, 'run-roots'),
        PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath,
        NODE_OPTIONS: (process.env.NODE_OPTIONS || '') + ' --require=' + JSON.stringify(__filename.replace(/\\/g, '/')),
      } });
      child.once('error', error => { spawnError = String(error); });
      child.once('close', (code, cause) => resolve([code, cause]));
    });
  } finally { fs.closeSync(fd); }
  const finishedAt = new Date().toISOString();
  const receipt = { schema: 'NodeGatewayReadinessRun/v1', driven_by: 'agent', actor, realHumanEvidence: false,
    candidate: before.head, tree: before.tree, command: [process.execPath, ...args], startedAt, finishedAt,
    exitCode, signal, before, after: source(), log: ref(logPath), observer: ref(__filename), config: ref(configPath),
    runtimeEntry, provider: 'scripted local provider', ...(spawnError ? { spawnError } : {}) };
  try {
    assert.equal(exitCode, 0, spawnError || 'Runtime readiness test failed');
    assert.deepEqual(receipt.after, before, 'Runtime test source changed');
    assert.equal(sha(entry), runtimeEntry.sha256, 'Runtime entry changed during the test');
    const report = read(reportPath);
    assert.equal(report.stats.expected, 1);
    assert.equal(report.stats.unexpected + report.stats.skipped + report.stats.flaky, 0);
    assert.deepEqual(report.errors || [], []);
    const attachments = [];
    const visit = suite => {
      for (const spec of suite.specs || []) for (const test of spec.tests || []) {
        assert.equal(test.results.length, 1);
        assert.equal(test.results[0].status, 'passed');
        attachments.push(...(test.results[0].attachments || []));
      }
      for (const child of suite.suites || []) visit(child);
    };
    report.suites.forEach(visit);
    assert(attachments.some(item => item.path && sha(item.path) === sha(ownerPath)), 'Runtime owner content is not attached');
    receipt.tests = ref(reportPath);
    receipt.owner = ref(ownerPath);
    receipt.native = await collect({ outputDir, markerPath: runMarker, ownerPath, candidate: before.head, actor, entry,
      processHelper: path.join(root, 'tests/e2e/fixtures/windows-process.ts'), startedAt, finishedAt });
    receipt.status = 'passed';
  } catch (error) {
    receipt.status = 'failed'; receipt.validationError = String(error);
    if (fs.existsSync(reportPath)) receipt.tests = ref(reportPath);
    process.exitCode = 1;
  }
  const receiptPath = path.join(outputDir, 'receipt.json');
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: receipt.status, candidate: before.head, exitCode, receipt: receiptPath,
    ledgerEntries: receipt.native?.ledgerEntries, validationError: receipt.validationError }));
}

module.exports = { LEDGER, validateLedger, collect, captureCreationTime, runRuntimeReadiness };
if (process.env.CLAWX_A5_NODE_OBSERVER_CONFIG) install(read(process.env.CLAWX_A5_NODE_OBSERVER_CONFIG));
if (require.main === module && process.argv[2] === '--run') {
  runRuntimeReadiness(process.argv[3]).catch(error => { console.error(error); process.exitCode = 1; });
}
