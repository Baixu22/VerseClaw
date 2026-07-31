import settingsNavIcons from './settings-nav-icons.json';

export type SettingsIconName =
  | 'general'
  | 'appearance'
  | 'account'
  | 'plugins'
  | 'browser'
  | 'computer'
  | 'config'
  | 'connections'
  | 'hooks'
  | 'git'
  | 'environments'
  | 'worktrees'
  | 'archived'
  | 'back'
  | 'search';

type IconEntry = { viewBox: string; width: string; height: string; inner: string };

export function SettingsNavIcon({ name, size = 16 }: { name: SettingsIconName; size?: number }) {
  if (name === 'search') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" className="codex-settings-icon">
        <path fillRule="evenodd" clipRule="evenodd" d="M7.25 2.5C9.87335 2.5 12 4.62665 12 7.25C12 8.32009 11.6461 9.30674 11.0488 10.0996L13.5303 12.5811C13.8232 12.8739 13.8232 13.3488 13.5303 13.6416C13.2374 13.9345 12.7626 13.9345 12.4697 13.6416L9.98828 11.1602C9.19541 11.7574 8.2088 12.1113 7.13867 12.1113C4.51532 12.1113 2.38867 9.98468 2.38867 7.36133C2.38867 4.73798 4.51532 2.61133 7.13867 2.61133H7.25ZM7.25 3.88867C5.22103 3.88867 3.57617 5.53353 3.57617 7.5625C3.57617 9.59147 5.22103 11.2363 7.25 11.2363C9.27897 11.2363 10.9238 9.59147 10.9238 7.5625C10.9238 5.53353 9.27897 3.88867 7.25 3.88867Z" fill="currentColor" />
      </svg>
    );
  }

  const entry = (settingsNavIcons as Record<string, IconEntry>)[name];
  if (!entry) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox={entry.viewBox}
      fill="none"
      aria-hidden="true"
      className="codex-settings-icon"
      dangerouslySetInnerHTML={{ __html: entry.inner }}
    />
  );
}
