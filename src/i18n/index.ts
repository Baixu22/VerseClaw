import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import {
    resolveSupportedLanguage,
    SUPPORTED_LANGUAGE_CODES,
    type LanguageCode,
} from '@shared/language';
import { I18N_NAMESPACES } from '@shared/i18n/namespaces';
import {
    getEnglishResources,
    isEnglish,
    loadLanguageResources,
} from './resources';

export const SUPPORTED_LANGUAGES = [
    { code: 'en', label: 'English' },
    { code: 'zh', label: '中文' },
    { code: 'ja', label: '日本語' },
    { code: 'ru', label: 'Русский' },
] as const satisfies ReadonlyArray<{ code: LanguageCode; label: string }>;

const initialLanguage = resolveSupportedLanguage(
    typeof navigator !== 'undefined' ? navigator.language : undefined,
);

const i18nInitialization = i18n
    .use(initReactI18next)
    .init({
        // Only the fallback tree is synchronous. Other languages are added by
        // ensureLanguageResources before they become active.
        resources: { en: getEnglishResources() },
        lng: 'en',
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

const loadedLanguages = new Set<LanguageCode>(['en']);
let languageRequest = 0;

async function ensureLanguageResources(language: LanguageCode): Promise<void> {
    if (loadedLanguages.has(language) || isEnglish(language)) return;

    const resources = await loadLanguageResources(language);
    for (const namespace of I18N_NAMESPACES) {
        i18n.addResourceBundle(
            language,
            namespace,
            resources[namespace] ?? {},
            true,
            true,
        );
    }
    loadedLanguages.add(language);
}

/**
 * Change the active language after its bundle has loaded. Use this instead of
 * calling i18n.changeLanguage directly so a switch never renders raw keys
 * while the dynamic import is in flight.
 */
export async function changeLanguageWithResources(language: string): Promise<void> {
    const request = ++languageRequest;
    const resolved = resolveSupportedLanguage(language);
    if (!isEnglish(resolved)) {
        try {
            await ensureLanguageResources(resolved);
        } catch (error) {
            console.warn(`[i18n] failed to load ${resolved} resources`, error);
        }
    }
    if (request === languageRequest) await i18n.changeLanguage(resolved);
}

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

/**
 * Ready once the navigator-derived locale is available. main.tsx waits for
 * this before mounting so the first frame never flashes English for a zh/ja/ru
 * system locale.
 */
export const i18nReady = (async () => {
    try {
        await i18nInitialization;
    } catch (error) {
        console.error('[i18n] initialization failed', error);
        return;
    }
    if (!isEnglish(initialLanguage)) {
        try {
            await ensureLanguageResources(initialLanguage);
            await i18n.changeLanguage(initialLanguage);
        } catch (error) {
            console.warn(`[i18n] failed to initialize ${initialLanguage}`, error);
        }
    }
})();

export default i18n;
