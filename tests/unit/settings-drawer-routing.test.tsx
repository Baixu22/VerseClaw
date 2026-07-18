import { describe, expect, it } from 'vitest';
import { toRoutePath } from '@/lib/settings-overlay-routing';

describe('settings drawer routing contract', () => {
  it('preserves the full background route when settings is opened', () => {
    expect(toRoutePath({ pathname: '/knowledge', search: '?tab=drafts', hash: '#proposal' }))
      .toBe('/knowledge?tab=drafts#proposal');
  });

  it('uses chat as the direct deep-link fallback', () => {
    expect(toRoutePath({ pathname: '/' })).toBe('/');
  });
});
