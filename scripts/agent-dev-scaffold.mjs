#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [, , kind, rawName] = process.argv;

function usage() {
  console.log('Usage: pnpm agent-dev:make <page|e2e|host-route> <name>');
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

async function writeNewFile(path, content) {
  if (existsSync(path)) {
    throw new Error(`Refusing to overwrite existing file: ${path}`);
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
  console.log(path);
}

async function makePage(name) {
  const pascal = toPascal(name);
  const kebab = toKebab(name);
  await writeNewFile(join('src', 'pages', pascal, 'index.tsx'), `import { useTranslation } from 'react-i18next';

export function ${pascal}() {
  const { t } = useTranslation('${kebab}');

  return (
    <div className="flex h-full min-h-0 flex-col p-6" data-testid="${kebab}-page">
      <h1 className="font-serif text-2xl font-normal tracking-tight">{t('title')}</h1>
    </div>
  );
}
`);
}

async function makeE2e(name) {
  const kebab = toKebab(name);
  await writeNewFile(join('tests', 'e2e', `${kebab}.spec.ts`), `import { expect, openAgentDevScenario, test } from './fixtures/electron';

test('${kebab} scenario is reachable', async ({ page }) => {
  await openAgentDevScenario(page, '${kebab}');
  await expect(page.getByTestId('main-layout')).toBeVisible();
});
`);
}

async function makeHostRoute(name) {
  const kebab = toKebab(name);
  const pascal = toPascal(name);
  await writeNewFile(join('electron', 'services', `${kebab}-api.ts`), `import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';

export function create${pascal}Api(): Partial<CompleteHostServiceRegistry> {
  return {};
}
`);
}

if (!kind || !rawName) {
  usage();
  process.exit(1);
}

if (!['page', 'e2e', 'host-route'].includes(kind)) {
  usage();
  process.exit(1);
}

try {
  if (kind === 'page') await makePage(rawName);
  if (kind === 'e2e') await makeE2e(rawName);
  if (kind === 'host-route') await makeHostRoute(rawName);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
