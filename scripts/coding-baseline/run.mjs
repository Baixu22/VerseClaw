import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { PROBE_FILES, boundInputPaths, evaluateFindings, readWithin, sha256, verifyEvidence } from './verify.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { values: args } = parseArgs({ options: {
  help: { type: 'boolean' }, out: { type: 'string' }, 'vg-root': { type: 'string' },
  python: { type: 'string' }, 'sts-wheel': { type: 'string' }, httpx: { type: 'string' }, packaging: { type: 'string' },
} });
if (args.help) {
  console.log('Usage: node scripts/coding-baseline/run.mjs --out <NEW directory> --vg-root <frozen VG checkout> --python <STS interpreter> --sts-wheel <wheel built from VG pin> --httpx <pinned clean checkout> --packaging <pinned clean checkout>');
  console.log('Windows mechanism baseline only. Does not run providers, selected/full performance trials, package E2E or fix product bugs.');
  process.exit(0);
}
for (const key of ['out', 'vg-root', 'python', 'sts-wheel', 'httpx', 'packaging']) {
  if (!args[key] || !path.isAbsolute(args[key])) throw new Error(`--${key} must be an absolute path`);
}
if (process.platform !== 'win32') throw new Error('This baseline includes Windows junction and read-only-file oracles');
const git = (argv, cwd = root) => execFileSync('git', argv, { cwd, encoding: 'utf8', windowsHide: true, timeout: 20_000, maxBuffer: 16 * 1024 * 1024 }).trim();
const candidate = { commit: git(['rev-parse', 'HEAD']), tree: git(['rev-parse', 'HEAD^{tree}']), dirty: git(['status', '--porcelain', '--untracked-files=all']).length > 0 };
if (candidate.dirty) throw new Error('Commit the baseline driver and its inputs before measuring; no dirty-candidate acceptance');
const out = path.resolve(args.out);
if (fs.existsSync(out)) throw new Error('Output exists; use a fresh run directory to preserve previous evidence');
const outRelative = path.relative(root, out);
if (!path.isAbsolute(outRelative) && outRelative !== '..' && !outRelative.startsWith(`..${path.sep}`)) {
  try { git(['check-ignore', path.join(outRelative, 'report.json')]); }
  catch { throw new Error('In-worktree output must be ignored; choose .audit/<new-run> or an external D: scratch directory'); }
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.mkdirSync(out);
const commands = [];
function run(name, binary, argv, { cwd = root, env = {}, timeout = 180_000, probe } = {}) {
  const start = Date.now();
  const result = spawnSync(binary, argv, { cwd, env: { ...process.env, TEMP: process.env.TEMP, TMP: process.env.TMP, ...env }, encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024 });
  const record = { name, ...(probe ? { probe } : {}), executable: binary, argv, cwd,
    exitCode: result.status, signal: result.signal, timedOut: result.error?.code === 'ETIMEDOUT',
    durationMs: Date.now() - start, ...(result.error ? { error: result.error.message } : {}) };
  commands.push(record);
  fs.writeFileSync(path.join(out, `${name}.stdout.log`), result.stdout ?? '');
  fs.writeFileSync(path.join(out, `${name}.stderr.log`), result.stderr ?? '');
  fs.writeFileSync(path.join(out, 'commands.json'), JSON.stringify(commands, null, 2));
  if (result.status !== 0 || result.error) throw new Error(`${name} failed (${result.status}); inspect retained output in ${out}`);
  return (result.stdout ?? '').trim();
}
const json = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const stamp = (p) => { const bytes = fs.readFileSync(p); return { sha256: sha256(bytes), bytes: bytes.length }; };
const fixture = path.join(root, 'harness/specs/fixtures/coding-vg-sts-jj-baseline');
const protocol = json(path.join(fixture, 'evaluation-protocol.json'));
const historical = json(path.join(fixture, 'historical-inputs.json'));
const sourceInputs = boundInputPaths(root).map((p) => ({ path: p, ...stamp(path.join(root, p)) }));
try {
  for (const p of ['resources/bin/win32-x64/vg.exe', 'resources/bin/win32-x64/ae.exe']) {
    if (!fs.existsSync(path.join(root, p))) throw new Error(`Required frozen binary is absent: ${p}; provision and verify it before running`);
  }
  const probes = {};
  for (const [name, resultPath] of Object.entries(PROBE_FILES)) {
    const probeOut = path.join(out, name);
    fs.mkdirSync(probeOut);
    run(`probe-${name}`, process.execPath, [
      '--import', pathToFileURL(path.join(root, 'openclaw_runtime/node_modules/tsx/dist/loader.mjs')).href,
      path.join(root, `scripts/coding-baseline/probes/${name}.mts`),
    ], { probe: name, timeout: protocol.budgets.probeSeconds * 1000,
      env: { CODING_BASELINE_OUTPUT: probeOut, TSX_TSCONFIG_PATH: path.join(root, 'openclaw_runtime/tsconfig.json') } });
    probes[name] = json(path.join(out, resultPath));
  }

  const vgManifest = json(path.join(root, 'resources/versegit/manifest.json'));
  const vsManifest = json(path.join(root, 'resources/verseshell/manifest.json'));
  const vgBinary = path.join(root, vgManifest.artifact.devPath);
  const vsArtifact = vsManifest.artifacts['win32-x64'];
  const vsBinary = path.join(root, vsArtifact.path);
  const vgIdentity = stamp(vgBinary), vsIdentity = stamp(vsBinary);
  if (vgIdentity.sha256 !== vgManifest.artifact.sha256 || vsIdentity.sha256 !== vsArtifact.sha256) throw new Error('Binary digest differs from the pinned manifest');
  const vgRoot = path.resolve(args['vg-root']);
  if (git(['rev-parse', 'HEAD'], vgRoot) !== vgManifest.source.commit) throw new Error('VG source checkout differs from pinned binary source');
  if (git(['diff', 'HEAD', '--name-only', '--', 'extensions/sts', 'crates/vg-jj', 'Cargo.lock'], vgRoot)) throw new Error('Bound VG/STS/JJ source has uncommitted changes');
  const contracts = ['v1', 'v2'].map((version) => {
    const dir = path.join(vgRoot, 'extensions/sts/contracts/vg-sts', version);
    const manifest = json(path.join(dir, 'manifest.json'));
    const digests = manifest.digests;
    const invalid = [];
    const entries = Object.entries(digests).filter(([key]) => key !== 'algorithm');
    for (const [relative, expected] of entries) {
      if (`sha256:${sha256(readWithin(dir, relative))}` !== expected) invalid.push(relative);
    }
    return { version: manifest.protocol_version, manifest: stamp(path.join(dir, 'manifest.json')), declaredFiles: entries.length, invalid };
  });
  const environment = JSON.parse(run('sts-environment', args.python, ['-I', '-B', '-m', 'smart_sorter.environment'], { cwd: out }));
  const installation = JSON.parse(run('sts-installation', args.python, ['-I', '-B', '-c', [
    'import sys,json,hashlib,importlib.metadata as m,smart_sorter',
    'from pathlib import Path',
    'd=m.distribution("smart-test-sorter")',
    'print(json.dumps({"pythonExecutable":sys.executable,"version":d.version,"module":str(Path(smart_sorter.__file__).resolve()),"moduleSha256":hashlib.sha256(Path(smart_sorter.__file__).read_bytes()).hexdigest(),"metadataSha256":hashlib.sha256(d.read_text("METADATA").encode()).hexdigest(),"installedDistributions":sorted((x.metadata["Name"],x.version) for x in m.distributions())}))',
  ].join('\n')], { cwd: out }));
  const wheelBinding = JSON.parse(run('sts-wheel-binding', args.python, ['-I', '-B', path.join(root, 'scripts/coding-baseline/inspect-wheel.py'), vgRoot, args['sts-wheel']], { cwd: out }));
  const stsSource = git(['ls-files', '-z', '--', 'extensions/sts/src', 'extensions/sts/contracts', 'extensions/sts/pyproject.toml', 'extensions/sts/setup.py', 'extensions/sts/requirements-dev.txt'], vgRoot)
    .split('\0').filter(Boolean).map((p) => ({ path: p, ...stamp(path.join(vgRoot, p)) }));
  const cargoLock = fs.readFileSync(path.join(vgRoot, 'Cargo.lock'), 'utf8');
  const libraryVersion = cargoLock.match(/name = "jj-lib"\r?\nversion = "([^"]+)"/)?.[1];
  const inventory = {
    driven_by: 'agent', actor: 'codex-coding-c0-builder', realHumanEvidence: false,
    vg: { binary: vgIdentity, binaryMatchesManifest: true, sourceCommit: vgManifest.source.commit,
      capabilities: JSON.parse(run('vg-capabilities', vgBinary, ['capabilities', '--json'], { cwd: out })),
      nativeCapabilityIsHostPermission: false },
    vs: { binary: vsIdentity, binaryMatchesManifest: true, versionObservation: run('vs-version', vsBinary, ['--version'], { cwd: out }),
      source: vsManifest.upstream, protocol: vsManifest.protocol, sourceIdentity: vsManifest.build?.source_identity_sha256 ?? null,
      governedProcessTrial: 'not-run; TF-0777' },
    sts: { sourceCommit: vgManifest.source.commit, sourceInputs: stsSource, contracts, environment, installation,
      wheel: { ...stamp(args['sts-wheel']), filename: path.basename(args['sts-wheel']), sourceCommit: vgManifest.source.commit, binding: wheelBinding, installationTest: 'not-run; TF-0778' },
      supportedSelectionRunner: 'pytest', defaultSelection: false, selectionPerformance: 'not-run; TF-0778' },
    jj: { libraryVersion, cargoLock: stamp(path.join(vgRoot, 'Cargo.lock')), cliClaim: 'not-executed',
      oracleRequirement: 'TF-0776 must provision and pin the independent jj 0.46.0 oracle before parity measurements; absence is not parity' },
    corpus: protocol.corpus.map((p) => {
      if (p.id === 'clawx-typescript') return { ...p, observedTree: git(['rev-parse', `${p.commit}^{tree}`]), verified: true, testRun: 'not-run; input identity only' };
      const dir = args[p.id];
      const commit = git(['rev-parse', 'HEAD'], dir), tree = git(['rev-parse', 'HEAD^{tree}'], dir), dirty = git(['status', '--porcelain'], dir);
      return { ...p, observedCommit: commit, observedTree: tree, verified: commit === p.commit && tree === p.tree && dirty === '', testRun: 'not-run; TF-0778' };
    }),
    capabilities: json(path.join(fixture, 'capabilities.json')),
    dependencies: { node: process.version, rootModules: fs.realpathSync(path.join(root, 'node_modules')),
      runtimeModules: fs.realpathSync(path.join(root, 'openclaw_runtime/node_modules')), freshInstall: false,
      resourceBuild: 'not-run; prebuilt VG/VS binaries are accepted only after matching the tracked manifest digests' },
  };
  fs.writeFileSync(path.join(out, 'inventory.json'), JSON.stringify(inventory, null, 2));
  const historicalComparison = Object.entries(historical.sourceStamps).map(([p, v]) => ({ path: p, historicalSha256: v.sha256, currentSha256: stamp(path.join(root, p)).sha256, unchanged: stamp(path.join(root, p)).sha256 === v.sha256 }));
  fs.writeFileSync(path.join(out, 'historical-comparison.json'), JSON.stringify({ historicalCandidate: historical.candidate, currentCandidate: candidate.commit, currentProbesRerun: true, inputs: historicalComparison }, null, 2));
  const artifactNames = [...Object.values(PROBE_FILES), 'inventory.json', 'historical-comparison.json', 'commands.json',
    ...commands.flatMap((c) => [`${c.name}.stdout.log`, `${c.name}.stderr.log`])];
  const report = { schema: 'CodingBaselineEvidence/v1', taskId: 'TF-0764', driven_by: 'agent', actor: 'codex-coding-c0-builder', realHumanEvidence: false,
    recordedAt: new Date().toISOString(), candidate, sourceInputs, commands, artifacts: Object.fromEntries(artifactNames.map((p) => [p, stamp(path.join(out, p))])),
    findings: evaluateFindings(probes), baselineVerdict: 'established', productVerdict: 'needs-fix', releaseApproved: false,
    protocolScope: 'mechanism-baseline-not-performance-or-live-quality',
  };
  if (git(['status', '--porcelain', '--untracked-files=all'])) throw new Error('Worktree changed during baseline execution');
  const result = verifyEvidence(report, { readArtifact: (p) => readWithin(out, p), readSource: (p) => readWithin(root, p), requiredSources: boundInputPaths(root), expectedCandidate: candidate.commit });
  if (!result.ok) report.baselineVerdict = 'invalid';
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(out, 'verification.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ out, candidate: candidate.commit, findings: report.findings, verification: result }, null, 2));
  process.exitCode = result.ok ? 0 : 1;
} catch (error) {
  fs.writeFileSync(path.join(out, 'failure.json'), JSON.stringify({ driven_by: 'agent', candidate, baselineVerdict: 'invalid', error: String(error), commands }, null, 2));
  throw error;
}
