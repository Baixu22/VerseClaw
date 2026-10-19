import type { LanguageCode } from '../language';
import enMenu from './locales/en/menu.json';
import zhMenu from './locales/zh/menu.json';
import jaMenu from './locales/ja/menu.json';
import ruMenu from './locales/ru/menu.json';

export type MenuLabels = typeof enMenu;

/**
 * Main-process menu labels. Kept separate from I18N_RESOURCES so the Electron
 * main bundle does not parse every renderer namespace for four languages just
 * to build the native menu.
 */
export const MENU_LABELS: Record<LanguageCode, MenuLabels> = {
  en: enMenu,
  zh: zhMenu,
  ja: jaMenu,
  ru: ruMenu,
};
