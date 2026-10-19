/**
 * Renderer translation resources.
 *
 * English is the fallback and is always available. Other languages are loaded
 * on demand so a startup only pays for the active locale instead of parsing
 * all four locale trees (previously ~1.4 MB of JSON on the entry chunk).
 */
import type { LanguageCode } from '@shared/language';
import { I18N_NAMESPACES, type I18nNamespace } from '@shared/i18n/namespaces';
import EN_RESOURCES from './bundles/en';

export type TranslationResources = Record<I18nNamespace, Record<string, unknown>>;

type NonEnglishLanguage = Exclude<LanguageCode, 'en'>;

const LANGUAGE_LOADERS: Record<NonEnglishLanguage, () => Promise<TranslationResources>> = {
  zh: () => import('./bundles/zh').then((module) => module.default),
  ja: () => import('./bundles/ja').then((module) => module.default),
  ru: () => import('./bundles/ru').then((module) => module.default),
};

const loadedResources = new Map<NonEnglishLanguage, Promise<TranslationResources>>();

export function getEnglishResources(): TranslationResources {
  return EN_RESOURCES;
}

export function isEnglish(language: LanguageCode): language is 'en' {
  return language === 'en';
}

/**
 * Load (and cache) one non-English resource tree. The returned promise is
 * shared by concurrent callers so a language switch cannot trigger duplicate
 * dynamic imports.
 */
export function loadLanguageResources(language: NonEnglishLanguage): Promise<TranslationResources> {
  const existing = loadedResources.get(language);
  if (existing) return existing;

  const pending = LANGUAGE_LOADERS[language]().catch((error) => {
    loadedResources.delete(language);
    throw error;
  });
  loadedResources.set(language, pending);
  return pending;
}

export function getNamespaces(): readonly I18nNamespace[] {
  return I18N_NAMESPACES;
}
