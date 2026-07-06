#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const [, , rawArtifactPath, rawName] = process.argv;
const REGISTRY_PATH = join('shared', 'agent-dev', 'scenarios.ts');

function usage() {
  console.error('Usage: pnpm agent-dev:promote-scenario <artifact.scenario.json> <scenario-name>');
}

function toKebab(value) {
  return String(value || '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function toPascal(value) {
  return toKebab(value)
    .split('-')
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join('');
}

function projectPath(path) {
  return resolve(ROOT, path);
}

function assertNewFiles(paths) {
  const existing = paths.filter((path) => existsSync(projectPath(path)));
  if (existing.length > 0) {
    throw new Error(`Refusing to overwrite existing file: ${existing[0]}`);
  }
}

async function writeNewFile(path, content) {
  const abs = projectPath(path);
  if (existsSync(abs)) {
    throw new Error(`Refusing to overwrite existing file: ${path}`);
  }
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, 'utf8');
}

async function readScenarioRegistry() {
  return await readFile(projectPath(REGISTRY_PATH), 'utf8');
}

function registryHasId(text, kebab) {
  return text.includes(`id: '${kebab}'`) || text.includes(`id: "${kebab}"`);
}

function createScenarioRegistryText(text, kebab, route, fixturePath, capturedAt) {
  if (registryHasId(text, kebab)) {
    throw new Error(`Refusing to promote scenario with existing registry id: ${kebab}`);
  }
  const marker = '] as const satisfies readonly AgentDevScenarioDefinition[];';
  if (!text.includes(marker)) {
    throw new Error(`Unable to find Agent Dev scenario registry marker in ${REGISTRY_PATH}`);
  }
  const entry = `  {
    id: '${kebab}',
    route: '${route}',
    description: '${kebab} promoted from a reviewed scenario recording.',
    seed: {
      recordingFixture: '${fixturePath.replace(/\\/g, '/')}',
      recordedAt: ${JSON.stringify(capturedAt ?? null)},
    },
    slices: ['recording'],
    tags: ['recorded', 'agent-dev'],
  },
`;
  return text.replace(marker, `${entry}${marker}`);
}

function assertLooksRedacted(text) {
  const findings = [];
  const patterns = [
    /\b(?:Bearer|Basic)\s+(?!\[redacted\])[A-Za-z0-9._~+/=-]{8,}/i,
    /\b(?:sk|rk|pk|ghp|github_pat)_[A-Za-z0-9_=-]{8,}\b/i,
    /["']?(?:api[-_ ]?key|token|secret|password|authorization)["']?\s*:\s*["']?(?!\[redacted\])[^'"\s,;}]+/i,
    /\b(?:api[-_ ]?key|token|secret|password|authorization)\s*[:=]\s*['"]?(?!\[redacted\])[^'"\s,;}]+/i,
    /\b[A-Z]:\\Users\\[^\\\s"]+/i,
    /\/Users\/[^/\s"]+/i,
  ];
  for (const pattern of patterns) {
    if (pattern.test(text)) findings.push(String(pattern));
  }
  if (findings.length > 0) {
    throw new Error(`Refusing to promote scenario recording with possible unredacted sensitive data: ${findings[0]}`);
  }
}

async function promoteScenario(artifactPathInput, nameInput) {
  const kebab = toKebab(nameInput);
  if (!kebab) throw new Error('Scenario name is required.');
  const artifactPath = isAbsolute(artifactPathInput)
    ? artifactPathInput
    : projectPath(artifactPathInput);
  const artifactText = await readFile(artifactPath, 'utf8');
  assertLooksRedacted(artifactText);
  const artifact = JSON.parse(artifactText);
  if (artifact?.schema !== 'clawx.agent-dev.scenario-recording.v1') {
    throw new Error('Scenario recording schema must be clawx.agent-dev.scenario-recording.v1.');
  }

  const route = typeof artifact.route === 'string' && artifact.route.trim() ? artifact.route.trim() : '/';
  const fixturePath = join('tests', 'e2e', 'fixtures', 'agent-dev', `${kebab}.scenario.json`);
  const harnessPath = join('harness', 'specs', 'scenarios', `${kebab}.md`);
  const e2ePath = join('tests', 'e2e', `${kebab}.spec.ts`);
  assertNewFiles([fixturePath, harnessPath, e2ePath]);

  const nextRegistry = createScenarioRegistryText(
    await readScenarioRegistry(),
    kebab,
    route,
    fixturePath,
    typeof artifact.capturedAt === 'string' ? artifact.capturedAt : null,
  );

  await writeNewFile(fixturePath, `${JSON.stringify(artifact, null, 2)}\n`);
  await writeNewFile(harnessPath, `---
id: ${kebab}
title: ${toPascal(kebab)}
type: scenario
requiredRules:
  - renderer-main-boundary
  - agent-dev-conformance-evidence
---

# ${kebab}

## Purpose

Promoted from a reviewed Agent Dev scenario recording. The source recording fixture is \`${fixturePath.replace(/\\/g, '/')}\`.

## Review Requirements

- Confirm the fixture is redacted before changing the seed.
- Keep this scenario registered in \`shared/agent-dev/scenarios.ts\`.
- Keep the E2E snapshot assertion in \`tests/e2e/${kebab}.spec.ts\`.

## Validation

- pnpm contract:check
- pnpm i18n:lint
- pnpm agent-dev:workbench
- pnpm run test:e2e tests/e2e/${kebab}.spec.ts
`);
  await writeNewFile(e2ePath, `import { expect, getAgentDevSnapshot, openAgentDevScenario, test } from './fixtures/electron';

test('${kebab} promoted agent-dev scenario is reachable', async ({ page }) => {
  await openAgentDevScenario(page, '${kebab}');
  await expect(page.getByTestId('main-layout')).toBeVisible();
  await expect.poll(async () => getAgentDevSnapshot(page)).toEqual(
    expect.objectContaining({ devScenario: '${kebab}' }),
  );
});
`);
  await writeFile(projectPath(REGISTRY_PATH), nextRegistry, 'utf8');
  return {
    success: true,
    scenario: kebab,
    route,
    files: [REGISTRY_PATH, fixturePath, harnessPath, e2ePath],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!rawArtifactPath || !rawName) {
    usage();
    process.exit(1);
  }
  try {
    console.log(JSON.stringify(await promoteScenario(rawArtifactPath, rawName), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export { assertLooksRedacted, promoteScenario };
