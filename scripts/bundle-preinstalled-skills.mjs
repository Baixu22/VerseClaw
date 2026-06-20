#!/usr/bin/env node

import { readFileSync, existsSync, mkdirSync, rmSync, cpSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MANIFEST_PATH = join(ROOT, 'resources', 'skills', 'preinstalled-manifest.json');
const LOCAL_SOURCE_ROOT = join(ROOT, 'resources', 'skills', 'preinstalled');
const OUTPUT_ROOT = join(ROOT, 'build', 'preinstalled-skills');

function log(message) {
  console.log(message);
}

function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error(`Missing manifest: ${MANIFEST_PATH}`);
  }
  const raw = readFileSync(MANIFEST_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.skills)) {
    throw new Error('Invalid preinstalled-skills manifest format');
  }
  for (const item of parsed.skills) {
    if (!item.slug) {
      throw new Error(`Invalid manifest entry: ${JSON.stringify(item)}`);
    }
  }
  return parsed.skills;
}

function shouldCopySkillFile(srcPath) {
  const parts = srcPath.split(/[\\/]/);
  return !parts.includes('.git') && !parts.includes('node_modules');
}

function resolveLocalSkillSource(entry) {
  const relativeSource = entry.sourcePath || entry.localPath || entry.slug;
  return join(LOCAL_SOURCE_ROOT, relativeSource);
}

log('Bundling preinstalled skills from local resources...');

if (process.env.SKIP_PREINSTALLED_SKILLS === '1') {
  log('SKIP_PREINSTALLED_SKILLS=1 set, skipping skills bundle.');
  process.exit(0);
}

if (!existsSync(LOCAL_SOURCE_ROOT)) {
  throw new Error(`Missing local preinstalled skills directory: ${LOCAL_SOURCE_ROOT}`);
}

const manifestSkills = loadManifest();

rmSync(OUTPUT_ROOT, { recursive: true, force: true });
mkdirSync(OUTPUT_ROOT, { recursive: true });

const lock = {
  generatedAt: new Date().toISOString(),
  source: 'local',
  skills: [],
};

for (const entry of manifestSkills) {
  const sourceDir = resolveLocalSkillSource(entry);
  const targetDir = join(OUTPUT_ROOT, entry.slug);

  if (!existsSync(sourceDir)) {
    throw new Error(`Missing local preinstalled skill source for ${entry.slug}: ${sourceDir}`);
  }

  rmSync(targetDir, { recursive: true, force: true });
  cpSync(sourceDir, targetDir, { recursive: true, dereference: true, filter: shouldCopySkillFile });

  const skillManifest = join(targetDir, 'SKILL.md');
  if (!existsSync(skillManifest)) {
    throw new Error(`Skill ${entry.slug} is missing SKILL.md after copy`);
  }

  const resolvedVersion = (entry.version || 'local').trim() || 'local';
  lock.skills.push({
    slug: entry.slug,
    version: resolvedVersion,
    source: 'local',
    sourcePath: entry.sourcePath || entry.localPath || entry.slug,
  });

  log(`   OK ${entry.slug}`);
}

writeFileSync(join(OUTPUT_ROOT, '.preinstalled-lock.json'), `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
log(`Preinstalled skills ready: ${OUTPUT_ROOT}`);
