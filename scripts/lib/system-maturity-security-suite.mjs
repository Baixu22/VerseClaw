import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { runReleaseGateCommand } from './run-release-gate-command.mjs';

const ALLOWED_PRIORITIES = new Set(['P0', 'P1']);
const REQUIRED_FULL_KINDS = new Set(['comms-replay', 'comms-compare', 'electron-e2e']);

function normalize(value) {
  const text = String(value || '').replace(/\r\n?/gu, '\n').replace(/[\t ]+$/gmu, '').replace(/\n*$/u, '');
  return text ? `${text}\n` : '';
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function safeName(value) {
  return value.replace(/[^a-zA-Z0-9_.-]+/gu, '-');
}

export function validateSecuritySuiteManifest({ root, manifest }) {
  const errors = [];
  if (manifest.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!Array.isArray(manifest.scenarios) || manifest.scenarios.length === 0) errors.push('scenarios must be non-empty');
  if (!Array.isArray(manifest.commands) || manifest.commands.length === 0) errors.push('commands must be non-empty');
  const commands = new Map();
  for (const command of manifest.commands || []) {
    if (!command.id) errors.push('command missing id');
    else if (commands.has(command.id)) errors.push(`duplicate command ${command.id}`);
    else commands.set(command.id, command);
    if (!command.run) errors.push(`command ${command.id || '(unknown)'} missing run`);
    if (!Array.isArray(command.modes) || command.modes.length === 0) errors.push(`command ${command.id || '(unknown)'} missing modes`);
  }
  const scenarioIds = new Set();
  for (const scenario of manifest.scenarios || []) {
    if (!scenario.id) errors.push('scenario missing id');
    else if (scenarioIds.has(scenario.id)) errors.push(`duplicate scenario ${scenario.id}`);
    else scenarioIds.add(scenario.id);
    if (!ALLOWED_PRIORITIES.has(scenario.priority)) errors.push(`scenario ${scenario.id} invalid priority ${scenario.priority}`);
    if (!scenario.owner) errors.push(`scenario ${scenario.id} missing owner`);
    if (!Array.isArray(scenario.findings) || scenario.findings.length === 0) errors.push(`scenario ${scenario.id} missing Findings`);
    if (!Array.isArray(scenario.commandIds) || scenario.commandIds.length === 0) errors.push(`scenario ${scenario.id} missing commandIds`);
    for (const commandId of scenario.commandIds || []) {
      const command = commands.get(commandId);
      if (!command) errors.push(`scenario ${scenario.id} references missing command ${commandId}`);
      else if (!command.modes.includes('pr')) errors.push(`P0/P1 scenario ${scenario.id} command ${commandId} is not runnable in pr mode`);
    }
    if (!Array.isArray(scenario.testFiles) || scenario.testFiles.length === 0) errors.push(`scenario ${scenario.id} missing testFiles`);
    for (const testFile of scenario.testFiles || []) {
      if (!fs.existsSync(path.join(root, testFile))) errors.push(`scenario ${scenario.id} missing test file ${testFile}`);
      else if (!(scenario.commandIds || []).some((commandId) => {
        const run = commands.get(commandId)?.run || '';
        const commandRelative = testFile.replace(/^openclaw_runtime\//u, '');
        return run.includes(testFile) || run.includes(commandRelative);
      })) {
        errors.push(`scenario ${scenario.id} test file is not executed by its commands: ${testFile}`);
      }
    }
    if (!scenario.expected) errors.push(`scenario ${scenario.id} missing expected fail-closed behavior`);
  }
  const fullKinds = new Set((manifest.commands || []).filter((command) => command.modes?.includes('full')).map((command) => command.kind));
  for (const kind of REQUIRED_FULL_KINDS) {
    if (!fullKinds.has(kind)) errors.push(`full mode missing required command kind ${kind}`);
  }
  return errors;
}

export function planSecuritySuite({ root, manifest, mode }) {
  const errors = validateSecuritySuiteManifest({ root, manifest });
  if (!manifest.modes?.includes(mode)) errors.push(`unsupported mode ${mode}`);
  const scenarios = (manifest.scenarios || []).filter((scenario) => scenario.commandIds.some((id) => {
    const command = manifest.commands.find((candidate) => candidate.id === id);
    return command?.modes?.includes(mode);
  }));
  const commands = (manifest.commands || []).filter((command) => command.modes?.includes(mode));
  if (!scenarios.length) errors.push(`mode ${mode} selected no scenarios`);
  if (!commands.length) errors.push(`mode ${mode} selected no commands`);
  return { mode, scenarios, commands, errors };
}

export function runSecuritySuite({ root, manifest, mode, outDir, runCommand = runReleaseGateCommand }) {
  const plan = planSecuritySuite({ root, manifest, mode });
  fs.mkdirSync(path.join(outDir, 'gates'), { recursive: true });
  const commandResults = [];
  if (plan.errors.length === 0) {
    for (const command of plan.commands) {
      const startedAt = new Date().toISOString();
      const started = Date.now();
      const result = runCommand(command.run, {
        cwd: root,
        env: process.env,
        timeout: 60 * 60 * 1000,
        maxBuffer: 256 * 1024 * 1024,
      });
      const stdout = normalize(result.stdout);
      const stderr = normalize([result.stderr || '', result.error ? `${result.error.stack || result.error}\n` : ''].join(''));
      const name = safeName(command.id);
      const stdoutPath = `gates/${name}.stdout.txt`;
      const stderrPath = `gates/${name}.stderr.txt`;
      fs.writeFileSync(path.join(outDir, stdoutPath), stdout);
      fs.writeFileSync(path.join(outDir, stderrPath), stderr);
      commandResults.push({
        id: command.id,
        kind: command.kind,
        run: command.run,
        startedAt,
        durationMs: Date.now() - started,
        exitCode: result.status ?? 1,
        signal: result.signal || null,
        spawnError: result.error?.message || null,
        stdoutPath,
        stdoutSha256: sha256(stdout),
        stderrPath,
        stderrSha256: sha256(stderr),
      });
    }
  }
  const failedCommandIds = commandResults.filter((result) => result.exitCode !== 0).map((result) => result.id);
  const report = {
    schemaVersion: 1,
    task: 'P7-002',
    generatedAt: new Date().toISOString(),
    mode,
    ok: plan.errors.length === 0 && commandResults.length === plan.commands.length && failedCommandIds.length === 0,
    scenarioIds: plan.scenarios.map((scenario) => scenario.id),
    findingIds: [...new Set(plan.scenarios.flatMap((scenario) => scenario.findings))].sort(),
    commands: commandResults,
    failedCommandIds,
    errors: plan.errors,
  };
  fs.writeFileSync(path.join(outDir, 'security-regression-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export function validateSecuritySuiteReport({ root, outDir, report }) {
  const errors = [];
  if (report.ok !== true) errors.push('report is not successful');
  if (!Array.isArray(report.scenarioIds) || report.scenarioIds.length === 0) errors.push('report has no scenarios');
  if (!Array.isArray(report.commands) || report.commands.length === 0) errors.push('report has no commands');
  for (const command of report.commands || []) {
    if (command.exitCode !== 0) errors.push(`command ${command.id} exit=${command.exitCode}`);
    for (const stream of ['stdout', 'stderr']) {
      const relativePath = command[`${stream}Path`];
      const expected = command[`${stream}Sha256`];
      const absolute = path.join(outDir, relativePath || '');
      if (!relativePath || !fs.existsSync(absolute)) errors.push(`command ${command.id} missing ${stream}`);
      else if (sha256(fs.readFileSync(absolute)) !== expected) errors.push(`command ${command.id} ${stream} hash mismatch`);
    }
  }
  return errors;
}
