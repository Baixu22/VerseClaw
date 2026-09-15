export type UiVersion = 'v2';

export function resolveUiVersion(
  _platform: string | undefined,
  _search: string,
): UiVersion {
  // Older links may still include uiVersion; visual migration is complete.
  return 'v2';
}

