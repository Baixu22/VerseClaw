import { useCallback, useEffect, useState } from 'react';
import { KeyRound, RefreshCw, ShieldCheck, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  SettingsButton,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSegmented,
  SettingsStackRow,
} from '@/components/settings/primitives';
import { hostApi } from '@/lib/host-api';
import type {
  AgentBrowserCredentialMetadata,
  AgentBrowserProfileEntry,
  AgentBrowserVaultHealth,
} from '@shared/host-api/contract';

type ProfileDraft = {
  profile: string;
  label: string;
  description: string;
  authStateName: string;
};

type CredentialDraft = {
  id?: string;
  profile: string;
  origin: string;
  username: string;
  password: string;
};

const EMPTY_PROFILE: ProfileDraft = { profile: '', label: '', description: '', authStateName: '' };
const EMPTY_CREDENTIAL: CredentialDraft = { profile: 'default', origin: '', username: '', password: '' };

function hostError(result: { success: boolean; error?: string }): string | null {
  return result.success ? null : result.error || 'Host action failed';
}

export function BrowserSettingsPanel() {
  const { t } = useTranslation('browser');
  const [view, setView] = useState<'profiles' | 'vault'>('profiles');
  const [profiles, setProfiles] = useState<AgentBrowserProfileEntry[]>([]);
  const [credentials, setCredentials] = useState<AgentBrowserCredentialMetadata[]>([]);
  const [vaultHealth, setVaultHealth] = useState<AgentBrowserVaultHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [profileDraft, setProfileDraft] = useState<ProfileDraft | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [credentialDraft, setCredentialDraft] = useState<CredentialDraft | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [profileResult, vaultResult, healthResult] = await Promise.allSettled([
      hostApi.agentBrowser.profiles(),
      hostApi.agentBrowser.vault(),
      hostApi.agentBrowser.vaultHealth(),
    ]);
    const errors: string[] = [];
    if (profileResult.status === 'fulfilled' && profileResult.value.success) {
      setProfiles(profileResult.value.profiles ?? []);
    } else {
      errors.push(profileResult.status === 'rejected' ? String(profileResult.reason) : profileResult.value.error || 'profiles');
    }
    if (vaultResult.status === 'fulfilled' && vaultResult.value.success) {
      setCredentials(vaultResult.value.credentials ?? []);
    } else {
      errors.push(vaultResult.status === 'rejected' ? String(vaultResult.reason) : vaultResult.value.error || 'vault');
    }
    if (healthResult.status === 'fulfilled' && healthResult.value.success) {
      setVaultHealth(healthResult.value.health);
    } else {
      errors.push(healthResult.status === 'rejected' ? String(healthResult.reason) : healthResult.value.error || 'vault health');
    }
    setError(errors.join('; '));
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveProfile = async () => {
    if (!profileDraft?.profile.trim()) return;
    setSaving(true);
    try {
      const result = await hostApi.agentBrowser.saveProfile({
        profile: profileDraft.profile.trim(),
        label: profileDraft.label.trim() || undefined,
        description: profileDraft.description.trim() || undefined,
        authStateName: profileDraft.authStateName.trim() || undefined,
      });
      const message = hostError(result);
      if (message) throw new Error(message);
      setProfileDraft(null);
      setEditingProfile(false);
      await refresh();
      toast.success(t('settings.profileSaved'));
    } catch (saveError) {
      toast.error(t('settings.saveFailed', { error: saveError instanceof Error ? saveError.message : String(saveError) }));
    } finally {
      setSaving(false);
    }
  };

  const saveCredential = async () => {
    if (!credentialDraft?.profile.trim() || !credentialDraft.origin.trim() || !credentialDraft.username.trim() || !credentialDraft.password) return;
    setSaving(true);
    try {
      const result = await hostApi.agentBrowser.saveCredential({
        id: credentialDraft.id,
        profile: credentialDraft.profile.trim(),
        origin: credentialDraft.origin.trim(),
        username: credentialDraft.username.trim(),
        password: credentialDraft.password,
      });
      const message = hostError(result);
      if (message) throw new Error(message);
      setCredentialDraft(null);
      await refresh();
      toast.success(t('settings.credentialSaved'));
    } catch (saveError) {
      toast.error(t('settings.saveFailed', { error: saveError instanceof Error ? saveError.message : String(saveError) }));
    } finally {
      setSaving(false);
    }
  };

  const deleteCredential = async (credentialId: string) => {
    setSaving(true);
    try {
      const result = await hostApi.agentBrowser.deleteCredential({ credentialId });
      const message = hostError(result);
      if (message) throw new Error(message);
      await refresh();
      toast.success(t('settings.credentialDeleted'));
    } catch (deleteError) {
      toast.error(t('settings.deleteFailed', { error: deleteError instanceof Error ? deleteError.message : String(deleteError) }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8" data-testid="browser-settings-panel">
      <div className="flex items-center justify-between gap-4">
        <SettingsSegmented
          value={view}
          onChange={setView}
          ariaLabel={t('settings.viewLabel')}
          testId="browser-settings-view"
          options={[
            { value: 'profiles', label: t('tabs.profiles'), icon: <UserRound className="h-4 w-4" /> },
            { value: 'vault', label: t('tabs.vault'), icon: <KeyRound className="h-4 w-4" /> },
          ]}
        />
        <SettingsButton ariaLabel={t('actions.refresh')} disabled={loading} onClick={() => void refresh()} testId="browser-settings-refresh">
          <RefreshCw className={loading ? 'h-4 w-4 animate-spin motion-reduce:animate-none' : 'h-4 w-4'} />
        </SettingsButton>
      </div>

      {error ? <p role="alert" className="text-sm text-red-700 dark:text-red-400">{t('settings.loadFailed', { error })}</p> : null}

      {view === 'profiles' ? (
        <SettingsSection
          title={t('settings.profilesTitle')}
          description={t('settings.profilesDescription')}
          testId="browser-settings-profiles"
          action={!profileDraft ? (
            <SettingsButton variant="primary" onClick={() => { setEditingProfile(false); setProfileDraft({ ...EMPTY_PROFILE }); }} testId="browser-profile-new">
              {t('settings.newProfile')}
            </SettingsButton>
          ) : undefined}
        >
          {profileDraft ? (
            <SettingsStackRow title={editingProfile ? t('settings.editProfile') : t('settings.newProfile')}>
              <div className="grid gap-3 sm:grid-cols-2">
                <SettingsInput wide value={profileDraft.profile} disabled={editingProfile} onChange={(profile) => setProfileDraft({ ...profileDraft, profile })} ariaLabel={t('settings.profileId')} placeholder={t('settings.profileIdPlaceholder')} testId="browser-profile-id" />
                <SettingsInput wide value={profileDraft.label} onChange={(label) => setProfileDraft({ ...profileDraft, label })} ariaLabel={t('settings.profileLabel')} placeholder={t('settings.profileLabelPlaceholder')} testId="browser-profile-label" />
                <SettingsInput wide value={profileDraft.description} onChange={(description) => setProfileDraft({ ...profileDraft, description })} ariaLabel={t('settings.profileDescription')} placeholder={t('settings.profileDescriptionPlaceholder')} />
                <SettingsInput wide value={profileDraft.authStateName} onChange={(authStateName) => setProfileDraft({ ...profileDraft, authStateName })} ariaLabel={t('settings.authStateName')} placeholder={t('settings.authStateNamePlaceholder')} />
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <SettingsButton onClick={() => { setProfileDraft(null); setEditingProfile(false); }}>{t('settings.cancel')}</SettingsButton>
                <SettingsButton variant="primary" disabled={saving || !profileDraft.profile.trim()} onClick={() => void saveProfile()} testId="browser-profile-save">{t('settings.saveProfile')}</SettingsButton>
              </div>
            </SettingsStackRow>
          ) : profiles.length === 0 ? (
            <SettingsRow title={t('settings.noProfiles')} description={t('profiles.localState')} />
          ) : profiles.map((profile) => (
            <SettingsRow
              key={profile.profile}
              testId={`browser-profile-${profile.profile}`}
              title={profile.label || profile.profile}
              description={[profile.profile, profile.description || profile.authStateName, t('profiles.active', { count: profile.activeSessions ?? 0 })].filter(Boolean).join(' / ')}
              control={<SettingsButton onClick={() => { setEditingProfile(true); setProfileDraft({ profile: profile.profile, label: profile.label || '', description: profile.description || '', authStateName: profile.authStateName || '' }); }}>{t('settings.edit')}</SettingsButton>}
            />
          ))}
        </SettingsSection>
      ) : (
        <SettingsSection
          title={t('settings.vaultTitle')}
          description={t('vault.protected')}
          testId="browser-settings-vault"
          action={!credentialDraft ? (
            <SettingsButton variant="primary" onClick={() => setCredentialDraft({ ...EMPTY_CREDENTIAL, profile: profiles[0]?.profile || 'default' })} testId="browser-credential-new">
              {t('settings.newCredential')}
            </SettingsButton>
          ) : undefined}
        >
          <SettingsRow
            title={t('settings.vaultHealth')}
            description={vaultHealth?.errorMessage || t('settings.vaultCredentialCount', { count: vaultHealth?.credentialCount ?? credentials.length })}
            control={<span className="flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4" />{vaultHealth ? t(`settings.vaultState.${vaultHealth.state}`) : t('settings.unknown')}</span>}
          />
          {credentialDraft ? (
            <SettingsStackRow title={credentialDraft.id ? t('settings.replaceCredential') : t('settings.newCredential')}>
              <div className="grid gap-3 sm:grid-cols-2">
                <SettingsInput wide value={credentialDraft.profile} onChange={(profile) => setCredentialDraft({ ...credentialDraft, profile })} ariaLabel={t('tasks.profile')} placeholder={t('settings.profileIdPlaceholder')} testId="browser-credential-profile" />
                <SettingsInput wide value={credentialDraft.origin} onChange={(origin) => setCredentialDraft({ ...credentialDraft, origin })} ariaLabel={t('settings.origin')} placeholder={t('settings.originPlaceholder')} testId="browser-credential-origin" />
                <SettingsInput wide value={credentialDraft.username} onChange={(username) => setCredentialDraft({ ...credentialDraft, username })} ariaLabel={t('settings.username')} placeholder={t('settings.usernamePlaceholder')} testId="browser-credential-username" />
                <SettingsInput wide type="password" value={credentialDraft.password} onChange={(password) => setCredentialDraft({ ...credentialDraft, password })} ariaLabel={t('settings.password')} placeholder={t('settings.passwordPlaceholder')} testId="browser-credential-password" />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{t('settings.passwordNotice')}</p>
              <div className="mt-3 flex justify-end gap-2">
                <SettingsButton onClick={() => setCredentialDraft(null)}>{t('settings.cancel')}</SettingsButton>
                <SettingsButton variant="primary" disabled={saving || !credentialDraft.profile.trim() || !credentialDraft.origin.trim() || !credentialDraft.username.trim() || !credentialDraft.password} onClick={() => void saveCredential()} testId="browser-credential-save">{t('settings.saveCredential')}</SettingsButton>
              </div>
            </SettingsStackRow>
          ) : credentials.length === 0 ? (
            <SettingsRow title={t('vault.empty')} />
          ) : credentials.map((credential) => (
            <SettingsRow
              key={credential.id}
              testId={`browser-credential-${credential.id}`}
              title={credential.username}
              description={`${credential.origin} / ${credential.profile}`}
              control={(
                <div className="flex items-center gap-2">
                  <SettingsButton onClick={() => setCredentialDraft({ ...credential, password: '' })}>{t('settings.replace')}</SettingsButton>
                  <SettingsButton variant="danger" disabled={saving} onClick={() => void deleteCredential(credential.id)}>{t('settings.delete')}</SettingsButton>
                </div>
              )}
            />
          ))}
        </SettingsSection>
      )}
    </div>
  );
}

export default BrowserSettingsPanel;
