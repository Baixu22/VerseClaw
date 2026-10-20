#!/usr/bin/env node
/**
 * R6-4: generated catalogs — the first "generated directory" precedent.
 *
 * Single sources of truth, imported as the SAME module exports (never copied,
 * never hand-edited):
 *   - openclaw_runtime/src/agents/tool-catalog.ts   (tools / sections / profiles)
 *   - shared/dcs/prod-flags-catalog.ts              (DCS production opt-in flags)
 *
 * Outputs (committed, same change set as source edits):
 *   - docs/generated/catalogs/tools.md
 *   - docs/generated/catalogs/prod-flags.md
 *
 * Runs under openclaw_runtime's tsx (the runtime sources use .js-extension
 * imports that need tsx's extension substitution):
 *   pnpm catalogs:gen     -> regenerate
 *   pnpm catalogs:check   -> fail closed (exit 1) when generated files are
 *                            stale or missing
 */
import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const DEFAULT_OUT_DIR = resolve(REPO_ROOT, 'docs', 'generated', 'catalogs');
const TOOLS_SOURCE_PATH = 'openclaw_runtime/src/agents/tool-catalog.ts';
const FLAGS_SOURCE_PATH = 'shared/dcs/prod-flags-catalog.ts';

/** CLI options; --out-dir/--now exist for tests and pinned regeneration. */
export function parseCatalogArgs(argv = process.argv.slice(2)) {
  const valueOf = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 && typeof argv[index + 1] === 'string' ? argv[index + 1] : undefined;
  };
  const outDirValue = valueOf('--out-dir');
  return {
    check: argv.includes('--check'),
    outDir: outDirValue ? resolve(REPO_ROOT, outDirValue) : DEFAULT_OUT_DIR,
    now: valueOf('--now') ?? new Date().toISOString(),
  };
}

function generatedHeader(sourcePath, now) {
  return [
    '<!-- GENERATED FILE — DO NOT EDIT.',
    'Source of truth: ' + sourcePath,
    'Regenerate: pnpm catalogs:gen   |   Check freshness: pnpm catalogs:check',
    'Generated at: ' + now,
    '-->',
  ].join('\n');
}

let catalogResolvers = { resolveCoreToolProfiles: () => [] };

/** Profiles are resolved per tool id via the live source export (injected). */
export function setCatalogResolvers(resolvers) {
  catalogResolvers = resolvers;
}

function code(value) {
  return '`' + String(value) + '`';
}

/** Render the core tool catalog from the same-module source exports. */
export function renderToolsMarkdown(sections, now) {
  const lines = [
    '# Core Tool Catalog (generated)',
    '',
    generatedHeader(TOOLS_SOURCE_PATH, now),
    '',
    'Built-in core tool sections with their profiles. This file is generated —',
    'edit the source of truth instead, then run pnpm catalogs:gen.',
    '',
  ];
  for (const section of sections) {
    lines.push('## ' + section.label + ' (' + code(section.id) + ')', '');
    for (const tool of section.tools) {
      const profiles = catalogResolvers.resolveCoreToolProfiles(tool.id);
      const profileText = profiles.length > 0
        ? profiles.map((entry) => code(entry)).join(', ')
        : '—';
      lines.push('- ' + code(tool.id) + ' — ' + tool.description + ' — profiles: ' + profileText);
    }
    lines.push('');
  }
  return lines.join('\n') + '\n';
}

function renderFlagExecutor(executor) {
  if (!executor) return 'missing (catalogs:check will fail)';
  if (executor.status === 'wired') {
    const sites = Array.isArray(executor.sites) ? executor.sites : [];
    return sites.length > 0
      ? 'wired — ' + sites.map((site) => code(site)).join(', ')
      : 'wired (no sites; catalogs:check will fail)';
  }
  if (executor.status === 'pending-wiring') {
    return executor.reason
      ? 'pending-wiring — ' + executor.reason
      : 'pending-wiring (reason missing; catalogs:check will fail)';
  }
  return 'invalid executor status: ' + String(executor.status);
}

const EXECUTOR_SITE_PATTERN = /^(.+):([1-9][0-9]*)$/u;

