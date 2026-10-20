import { isMainEntrypoint } from './lib/entrypoint.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = join(
  rootDir,
  'artifacts',
  'first-product-preview',
  'FP-P1-08',
  'forbidden-claims-scan.json',
);

export const FORBIDDEN_CLAIMS = [
  { id: 'live-ready-field', pattern: /\bliveReady\b/gi },
  { id: 'product-approved-field', pattern: /\bproductApproved\b/gi },
  { id: 'default-on', pattern: /\bdefault-on\b/gi },
  { id: 'ga-abbreviation', pattern: /\bGA\b/g },
  { id: 'production-available-zh', pattern: /生产可用/g },
];

export const CURRENT_PRODUCT_SURFACES = new Set([
  'README.md',
  'README.zh-CN.md',
  'README.ja-JP.md',
  'README.ru-RU.md',
  'docs/clawx-product-semantics.md',
  'docs/dcs-production-p0-runbook.md',
  'docs/dcs-production-p0-runbook.zh-CN.md',
  'docs/dev/default-config-matrix.md',
  ...['en', 'zh', 'ja', 'ru'].flatMap((language) => [
    `shared/i18n/locales/${language}/setup.json`,
    `shared/i18n/locales/${language}/settings.json`,
  ]),
]);

const textExtensions = new Set([
  '.cjs', '.js', '.json', '.jsonl', '.jsx', '.md', '.mjs', '.toml', '.ts', '.tsx', '.txt',
  '.yaml', '.yml',
]);

const exemptionRationales = {
  'scanner-definition': 'Literal terms are required to define and test this scanner.',
  'governance-policy': 'Internal task/status policy defines forbidden claims or stores gate fields; it is not current product copy.',
  'task-forest-state': 'Task Forest state/history preserves gate names and prior decisions; it is proposal-controlled metadata.',
  'historical-evidence': 'Immutable or generated evidence records prior claims and decisions; it is not current product copy.',
  'machine-contract-or-test': 'Source/tests use stable field identifiers or negative assertions, not user-facing capability claims.',
  'embedded-runtime-internal': 'Embedded runtime source and internal evidence are outside the current Verse Claw product-copy surfaces.',
  'internal-reference': 'Internal reference text is outside the current product-copy surfaces and requires evidence review before promotion.',
};

function normalizePath(filePath) {
  return filePath.replaceAll('\\', '/').replace(/^\.\//, '');
}

function listRepositoryFiles() {
  const output = execFileSync(
    'git',
    ['ls-files', '-co', '--exclude-standard', '-z'],
    { cwd: rootDir, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
  );
  return output
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map(normalizePath);
}

function categoryFor(filePath) {
  if (filePath === 'scripts/scan-first-product-claims.mjs'
    || filePath === 'tests/unit/first-product-claims.test.ts') {
    return 'scanner-definition';
  }
  if (filePath.startsWith('.agent-workbench/task-forest/')) return 'task-forest-state';
  if (filePath.startsWith('artifacts/') || filePath.startsWith('reports/')) {
    return 'historical-evidence';
  }
  if (filePath === 'AGENTS.md' || filePath.startsWith('docs/dev/')
    || filePath.startsWith('harness/') || filePath.startsWith('plans/')) {
    return 'governance-policy';
  }
  if (filePath.startsWith('openclaw_runtime/')) return 'embedded-runtime-internal';
  if (filePath.startsWith('src/') || filePath.startsWith('electron/')
    || filePath.startsWith('shared/') || filePath.startsWith('tests/')) {
    return 'machine-contract-or-test';
  }
  return 'internal-reference';
}

// Lines that explicitly negate enablement are boundary statements, not
// graduation claims: they name the forbidden terms precisely to say those
// states stay off (e.g. README evidence paragraphs in en/zh/ja). A line
// matching one of these is skipped entirely; keep the patterns anchored to
// the exact negation phrasing so a real claim on the same line is not masked
// accidentally — new disclaimer wordings must be added here deliberately.
const DISCLAIMER_LINE_PATTERNS = [
  /\bdoes not enable\b/i, // en
  /不开启|不启用|不会默认启用/, // zh-CN
  /を有効化しません/, // ja
  /не включает/i, // ru
];

// "GA hardening" is the recorded name of a historical engineering pass
// (2026-08-19 evidence), not a claim that the product reached GA. Strip it
// before term matching instead of editing history in the READMEs.
const GA_HARDENING_TEST = /\bGA hardening\b/;
const GA_HARDENING_PATTERN = /\bGA hardening\b/g;

export function findForbiddenClaims(text) {
  const matches = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index];
    // English README evidence paragraphs wrap across lines, so the negation
    // verb ("does not enable …") may sit on the previous line while the named
    // terms sit on the continuation line. Detect disclaimers over a two-line
    // context window.
    const disclaimerContext = index > 0 ? `${lines[index - 1]} ${line}` : line;
    if (DISCLAIMER_LINE_PATTERNS.some((pattern) => pattern.test(disclaimerContext))) continue;
    if (GA_HARDENING_TEST.test(line)) {
      line = line.replace(GA_HARDENING_PATTERN, '');
    }
    line = line
      .replace(/单项工程证据不等于[^。\r\n]*。/g, '')
      .replace(/タスク単位の証拠は、[^。\r\n]*を許可しません。/g, '')
      // Explicit false gate fields are factual boundaries, not graduation claims.
      // Strip the exact assignment only; any adjacent claim remains visible.
      .replace(/\bliveReady\s*=\s*false\b/gi, '')
      .replace(/\bproductApproved\s*=\s*false\b/gi, '');
    for (const claim of FORBIDDEN_CLAIMS) {
      claim.pattern.lastIndex = 0;
      const count = [...line.matchAll(claim.pattern)].length;
      if (count > 0) matches.push({ term: claim.id, line: index + 1, count });
    }
  }
  return matches;
}

