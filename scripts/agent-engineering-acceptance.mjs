#!/usr/bin/env node

import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createAcceptancePlan,
  defaults,
  sealReport,
  loadManifest,
  readAcceptanceStatus,
  runAcceptance,
  verifyAcceptance,
  writePlan,
} from './lib/agent-engineering-acceptance.mjs';

const repositoryRoot = defaults.repositoryRoot;

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') continue;
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    index += 1;
    if (key === 'changed') {
      args.changed = [...(Array.isArray(args.changed) ? args.changed : []), next];
    } else {
      args[key] = next;
    }
  }
  return args;
}

function printUsage() {
  console.log([
    'Usage:',
    '  pnpm acceptance:agent:plan --spec <path> [--since <ref>] [--changed <path,...>] [--output-dir <dir>]',
    '  pnpm acceptance:agent:run --manifest <path> [--actor <id>] [--output-dir <dir>]',
    '  pnpm acceptance:agent:verify --manifest <path> [--actor <id>] [--executor-report <path>] [--output-dir <dir>]',
    '  pnpm acceptance:agent:full --spec <path> [--executor <id>] [--verifier <id>] [--since <ref>] [--output-dir <dir>]',
    '  pnpm acceptance:agent:status [--output-dir <dir>]',
  ].join('\n'));
}

function rootFrom(args) {
  return resolve(args.root || repositoryRoot);
}

function splitChanged(args) {
  if (!Array.isArray(args.changed)) return undefined;
  return args.changed
    .flatMap((value) => String(value).split(','))
    .map((value) => value.trim())
    .filter(Boolean);
}

function outputDirFrom(args, root, runId) {
  return resolve(args['output-dir'] || join(root, 'artifacts', 'agent-engineering-acceptance', 'runs', runId));
}

function manifestPathFrom(args, root) {
  if (args.manifest) return resolve(args.manifest);
  if (args['output-dir']) return join(resolve(args['output-dir']), 'manifest.json');
  throw new Error('--manifest or --output-dir is required');
}

function summary(report) {
  return {
    schema: report.schema,
    runId: report.runId,
    role: report.role,
    result: report.result,
    engineeringAcceptedByAgent: report.engineeringAcceptedByAgent === true,
    taskStatusRecommendation: report.taskStatusRecommendation,
    humanEvidenceRequired: report.humanEvidenceRequired === true,
    failures: report.failures ?? [],
  };
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function readManifestFile(pathValue) {
  if (!existsSync(pathValue)) throw new Error(`manifest not found: ${pathValue}`);
  return loadManifest(pathValue);
}

function runPlan(args) {
  if (!args.spec) throw new Error('plan requires --spec');
  const root = rootFrom(args);
  const manifest = createAcceptancePlan({
    root,
    specPath: args.spec,
    since: args.since,
    changedPaths: splitChanged(args),
    mode: args.mode || 'full',
  });
  const outputDir = outputDirFrom(args, root, manifest.runId);
  writePlan(outputDir, manifest);
  printJson({
    schema: manifest.schema,
    runId: manifest.runId,
    manifestPath: join(outputDir, 'manifest.json'),
    manifestDigest: manifest.manifestDigest,
    candidate: manifest.candidate,
    changedPaths: manifest.changedPaths,
    coverage: manifest.coverage,
    requiredProfiles: manifest.requiredProfiles,
    gateCount: manifest.gates.length,
    eligibility: manifest.eligibility,
    residuals: manifest.residuals,
  });
  return 0;
}

function runExecutor(args) {
  const root = rootFrom(args);
  const manifestPath = manifestPathFrom(args, root);
  const manifest = readManifestFile(manifestPath);
  const outputDir = outputDirFrom(args, root, manifest.runId);
  const report = runAcceptance(manifest, {
    sourceRoot: root,
    outputDir,
    role: 'executor',
    actor: args.actor || 'executor-agent',
    continueOnError: Boolean(args['continue-on-error']),
  });
  printJson(summary(report));
  return report.result === 'pass' ? 0 : 1;
}

function runVerifier(args) {
  const root = rootFrom(args);
  const manifestPath = manifestPathFrom(args, root);
  const manifest = readManifestFile(manifestPath);
  const outputDir = outputDirFrom(args, root, manifest.runId);
  const report = verifyAcceptance(manifest, {
    sourceRoot: root,
    outputDir,
    actor: args.actor || 'verifier-agent',
    executorReportPath: args['executor-report'] ? resolve(args['executor-report']) : join(outputDir, 'executor-report.json'),
  });
  printJson(summary(report));
  return report.result === 'pass' && report.engineeringAcceptedByAgent === true ? 0 : 1;
}

function runFull(args) {
  if (!args.spec) throw new Error('full requires --spec');
  const root = rootFrom(args);
  const manifest = createAcceptancePlan({
    root,
    specPath: args.spec,
    since: args.since,
    changedPaths: splitChanged(args),
    mode: args.mode || 'full',
  });
  const outputDir = outputDirFrom(args, root, manifest.runId);
  writePlan(outputDir, manifest);
  const executor = runAcceptance(manifest, {
    sourceRoot: root,
    outputDir,
    role: 'executor',
    actor: args.executor || 'executor-agent',
    continueOnError: true,
  });
  if (executor.result !== 'pass') {
    // A failed executor run must still be observable through `status`: persist a
    // final report so the run shows up with NO-GO instead of disappearing.
    const finalReport = {
      ...executor,
      conclusion: {
        ...executor.conclusion,
        verifierRequired: true,
        allowedPromotion: false,
        engineeringAcceptedByAgent: false,
      },
      failures: [...(executor.failures ?? []), 'executor did not pass; verifier rerun not attempted'],
      reportDigest: undefined,
    };
    sealReport(finalReport);
    writeFileSync(join(outputDir, 'final-report.json'), `${JSON.stringify(finalReport, null, 2)}\n`);
    printJson({ plan: { runId: manifest.runId, manifestDigest: manifest.manifestDigest }, executor: summary(executor) });
    return 1;
  }
  const verifier = verifyAcceptance(manifest, {
    sourceRoot: root,
    outputDir,
    actor: args.verifier || 'verifier-agent',
    executorReport: executor,
  });
  printJson({ plan: { runId: manifest.runId, manifestDigest: manifest.manifestDigest }, executor: summary(executor), verifier: summary(verifier) });
  return verifier.result === 'pass' && verifier.engineeringAcceptedByAgent === true ? 0 : 1;
}

function runStatus(args) {
  const root = rootFrom(args);
  const outputDir = resolve(args['output-dir'] || join(root, 'artifacts', 'agent-engineering-acceptance'));
  printJson(readAcceptanceStatus(outputDir));
  return 0;
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const command = args._[0];
  if (!command || args.help) {
    printUsage();
    return 0;
  }
  try {
    if (command === 'plan') return runPlan(args);
    if (command === 'run') return runExecutor(args);
    if (command === 'verify') return runVerifier(args);
    if (command === 'full') return runFull(args);
    if (command === 'status') return runStatus(args);
    printUsage();
    return 1;
  } catch (error) {
    console.error(`NO-GO: ${error?.message ?? String(error)}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main();
}