/**
 * Hard gate for landed-unwired drift: every wired catalog entry must point at
 * a readable, non-empty production line inside the repository. Pending-wiring
 * is allowed only when the reason is explicit.
 */
export async function validateFlagExecutors(flags, repoRoot = REPO_ROOT) {
  const issues = [];
  for (const flag of flags) {
    const executor = flag?.executor;
    if (!executor) {
      issues.push({ file: 'prod-flags', reason: `executor missing for flag ${flag?.id ?? '<unknown>'}` });
      continue;
    }
    if (executor.status === 'wired') {
      if (!Array.isArray(executor.sites) || executor.sites.length === 0) {
        issues.push({ file: 'prod-flags', reason: `wired executor for flag ${flag.id} must list at least one file:line site` });
        continue;
      }
      for (const site of executor.sites) {
        const match = typeof site === 'string' ? site.match(EXECUTOR_SITE_PATTERN) : undefined;
        if (!match) {
          issues.push({ file: 'prod-flags', reason: `executor site for flag ${flag.id} must be '<relative-path>:<line>': ${JSON.stringify(site)}` });
          continue;
        }
        const [, relativePath, lineText] = match;
        const absolutePath = resolve(repoRoot, relativePath);
        const rootedRelative = relative(repoRoot, absolutePath);
        if (
          isAbsolute(relativePath) ||
          rootedRelative === '' ||
          rootedRelative.startsWith('..') ||
          isAbsolute(rootedRelative)
        ) {
          issues.push({ file: 'prod-flags', reason: `executor site escapes repository root for flag ${flag.id}: ${site}` });
          continue;
        }
        if (!existsSync(absolutePath)) {
          issues.push({ file: 'prod-flags', reason: `executor site file missing for flag ${flag.id}: ${site}` });
          continue;
        }
        const contents = await readFile(absolutePath, 'utf8');
        const lines = contents.split(/\r?\n/u);
        const lineNumber = Number(lineText);
        if (lineNumber < 1 || lineNumber > lines.length) {
          issues.push({ file: 'prod-flags', reason: `executor site line out of range for flag ${flag.id}: ${site} (file has ${lines.length} lines)` });
        } else if (!lines[lineNumber - 1].trim()) {
          issues.push({ file: 'prod-flags', reason: `executor site points to a blank line for flag ${flag.id}: ${site}` });
        }
      }
    } else if (executor.status === 'pending-wiring') {
      if (typeof executor.reason !== 'string' || executor.reason.trim() === '') {
        issues.push({ file: 'prod-flags', reason: `pending-wiring executor for flag ${flag.id} requires a reason` });
      }
      if (Array.isArray(executor.sites) && executor.sites.length > 0) {
        issues.push({ file: 'prod-flags', reason: `pending-wiring executor for flag ${flag.id} must not list sites` });
      }
    } else {
      issues.push({ file: 'prod-flags', reason: `executor status invalid for flag ${flag.id}: ${JSON.stringify(executor.status)}` });
    }
  }
  return { fresh: issues.length === 0, issues };
}

/** Render the DCS production flag catalog from the same-module source export. */
export function renderFlagsMarkdown(flags, now) {
  const lines = [
    '# DCS Production Flag Catalog (generated)',
    '',
    generatedHeader(FLAGS_SOURCE_PATH, now),
    '',
    'Machine-readable source of truth for defaults, risk, enable, and rollback.',
    'This file is generated — edit the source of truth instead.',
    '',
  ];
  for (const flag of flags) {
    lines.push(
      '## ' + flag.id,
      '',
      '- wave: ' + flag.wave,
      '- kind: ' + flag.kind,
      '- key: ' + code(flag.key),
      '- default: ' + JSON.stringify(flag.defaultValue),
      '- defaultDisplay: ' + flag.defaultDisplay,
      '- risk: ' + flag.risk,
      '- enable: ' + flag.enable,
      '- rollback: ' + flag.rollback,
      '- executor: ' + renderFlagExecutor(flag.executor),
      '',
      '> ' + flag.riskNote,
      '',
    );
  }
  return lines.join('\n') + '\n';
}

