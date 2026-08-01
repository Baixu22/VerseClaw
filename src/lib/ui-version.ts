export type UiVersion = 'legacy' | 'v2';

export function resolveUiVersion(
  _platform: string | undefined,
  search: string,
): UiVersion {
  const override = new URLSearchParams(search).get('uiVersion');
  if (override === 'legacy' || override === 'v2') return override;
  return 'v2';
}

