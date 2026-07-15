export type SettingsSectionId =
  | 'overview'
  | 'general'
  | 'models'
  | 'agents'
  | 'channels'
  | 'skills'
  | 'system'
  | 'developer'
  | 'billing'
  | 'storage';

export const SETTINGS_SECTION_SEGMENTS: Record<Exclude<SettingsSectionId, 'overview'>, string> = {
  general: 'general',
  models: 'models',
  agents: 'agents',
  channels: 'channels',
  skills: 'skills',
  system: 'system',
  developer: 'developer',
  billing: 'billing',
  storage: 'storage',
};

export function resolveSettingsSection(pathname: string): SettingsSectionId {
  const normalized = pathname.replace(/\/+$/, '');
  const segment = normalized.split('/').filter(Boolean)[1];
  if (!segment) return 'overview';
  const match = Object.entries(SETTINGS_SECTION_SEGMENTS).find(([, value]) => value === segment);
  return match ? (match[0] as SettingsSectionId) : 'overview';
}
