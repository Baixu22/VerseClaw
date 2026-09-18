import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import {
    SUPPORTED_LANGUAGE_CODES,
    resolveSupportedLanguage,
    type LanguageCode,
} from '@shared/language';
import { I18N_NAMESPACES, I18N_RESOURCES } from '@shared/i18n/resources';

export const SUPPORTED_LANGUAGES = [
    { code: 'en', label: 'English' },
    { code: 'zh', label: '中文' },
    { code: 'ja', label: '日本語' },
    { code: 'ru', label: 'Русский' },
] as const satisfies ReadonlyArray<{ code: LanguageCode; label: string }>;

i18n
    .use(initReactI18next)
    .init({
        resources: I18N_RESOURCES,
        lng: resolveSupportedLanguage(typeof navigator !== 'undefined' ? navigator.language : undefined),
        fallbackLng: 'en',
        supportedLngs: [...SUPPORTED_LANGUAGE_CODES],
        defaultNS: 'common',
        ns: [...I18N_NAMESPACES],
        interpolation: {
            escapeValue: false, // React already escapes
        },
        react: {
            useSuspense: false,
        },
    });

// Keep the document language in sync with the active i18n language.
// The store (settings.setLanguage / init) drives i18n.changeLanguage; without
// this listener <html lang> stays at its initial value forever, so a UI
// rendered in Russian is still announced as English to assistive tech — and
// any contract that reads the lang attribute (E2E, a11y audits) sees a stale
// value even though the rendered text is correct. (issue #49)
function syncDocumentLanguage(lng: string | undefined): void {
    if (typeof document === 'undefined') return;
    const resolved = resolveSupportedLanguage(lng);
    if (resolved && resolved !== document.documentElement.lang) {
        document.documentElement.lang = resolved;
    }
}

i18n.on('languageChanged', (lng: string) => syncDocumentLanguage(lng));
syncDocumentLanguage(i18n.language);

export default i18n;
