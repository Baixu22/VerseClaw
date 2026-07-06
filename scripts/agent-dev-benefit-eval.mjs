#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const ROOT = process.cwd();
const OUT_DIR = resolve(ROOT, 'artifacts/agent-dev-benefit-eval');

async function read(path) {
  return await readFile(resolve(ROOT, path), 'utf8');
}

async function walk(dir, predicate = () => true) {
  const results = [];
  async function visit(abs) {
    for (const entry of await readdir(abs, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
      const full = join(abs, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (predicate(full)) results.push(full);
    }
  }
  await visit(resolve(ROOT, dir));
  return results;
}

function countMatches(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

function extractScenarioIds(registryText) {
  const match = registryText.match(/export const AGENT_DEV_SCENARIOS = \[([\s\S]*?)\] as const/);
  return match ? [...match[1].matchAll(/\{\s*id:\s*'([^']+)'/g)].map((entry) => entry[1]) : [];
}

function packageInstalled(name) {
  const normalized = name.startsWith('@')
    ? name.replace('/', '\\')
    : name;
  return existsSync(resolve(ROOT, 'node_modules', ...normalized.split(/[\\/]/)));
}

async function scanSelectorCoverage() {
  const files = await walk('src', (file) => /\.(tsx|ts)$/.test(file));
  let testIdCount = 0;
  let interactiveTagCount = 0;
  let interactiveWithoutInlineTestId = 0;
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    testIdCount += countMatches(text, /data-testid=/g);
    const tags = [...text.matchAll(/<(?<tag>button|input|select|textarea|a)\b(?<attrs>[^>]*)>/g)];
    interactiveTagCount += tags.length;
    interactiveWithoutInlineTestId += tags.filter((match) => !String(match.groups?.attrs ?? '').includes('data-testid')).length;
  }
  return {
    fileCount: files.length,
    testIdCount,
    interactiveTagCount,
    interactiveWithoutInlineTestId,
    inlineSelectorCoverage: interactiveTagCount === 0
      ? 1
      : Number(((interactiveTagCount - interactiveWithoutInlineTestId) / interactiveTagCount).toFixed(3)),
  };
}

function renderMarkdown(report) {
  const tools = report.externalTools.map((tool) => (
    `| ${tool.package} | ${tool.installed ? 'yes' : 'no'} | ${tool.role} |`
  )).join('\n');
  return `# Agent Dev Benefit Evaluation

Generated: ${report.generatedAt}

## Summary

| Metric | Value |
| --- | ---: |
| Dev scenarios | ${report.agentDev.scenarioCount} |
| hostApi.agentDev methods | ${report.agentDev.hostApiMethodCount} |
| E2E agent-dev helpers | ${report.agentDev.e2eHelperCount} |
| Runtime schema assertions | ${report.agentDev.schemaAssertionCount} |
| Basic a11y rule families | ${report.quality.a11yRuleCount} |
| Renderer files scanned | ${report.selectorCoverage.fileCount} |
| data-testid occurrences | ${report.selectorCoverage.testIdCount} |
| Interactive tags scanned | ${report.selectorCoverage.interactiveTagCount} |
| Inline selector coverage | ${Math.round(report.selectorCoverage.inlineSelectorCoverage * 100)}% |

## External Tool Readiness

| Package | Installed | Role |
| --- | --- | --- |
${tools}

## Interpretation

- The current in-repo implementation already gives agents ${report.agentDev.scenarioCount} deterministic page entry points and ${report.agentDev.e2eHelperCount} E2E helpers without depending on new packages.
- Schema assertions now reject malformed agent-dev payloads at the Main host-api boundary.
- Basic a11y and visual artifact generation are available through Playwright today; axe/Argos can replace the fallback scanners once supply-chain policy allows installing them.
- The selector coverage metric is a heuristic. It is useful as a trend line, not as a precise accessibility or E2E quality proof.
`;
}

const start = performance.now();
const [
  scenarioRegistry,
  hostApi,
  e2eFixture,
  schemaText,
  a11yText,
] = await Promise.all([
  read('shared/agent-dev/scenarios.ts'),
  read('src/lib/host-api.ts'),
  read('tests/e2e/fixtures/electron.ts'),
  read('shared/host-api/agent-dev-schemas.ts'),
  read('tests/e2e/fixtures/a11y.ts'),
]);

const scenarioIds = extractScenarioIds(scenarioRegistry);
const hostApiAgentDevBlock = hostApi.match(/agentDev:\s*\{([\s\S]*?)\n  \},\n  providers:/)?.[1] ?? '';
const report = {
  generatedAt: new Date().toISOString(),
  durationMs: 0,
  agentDev: {
    scenarioCount: scenarioIds.length,
    scenarios: scenarioIds,
    hostApiMethodCount: countMatches(hostApiAgentDevBlock, /^\s{4}[A-Za-z][A-Za-z0-9_]*:/gm),
    e2eHelperCount: countMatches(e2eFixture, /export async function (openAgentDevScenario|getAgentDevSnapshot|configureAgentDevHostReplay|getAgentDevHostCalls)/g),
    schemaAssertionCount: countMatches(schemaText, /export function assertAgentDev/g),
  },
  quality: {
    a11yRuleCount: countMatches(a11yText, /add\('([^']+)'/g),
    visualArtifactSpec: existsSync(resolve(ROOT, 'tests/e2e/agent-dev-quality.spec.ts')),
    workbenchScript: existsSync(resolve(ROOT, 'scripts/agent-dev-workbench.mjs')),
  },
  selectorCoverage: await scanSelectorCoverage(),
  externalTools: [
    { package: '@axe-core/playwright', installed: packageInstalled('@axe-core/playwright'), role: 'strict a11y scanning' },
    { package: '@ladle/react', installed: packageInstalled('@ladle/react'), role: 'component scenario workbench' },
    { package: '@argos-ci/playwright', installed: packageInstalled('@argos-ci/playwright'), role: 'hosted visual regression' },
    { package: '@vitest/browser', installed: packageInstalled('@vitest/browser'), role: 'browser component testing' },
    { package: '@testing-library/user-event', installed: packageInstalled('@testing-library/user-event'), role: 'realistic component interactions' },
    { package: 'knip', installed: packageInstalled('knip'), role: 'unused files/deps/exports' },
    { package: 'ajv', installed: packageInstalled('ajv'), role: 'JSON schema validation engine' },
  ],
};
report.durationMs = Number((performance.now() - start).toFixed(1));

await mkdir(OUT_DIR, { recursive: true });
await writeFile(resolve(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
await writeFile(resolve(OUT_DIR, 'report.md'), renderMarkdown(report), 'utf8');
console.log(JSON.stringify(report, null, 2));