async function loadSources() {
  const [toolsModule, flagsModule] = await Promise.all([
    import('../openclaw_runtime/src/agents/tool-catalog.ts'),
    import('../shared/dcs/prod-flags-catalog.ts'),
  ]);
  if (typeof toolsModule.listCoreToolSections !== 'function') {
    throw new Error('tool-catalog source must export listCoreToolSections()');
  }
  if (!Array.isArray(flagsModule.DCS_PROD_FLAGS)) {
    throw new Error('prod-flags source must export DCS_PROD_FLAGS array');
  }
  return { toolsModule, flagsModule };
}

/** Strip the "Generated at:" line so --check compares content, not the clock. */
function stripGeneratedAt(content) {
  return content
    .split(/\r?\n/u)
    .filter((line) => !line.startsWith('Generated at:'))
    .join('\n');
}

/** Render both catalogs from the live source exports without touching disk. */
export async function renderCatalogs(options = {}) {
  const { now = new Date().toISOString() } = options;
  const { toolsModule, flagsModule } = await loadSources();
  setCatalogResolvers({ resolveCoreToolProfiles: toolsModule.resolveCoreToolProfiles });
  const sections = toolsModule.listCoreToolSections();
  return {
    sections,
    flags: flagsModule.DCS_PROD_FLAGS,
    toolsMarkdown: renderToolsMarkdown(sections, now),
    flagsMarkdown: renderFlagsMarkdown(flagsModule.DCS_PROD_FLAGS, now),
  };
}

export async function generateCatalogs(options = {}) {
  const { outDir = DEFAULT_OUT_DIR } = options;
  const rendered = await renderCatalogs(options);
  const toolsPath = resolve(outDir, 'tools.md');
  const flagsPath = resolve(outDir, 'prod-flags.md');
  await mkdir(outDir, { recursive: true });
  await writeFile(toolsPath, rendered.toolsMarkdown, 'utf8');
  await writeFile(flagsPath, rendered.flagsMarkdown, 'utf8');
  return {
    toolsPath,
    flagsPath,
    ...rendered,
  };
}

/** Fail-closed freshness check: regenerate and compare against committed files. */
export async function checkCatalogs(options = {}) {
  const { outDir = DEFAULT_OUT_DIR } = options;
  // Compare against a pure render: --check must never write disk, otherwise
  // it would overwrite the very drift it is supposed to flag.
  const expected = await renderCatalogs(options);
  const toolsPath = resolve(outDir, 'tools.md');
  const flagsPath = resolve(outDir, 'prod-flags.md');
  const issues = [];
  const executorCheck = await validateFlagExecutors(expected.flags);
  issues.push(...executorCheck.issues);
  for (const [label, path, expectedText] of [
    ['tools', toolsPath, expected.toolsMarkdown],
    ['prod-flags', flagsPath, expected.flagsMarkdown],
  ]) {
    if (!existsSync(path)) {
      issues.push({ file: label, reason: 'missing generated file: ' + path });
      continue;
    }
    const actual = await readFile(path, 'utf8');
    if (stripGeneratedAt(actual) !== stripGeneratedAt(expectedText)) {
      issues.push({ file: label, reason: 'stale or hand-edited: ' + path });
    }
  }
  return { fresh: issues.length === 0, issues };
}

async function main() {
  const options = parseCatalogArgs();
  if (options.check) {
    const { fresh, issues } = await checkCatalogs(options);
    if (fresh) {
      console.log('catalogs:check passed — generated catalogs are fresh and match their sources.');
      return;
    }
    for (const issue of issues) {
      console.error('catalogs:check FAILED: ' + issue.reason);
    }
    console.error('Run pnpm catalogs:gen and commit the regenerated files in the same change set.');
    process.exitCode = 1;
    return;
  }
  const result = await generateCatalogs(options);
  console.log(JSON.stringify({
    tools: result.toolsPath,
    'prod-flags': result.flagsPath,
    sections: result.sections.length,
    flags: result.flags.length,
  }, null, 2));
}

if (isMainEntrypoint(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
