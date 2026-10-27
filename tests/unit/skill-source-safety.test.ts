import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { __testing as pluginSkillsTesting } from '../../openclaw_runtime/src/skills/loading/plugin-skills';
import { __testing as workspaceSkillsTesting } from '../../openclaw_runtime/src/skills/loading/workspace';

const DIR_LINK_TYPE: 'dir' | 'junction' = process.platform === 'win32' ? 'junction' : 'dir';

describe('skill source safety', () => {
  it('does not treat a regular plugin-skills directory as a generated stale link', () => {
    const root = mkdtempSync(join(tmpdir(), 'clawx-plugin-skill-source-safety-'));
    try {
      const pluginSkillsDir = join(root, 'plugin-skills');
      const regularSkillDir = join(pluginSkillsDir, 'qqbot-channel');
      mkdirSync(regularSkillDir, { recursive: true });
      writeFileSync(join(regularSkillDir, 'SKILL.md'), '# user-owned skill\n', 'utf8');

      pluginSkillsTesting.publishPluginSkills([], { pluginSkillsDir });

      expect(existsSync(join(regularSkillDir, 'SKILL.md'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails before syncing skills through a link that resolves into a protected source root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'clawx-synced-skill-source-safety-'));
    try {
      const sourceRoot = join(root, 'source');
      const sourceSkillDir = join(sourceRoot, 'skills', 'qqbot-channel');
      mkdirSync(sourceSkillDir, { recursive: true });
      writeFileSync(join(sourceSkillDir, 'SKILL.md'), '# protected source\n', 'utf8');

      const targetSkillsDir = join(root, 'target', 'skills');
      mkdirSync(targetSkillsDir, { recursive: true });
      const linkedSkillDir = join(targetSkillsDir, 'qqbot-channel');
      symlinkSync(sourceSkillDir, linkedSkillDir, DIR_LINK_TYPE);

      await expect(
        workspaceSkillsTesting.prepareSyncedSkillsDirectory(targetSkillsDir, [sourceSkillDir]),
      ).rejects.toThrow(/overlaps a protected source root/u);

      expect(existsSync(join(sourceSkillDir, 'SKILL.md'))).toBe(true);
      expect(existsSync(linkedSkillDir)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
