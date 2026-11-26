export const ACCENT_PRESETS = {
  original: 'default',
  ocean: '#3569c8',
  jade: '#20816d',
  iris: '#8461b9',
  rose: '#b24b70',
  amber: '#a76923',
} as const;

export const READING_FONTS = ['system', 'serif', 'mono'] as const;
export const SETTINGS_TEXT_SIZES = ['standard', 'large', 'larger'] as const;
export const MIN_READING_SIZE = 12;
export const MAX_READING_SIZE = 22;
export const DEFAULT_REPLY_SIZE = 17;

export interface AppearancePreferences {
  accent: string;
  settingsText: (typeof SETTINGS_TEXT_SIZES)[number];
  fontSize: number | null;
  fontFamily: (typeof READING_FONTS)[number];
}

export const DEFAULT_APPEARANCE: AppearancePreferences = {
  accent: 'default',
  settingsText: 'standard',
  fontSize: null,
  fontFamily: 'system',
};

export function normalizeAppearance(value: unknown): AppearancePreferences {
  const saved = (value ?? {}) as Partial<AppearancePreferences>;
  return {
    settingsText: SETTINGS_TEXT_SIZES.find((size) => size === saved.settingsText) ?? DEFAULT_APPEARANCE.settingsText,
    accent: typeof saved.accent === 'string' && /^#[\da-f]{6}$/i.test(saved.accent)
      ? saved.accent.toLowerCase() : DEFAULT_APPEARANCE.accent,
    fontSize: typeof saved.fontSize === 'number' && Number.isInteger(saved.fontSize)
      && saved.fontSize >= MIN_READING_SIZE && saved.fontSize <= MAX_READING_SIZE
      ? saved.fontSize : DEFAULT_APPEARANCE.fontSize,
    fontFamily: READING_FONTS.find((font) => font === saved.fontFamily) ?? DEFAULT_APPEARANCE.fontFamily,
  };
}

export function applyDocumentAppearance(root: HTMLElement, appearance: AppearancePreferences) {
  if (appearance.fontSize === null) root.style.removeProperty('--reading-size');
  else root.style.setProperty('--reading-size', `${appearance.fontSize}px`);
  root.dataset.readingFont = appearance.fontFamily;
  root.dataset.settingsText = appearance.settingsText;
  root.toggleAttribute('data-custom-accent', appearance.accent !== 'default');
  if (appearance.accent === 'default') root.style.removeProperty('--appearance-source');
  else root.style.setProperty('--appearance-source', appearance.accent);
}
