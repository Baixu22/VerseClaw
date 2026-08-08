export const SUPPORTED_LANGUAGE_CODES = ['en', 'zh', 'ja', 'ru'] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGE_CODES)[number];

function normalizeLocale(locale: string | null | undefined): string {
  return locale?.trim().toLowerCase().replaceAll('_', '-') ?? '';
}

export function resolveSupportedLanguage(
  locale: string | null | undefined,
  fallback: LanguageCode = 'en',
): LanguageCode {
  const normalizedLocale = normalizeLocale(locale);
  if (!normalizedLocale) {
    return fallback;
  }

  const [baseLanguage] = normalizedLocale.split('-');
  return baseLanguage === 'en' || baseLanguage === 'zh' || baseLanguage === 'ja' || baseLanguage === 'ru'
    ? (baseLanguage as LanguageCode)
    : fallback;
}
