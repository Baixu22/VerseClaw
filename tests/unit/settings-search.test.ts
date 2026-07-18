import { describe, expect, it } from 'vitest';
import { filterSettingsSections } from '@/lib/settings-search';

const sections = [
  { id: 'models', title: 'Models & Providers', description: 'Provider accounts and defaults.' },
  { id: 'storage', title: 'Storage & Memory', description: 'Clean caches and session artefacts.' },
];

describe('filterSettingsSections', () => {
  it('matches titles and descriptions without changing values', () => {
    expect(filterSettingsSections(sections, 'provider').map((section) => section.id)).toEqual(['models']);
    expect(filterSettingsSections(sections, 'CACHE').map((section) => section.id)).toEqual(['storage']);
  });

  it('returns all categories for a blank query', () => {
    expect(filterSettingsSections(sections, '  ')).toEqual(sections);
  });
});
