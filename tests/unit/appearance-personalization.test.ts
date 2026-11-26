import { describe, expect, it } from 'vitest';
import { applyDocumentAppearance, DEFAULT_APPEARANCE, normalizeAppearance } from '@/lib/appearance';

describe('saved appearance preferences', () => {
  it('keeps existing profiles and resets each invalid preference independently', () => {
    expect(normalizeAppearance(undefined)).toEqual(DEFAULT_APPEARANCE);
    expect(normalizeAppearance({ accent: '#AABBCC', fontSize: 90, fontFamily: 'serif' }))
      .toEqual({ ...DEFAULT_APPEARANCE, accent: '#aabbcc', fontSize: null, fontFamily: 'serif' });
    expect(normalizeAppearance({ accent: 'url(x)', fontSize: 12, fontFamily: 'unavailable' }))
      .toEqual({ ...DEFAULT_APPEARANCE, accent: 'default', fontSize: 12, fontFamily: 'system' });
    expect(normalizeAppearance({ fontSize: 15.5 }).fontSize).toBeNull();
  });

  it('removes document overrides when the user restores the original appearance', () => {
    const root = document.createElement('div');
    applyDocumentAppearance(root, { settingsText: 'larger', accent: '#014355', fontSize: 22, fontFamily: 'mono' });
    expect(root.hasAttribute('data-custom-accent')).toBe(true);
    expect(root.style.getPropertyValue('--reading-size')).toBe('22px');
    expect(root.dataset.readingFont).toBe('mono');
    expect(root.dataset.settingsText).toBe('larger');
    applyDocumentAppearance(root, DEFAULT_APPEARANCE);
    expect(root.hasAttribute('data-custom-accent')).toBe(false);
    expect(root.style.getPropertyValue('--appearance-source')).toBe('');
    expect(root.style.getPropertyValue('--reading-size')).toBe('');
    expect(root.dataset.readingFont).toBe('system');
    expect(root.dataset.settingsText).toBe('standard');
  });
});
