import { describe, expect, it } from 'vitest';
import {
  collectHardcodedTextIssuesFromSource,
  collectLocaleIssues,
  extractUseTranslationNamespaces,
  flattenKeys,
} from '../../scripts/i18n-lint.mjs';

describe('i18n lint', () => {
  it('flattens nested locale keys', () => {
    expect(flattenKeys({ nav: { home: 'Home' }, action: 'Save' })).toEqual(['action', 'nav.home']);
  });

  it('reports missing and extra locale keys', () => {
    const issues = collectLocaleIssues({
      en: { common: new Set(['action.save', 'nav.home']) },
      zh: { common: new Set(['action.save']) },
      ja: { common: new Set(['action.save', 'nav.home', 'extra.key']) },
      ru: {},
    });

    expect(issues).toEqual(expect.arrayContaining([
      { type: 'missing key', language: 'zh', namespace: 'common', key: 'nav.home' },
      { type: 'extra key', language: 'ja', namespace: 'common', key: 'extra.key' },
      { type: 'missing namespace', language: 'ru', namespace: 'common' },
    ]));
  });

  it('extracts useTranslation namespaces', () => {
    expect(extractUseTranslationNamespaces("const { t } = useTranslation('settings');")).toEqual(['settings']);
  });

  it('detects obvious hardcoded TSX text in new files', () => {
    expect(collectHardcodedTextIssuesFromSource('<button title="Save changes">Save changes</button>', 'NewPage.tsx'))
      .toEqual(expect.arrayContaining([
        { type: 'hardcoded text', file: 'NewPage.tsx', value: 'Save changes' },
      ]));
  });
});
