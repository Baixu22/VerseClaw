import { describe, expect, it } from 'vitest';
import { resolveUiVersion } from '@/lib/ui-version';

describe('resolveUiVersion', () => {
  it('enables UI v2 by default on every supported desktop platform', () => {
    expect(resolveUiVersion('win32', '')).toBe('v2');
    expect(resolveUiVersion('darwin', '')).toBe('v2');
    expect(resolveUiVersion('linux', '')).toBe('v2');
  });

  it('allows an explicit development override', () => {
    expect(resolveUiVersion('win32', '?uiVersion=legacy')).toBe('legacy');
    expect(resolveUiVersion('darwin', '?uiVersion=legacy')).toBe('legacy');
    expect(resolveUiVersion('linux', '?uiVersion=v2')).toBe('v2');
  });
});

