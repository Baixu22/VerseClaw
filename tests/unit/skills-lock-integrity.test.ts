import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const LOCK_PATH = join(ROOT, 'skills-lock.json');

type SkillLockEntry = {
  source?: string;
  sourceType?: string;
  skillPath?: string;
  computedHash?: string;
};

type SkillLock = {
  version?: number;
  skills?: Record<string, SkillLockEntry>;
};

function readLock(): SkillLock {
  return JSON.parse(readFileSync(LOCK_PATH, 'utf8')) as SkillLock;
}

function sha256File(absolutePath: string): string {
  return createHash('sha256').update(readFileSync(absolutePath)).digest('hex');
}

// Regression for issue #73. The root skills lock used to point at
// `packages/agent/plugin/skills/tool-ui/SKILL.md` (a path that never existed in
// this repository) with a `computedHash` that matched nothing, so the file was
// misleading metadata that no integrity check could ever satisfy. Every entry
// must now resolve to a real file whose bytes hash to the recorded value.
describe('skills lock integrity', () => {
  it('exists and parses as a versioned lock file', () => {
    expect(existsSync(LOCK_PATH)).toBe(true);
    const lock = readLock();
    expect(lock.version).toBe(1);
    expect(Object.keys(lock.skills ?? {}).length).toBeGreaterThan(0);
  });

  it('points every locked skill at an existing file inside the repository', () => {
    const lock = readLock();
    const entries = Object.entries(lock.skills ?? {});
    const missing: string[] = [];

    for (const [name, entry] of entries) {
      const skillPath = entry.skillPath;
      if (!skillPath) {
        missing.push(`${name}: skillPath is required`);
        continue;
      }
      const absolute = resolve(ROOT, skillPath);
      if (!absolute.startsWith(ROOT)) {
        missing.push(`${name}: skillPath must stay inside the repository (${skillPath})`);
        continue;
      }
      if (!existsSync(absolute)) {
        missing.push(`${name}: skillPath does not exist (${skillPath})`);
      }
    }

    expect(missing).toEqual([]);
  });

  it('records a computedHash that matches the locked file bytes', () => {
    const lock = readLock();
    const mismatches: string[] = [];

    for (const [name, entry] of Object.entries(lock.skills ?? {})) {
      if (!entry.skillPath || !entry.computedHash) {
        mismatches.push(`${name}: skillPath and computedHash are both required`);
        continue;
      }
      const absolute = resolve(ROOT, entry.skillPath);
      if (!existsSync(absolute)) continue; // covered by the resolution test
      const actual = sha256File(absolute);
      if (actual !== entry.computedHash) {
        mismatches.push(`${name}: computedHash ${entry.computedHash} != actual ${actual}`);
      }
    }

    expect(mismatches).toEqual([]);
  });
});
