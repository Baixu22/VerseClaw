export type SettingsSectionId =
  | 'overview'
  | 'general'
  | 'models'
  | 'agents'
  | 'channels'
  | 'skills'
  | 'browser'
  | 'system'
  | 'developer'
  | 'billing'
  | 'archived'
  | 'recovery'
  | 'storage';

export const SETTINGS_SECTION_SEGMENTS: Record<Exclude<SettingsSectionId, 'overview'>, string> = {
  general: 'general',
  models: 'models',
  agents: 'agents',
  channels: 'channels',
  skills: 'skills',
  browser: 'browser',
  system: 'system',
  developer: 'developer',
  billing: 'billing',
  archived: 'archived',
  recovery: 'recovery',
  storage: 'storage',
};

export function resolveSettingsSection(pathname: string): SettingsSectionId {
  const normalized = pathname.replace(/\/+$/, '');
  const segment = normalized.split('/').filter(Boolean)[1];
  if (!segment) return 'overview';
  const match = Object.entries(SETTINGS_SECTION_SEGMENTS).find(([, value]) => value === segment);
  return match ? (match[0] as SettingsSectionId) : 'overview';
}