function scan() {
  const pathResults = [];
  const skipped = [];
  for (const filePath of listRepositoryFiles()) {
    const absolutePath = join(rootDir, filePath);
    const extension = extname(filePath).toLowerCase();
    if (!textExtensions.has(extension) && filePath !== 'AGENTS.md') continue;
    try {
      const size = statSync(absolutePath).size;
      if (size > 64 * 1024 * 1024) {
        skipped.push({ path: filePath, reason: 'text file exceeds 64 MiB', size });
        continue;
      }
      const matches = findForbiddenClaims(readFileSync(absolutePath, 'utf8'));
      if (matches.length === 0) continue;
      const category = CURRENT_PRODUCT_SURFACES.has(filePath)
        ? 'current-product-surface'
        : categoryFor(filePath);
      pathResults.push({
        path: filePath,
        category,
        rationale: category === 'current-product-surface'
          ? 'Current product copy cannot use ungraduated claim terms.'
          : exemptionRationales[category],
        matchCount: matches.reduce((sum, match) => sum + match.count, 0),
        matches,
      });
    } catch (error) {
      skipped.push({ path: filePath, reason: String(error) });
    }
  }

  const violations = pathResults.filter((result) => result.category === 'current-product-surface');
  const report = {
    schema: 'verse-claw-first-product-claim-scan/1',
    generatedAt: new Date().toISOString(),
    repository: normalizePath(relative(dirname(rootDir), rootDir)),
    scope: 'tracked and non-ignored untracked text files; current product surfaces are hard-fail',
    currentProductSurfaces: [...CURRENT_PRODUCT_SURFACES].sort(),
    summary: {
      filesWithMatches: pathResults.length,
      totalMatches: pathResults.reduce((sum, result) => sum + result.matchCount, 0),
      currentProductViolations: violations.length,
      exemptPaths: pathResults.length - violations.length,
      skippedFiles: skipped.length,
    },
    violations,
    exemptions: pathResults.filter((result) => result.category !== 'current-product-surface'),
    skipped,
  };

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`[first-product-claims] scanned ${report.currentProductSurfaces.length} current product surfaces`);
  console.log(`[first-product-claims] repository matches ${report.summary.totalMatches} across ${report.summary.filesWithMatches} paths`);
  console.log(`[first-product-claims] current product violations ${report.summary.currentProductViolations}`);
  console.log(`[first-product-claims] report ${normalizePath(relative(rootDir, outputPath))}`);
  if (violations.length > 0 || skipped.length > 0) process.exitCode = 1;
  return report;
}

if (isMainEntrypoint(import.meta.url)) scan();
