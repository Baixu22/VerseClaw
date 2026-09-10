// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CURRENT_PRODUCT_SURFACES,
  findForbiddenClaims,
} from '../../scripts/scan-first-product-claims.mjs';

const rootDir = process.cwd();

const expectedComponentLabels = new Map([
  ['DCS coding loop', 'opt-in'],
  ['DCS Fact view and tool registry', 'opt-in'],
  ['VToken turn assembly', 'opt-in'],
  ['SEKB automatic writeback', 'deferred'],
  ['C6 automatic context ladder', 'deferred'],
  ['C7 knowledge/routing cutover', 'deferred'],
  ['Coding WAL', 'deferred'],
  ['Browser supervised workflows', 'experimental'],
  ['Runtime Memory injection', 'diagnostics-only'],
  ['Surfaces listed in RETIRED-SURFACES.md', 'retired'],
]);

describe('FP-P1-08 first-product claim boundary', () => {
  it('keeps forbidden graduation terms out of every current product surface', () => {
    const violations = [];
    for (const filePath of CURRENT_PRODUCT_SURFACES) {
      const matches = findForbiddenClaims(readFileSync(join(rootDir, filePath), 'utf8'));
      if (matches.length > 0) violations.push({ filePath, matches });
    }
    expect(violations).toEqual([]);
  });

  it('treats explicit enablement-negation lines and historical "GA hardening" references as non-claims', () => {
    // Disclaimer phrasings used by the four README evidence paragraphs.
    expect(findForbiddenClaims('This is engineering evidence only and does not enable default-on, GA, or product approval.')).toEqual([]);
    expect(findForbiddenClaims('这只是 engineering evidence，不开启 default-on、GA 或产品审批。')).toEqual([]);
    expect(findForbiddenClaims('これは engineering evidence であり、default-on、GA を有効化しません。')).toEqual([]);
    expect(findForbiddenClaims('A GA hardening pass (2026-08-19) added verification; product locks remain unchanged.')).toEqual([]);
    // Real graduation claims must stay flagged.
    expect(findForbiddenClaims('This feature ships default-on.')).toEqual([{ term: 'default-on', line: 1, count: 1 }]);
    expect(findForbiddenClaims('Now GA for all users.')).toEqual([{ term: 'ga-abbreviation', line: 1, count: 1 }]);
  });

  it('assigns exactly one canonical label to every controlled-preview component', () => {
    const semantics = readFileSync(join(rootDir, 'docs/clawx-product-semantics.md'), 'utf8');
    const section = semantics.split('<!-- FP-P1-08-COMPONENT-STATUS-START -->')[1]
      ?.split('<!-- FP-P1-08-COMPONENT-STATUS-END -->')[0];
    expect(section).toBeDefined();

    const rows = section!
      .split(/\r?\n/)
      .filter((line) => /^\| [^|-].*\| `[^`]+` \|/.test(line))
      .map((line) => {
        const cells = line.split('|').map((cell) => cell.trim());
        return [cells[1], cells[2].replaceAll('`', '')] as const;
      });

    expect(rows).toHaveLength(expectedComponentLabels.size);
    expect(new Set(rows.map(([component]) => component)).size).toBe(rows.length);
    expect(new Map(rows)).toEqual(expectedComponentLabels);
  });

  it('shows the Windows x64 opt-in boundary in Setup and Settings for all locales', () => {
    for (const language of ['en', 'zh', 'ja', 'ru']) {
      const setup = JSON.parse(readFileSync(
        join(rootDir, `shared/i18n/locales/${language}/setup.json`),
        'utf8',
      )) as { welcome: { features: { crossPlatform: string } } };
      const settings = JSON.parse(readFileSync(
        join(rootDir, `shared/i18n/locales/${language}/settings.json`),
        'utf8',
      )) as {
        developer: {
          dcsProdFlags: { title: string; modeOptIn: string };
          dcsPreview: { title: string; description: string };
          vtokenBridge: { description: string };
        };
      };

      expect(setup.welcome.features.crossPlatform).toContain('Windows x64');
      expect(settings.developer.dcsProdFlags.title).toContain('Controlled Preview');
      expect(settings.developer.dcsProdFlags.modeOptIn).toContain('opt-in');
      expect(settings.developer.dcsPreview.title).toContain('Controlled Preview');
      expect(settings.developer.dcsPreview.description).toMatch(/opt-in/i);
      expect(settings.developer.vtokenBridge.description).toMatch(/opt-in/i);
    }
  });
});
