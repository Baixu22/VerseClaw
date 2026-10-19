#!/usr/bin/env node
// Record and verify the historical RC-01R prerequisite identity without
// re-signing acceptedBase or treating the current batch comparison base as
// that prerequisite.
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const PREREQUISITE_COMMIT = 'c860c12f4ab88bca9bd46742facbc97e98bb9d60';
export const PREREQUISITE_DIFF_BASE = '3b08a46667e9b961ff9eafda12da0a18848832c5';
export const PREREQUISITE_SPEC_PATH = 'harness/specs/tasks/rc01r-green-baseline.md';
export const PREREQUISITE_SPEC_BLOB = '4bfc17d73c304fdea62c2debb4e213605a2ca227';
export const APPROVED_ACCEPTED_BASE = '086dc6b17ed51813e9114fdeceaa898d195e0579';
export const INTEGRATED_COMPARISON_BASE = '5dabc7ca5e86d2c08e5236e175323ebe4b4db804';
export const FROZEN_ROOT_UNIT_EXPECTED_SKIPS = 53;

export const PREREQUISITE_PATHS = Object.freeze([
  'harness/specs/tasks/rc01r-green-baseline.md',
  'openclaw_runtime/src/agents/resource-aware-wave-scheduler.ts',
  'openclaw_runtime/src/context-engine/agent-map-context-provider.ts',
  'openclaw_runtime/src/context-engine/cvk/codebase-index.ts',
  'openclaw_runtime/src/context-engine/cvk/compiler.ts',
  'openclaw_runtime/src/context-engine/cvk/recovery.ts',
  'openclaw_runtime/src/context-engine/cvk/resolver.ts',
  'openclaw_runtime/src/context-engine/cvk/shadow-provider.ts',
  'openclaw_runtime/src/context-engine/cvk/tool-call-gate.ts',
  'openclaw_runtime/src/context-engine/cvk/views.ts',
  'openclaw_runtime/src/context-engine/dcs-canary-c1.ts',
  'openclaw_runtime/src/context-engine/dcs-graduation-decision.ts',
  'openclaw_runtime/src/context-engine/registry/context-item-registry.ts',
  'openclaw_runtime/src/context-engine/registry/context-item-store.ts',
  'openclaw_runtime/src/context-engine/symbol-context-provider.ts',
  'openclaw_runtime/src/context-engine/trace-context-provider.ts',
  'openclaw_runtime/src/plugins/cli-registry-loader.ts',
  'openclaw_runtime/src/runtime-core/memory-bridge-discovery.ts',
  'openclaw_runtime/src/runtime-core/memory-read-hydration-consumer.ts',
  'openclaw_runtime/tsconfig.core.json',
  'openclaw_runtime/ui/src/ui/tool-display.ts',
  'openclaw_runtime/ui/src/ui/views/usage-render-details.ts',
  'shared/package.json',
  'shared/product-semantics.ts',
  'shared/remote-forge/error-envelope.ts',
  'shared/remote-forge/unified-diff-adapter.ts',
  'shared/types/context-family.ts',
  'shared/types/context-item.ts',
  'shared/types/work-mode.ts',
  'shared/types/work-provider.ts',
  'shared/types/workspace.ts',
  'shared/verseshell/errors.ts',
  'shared/verseshell/validation.ts',
  'tests/unit/chat-input.test.tsx',
  'tests/unit/chat-question-directory.test.tsx',
  'tests/unit/provider-model-sync.test.ts',
  'tests/unit/startup-loading-experience.test.tsx',
  'tests/unit/title-bar.test.tsx',
]);

function resolveRepoRoot() {
  try {
    if (typeof import.meta.url === 'string' && import.meta.url.startsWith('file:')) {
      return fileURLToPath(new URL('..', import.meta.url));
    }
  } catch {
    // Vitest may rewrite import.meta.url to a non-file scheme.
  }
  return process.cwd();
}

function git(args, cwd = resolveRepoRoot()) {
  return spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    maxBuffer: 16 * 1024 * 1024,
  });
}

