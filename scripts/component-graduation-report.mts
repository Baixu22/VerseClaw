#!/usr/bin/env -S pnpm --dir openclaw_runtime exec tsx
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  COMPONENT_AUTHORITY_MANIFEST,
  type ComponentAuthorityDefaultMode,
} from '../shared/component-authority-manifest.js';
import {
  canonicalGraduationArtifactInput,
  evaluateComponentGraduationGate,
  type ComponentGraduationReport,
  type GraduationArtifactRef,
  type GraduationArtifactResolution,
  type GraduationTaskForestNode,
  type GraduationValidationExpectation,
} from '../shared/component-graduation-report.js';

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function createDiskArtifactResolver(root = process.cwd()): (artifact: GraduationArtifactRef) => GraduationArtifactResolution {
  return (artifact) => {
    const absolute = path.resolve(root, artifact.path);
    const relative = path.relative(root, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !existsSync(absolute)) return { status: 'missing' };
    const bytes = readFileSync(absolute);
    if (bytes.length !== artifact.bytes || sha256(bytes) !== artifact.sha256) return { status: 'hash-mismatch' };
    return { status: 'match', content: bytes.toString('utf8') };
  };
}

export type GraduationGateRunResult = ReturnType<typeof evaluateComponentGraduationGate> & {
  reportPath: string;
  expected: GraduationValidationExpectation;
  currentDefaultMode: ComponentAuthorityDefaultMode | null;
};

export function runComponentGraduationGate(input: {
  reportPath: string;
  root?: string;
  expected?: GraduationValidationExpectation;
  currentDefaultMode?: ComponentAuthorityDefaultMode | null;
  taskForestNode?: GraduationTaskForestNode;
}): GraduationGateRunResult {
  const root = path.resolve(input.root ?? DEFAULT_ROOT);
  const report = JSON.parse(readFileSync(path.resolve(root, input.reportPath), 'utf8')) as ComponentGraduationReport;
  const expected = { ...(input.expected ?? {}) };
  expected.recomputeInputDigest ??= sha256(canonicalGraduationArtifactInput(report));
  const member = COMPONENT_AUTHORITY_MANIFEST.components.find((entry) => entry.id === report.componentId);
  const currentDefaultMode = input.currentDefaultMode === undefined ? member?.defaultMode ?? null : input.currentDefaultMode;
  const result = evaluateComponentGraduationGate({
    report,
    context: { expected, artifactResolver: createDiskArtifactResolver(root) },
    ...(currentDefaultMode ? { currentDefaultMode } : {}),
    ...(input.taskForestNode ? { taskForestNode: input.taskForestNode } : {}),
  });
  return {
    ...result,
    reportPath: path.resolve(root, input.reportPath),
    expected,
    currentDefaultMode: currentDefaultMode ?? null,
  };
}

function readArg(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function main(argv = process.argv.slice(2)): number {
  const reportPath = readArg(argv, '--report');
  if (!reportPath) {
    console.error('usage: component-graduation-report.mts --report <path> [--root <path>] [--expected-context <json>] [--current-default-mode <mode>] [--require-graduation] [--task-node-id <id> --task-node-status <status>]');
    return 2;
  }
  const root = readArg(argv, '--root') ?? DEFAULT_ROOT;
  const expectedPath = readArg(argv, '--expected-context');
  const expected = expectedPath
    ? JSON.parse(readFileSync(path.resolve(root, expectedPath), 'utf8')) as GraduationValidationExpectation
    : {};
  const currentDefaultMode = readArg(argv, '--current-default-mode') as ComponentAuthorityDefaultMode | undefined;
  const nodeId = readArg(argv, '--task-node-id');
  const nodeStatus = readArg(argv, '--task-node-status');
  const taskForestNode = nodeId && nodeStatus ? { id: nodeId, status: nodeStatus } : undefined;
  try {
    const result = runComponentGraduationGate({
      reportPath,
      root,
      expected,
      ...(currentDefaultMode ? { currentDefaultMode } : {}),
      ...(taskForestNode ? { taskForestNode } : {}),
    });
    const requireGraduation = argv.includes('--require-graduation');
    const ok = result.ok && (!requireGraduation || result.validation.graduationPass);
    console.log(JSON.stringify({ ...result, ok, requireGraduation }, null, 2));
    return ok ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}