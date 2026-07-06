#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [, , kind, rawName] = process.argv;

function usage() {
  console.log('Usage: pnpm agent-dev:make <page|e2e|host-route|skill|channel|plugin|scenario> <name>');
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

function toCamel(value) {
  const pascal = toPascal(value);
  return pascal ? `${pascal[0].toLowerCase()}${pascal.slice(1)}` : '';
}

async function writeNewFile(path, content) {
  if (existsSync(path)) {
    throw new Error(`Refusing to overwrite existing file: ${path}`);
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
  console.log(path);
}

async function writePatchedFile(path, content) {
  await writeFile(path, content, 'utf8');
  console.log(path);
}

function assertNewFiles(paths) {
  const existing = paths.filter((path) => existsSync(path));
  if (existing.length > 0) {
    throw new Error(`Refusing to overwrite existing file: ${existing[0]}`);
  }
}

async function readScenarioRegistry() {
  return await readFile(join('shared', 'agent-dev', 'scenarios.ts'), 'utf8');
}

function scenarioRegistryHasId(text, kebab) {
  return text.includes(`id: '${kebab}'`) || text.includes(`id: "${kebab}"`);
}

function createScenarioRegistryText(text, kebab) {
  const path = join('shared', 'agent-dev', 'scenarios.ts');
  if (scenarioRegistryHasId(text, kebab)) {
    throw new Error(`Refusing to scaffold scenario with existing registry id: ${kebab}`);
  }
  const marker = '] as const satisfies readonly AgentDevScenarioDefinition[];';
  if (!text.includes(marker)) {
    throw new Error(`Unable to find Agent Dev scenario registry marker in ${path}`);
  }
  const entry = `  {
    id: '${kebab}',
    route: '/',
    description: '${kebab} scenario scaffold.',
    seed: {},
    slices: ['scaffold'],
    tags: ['scaffold'],
  },
`;
  return text.replace(marker, `${entry}${marker}`);
}

async function writeScenarioRegistryText(text) {
  const path = join('shared', 'agent-dev', 'scenarios.ts');
  await writeFile(path, text, 'utf8');
  console.log(path);
}

async function writeLocaleStubs(baseDir, namespace) {
  for (const locale of ['en', 'zh', 'ja', 'ru']) {
    await writeNewFile(join(baseDir, `${locale}.json`), `{
  "title": "${namespace}",
  "description": "${namespace} agent-dev scaffold"
}
`);
  }
}

async function writeSharedLocaleNamespaceStubs(namespace) {
  for (const locale of ['en', 'zh', 'ja', 'ru']) {
    await writeNewFile(join('shared', 'i18n', 'locales', locale, `${namespace}.json`), `{
  "title": "${namespace}"
}
`);
  }
}

async function makePage(name) {
  const pascal = toPascal(name);
  const kebab = toKebab(name);
  const routePath = `/${kebab}`;
  const files = [
    join('src', 'pages', pascal, 'index.tsx'),
    ...['en', 'zh', 'ja', 'ru'].map((locale) => join('shared', 'i18n', 'locales', locale, `${kebab}.json`)),
  ];
  assertNewFiles(files);
  const appPath = join('src', 'App.tsx');
  const appText = await readFile(appPath, 'utf8');
  if (appText.includes(`path="${routePath}"`) || appText.includes(`const ${pascal} = lazy(`)) {
    throw new Error(`Refusing to scaffold page with existing app route or component: ${kebab}`);
  }
  await writeNewFile(files[0], `import { useTranslation } from 'react-i18next';

export function ${pascal}() {
  const { t } = useTranslation('${kebab}');

  return (
    <div className="flex h-full min-h-0 flex-col p-6" data-testid="${kebab}-page">
      <h1 className="font-serif text-2xl font-normal tracking-tight">{t('title')}</h1>
    </div>
  );
}
`);
  await writeSharedLocaleNamespaceStubs(kebab);
  const lazyMarker = "const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));";
  const routeMarker = '              <Route path="/settings/*" element={<Settings />} />';
  if (!appText.includes(lazyMarker) || !appText.includes(routeMarker)) {
    throw new Error(`Unable to find App route insertion markers in ${appPath}`);
  }
  const nextAppText = appText
    .replace(lazyMarker, `${lazyMarker}\nconst ${pascal} = lazy(() => import('./pages/${pascal}').then((m) => ({ default: m.${pascal} })));`)
    .replace(routeMarker, `${routeMarker}\n              <Route path="${routePath}" element={<${pascal} />} />`);
  await writePatchedFile(appPath, nextAppText);
}

async function makeE2e(name) {
  const kebab = toKebab(name);
  const files = [join('tests', 'e2e', `${kebab}.spec.ts`)];
  assertNewFiles(files);
  const registry = await readScenarioRegistry();
  if (!scenarioRegistryHasId(registry, kebab)) {
    throw new Error(`Refusing to scaffold E2E for unregistered scenario '${kebab}'. Use "pnpm agent-dev:make scenario ${kebab}" first.`);
  }
  await writeNewFile(files[0], `import { expect, openAgentDevScenario, test } from './fixtures/electron';

test('${kebab} scenario is reachable', async ({ page }) => {
  await openAgentDevScenario(page, '${kebab}');
  await expect(page.getByTestId('main-layout')).toBeVisible();
});
`);
}

async function makeHostRoute(name) {
  const kebab = toKebab(name);
  const pascal = toPascal(name);
  const camel = toCamel(name);
  const files = [join('electron', 'services', `${kebab}-api.ts`)];
  assertNewFiles(files);
  const contractPath = join('shared', 'host-api', 'contract.ts');
  const hostApiPath = join('src', 'lib', 'host-api.ts');
  const ipcPath = join('electron', 'main', 'ipc-handlers.ts');
  const contractText = await readFile(contractPath, 'utf8');
  const hostApiText = await readFile(hostApiPath, 'utf8');
  const ipcText = await readFile(ipcPath, 'utf8');
  if (
    contractText.includes(`  ${camel}: {`)
    || hostApiText.includes(`  ${camel}: {`)
    || ipcText.includes(`${camel}: create${pascal}Api()`)
  ) {
    throw new Error(`Refusing to scaffold host route with existing host-api module: ${camel}`);
  }
  const typeMarker = 'export type HostApiContract = {';
  const providerMarker = '  providers: {';
  const importMarker = "} from '@shared/host-api/contract';";
  const facadeMarker = '  providers: {';
  const ipcImportMarker = "import { createAgentDevApi } from '../services/agent-dev-api';";
  const registryMarker = '    agentDev: createAgentDevApi({ gatewayManager }),';
  for (const [path, marker] of [
    [contractPath, typeMarker],
    [contractPath, providerMarker],
    [hostApiPath, importMarker],
    [hostApiPath, facadeMarker],
    [ipcPath, ipcImportMarker],
    [ipcPath, registryMarker],
  ]) {
    if (!String(path === contractPath ? contractText : path === hostApiPath ? hostApiText : ipcText).includes(marker)) {
      throw new Error(`Unable to find host-route insertion marker in ${path}: ${marker}`);
    }
  }
  const nextContractText = contractText
    .replace(typeMarker, `export type ${pascal}PingResult = HostSuccess & { module: '${camel}' };\n\n${typeMarker}`)
    .replace(providerMarker, `  ${camel}: {\n    ping: () => ${pascal}PingResult;\n  };\n  providers: {`);

  const nextHostApiText = hostApiText
    .replace(importMarker, `  ${pascal}PingResult,\n${importMarker}`)
    .replace(facadeMarker, `  ${camel}: {\n    ping: (): Promise<${pascal}PingResult> => invokeHost('${camel}', 'ping'),\n  },\n  providers: {`);

  const nextIpcText = ipcText
    .replace(ipcImportMarker, `${ipcImportMarker}\nimport { create${pascal}Api } from '../services/${kebab}-api';`)
    .replace(registryMarker, `${registryMarker}\n    ${camel}: create${pascal}Api(),`);
  await writeNewFile(files[0], `import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';

export function create${pascal}Api(): CompleteHostServiceRegistry['${camel}'] {
  return {
    ping: () => ({ success: true, module: '${camel}' }),
  };
}
`);
  await writePatchedFile(contractPath, nextContractText);
  await writePatchedFile(hostApiPath, nextHostApiText);
  await writePatchedFile(ipcPath, nextIpcText);
}

async function makeSkill(name) {
  const kebab = toKebab(name);
  const pascal = toPascal(name);
  const root = join('skills', kebab);
  const files = [
    join(root, 'index.ts'),
    join(root, 'manifest.yaml'),
    join(root, 'schema.yaml'),
    join(root, '__fixtures__', 'mock-context.json'),
    join(root, '__tests__', 'unit.test.ts'),
    join(root, '__tests__', 'harness.spec.ts'),
    ...['en', 'zh', 'ja', 'ru'].map((locale) => join(root, 'i18n', `${locale}.json`)),
  ];
  assertNewFiles(files);
  await writeNewFile(join(root, 'index.ts'), `export type ${pascal}Input = {
  text: string;
};

export type ${pascal}Output = {
  text: string;
};

export async function run(input: ${pascal}Input): Promise<${pascal}Output> {
  return { text: input.text };
}
`);
  await writeNewFile(join(root, 'manifest.yaml'), `name: ${kebab}
version: 0.1.0
capabilities:
  - text.transform
i18nNamespace: skill-${kebab}
requiredPermissions: []
fixtures:
  - __fixtures__/mock-context.json
schemas:
  input: schema.yaml#/input
  output: schema.yaml#/output
`);
  await writeNewFile(join(root, 'schema.yaml'), `input:
  type: object
  required:
    - text
  properties:
    text:
      type: string
output:
  type: object
  required:
    - text
  properties:
    text:
      type: string
`);
  await writeNewFile(join(root, '__fixtures__', 'mock-context.json'), `{
  "input": {
    "text": "hello"
  }
}
`);
  await writeNewFile(join(root, '__tests__', 'unit.test.ts'), `import { describe, expect, it } from 'vitest';
import { run } from '../index';

describe('${kebab} skill', () => {
  it('returns a typed output payload', async () => {
    await expect(run({ text: 'hello' })).resolves.toEqual({ text: 'hello' });
  });
});
`);
  await writeNewFile(join(root, '__tests__', 'harness.spec.ts'), `import { describe, expect, it } from 'vitest';
import manifest from '../manifest.yaml?raw';
import schema from '../schema.yaml?raw';

describe('${kebab} skill harness contract', () => {
  it('declares manifest and schema assets', () => {
    expect(manifest).toContain('name: ${kebab}');
    expect(schema).toContain('input:');
  });
});
`);
  await writeLocaleStubs(join(root, 'i18n'), `skill-${kebab}`);
}

async function makeChannel(name) {
  const kebab = toKebab(name);
  const pascal = toPascal(name);
  const root = join('openclaw_runtime', 'extensions', 'channels', kebab);
  const files = [
    join(root, 'adapter.ts'),
    join(root, 'manifest.yaml'),
    join(root, 'schema.yaml'),
    join(root, '__fixtures__', 'send-text.json'),
    join(root, '__tests__', 'conformance.test.ts'),
  ];
  assertNewFiles(files);
  await writeNewFile(join(root, 'adapter.ts'), `export type ${pascal}ChannelMessage = {
  id: string;
  text: string;
};

export async function sendText(message: ${pascal}ChannelMessage): Promise<{ ok: true; id: string }> {
  return { ok: true, id: message.id };
}

export async function receiveText(): Promise<${pascal}ChannelMessage[]> {
  return [];
}
`);
  await writeNewFile(join(root, 'manifest.yaml'), `name: ${kebab}
version: 0.1.0
capabilities:
  - channel.send
  - channel.receive
schemas:
  message: schema.yaml#/message
diagnostics:
  logs: true
`);
  await writeNewFile(join(root, 'schema.yaml'), `message:
  type: object
  required:
    - id
    - text
  properties:
    id:
      type: string
    text:
      type: string
`);
  await writeNewFile(join(root, '__fixtures__', 'send-text.json'), `{
  "id": "fixture-message",
  "text": "hello"
}
`);
  await writeNewFile(join(root, '__tests__', 'conformance.test.ts'), `import { describe, expect, it } from 'vitest';
import { receiveText, sendText } from '../adapter';

describe('${kebab} channel conformance stub', () => {
  it('sends and receives text payloads', async () => {
    await expect(sendText({ id: 'fixture-message', text: 'hello' })).resolves.toEqual({
      ok: true,
      id: 'fixture-message',
    });
    await expect(receiveText()).resolves.toEqual([]);
  });
});
`);
}

async function makePlugin(name) {
  const kebab = toKebab(name);
  const root = join('plugins', kebab);
  const files = [
    join(root, 'manifest.yaml'),
    join(root, 'schema.yaml'),
    join(root, '__fixtures__', 'config.json'),
    join(root, '__tests__', 'manifest.test.ts'),
    ...['en', 'zh', 'ja', 'ru'].map((locale) => join(root, 'i18n', `${locale}.json`)),
  ];
  assertNewFiles(files);
  await writeNewFile(join(root, 'manifest.yaml'), `name: ${kebab}
version: 0.1.0
capabilities: []
i18nNamespace: plugin-${kebab}
requiredPermissions: []
schemas:
  config: schema.yaml#/config
`);
  await writeNewFile(join(root, 'schema.yaml'), `config:
  type: object
  additionalProperties: false
`);
  await writeNewFile(join(root, '__fixtures__', 'config.json'), `{}
`);
  await writeNewFile(join(root, '__tests__', 'manifest.test.ts'), `import { describe, expect, it } from 'vitest';
import manifest from '../manifest.yaml?raw';

describe('${kebab} plugin manifest', () => {
  it('declares the plugin name', () => {
    expect(manifest).toContain('name: ${kebab}');
  });
});
`);
  await writeLocaleStubs(join(root, 'i18n'), `plugin-${kebab}`);
}

async function makeScenario(name) {
  const kebab = toKebab(name);
  const files = [
    join('harness', 'specs', 'scenarios', `${kebab}.md`),
    join('tests', 'e2e', `${kebab}.spec.ts`),
  ];
  assertNewFiles(files);
  const nextRegistry = createScenarioRegistryText(await readScenarioRegistry(), kebab);
  await writeNewFile(join('harness', 'specs', 'scenarios', `${kebab}.md`), `---
id: ${kebab}
title: ${toPascal(kebab)}
type: scenario
requiredRules:
  - renderer-main-boundary
  - i18n-locale-coverage
---

# ${kebab}

## Purpose

Describe the user-visible Agent Dev scenario this seed makes reproducible.

## Required Rules

- harness/specs/rules/renderer-main-boundary.md
- harness/specs/rules/i18n-locale-coverage.md

## Validation

- pnpm agent-dev:make scenario ${kebab}
- pnpm test:e2e tests/e2e/${kebab}.spec.ts
`);
  await writeNewFile(join('tests', 'e2e', `${kebab}.spec.ts`), `import { expect, getAgentDevSnapshot, openAgentDevScenario, test } from './fixtures/electron';

test('${kebab} agent-dev scenario is reachable', async ({ page }) => {
  await openAgentDevScenario(page, '${kebab}');
  await expect(page.getByTestId('main-layout')).toBeVisible();
  await expect.poll(async () => getAgentDevSnapshot(page)).toEqual(
    expect.objectContaining({ devScenario: '${kebab}' }),
  );
});
`);
  await writeScenarioRegistryText(nextRegistry);
}

if (!kind || !rawName) {
  usage();
  process.exit(1);
}

if (!['page', 'e2e', 'host-route', 'skill', 'channel', 'plugin', 'scenario'].includes(kind)) {
  usage();
  process.exit(1);
}

try {
  if (kind === 'page') await makePage(rawName);
  if (kind === 'e2e') await makeE2e(rawName);
  if (kind === 'host-route') await makeHostRoute(rawName);
  if (kind === 'skill') await makeSkill(rawName);
  if (kind === 'channel') await makeChannel(rawName);
  if (kind === 'plugin') await makePlugin(rawName);
  if (kind === 'scenario') await makeScenario(rawName);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
