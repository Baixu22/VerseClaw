import { useEffect, useState } from 'react';
import { useSettingsStore } from '@/stores/settings';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

export function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia(DARK_MEDIA_QUERY).matches ? 'dark' : 'light';
}

export function resolveThemePreference(theme: ThemePreference): ResolvedTheme {
  return theme === 'system' ? getSystemTheme() : theme;
}

export function applyDocumentTheme(theme: ThemePreference): void {
  if (typeof window === 'undefined') return;

  const root = window.document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(resolveThemePreference(theme));
}

export function useResolvedTheme(): ResolvedTheme {
  const theme = useSettingsStore((state) => state.theme);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveThemePreference(theme));

  useEffect(() => {
    setResolvedTheme(resolveThemePreference(theme));

    if (theme !== 'system' || typeof window === 'undefined') return;

    const media = window.matchMedia(DARK_MEDIA_QUERY);
    const handleChange = () => setResolvedTheme(media.matches ? 'dark' : 'light');
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, [theme]);

  return resolvedTheme;
}
