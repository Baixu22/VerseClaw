// Deterministic renderer for the human-readable component disposition matrix.
// Source of truth: shared/dcs/component-disposition-catalog.ts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPONENT_DISPOSITION_ENTRIES } from '../shared/dcs/component-disposition-catalog';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'docs/dev/component-disposition-matrix-20261021.md');
const source = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
const header = '| ID | Disposition | Current → target | User entry / visibility | Owner | Implementation / retirement node | Experiment expiry | Current consumers | Coverage | Evidence |';
const start = source.indexOf(header);
const end = source.indexOf('\n## Validation', start);
if (start < 0 || end < 0) throw new Error('matrix markers not found');

function cell(value: string): string {
  return value.replaceAll('|', '\\|').replace(/\n/g, '<br>');
}

function coverage(entry: (typeof COMPONENT_DISPOSITION_ENTRIES)[number]): string {
  const groups: string[] = [];
  const authority = entry.coverage.authorityComponentIds ?? [];
  const flags = entry.coverage.dcsFlagIds ?? [];
  const runtime = entry.coverage.runtimeLeafPatterns ?? [];
  const sections = entry.coverage.settingsSectionIds ?? [];
  const panels = entry.coverage.settingsPanelIds ?? [];
  const routes = entry.coverage.routePaths ?? [];
  if (authority.length) groups.push(`authority:${authority.join(',')}`);
  if (flags.length) groups.push(`flags:${flags.join(',')}`);
  if (runtime.length) groups.push(`runtime:${runtime.join(',')}`);
  if (sections.length) groups.push(`sections:${sections.join(',')}`);
  if (panels.length) groups.push(`panels:${panels.join(',')}`);
  if (routes.length) groups.push(`routes:${routes.join(',')}`);
  return groups.join('<br>');
}

const rows = COMPONENT_DISPOSITION_ENTRIES.map((entry) => {
  const node = entry.implementationNodeId ?? entry.retirementNodeId ?? '—';
  const visibility = entry.userEntry
    ? `\`${entry.userEntry}\``
    : entry.visibility === 'retired'
      ? 'retired ONLY'
      : 'internal ONLY';
  return [
    `\`${entry.id}\``,
    `**${entry.disposition}**`,
    `${entry.currentMode} → ${entry.targetDefaultMode}`,
    visibility,
    `\`${entry.owner}\``,
    `\`${node}\``,
    entry.expiry ?? '—',
    entry.currentConsumers.join('<br>'),
    coverage(entry),
    entry.evidenceRefs.join('<br>'),
  ].map(cell).join(' | ');
});
const table = [
  header,
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...rows.map((row) => `| ${row} |`),
].join('\n');
const counts = Object.fromEntries(['default', 'advanced', 'internal', 'experiment', 'retired'].map((disposition) => [disposition, COMPONENT_DISPOSITION_ENTRIES.filter((entry) => entry.disposition === disposition).length]));
let rendered = source.slice(0, start) + table + source.slice(end);
for (const [disposition, count] of Object.entries(counts)) {
  rendered = rendered.replace(new RegExp(`^\\| ${disposition} \\| \\d+ \\|$`, 'mu'), `| ${disposition} | ${count} |`);
}
fs.writeFileSync(target, rendered, 'utf8');
console.log(JSON.stringify({ ok: true, rows: rows.length, target }, null, 2));