export function verifyRc01rPrerequisiteProvenance(options = {}) {
  const root = options.root ?? resolveRepoRoot();
  const errors = [];
  const run = (args) => git(args, root);

  const commit = run(['rev-parse', '--verify', PREREQUISITE_COMMIT]);
  if (commit.status !== 0 || commit.stdout.trim() !== PREREQUISITE_COMMIT) {
    errors.push(`prerequisite commit missing: ${PREREQUISITE_COMMIT}`);
  }
  const parent = run(['rev-parse', '--verify', `${PREREQUISITE_COMMIT}^`]);
  if (parent.status !== 0) errors.push('prerequisite parent is missing');

  const diffBaseAncestor = run(['merge-base', '--is-ancestor', PREREQUISITE_DIFF_BASE, PREREQUISITE_COMMIT]);
  if (diffBaseAncestor.status !== 0) {
    errors.push(`prerequisite diffBase ${PREREQUISITE_DIFF_BASE} is not an ancestor of ${PREREQUISITE_COMMIT}`);
  }
  const acceptedAncestor = run(['merge-base', '--is-ancestor', APPROVED_ACCEPTED_BASE, 'HEAD']);
  if (acceptedAncestor.status !== 0) {
    errors.push(`approved acceptedBase ${APPROVED_ACCEPTED_BASE} is not an ancestor of HEAD`);
  }
  const comparisonExists = run(['rev-parse', '--verify', INTEGRATED_COMPARISON_BASE]);
  if (comparisonExists.status !== 0) {
    errors.push(`integrated comparison base missing: ${INTEGRATED_COMPARISON_BASE}`);
  }
  if (INTEGRATED_COMPARISON_BASE === APPROVED_ACCEPTED_BASE || INTEGRATED_COMPARISON_BASE === PREREQUISITE_COMMIT) {
    errors.push('integrated comparison base must stay distinct from acceptedBase and the historical prerequisite');
  }

  const specBlob = run(['rev-parse', '--verify', `${PREREQUISITE_COMMIT}:${PREREQUISITE_SPEC_PATH}`]);
  if (specBlob.status !== 0 || specBlob.stdout.trim() !== PREREQUISITE_SPEC_BLOB) {
    errors.push(`prerequisite spec blob mismatch for ${PREREQUISITE_SPEC_PATH}`);
  }

  const diff = run(['diff', '--name-only', '-z', PREREQUISITE_DIFF_BASE, PREREQUISITE_COMMIT]);
  if (diff.status !== 0) {
    errors.push('cannot read prerequisite diff');
  } else {
    const changed = new Set(diff.stdout.split('\0').map((value) => value.trim()).filter(Boolean));
    const expected = new Set(PREREQUISITE_PATHS);
    const extra = [...changed].filter((path) => !expected.has(path)).sort();
    const missing = [...expected].filter((path) => !changed.has(path)).sort();
    if (extra.length) errors.push(`unexpected prerequisite diff paths: ${extra.join(', ')}`);
    if (missing.length) errors.push(`missing prerequisite diff paths: ${missing.join(', ')}`);
  }
  if (PREREQUISITE_PATHS.length !== 38) errors.push('prerequisite path inventory must remain 38 entries');

  const report = {
    ok: errors.length === 0,
    errors,
    prerequisite: {
      commit: PREREQUISITE_COMMIT,
      diffBase: PREREQUISITE_DIFF_BASE,
      specPath: PREREQUISITE_SPEC_PATH,
      specBlob: PREREQUISITE_SPEC_BLOB,
      pathCount: PREREQUISITE_PATHS.length,
    },
    approvedAcceptedBase: APPROVED_ACCEPTED_BASE,
    integratedComparisonBase: INTEGRATED_COMPARISON_BASE,
    frozenRootUnitExpectedSkips: FROZEN_ROOT_UNIT_EXPECTED_SKIPS,
    identities: {
      prerequisiteIsNotAcceptedBase: PREREQUISITE_COMMIT !== APPROVED_ACCEPTED_BASE,
      comparisonBaseIsNotAcceptedBase: INTEGRATED_COMPARISON_BASE !== APPROVED_ACCEPTED_BASE,
      comparisonBaseIsNotPrerequisite: INTEGRATED_COMPARISON_BASE !== PREREQUISITE_COMMIT,
    },
  };
  return report;
}

function invokedAsCli() {
  return isMainEntrypoint(import.meta.url);
}
const invokedDirectly = invokedAsCli();
if (invokedDirectly) {
  const report = verifyRc01rPrerequisiteProvenance();
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (report.ok) process.stdout.write(serialized);
  else process.stderr.write(serialized);
  process.exitCode = report.ok ? 0 : 1;
}
