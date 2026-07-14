#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const LOCALES_DIR = resolve(ROOT, 'shared/i18n/locales');
const LANGUAGES = ['en', 'zh', 'ja', 'ru'];

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function flattenKeys(value, prefix = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }
  const keys = [];
  for (const [key, child] of Object.entries(value)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      keys.push(...flattenKeys(child, next));
    } else {
      keys.push(next);
    }
  }
  return keys.sort();
}

async function collectLocaleState(localesDir = LOCALES_DIR) {
  const state = {};
  for (const language of LANGUAGES) {
    const dir = resolve(localesDir, language);
    const files = (await readdir(dir)).filter((file) => file.endsWith('.json')).sort();
    state[language] = {};
    for (const file of files) {
      const namespace = file.replace(/\.json$/, '');
      state[language][namespace] = new Set(flattenKeys(await readJson(resolve(dir, file))));
    }
  }
  return state;
}

function collectLocaleIssues(localeState) {
  const issues = [];
  const baselineNamespaces = new Set(Object.keys(localeState.en ?? {}));
  for (const language of LANGUAGES) {
    const namespaces = new Set(Object.keys(localeState[language] ?? {}));
    for (const namespace of baselineNamespaces) {
      if (!namespaces.has(namespace)) {
        issues.push({ type: 'missing namespace', language, namespace });
      }
    }
    for (const namespace of namespaces) {
      if (!baselineNamespaces.has(namespace)) {
        issues.push({ type: 'extra namespace', language, namespace });
      }
    }
  }

  for (const namespace of baselineNamespaces) {
    const baselineKeys = localeState.en[namespace] ?? new Set();
    for (const language of LANGUAGES) {
      const keys = localeState[language]?.[namespace];
      if (!keys) continue;
      for (const key of baselineKeys) {
        if (!keys.has(key)) {
          issues.push({ type: 'missing key', language, namespace, key });
        }
      }
      for (const key of keys) {
        if (!baselineKeys.has(key)) {
          issues.push({ type: 'extra key', language, namespace, key });
        }
      }
    }
  }
  return issues;
}

async function walk(dir, predicate = () => true) {
  if (!existsSync(dir)) return [];
  const results = [];
  async function visit(abs) {
    for (const entry of await readdir(abs, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'dist-electron') continue;
      const full = resolve(abs, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (predicate(full)) results.push(full);
    }
  }
  await visit(dir);
  return results;
}

function extractUseTranslationNamespaces(text) {
  return [...text.matchAll(/useTranslation\(\s*['"]([^'"]+)['"]/g)].map((entry) => entry[1]);
}

async function collectUseTranslationIssues(namespaceSet, roots = [resolve(ROOT, 'src')]) {
  const issues = [];
  const files = [];
  for (const root of roots) {
    files.push(...await walk(root, (file) => /\.(tsx|ts)$/.test(file)));
  }
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    for (const namespace of extractUseTranslationNamespaces(text)) {
      if (!namespaceSet.has(namespace)) {
        issues.push({
          type: 'unknown namespace',
          file: relative(ROOT, file).replace(/\\/g, '/'),
          namespace,
        });
      }
    }
  }
  return issues;
}

function changedTsxFiles() {
  try {
    const output = execFileSync('git', ['diff', '--name-only', '--diff-filter=A', '--', '*.tsx'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function collectHardcodedTextIssuesFromSource(text, file) {
  const issues = [];
  const patterns = [
    />\s*([A-Z][A-Za-z][^<>{}\n]{2,})\s*</g,
    /\b(?:title|aria-label|placeholder)=["']([A-Z][A-Za-z][^"']{2,})["']/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = match[1].trim();
      if (/^(TODO|OK|URL|ID)$/.test(value)) continue;
      issues.push({ type: 'hardcoded text', file, value });
    }
  }
  return issues;
}

async function collectHardcodedTextIssues(files = changedTsxFiles()) {
  const issues = [];
  for (const file of files) {
    const abs = resolve(ROOT, file);
    if (!existsSync(abs)) continue;
    issues.push(...collectHardcodedTextIssuesFromSource(await readFile(abs, 'utf8'), file.replace(/\\/g, '/')));
  }
  return issues;
}

function formatI18nIssue(issue) {
  if (issue.key) return `${issue.type}: ${issue.language}/${issue.namespace}.${issue.key}`;
  if (issue.namespace && issue.language) return `${issue.type}: ${issue.language}/${issue.namespace}`;
  if (issue.namespace && issue.file) return `${issue.type}: ${issue.file} -> ${issue.namespace}`;
  if (issue.value) return `${issue.type}: ${issue.file} -> ${JSON.stringify(issue.value)}`;
  return JSON.stringify(issue);
}

export {
  LANGUAGES,
  collectHardcodedTextIssues,
  collectHardcodedTextIssuesFromSource,
  collectLocaleIssues,
  collectLocaleState,
  collectUseTranslationIssues,
  extractUseTranslationNamespaces,
  flattenKeys,
  formatI18nIssue,
};

async function main() {
  const localeState = await collectLocaleState();
  const namespaceSet = new Set(Object.keys(localeState.en ?? {}));
  const issues = [
    ...collectLocaleIssues(localeState),
    ...await collectUseTranslationIssues(namespaceSet),
    ...await collectHardcodedTextIssues(),
  ];
  if (issues.length > 0) {
    console.error('i18n lint failed:');
    for (const issue of issues) console.error(`- ${formatI18nIssue(issue)}`);
    process.exitCode = 1;
    return;
  }
  console.log('i18n lint passed.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
