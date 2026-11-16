import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Diagnostic reproduction: success means the recorded configuration divergence exists.
// Run with the runtime tsx loader, TEMP/TMP on the task scratch drive, and an output path.
const outputPath = process.argv[2];
if (!outputPath) throw new Error('Pass an output JSON path.');
const temp = mkdtempSync(join(tmpdir(), 'clawx-skill-boundary-'));
process.env.VERSE_CLAW_USER_DATA_DIR = join(temp, 'app');
process.env.OPENCLAW_CONFIG_DIR = join(temp, 'runtime');
mkdirSync(process.env.OPENCLAW_CONFIG_DIR, { recursive: true });
const configPath = join(process.env.OPENCLAW_CONFIG_DIR, 'openclaw.json');
writeFileSync(configPath, JSON.stringify({ skills: { entries: { 'audit-skill': { enabled: true } } } }));
const { updateSkillConfigs } = await import(new URL('../../../../electron/utils/skill-config.ts', import.meta.url).href);
const result = await updateSkillConfigs([{ skillKey: 'audit-skill', enabled: false }]);
const local = JSON.parse(readFileSync(join(process.env.VERSE_CLAW_USER_DATA_DIR, 'verse-claw-skills.json'), 'utf8'));
const runtime = JSON.parse(readFileSync(configPath, 'utf8'));
const record = {
  driven_by: 'agent', actor: 'codex-skill-mcp-audit', result,
  localEnabled: local.entries['audit-skill'].enabled,
  runtimeEnabled: runtime.skills.entries['audit-skill'].enabled,
  scope: 'Isolated filesystem call to the real Main config function; not Electron end-to-end.',
};
writeFileSync(outputPath, JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify(record));
if (!result.success || record.localEnabled !== false || record.runtimeEnabled !== true) process.exitCode = 1;
