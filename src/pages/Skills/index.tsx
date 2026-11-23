import { parseMcpJsonConfigs, mcpServerToJson } from '@/lib/mcp-json';
/**
 * Skills Page
 * Browse and manage AI skills
 */
import { Suspense, lazy, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  Search,
  Puzzle,
  Server,
  Lock,
  Package,
  X,
  AlertCircle,
  Trash2,
  FolderOpen,
  Copy,
  Activity,
  CheckCircle2,
  Code2,
  Plus,
  RefreshCw,
  Save,
  Download,
  Power,
  Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useSkillsStore } from '@/stores/skills';
import { useSkillPacksStore } from '@/stores/skill-packs';
import { useMcpStore } from '@/stores/mcp';
import { useGatewayStore } from '@/stores/gateway';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { MeasuredLoadingList } from '@/components/loading/MeasuredLoadingList';
import { SkillRowFrame, SkillStructureRow } from '@/components/loading/DataListFrames';
import { cn } from '@/lib/utils';
import { hostApi } from '@/lib/host-api';
import { createPollScheduler } from '@/lib/poll-scheduler';
import { isResourceShed } from '@/lib/resource-shed';
import { hostEvents } from '@/lib/host-events';
import { isGatewayStopped } from '@/lib/gateway-status';
import { toast } from 'sonner';
import type { Skill } from '@/types/skill';
import type { McpServerConfig } from '@shared/types/mcp';
import type { GatewayStatus } from '@/types/gateway';
import { rendererExtensionRegistry } from '@/extensions/registry';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { SkillFileSections } from '@/components/file-preview/SkillFileSections';
import type { FilePreviewTarget } from '@/components/file-preview/FilePreviewOverlay';
import type { SkillFile } from '@/lib/skill-files';
import type {
  OfficecliInfo,
  OfficecliInstallEvent,
  OfficecliSkillInstallStatus,
  OfficecliSkillSyncReport,
  SkillPackSkill,
  SkillPackId,
  SkillPackSummary,
} from '@shared/host-api/contract';
import type { AgentSummary } from '@shared/types/agent';

const FilePreviewOverlayLazy = lazy(() =>
  import('@/components/file-preview/FilePreviewOverlay').then((m) => ({ default: m.FilePreviewOverlay })),
);

function skillFileToTarget(file: SkillFile): FilePreviewTarget {
  return {
    filePath: file.filePath,
    fileName: file.fileName,
    ext: file.ext,
    mimeType: file.mimeType,
    contentType: file.contentType,
  };
}

const FETCH_ERROR_CODES = new Set(['fetchTimeoutError', 'fetchRateLimitError', 'timeoutError', 'rateLimitError']);

type SkillsGatewayBannerState = 'none' | 'stopped';
type SkillsToolTab = 'skills' | 'packs' | 'marketplace' | 'mcp';

function getSkillsGatewayBannerState(status: GatewayStatus): SkillsGatewayBannerState {
  if (isGatewayStopped(status)) {
    return 'stopped';
  }
  return 'none';
}

function resolveInitialToolTab(): SkillsToolTab {
  if (typeof window === 'undefined') return 'skills';
  const hash = window.location.hash;
  const query = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : window.location.search.replace(/^\?/, '');
  const tab = new URLSearchParams(query).get('tab');
  return tab === 'packs' || tab === 'marketplace' || tab === 'mcp' || tab === 'skills' ? tab : 'skills';
}

// Skill detail dialog component
interface SkillDetailDialogProps {
  skill: Skill | null;
  isOpen: boolean;
  onClose: () => void;
  onToggle: (enabled: boolean) => void;
  onUninstall?: (slug: string) => void;
  onOpenFolder?: (skill: Skill) => Promise<void> | void;
}

function resolveSkillSourceLabel(skill: Skill, t: TFunction<'skills'>): string {
  const source = (skill.source || '').trim().toLowerCase();
  if (!source) {
    if (skill.isBundled) return t('source.badge.bundled', { defaultValue: 'Bundled dir' });
    return t('source.badge.unknown', { defaultValue: 'Unknown source' });
  }
  if (source === 'openclaw-bundled') return t('source.badge.bundled', { defaultValue: 'Bundled dir' });
  if (source === 'openclaw-managed') return t('source.badge.managed', { defaultValue: 'Managed' });
  if (source === 'openclaw-workspace') return t('source.badge.workspace', { defaultValue: 'Workspace' });
  if (source === 'openclaw-extra') return t('source.badge.extra', { defaultValue: 'Extra dirs' });
  if (source === 'openclaw-plugin') return t('source.badge.plugin', { defaultValue: 'Plugin dir' });
  if (source === 'agents-skills-personal') return t('source.badge.agentsPersonal', { defaultValue: 'Personal .agents' });
  if (source === 'agents-skills-project') return t('source.badge.agentsProject', { defaultValue: 'Project .agents' });
  return source;
}

function canUninstallSkill(skill: Skill): boolean {
  return (skill.source || '').trim().toLowerCase() === 'openclaw-managed';
}

function SkillDetailDialog({ skill, isOpen, onClose, onToggle, onUninstall, onOpenFolder }: SkillDetailDialogProps) {
  const { t } = useTranslation('skills');
  const [openedSkillFile, setOpenedSkillFile] = useState<FilePreviewTarget | null>(null);
  const detailMetaComponents = rendererExtensionRegistry.getSkillDetailMetaComponents();

  const handleCopyPath = async () => {
    if (!skill?.baseDir) return;
    try {
      await navigator.clipboard.writeText(skill.baseDir);
      toast.success(t('toast.copiedPath'));
    } catch (err) {
      toast.error(t('toast.failedCopyPath') + ': ' + String(err));
    }
  };

  if (!skill) return null;

  const uninstallable = canUninstallSkill(skill);

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Suspense fallback={null}>
        <FilePreviewOverlayLazy
          file={openedSkillFile}
          readOnly
          onClose={() => setOpenedSkillFile(null)}
        />
      </Suspense>
      <SheetContent
        className="w-full sm:max-w-[450px] p-0 flex flex-col border-l border-black/10 dark:border-white/10 bg-surface-modal shadow-[0_0_40px_rgba(0,0,0,0.2)]"
        side="right"
      >
        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-8 py-10">
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 flex items-center justify-center rounded-full bg-surface-modal border border-black/5 dark:border-white/5 shrink-0 mb-4 relative shadow-sm">
              <span className="text-3xl">{skill.icon || '🔧'}</span>
              {skill.isCore && (
                <div className="absolute -bottom-1 -right-1 bg-surface-modal rounded-full p-1 shadow-sm border border-black/5 dark:border-white/5">
                  <Lock className="h-3 w-3 text-muted-foreground shrink-0" />
                </div>
              )}
            </div>
            <h2 className="text-xl font-serif text-foreground font-normal mb-3 text-center tracking-tight">
              {skill.name}
            </h2>
            <div data-skill-detail-meta-row="1" className="flex items-center justify-center flex-wrap gap-2.5 mb-6 opacity-80">
              {skill.version && (
                <Badge variant="secondary" className="shrink-0 whitespace-nowrap font-mono text-tiny font-medium px-3 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.08] hover:bg-black/[0.08] dark:hover:bg-white/[0.12] border-0 shadow-none text-foreground/70 transition-colors">
                  v{skill.version}
                </Badge>
              )}
              <Badge variant="secondary" className="shrink-0 whitespace-nowrap font-mono text-tiny font-medium px-3 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.08] hover:bg-black/[0.08] dark:hover:bg-white/[0.12] border-0 shadow-none text-foreground/70 transition-colors">
                {skill.isCore ? t('detail.coreSystem') : skill.isBundled ? t('detail.bundled') : t('detail.userInstalled')}
              </Badge>
              {detailMetaComponents.map((DetailMetaComponent, index) => (
                <DetailMetaComponent key={`skill-detail-meta-${index}`} skill={skill} />
              ))}
            </div>

            {skill.description && (
              <p className="text-sm text-foreground/70 font-medium leading-[1.6] text-center px-4">
                {skill.description}
              </p>
            )}
          </div>

          <div className="space-y-7 px-1">
            <div className="space-y-2">
              <h3 className="text-meta font-bold text-foreground/80">{t('detail.source')}</h3>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary" className="shrink-0 whitespace-nowrap font-mono text-tiny font-medium px-3 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.08] border-0 shadow-none text-foreground/70">
                  {resolveSkillSourceLabel(skill, t)}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={skill.baseDir || t('detail.pathUnavailable')}
                  readOnly
                  className="h-[38px] font-mono text-xs bg-transparent border-black/10 dark:border-white/10 rounded-xl text-foreground/70"
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="h-[38px] w-[38px] border-black/10 dark:border-white/10"
                  disabled={!skill.baseDir}
                  onClick={handleCopyPath}
                  title={t('detail.copyPath')}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-[38px] w-[38px] border-black/10 dark:border-white/10"
                  disabled={!skill.baseDir}
                  onClick={() => onOpenFolder?.(skill)}
                  title={t('detail.openActualFolder')}
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* File Sections — read-only preview of skill content */}
            {skill.baseDir && (
              <div className="space-y-3">
                <h3 className="text-meta font-bold text-foreground/80">
                  {t('detail.sections.title')}
                </h3>
                <SkillFileSections
                  baseDir={skill.baseDir}
                  onOpen={(file) => setOpenedSkillFile(skillFileToTarget(file))}
                />
              </div>
            )}

          </div>

          {/* Centered Footer Button — uninstall / disable / enable */}
          {!skill.isCore && (
            <div className="pt-8 pb-4 flex items-center justify-center w-full px-2 max-w-[340px] mx-auto">
              <Button
                variant="outline"
                className="w-full h-[42px] text-meta rounded-full font-semibold shadow-sm bg-transparent border-black/20 dark:border-white/20 hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-foreground/80 hover:text-foreground"
                onClick={() => {
                  if (uninstallable && onUninstall && skill.slug) {
                    onUninstall(skill.slug);
                    onClose();
                  } else {
                    onToggle(!skill.enabled);
                  }
                }}
              >
                {uninstallable && onUninstall
                  ? t('detail.uninstall')
                  : (skill.enabled ? t('detail.disable') : t('detail.enable'))}
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function Skills({ embedded = false }: { embedded?: boolean } = {}) {
  const {
    skills,
    loading,
    error,
    fetchSkills,
    enableSkill,
    disableSkill,
    uninstallSkill,
    marketplaceFallbackReason,
  } = useSkillsStore();
  const { t } = useTranslation('skills');
  const gatewayStatus = useGatewayStore((state) => state.status);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [toolTab, setToolTab] = useState<SkillsToolTab>(() => resolveInitialToolTab());

  const gatewayRunning = gatewayStatus.state === 'running';
  const gatewayReportedReady = gatewayStatus.gatewayReady !== false;
  const gatewayRuntimeKey = `${gatewayStatus.pid ?? 'none'}:${gatewayStatus.connectedAt ?? 'none'}:${gatewayStatus.port}`;
  const gatewayBannerState = getSkillsGatewayBannerState(gatewayStatus);
  const [showGatewayBanner, setShowGatewayBanner] = useState(false);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (gatewayBannerState === 'none') {
      timer = setTimeout(() => {
        setShowGatewayBanner(false);
      }, 0);
    } else {
      timer = setTimeout(() => {
        setShowGatewayBanner(true);
      }, 1500);
    }
    return () => clearTimeout(timer);
  }, [gatewayBannerState]);

  useEffect(() => {
    let cancelled = false;

    const attemptFetch = async () => {
      const ok = await fetchSkills();
      if (cancelled || !ok) return;
    };

    void attemptFetch();

    const stopPolling = gatewayRunning && !gatewayReportedReady
      ? createPollScheduler({
          intervalMs: 5_000,
          priority: 'background',
          isShed: isResourceShed,
          task: attemptFetch,
          isVisible: () => document.visibilityState !== 'hidden',
        })
      : null;

    return () => {
      cancelled = true;
      stopPolling?.();
    };
  }, [fetchSkills, gatewayReportedReady, gatewayRunning, gatewayRuntimeKey]);

  const safeSkills = Array.isArray(skills) ? skills : [];
  const enabledSkillsCount = safeSkills.filter((skill) => skill.enabled).length;
  const disabledSkillsCount = safeSkills.filter((skill) => !skill.enabled).length;
  const filteredSkills = safeSkills.filter((skill) => {
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch = q.length === 0
      || skill.name.toLowerCase().includes(q)
      || skill.description.toLowerCase().includes(q)
      || skill.id.toLowerCase().includes(q)
      || (skill.slug || '').toLowerCase().includes(q)
      || (skill.author || '').toLowerCase().includes(q);
    const matchesStatus = statusFilter === 'all'
      || (statusFilter === 'enabled' ? skill.enabled : !skill.enabled);
    return matchesSearch && matchesStatus;
  }).sort((a, b) => {
    if (a.enabled && !b.enabled) return -1;
    if (!a.enabled && b.enabled) return 1;
    if (a.isCore && !b.isCore) return -1;
    if (!a.isCore && b.isCore) return 1;
    return a.name.localeCompare(b.name);
  });


  const handleToggle = useCallback(async (skillId: string, enable: boolean) => {
    try {
      if (enable) {
        await enableSkill(skillId);
        toast.success(t('toast.enabled'));
      } else {
        await disableSkill(skillId);
        toast.success(t('toast.disabled'));
      }
    } catch (err) {
      toast.error(String(err));
    }
  }, [enableSkill, disableSkill, t]);

  const hasInstalledSkills = safeSkills.some(s => !s.isBundled);

  const handleStatusFilterClick = useCallback((nextFilter: 'enabled' | 'disabled') => {
    setStatusFilter((current) => (current === nextFilter ? 'all' : nextFilter));
  }, []);

  const handleOpenSkillsFolder = useCallback(async () => {
    try {
      const skillsDir = await hostApi.openclaw.getSkillsDir();
      if (!skillsDir) {
        throw new Error('Skills directory not available');
      }
      const result = await hostApi.shell.openPath(skillsDir);
      if (result) {
        if (result.toLowerCase().includes('no such file') || result.toLowerCase().includes('not found') || result.toLowerCase().includes('failed to open')) {
          toast.error(t('toast.failedFolderNotFound'));
        } else {
          throw new Error(result);
        }
      }
    } catch (err) {
      toast.error(t('toast.failedOpenFolder') + ': ' + String(err));
    }
  }, [t]);

  const handleOpenSkillFolder = useCallback(async (skill: Skill) => {
    try {
      const result = await hostApi.skills.clawhubOpenSkillPath({
        skillKey: skill.id,
        slug: skill.slug,
        baseDir: skill.baseDir,
      });
      if (!result.success) {
        throw new Error(result.error || 'Failed to open folder');
      }
    } catch (err) {
      toast.error(t('toast.failedOpenActualFolder') + ': ' + String(err));
    }
  }, [t]);

  const [skillsDirPath, setSkillsDirPath] = useState('');

  useEffect(() => {
    hostApi.openclaw.getSkillsDir()
      .then((dir) => setSkillsDirPath(dir))
      .catch(console.error);
  }, []);

  const showSkillsLoading = loading && toolTab === 'skills';

  return (
    <div
      data-testid="skills-page"
      className={cn(
        'flex flex-col',
        embedded ? 'w-full' : '-m-6 h-[calc(100vh-2.5rem)] overflow-hidden dark:bg-background',
      )}
    >
      <div className={cn(
        'w-full flex flex-col',
        embedded ? 'min-h-0' : 'max-w-5xl mx-auto h-full p-10 pt-16',
      )}>

        {/* Header */}
        <div className={cn(
          'flex flex-col md:flex-row md:items-start shrink-0 gap-4',
          embedded ? 'mb-6 justify-end' : 'mb-6 justify-between',
        )}>
          {!embedded && (
            <div>
              <h1 className="text-2xl font-serif text-foreground mb-3 font-normal tracking-tight">
                {t('title')}
              </h1>
              <p className="text-subtitle text-foreground/70 font-medium">
                {t('subtitle')}
              </p>
            </div>
          )}

          <div className="flex items-center gap-3 md:mt-2">
            {(hasInstalledSkills || showSkillsLoading) && (
              <button
                onClick={handleOpenSkillsFolder}
                disabled={!hasInstalledSkills}
                className="hover:bg-black/5 dark:hover:bg-white/5 transition-colors shrink-0 text-meta font-medium px-4 h-8 rounded-full border border-black/10 dark:border-white/10 flex items-center justify-center text-foreground/80 hover:text-foreground"
              >
                <FolderOpen className="h-4 w-4 mr-2" />
                {t('openFolder')}
              </button>
            )}
          </div>
        </div>

        {/* Gateway Status Banner */}
        {showGatewayBanner && gatewayBannerState !== 'none' && (
          <div
            data-testid="skills-gateway-banner"
            data-state={gatewayBannerState}
            className="mb-6 p-4 rounded-xl border border-yellow-500/50 bg-yellow-500/10 flex items-center gap-3"
          >
            <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
            <span className="text-sm font-medium text-yellow-700 dark:text-yellow-400">
              {t('gatewayWarning')}
            </span>
          </div>
        )}

        {/* Sub Navigation and Actions */}
        <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-black/10 dark:border-white/10 pb-4 mb-4 shrink-0 gap-4">
          <div className="flex items-center flex-wrap gap-2 text-sm">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setToolTab('skills')}
              className={cn(
                'h-8 rounded-full px-3 text-meta font-medium border shadow-none',
                toolTab === 'skills'
                  ? 'bg-black/5 dark:bg-white/10 border-black/10 dark:border-white/10 text-foreground'
                  : 'bg-transparent border-transparent text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5',
              )}
            >
              {t('tabs.skills')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setToolTab('packs')}
              className={cn(
                'h-8 rounded-full px-3 text-meta font-medium border shadow-none',
                toolTab === 'packs'
                  ? 'bg-black/5 dark:bg-white/10 border-black/10 dark:border-white/10 text-foreground'
                  : 'bg-transparent border-transparent text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5',
              )}
            >
              {t('packs.tab')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="skills-tab-marketplace"
              aria-label={t('tabs.marketplaceLocalOnlyAria', {
                defaultValue: 'Marketplace (Local only — marketplace coming soon)',
              })}
              disabled
              title={t('tabs.marketplaceLocalOnly', {
                defaultValue: 'Local only — marketplace coming soon',
              })}
              className={cn(
                'h-8 rounded-full px-3 text-meta font-medium border shadow-none cursor-not-allowed opacity-60',
                'bg-transparent border-transparent text-muted-foreground',
              )}
            >
              {t('tabs.marketplaceLocalOnlyLabel')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setToolTab('mcp')}
              className={cn(
                'h-8 rounded-full px-3 text-meta font-medium border shadow-none',
                toolTab === 'mcp'
                  ? 'bg-black/5 dark:bg-white/10 border-black/10 dark:border-white/10 text-foreground'
                  : 'bg-transparent border-transparent text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5',
              )}
            >
              {t('mcp.tab')}
            </Button>
            {(toolTab === 'skills') && (
              <>
            <div className="relative group flex items-center bg-black/5 dark:bg-white/5 rounded-full px-3 py-1.5 focus-within:bg-black/10 transition-colors border border-transparent focus-within:border-black/10 dark:focus-within:border-white/10 mr-2">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                placeholder={t('search')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="ml-2 bg-transparent outline-none w-28 md:w-40 font-normal placeholder:text-foreground/50 text-meta text-foreground"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="text-foreground/50 hover:text-foreground shrink-0 ml-1"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="skills-filter-enabled"
              onClick={() => handleStatusFilterClick('enabled')}
              className={cn(
                'h-8 rounded-full px-3 text-meta font-medium border shadow-none',
                statusFilter === 'enabled'
                  ? 'bg-black/5 dark:bg-white/10 border-black/10 dark:border-white/10 text-foreground'
                  : 'bg-transparent border-transparent text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5',
              )}
            >
              {t('filter.enabledList', { count: enabledSkillsCount })}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="skills-filter-disabled"
              onClick={() => handleStatusFilterClick('disabled')}
              className={cn(
                'h-8 rounded-full px-3 text-meta font-medium border shadow-none',
                statusFilter === 'disabled'
                  ? 'bg-black/5 dark:bg-white/10 border-black/10 dark:border-white/10 text-foreground'
                  : 'bg-transparent border-transparent text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5',
              )}
            >
              {t('filter.disabledList', { count: disabledSkillsCount })}
            </Button>
              </>
            )}
          </div>

          </div>

        {/* Content Area */}
        <div
          className={cn(
            embedded ? 'min-h-0' : 'flex-1 overflow-y-auto pr-2 pb-10 min-h-0 -mr-2',
          )}
        >
          {toolTab === 'mcp' ? (
            <McpServicesPanel />
          ) : toolTab === 'packs' ? (
            <SkillPacksPanel />
          ) : toolTab === 'marketplace' ? (
            <div
              data-testid="skills-marketplace-local-only-notice"
              className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3"
            >
              <Package className="h-10 w-10 opacity-40" />
              <p className="text-sm font-medium">
                {t('marketplace.localOnlyTitle', {
                  defaultValue: 'Local skills only',
                })}
              </p>
              <p className="text-xs text-muted-foreground/70 max-w-sm text-center">
                {t('marketplace.localOnlyHint', {
                  defaultValue:
                    'The ClawHub marketplace is not available in this build. Marketplace support is coming soon.',
                })}
              </p>
              {marketplaceFallbackReason ? (
                <p
                  className="max-w-sm rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-center text-xs text-amber-800 dark:text-amber-300"
                  data-testid="skills-marketplace-fallback"
                >
                  {t('marketplace.degradedHint')}: {marketplaceFallbackReason}
                </p>
              ) : null}
            </div>
          ) : (
            <>
          {error && (
            <div className="mb-4 p-4 rounded-xl border border-destructive/50 bg-destructive/10 text-destructive text-sm font-medium flex items-center gap-2">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <span>
                {FETCH_ERROR_CODES.has(error)
                  ? t(`toast.${error}`, { path: skillsDirPath })
                  : error}
              </span>
            </div>
          )}

          <MeasuredLoadingList
            surfaceId="skills"
            loading={showSkillsLoading}
            label={t('common:status.loading')}
            listClassName="flex flex-col gap-1"
            skeletonRows={[0, 1, 2].map((index) => <SkillStructureRow key={index} />)}
            emptyState={(
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Puzzle className="h-10 w-10 mb-4 opacity-50" />
                <p>{searchQuery ? t('noSkillsSearch') : t('noSkillsAvailable')}</p>
              </div>
            )}
            rows={filteredSkills.map((skill) => (
                <SkillRowFrame
                  key={skill.id}
                  data-testid={`skill-row-${skill.id}`}
                  role="button"
                  tabIndex={0}
                  className="cursor-pointer"
                  onClick={() => setSelectedSkill(skill)}
                  onKeyDown={(event) => {
                    if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                      event.preventDefault();
                      setSelectedSkill(skill);
                    }
                  }}
                  icon={skill.icon || '🧩'}
                  title={(
                    <>
                        <h3 className="text-sm font-semibold text-foreground truncate">{skill.name}</h3>
                        {skill.isCore ? (
                          <Lock className="h-3 w-3 text-muted-foreground" />
                        ) : null}
                    </>
                  )}
                  detail={skill.description}
                  meta={(
                    <>
                        <Badge data-build-chip variant="secondary" className="shrink-0 whitespace-nowrap px-1.5 py-0 h-5 text-2xs font-medium bg-black/5 dark:bg-white/10 border-0 shadow-none">
                          {resolveSkillSourceLabel(skill, t)}
                        </Badge>
                        <span className="truncate font-mono min-w-0">
                          {skill.baseDir || t('detail.pathUnavailable')}
                        </span>
                    </>
                  )}
                  actions={(
                    <>
                    {skill.version && (
                      <span className="text-meta font-mono text-muted-foreground">
                        v{skill.version}
                      </span>
                    )}
                    <Switch
                      data-build-action
                      aria-label={skill.name}
                      checked={skill.enabled}
                      onCheckedChange={(checked) => handleToggle(skill.id, checked)}
                      disabled={skill.isCore}
                    />
                    </>
                  )}
                />
              ))}
          />
            </>
          )}
        </div>
      </div>


      {/* Skill Detail Dialog */}
      <SkillDetailDialog
        skill={selectedSkill}
        isOpen={!!selectedSkill}
        onClose={() => setSelectedSkill(null)}
        onToggle={(enabled) => {
          if (!selectedSkill) return;
          handleToggle(selectedSkill.id, enabled);
          setSelectedSkill({ ...selectedSkill, enabled });
        }}
        onOpenFolder={handleOpenSkillFolder}
        onUninstall={(slug) => {
          void uninstallSkill(slug)
            .then(() => toast.success(t('toast.uninstalled')))
            .catch((error) => toast.error(t('toast.failedUninstall') + ': ' + String(error)));
        }}
      />
    </div>
  );
}

function packBusyKey(packId: SkillPackId, action: string): string {
  return `${packId}:${action}`;
}

function createOfficeInstallTaskId(): string {
  const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `officecli-${randomId}`;
}

function formatOfficeInstallEvent(event: OfficecliInstallEvent): string {
  if (event.kind === 'started') return 'STARTED';
  if (event.kind === 'completed') return event.payload ? `COMPLETED: ${event.payload}` : 'COMPLETED';
  if (event.kind === 'failed') return event.payload ? `ERROR: ${event.payload}` : 'ERROR';
  return event.payload;
}

function officeAgentStatusKey(skillId: string, agentId: string): string {
  return `${skillId}:${agentId}`;
}

function OfficeAgentMatrix({
  skills,
  agents,
  statuses,
  loading,
  busyKey,
  onToggle,
}: {
  skills: SkillPackSkill[];
  agents: AgentSummary[];
  statuses: OfficecliSkillInstallStatus[];
  loading: boolean;
  busyKey: string | null;
  onToggle: (skill: SkillPackSkill, agent: AgentSummary, enabled: boolean) => void;
}) {
  const { t } = useTranslation('skills');
  const statusMap = useMemo(() => {
    const map = new Map<string, OfficecliSkillInstallStatus>();
    for (const status of statuses) {
      map.set(officeAgentStatusKey(status.skillId || status.expertId, status.agentId), status);
    }
    return map;
  }, [statuses]);

  if (skills.length === 0) return null;

  return (
    <div
      data-testid="officecli-agent-matrix"
      className="mt-4 overflow-hidden rounded-lg border border-black/10 bg-black/[0.02] dark:border-white/10 dark:bg-white/[0.03]"
    >
      <div className="flex items-center gap-2 border-b border-black/10 px-3 py-2 text-xs font-medium text-foreground dark:border-white/10">
        {loading && <LoadingSpinner size="sm" />}
        <span>{t('packs.office.agentMatrix.title')}</span>
      </div>
      {agents.length === 0 ? (
        <div className="px-3 py-3 text-xs text-muted-foreground">
          {t('packs.office.agentMatrix.emptyAgents')}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-black/10 text-muted-foreground dark:border-white/10">
                <th className="w-[220px] px-3 py-2 text-left font-medium">
                  {t('packs.office.agentMatrix.skill')}
                </th>
                {agents.map((agent) => (
                  <th key={agent.id} className="px-2 py-2 text-center font-medium">
                    <span className="block max-w-28 truncate">{agent.name || agent.id}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {skills.map((skill) => (
                <tr key={skill.id} className="border-b border-black/10 last:border-b-0 dark:border-white/10">
                  <th className="px-3 py-2 text-left font-normal">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-[11px] font-medium text-foreground">{skill.id}</div>
                      {!skill.installed && (
                        <div className="mt-0.5 text-[11px] text-yellow-700 dark:text-yellow-400">
                          {t('packs.office.agentMatrix.notSynced')}
                        </div>
                      )}
                    </div>
                  </th>
                  {agents.map((agent) => {
                    const key = officeAgentStatusKey(skill.id, agent.id);
                    const status = statusMap.get(key);
                    const enabled = status?.state === 'linked_to_codeg';
                    const broken = status?.state === 'broken';
                    const cellBusy = busyKey === key;
                    const disabled = loading || Boolean(busyKey) || (!skill.installed && !enabled);
                    return (
                      <td key={agent.id} className="px-2 py-2 text-center">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={enabled}
                          aria-label={t('packs.office.agentMatrix.cellLabel', {
                            skill: skill.name || skill.id,
                            agent: agent.name || agent.id,
                          })}
                          data-testid={`officecli-agent-cell-${skill.id}-${agent.id}`}
                          disabled={disabled}
                          onClick={() => onToggle(skill, agent, enabled)}
                          className={cn(
                            'inline-flex h-7 w-7 items-center justify-center rounded-md border align-middle transition-colors',
                            enabled
                              ? 'border-green-500/40 bg-green-500/15 text-green-700 dark:text-green-400'
                              : broken
                                ? 'border-yellow-500/50 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400'
                                : 'border-black/15 bg-surface-input text-muted-foreground hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10',
                            disabled && !enabled && 'cursor-not-allowed opacity-60',
                          )}
                        >
                          {cellBusy ? (
                            <LoadingSpinner size="sm" />
                          ) : enabled ? (
                            <CheckCircle2 className="h-4 w-4" />
                          ) : broken ? (
                            <AlertCircle className="h-3.5 w-3.5" />
                          ) : (
                            <Plus className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SkillPacksPanel() {
  const { t } = useTranslation('skills');
  const {
    packs,
    loading,
    busy,
    error,
    fetchPacks,
    installPack,
    syncPack,
    setPackEnabled,
    readSkill,
  } = useSkillPacksStore();
  const [preview, setPreview] = useState<{ pack: SkillPackSummary; skillId: string; content: string } | null>(null);
  const [officeInfo, setOfficeInfo] = useState<OfficecliInfo | null>(null);
  const [officeDetecting, setOfficeDetecting] = useState(false);
  const [officeAction, setOfficeAction] = useState<'install' | 'sync' | 'uninstall' | null>(null);
  const [officeInstallLogs, setOfficeInstallLogs] = useState<string[]>([]);
  const [officeSyncReport, setOfficeSyncReport] = useState<OfficecliSkillSyncReport | null>(null);
  const [officeAgents, setOfficeAgents] = useState<AgentSummary[]>([]);
  const [officeLinkStatuses, setOfficeLinkStatuses] = useState<OfficecliSkillInstallStatus[]>([]);
  const [officeLinksLoading, setOfficeLinksLoading] = useState(false);
  const [officeLinkBusyKey, setOfficeLinkBusyKey] = useState<string | null>(null);
  const officeInstallTaskIdRef = useRef<string | null>(null);

  useEffect(() => {
    void fetchPacks().catch((err) => toast.error(String(err)));
  }, [fetchPacks]);

  const refreshOfficeInfo = useCallback(async () => {
    setOfficeDetecting(true);
    try {
      setOfficeInfo(await hostApi.officeTools.detect());
    } catch {
      setOfficeInfo(null);
    } finally {
      setOfficeDetecting(false);
    }
  }, []);

  useEffect(() => {
    void refreshOfficeInfo();
  }, [refreshOfficeInfo]);

  const refreshOfficeAssignments = useCallback(async () => {
    setOfficeLinksLoading(true);
    try {
      const [agentsSnapshot, statuses] = await Promise.all([
        hostApi.agents.list(),
        hostApi.officeTools.listAllSkillInstallStatuses(),
      ]);
      setOfficeAgents(agentsSnapshot.agents ?? []);
      setOfficeLinkStatuses(statuses);
    } catch (err) {
      console.warn('[skills] Failed to load Office agent assignments:', err);
      setOfficeAgents([]);
      setOfficeLinkStatuses([]);
    } finally {
      setOfficeLinksLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshOfficeAssignments();
  }, [refreshOfficeAssignments]);

  useEffect(() => hostEvents.onOfficeToolsInstallEvent((event) => {
    if (event.taskId !== officeInstallTaskIdRef.current) return;
    const line = formatOfficeInstallEvent(event);
    if (!line) return;
    setOfficeInstallLogs((logs) => [...logs, line]);
  }), []);

  const refreshAfterOfficeChange = useCallback(async () => {
    await Promise.all([
      fetchPacks(),
      useSkillsStore.getState().fetchSkills(),
      refreshOfficeInfo(),
      refreshOfficeAssignments(),
    ]);
  }, [fetchPacks, refreshOfficeInfo, refreshOfficeAssignments]);

  const handleOfficeAgentToggle = useCallback(async (skill: SkillPackSkill, agent: AgentSummary, enabled: boolean) => {
    const key = officeAgentStatusKey(skill.id, agent.id);
    setOfficeLinkBusyKey(key);
    try {
      const results = await hostApi.officeTools.applySkillLinks({
        ops: [{ expertId: skill.id, agentId: agent.id, enable: !enabled }],
      });
      const failures = results.filter((result) => !result.ok);
      if (failures.length > 0) {
        toast.warning(t('packs.office.agentMatrix.applyPartial', { failed: failures.length }), {
          description: failures[0]?.error ?? undefined,
        });
      } else {
        toast.success(!enabled
          ? t('packs.office.agentMatrix.enableSuccess')
          : t('packs.office.agentMatrix.disableSuccess'));
      }
      await refreshOfficeAssignments();
    } catch (err) {
      toast.error(t('packs.office.agentMatrix.applyFailed', { error: String(err) }));
    } finally {
      setOfficeLinkBusyKey(null);
    }
  }, [refreshOfficeAssignments, t]);

  const handleOfficeInstall = async () => {
    const taskId = createOfficeInstallTaskId();
    officeInstallTaskIdRef.current = taskId;
    setOfficeAction('install');
    setOfficeInstallLogs([]);
    setOfficeSyncReport(null);
    try {
      setOfficeInfo(await hostApi.officeTools.install({ taskId }));
      const report = await hostApi.officeTools.syncSkills();
      setOfficeSyncReport(report);
      await refreshAfterOfficeChange();
      if (report.errors.length > 0) {
        toast.warning(t('packs.office.syncPartial', { synced: report.synced, errors: report.errors.length }));
      } else {
        toast.success(t('packs.office.installSuccess'));
      }
    } catch (err) {
      toast.error(t('packs.office.installFailed', { error: String(err) }));
      await refreshOfficeInfo();
    } finally {
      setOfficeAction(null);
      officeInstallTaskIdRef.current = null;
    }
  };

  const handleOfficeSync = async () => {
    setOfficeAction('sync');
    setOfficeSyncReport(null);
    try {
      const report = await hostApi.officeTools.syncSkills();
      setOfficeSyncReport(report);
      await refreshAfterOfficeChange();
      if (report.errors.length > 0) {
        toast.warning(t('packs.office.syncPartial', { synced: report.synced, errors: report.errors.length }));
      } else {
        toast.success(t('packs.office.syncSuccess', { synced: report.synced }));
      }
    } catch (err) {
      toast.error(t('packs.office.syncFailed', { error: String(err) }));
      await refreshOfficeInfo();
    } finally {
      setOfficeAction(null);
    }
  };

  const handleOfficeUninstall = async () => {
    setOfficeAction('uninstall');
    setOfficeSyncReport(null);
    try {
      setOfficeInfo(await hostApi.officeTools.uninstall());
      await refreshAfterOfficeChange();
      toast.success(t('packs.office.uninstallSuccess'));
    } catch (err) {
      toast.error(t('packs.office.uninstallFailed', { error: String(err) }));
    } finally {
      setOfficeAction(null);
    }
  };

  const handleInstall = async (packId: SkillPackId) => {
    if (packId === 'officecli') {
      await handleOfficeInstall();
      return;
    }
    try {
      await installPack(packId);
      toast.success(t('packs.toast.installed'));
    } catch (err) {
      toast.error(t('packs.toast.failed', { error: String(err) }));
    }
  };

  const handleSync = async (packId: SkillPackId) => {
    if (packId === 'officecli') {
      await handleOfficeSync();
      return;
    }
    try {
      await syncPack(packId);
      toast.success(t('packs.toast.synced'));
    } catch (err) {
      toast.error(t('packs.toast.failed', { error: String(err) }));
    }
  };

  const handleEnabled = async (packId: SkillPackId, enabled: boolean) => {
    try {
      await setPackEnabled(packId, enabled);
      toast.success(enabled ? t('packs.toast.enabled') : t('packs.toast.disabled'));
    } catch (err) {
      toast.error(t('packs.toast.failed', { error: String(err) }));
    }
  };

  const handlePreview = async (pack: SkillPackSummary, skillId: string) => {
    try {
      const content = await readSkill(pack.id, skillId);
      setPreview({ pack, skillId, content });
    } catch (err) {
      toast.error(t('packs.toast.failed', { error: String(err) }));
    }
  };

  if (loading && packs.length === 0) {
    return <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>;
  }

  return (
    <div className="space-y-5" data-testid="skill-packs-panel">
      {error && (
        <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-4">
        {packs.map((pack) => {
          const isOfficeCli = pack.id === 'officecli';
          const packInstalled = pack.status !== 'notInstalled';
          const installed = isOfficeCli ? (officeInfo?.installed ?? packInstalled) : packInstalled;
          const installBusy = isOfficeCli
            ? officeAction === 'install'
            : Boolean(busy[packBusyKey(pack.id, 'install')]);
          const syncBusy = isOfficeCli
            ? officeAction === 'sync'
            : Boolean(busy[packBusyKey(pack.id, 'sync')]);
          const uninstallBusy = isOfficeCli && officeAction === 'uninstall';
          const enabledBusy = Boolean(busy[packBusyKey(pack.id, 'enabled')]);
          const enabledCount = pack.skills.filter((skill) => skill.enabled).length;
          const installedCount = pack.skills.filter((skill) => skill.installed).length;
          const officeRuntimeError = isOfficeCli ? officeInfo?.runtimeError : null;
          const officeHealthy = isOfficeCli && officeInfo?.installed === true && !officeRuntimeError;

          return (
            <section
              key={pack.id}
              data-testid={`skill-pack-card-${pack.id}`}
              className="rounded-xl border border-black/10 bg-black/[0.02] p-4 dark:border-white/10 dark:bg-white/[0.03]"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Package className="h-4 w-4 text-foreground/70" />
                    <h2 className="text-base font-semibold text-foreground">{pack.name}</h2>
                    <Badge variant={pack.enabled ? 'secondary' : 'outline'} className="rounded-full">
                      {t(`packs.status.${pack.status}`)}
                    </Badge>
                  </div>
                  <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                    {pack.description}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t('packs.skillCounts', {
                      installed: installedCount,
                      enabled: enabledCount,
                      total: pack.skills.length,
                    })}
                  </p>
                  {pack.error && <p className="mt-2 text-xs text-destructive">{pack.error}</p>}
                  {isOfficeCli && (
                    <div
                      data-testid="officecli-detection-card"
                      className={cn(
                        'mt-3 rounded-lg border px-3 py-2 text-xs',
                        officeHealthy
                          ? 'border-green-500/30 bg-green-500/5 text-green-700 dark:text-green-400'
                          : officeInfo?.installed
                            ? 'border-yellow-500/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400'
                            : 'border-black/10 bg-black/[0.03] text-muted-foreground dark:border-white/10 dark:bg-white/[0.04]',
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-foreground">OfficeCLI</span>
                        <Badge variant={officeHealthy ? 'secondary' : 'outline'} className="rounded-full">
                          {officeDetecting
                            ? t('packs.office.detecting')
                            : officeHealthy
                              ? t('packs.office.installed')
                              : officeInfo?.installed
                                ? t('packs.office.notRunnable')
                                : t('packs.office.notInstalled')}
                        </Badge>
                      </div>
                      {officeInfo?.installed && (
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
                          {officeInfo.version && <span>{officeInfo.version}</span>}
                          {officeInfo.path && <code className="break-all text-2xs">{officeInfo.path}</code>}
                        </div>
                      )}
                      {officeRuntimeError && (
                        <p className="mt-1.5 whitespace-pre-wrap break-words">{officeRuntimeError}</p>
                      )}
                      {!officeInfo?.installed && !officeDetecting && (
                        <p className="mt-1 text-muted-foreground">{t('packs.office.installHint')}</p>
                      )}
                    </div>
                  )}
                  {isOfficeCli && officeInstallLogs.length > 0 && (
                    <div
                      data-testid="officecli-install-log"
                      className="mt-3 max-h-36 overflow-auto rounded-lg border border-black/10 bg-black/[0.03] p-3 font-mono text-2xs leading-relaxed text-muted-foreground dark:border-white/10 dark:bg-white/[0.04]"
                    >
                      {officeInstallLogs.map((line, index) => (
                        <div key={`${index}-${line}`} className={line.startsWith('ERROR:') ? 'text-destructive' : undefined}>
                          {line}
                        </div>
                      ))}
                    </div>
                  )}
                  {isOfficeCli && officeSyncReport && officeSyncReport.errors.length > 0 && (
                    <div
                      data-testid="officecli-sync-report"
                      className="mt-3 rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-xs text-yellow-700 dark:text-yellow-400"
                    >
                      <p className="font-medium">
                        {t('packs.office.syncPartial', {
                          synced: officeSyncReport.synced,
                          errors: officeSyncReport.errors.length,
                        })}
                      </p>
                      <ul className="mt-1 space-y-1">
                        {officeSyncReport.errors.slice(0, 3).map((item) => (
                          <li key={item} className="break-words font-mono text-2xs">{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {!installed ? (
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 rounded-full px-3"
                      data-testid={`skill-pack-install-${pack.id}`}
                      disabled={installBusy}
                      onClick={() => void handleInstall(pack.id)}
                    >
                      {installBusy ? <LoadingSpinner size="sm" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
                      {pack.id === 'officecli' ? t('packs.actions.downloadInstall') : t('packs.actions.install')}
                    </Button>
                  ) : (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-full bg-transparent px-3"
                        data-testid={`skill-pack-sync-${pack.id}`}
                        disabled={syncBusy}
                        onClick={() => void handleSync(pack.id)}
                      >
                        {syncBusy ? <LoadingSpinner size="sm" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
                        {t('packs.actions.sync')}
                      </Button>
                      <Button
                        type="button"
                        variant={pack.enabled ? 'outline' : 'default'}
                        size="sm"
                        className="h-8 rounded-full px-3"
                        data-testid={pack.enabled ? `skill-pack-disable-${pack.id}` : `skill-pack-enable-${pack.id}`}
                        disabled={enabledBusy}
                        onClick={() => void handleEnabled(pack.id, !pack.enabled)}
                      >
                        {enabledBusy ? <LoadingSpinner size="sm" /> : <Power className="mr-1.5 h-3.5 w-3.5" />}
                        {pack.enabled ? t('packs.actions.disable') : t('packs.actions.enable')}
                      </Button>
                      {isOfficeCli && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 rounded-full bg-transparent px-3 text-destructive hover:text-destructive"
                          data-testid="skill-pack-uninstall-officecli"
                          disabled={uninstallBusy}
                          onClick={() => void handleOfficeUninstall()}
                        >
                          {uninstallBusy ? <LoadingSpinner size="sm" /> : <Trash2 className="mr-1.5 h-3.5 w-3.5" />}
                          {t('packs.actions.uninstall')}
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {pack.skills.length > 0 && (
                <div className="mt-4 grid gap-2">
                  {pack.skills.map((skill) => (
                    <div
                      key={skill.id}
                      className="flex items-center justify-between gap-3 rounded-lg bg-black/[0.03] px-3 py-2 dark:bg-white/[0.04]"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-mono text-xs font-medium text-foreground">{skill.id}</p>
                          {skill.enabled && (
                            <Badge variant="secondary" className="rounded-full">
                              {t('packs.skill.enabled')}
                            </Badge>
                          )}
                          {!skill.installed && (
                            <Badge variant="outline" className="rounded-full">
                              {t('packs.skill.notInstalled')}
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{skill.description}</p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        disabled={!skill.installed}
                        onClick={() => void handlePreview(pack, skill.id)}
                        aria-label={t('packs.actions.previewSkill', { skill: skill.id })}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {isOfficeCli && pack.skills.length > 0 && (
                <OfficeAgentMatrix
                  skills={pack.skills}
                  agents={officeAgents}
                  statuses={officeLinkStatuses}
                  loading={officeLinksLoading}
                  busyKey={officeLinkBusyKey}
                  onToggle={handleOfficeAgentToggle}
                />
              )}
            </section>
          );
        })}
      </div>

      <Sheet open={Boolean(preview)} onOpenChange={(open) => !open && setPreview(null)}>
        <SheetContent
          side="right"
          className="flex w-full flex-col border-l border-black/10 bg-surface-modal p-0 shadow-[0_0_40px_rgba(0,0,0,0.2)] dark:border-white/10 sm:max-w-[560px]"
        >
          {preview && (
            <>
              <div className="border-b border-black/10 px-6 py-5 dark:border-white/10">
                <h2 className="font-serif text-2xl font-normal tracking-tight text-foreground">
                  {preview.skillId}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">{preview.pack.name}</p>
              </div>
              <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap px-6 py-5 font-mono text-xs leading-relaxed text-foreground">
                {preview.content}
              </pre>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

const defaultMcpJson = JSON.stringify({
  mcpServers: {
    filesystem: {
      localAddress: 'clawx://mcp/filesystem',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:/Users/27933/Desktop'],
      env: {},
      enabled: true,
      scope: 'global',
    },
  },
}, null, 2);

type McpHeartbeat = {
  success: boolean;
  message?: string;
  error?: string;
  latencyMs?: number;
  status?: string;
  checkedAt: number;
};

type McpToolState = Awaited<ReturnType<typeof hostApi.mcp.listTools>>;

function getMcpServerTarget(server: McpServerConfig): string {
  return server.transport === 'stdio'
    ? [server.command, ...(server.args ?? [])].filter(Boolean).join(' ')
    : server.url || '-';
}

function getMcpLocalAddress(server: McpServerConfig): string {
  return server.localAddress ?? `clawx://mcp/${encodeURIComponent(server.id)}`;
}

function McpServicesPanel() {
  const { t } = useTranslation('skills');
  const {
    servers,
    loading,
    error,
    fetchServers,
    createServer,
    updateServer,
    deleteServer,
    testServer,
    heartbeat,
    listTools,
    reloadRuntime,
  } = useMcpStore();
  const [jsonDraft, setJsonDraft] = useState(defaultMcpJson);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [detailJson, setDetailJson] = useState('');
  const [heartbeatById, setHeartbeatById] = useState<Record<string, McpHeartbeat>>({});
  const [toolsById, setToolsById] = useState<Record<string, McpToolState>>({});
  const [loadingToolsId, setLoadingToolsId] = useState<string | null>(null);

  useEffect(() => {
    void fetchServers();
  }, [fetchServers]);

  const selectedServer = servers.find((server) => server.id === selectedServerId) ?? null;

  useEffect(() => {
    if (selectedServer) {
      setDetailJson(mcpServerToJson(selectedServer));
    }
  }, [selectedServer]);

  const handleCreate = async () => {
    setSaving(true);
    setJsonError(null);
    try {
      const configs = parseMcpJsonConfigs(jsonDraft, t('mcp.errors.jsonObjectRequired'));
      for (const config of configs) {
        await createServer(config);
      }
      toast.success(configs.length > 1 ? t('mcp.toast.registeredMany', { count: configs.length }) : t('mcp.toast.registeredOne'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setJsonError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (server: McpServerConfig) => {
    setTestingId(server.id);
    try {
      const result = await testServer(server.id);
      if (result.success) {
        toast.success(result.message || t('mcp.toast.configValid'));
      } else {
        toast.error(result.error || t('mcp.toast.configInvalid'));
      }
      setHeartbeatById((prev) => ({
        ...prev,
        [server.id]: {
          success: result.success,
          message: result.message,
          error: result.error,
          checkedAt: Date.now(),
        },
      }));
    } finally {
      setTestingId(null);
    }
  };

  void handleTest;

  const handleHeartbeat = async (server: McpServerConfig) => {
    setTestingId(server.id);
    try {
      const result = await heartbeat(server.id);
      setHeartbeatById((prev) => ({
        ...prev,
        [server.id]: {
          success: result.success,
          message: result.message,
          error: result.error,
          latencyMs: result.latencyMs,
          status: result.status,
          checkedAt: Date.now(),
        },
      }));
      if (result.success) {
        toast.success(result.latencyMs != null ? t('mcp.toast.heartbeatOkWithLatency', { ms: result.latencyMs }) : result.message || t('mcp.toast.heartbeatOk'));
      } else {
        toast.error(result.error || t('mcp.toast.heartbeatFailed'));
      }
    } finally {
      setTestingId(null);
    }
  };

  const handleListTools = async (server: McpServerConfig) => {
    setLoadingToolsId(server.id);
    try {
      const result = await listTools(server.id);
      setToolsById((prev) => ({ ...prev, [server.id]: result }));
      if (result.message) toast.info(result.message);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setLoadingToolsId(null);
    }
  };

  const handleReloadRuntime = async () => {
    try {
      const result = await reloadRuntime();
      toast.success(result.message || t('mcp.toast.synced', { count: result.serverCount }));
    } catch (err) {
      toast.error(String(err));
    }
  };

  const handleSaveDetail = async () => {
    if (!selectedServer) return;
    setSaving(true);
    setJsonError(null);
    try {
      const [config] = parseMcpJsonConfigs(detailJson, t('mcp.errors.jsonObjectRequired'));
      await updateServer({ id: selectedServer.id, ...config });
      toast.success(t('mcp.toast.saved'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setJsonError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handleCopyLocalAddress = async (server: McpServerConfig) => {
    try {
      await navigator.clipboard.writeText(getMcpLocalAddress(server));
      toast.success(t('mcp.toast.localAddressCopied'));
    } catch (err) {
      toast.error(t('mcp.toast.localAddressCopyFailed', { error: String(err) }));
    }
  };

  return (
    <div className="space-y-5" data-testid="mcp-services-panel">
      {error && (
        <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.04] p-5">
        <div className="mb-4 flex items-center gap-2">
          <Code2 className="h-4 w-4 text-foreground/70" />
          <div>
            <h2 className="text-base font-semibold text-foreground">{t('mcp.register.title')}</h2>
            <p className="text-xs text-muted-foreground">{t('mcp.register.description')}</p>
          </div>
        </div>
        <Textarea
          value={jsonDraft}
          onChange={(event) => setJsonDraft(event.target.value)}
          spellCheck={false}
          className="min-h-56 rounded-xl border-transparent bg-black/5 font-mono text-xs leading-relaxed dark:bg-white/5"
        />
        {jsonError && (
          <p className="mt-2 text-xs text-destructive">{jsonError}</p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setJsonDraft(defaultMcpJson)} className="h-9 rounded-full px-4">
            {t('mcp.actions.fillExample')}
          </Button>
          <Button variant="outline" onClick={() => void handleReloadRuntime()} className="h-9 rounded-full px-4 bg-transparent">
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            {t('mcp.actions.syncRuntime')}
          </Button>
          <Button onClick={() => void handleCreate()} disabled={saving || !jsonDraft.trim()} className="h-9 rounded-full px-4">
            {saving ? <LoadingSpinner size="sm" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}
            {t('mcp.actions.register')}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {loading ? (
          <div className="flex justify-center py-10"><LoadingSpinner size="lg" /></div>
        ) : servers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Server className="mb-3 h-9 w-9 opacity-50" />
            <p>{t('mcp.empty')}</p>
          </div>
        ) : (
          servers.map((server) => {
            const heartbeat = heartbeatById[server.id];
            return (
            <div
              key={server.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedServerId(server.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') setSelectedServerId(server.id);
              }}
              className="group flex cursor-pointer items-center justify-between gap-4 rounded-xl border-b border-black/5 px-3 py-3.5 transition-colors last:border-0 hover:bg-black/5 dark:border-white/5 dark:hover:bg-white/5"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-semibold text-foreground">{server.name}</p>
                  <Badge variant="outline" className="rounded-full">{server.transport}</Badge>
                  <Badge variant="secondary" className="rounded-full">{server.scope}</Badge>
                  {!server.enabled && <Badge variant="outline" className="rounded-full">{t('mcp.status.disabled')}</Badge>}
                  {heartbeat && (
                    <Badge variant={heartbeat.success ? 'secondary' : 'destructive'} className="rounded-full">
                      {heartbeat.success ? t('mcp.status.heartbeatOk') : t('mcp.status.heartbeatFailed')}
                    </Badge>
                  )}
                </div>
                <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                  {getMcpServerTarget(server)}
                </p>
                <p className="mt-1 truncate font-mono text-xs text-muted-foreground/80">
                  {getMcpLocalAddress(server)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Switch
                  checked={server.enabled}
                  onClick={(event) => event.stopPropagation()}
                  onCheckedChange={(enabled) => void updateServer({ id: server.id, enabled }).catch((err) => toast.error(String(err)))}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 rounded-full"
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleHeartbeat(server);
                  }}
                  disabled={testingId === server.id}
                >
                  {testingId === server.id ? <LoadingSpinner size="sm" /> : <Activity className="h-3.5 w-3.5" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleCopyLocalAddress(server);
                  }}
                  aria-label={t('mcp.actions.copyLocalAddress')}
                >
                  <Copy className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={(event) => {
                    event.stopPropagation();
                    void deleteServer(server.id).catch((err) => toast.error(String(err)));
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          );
          })
        )}
      </div>
      <Sheet open={!!selectedServer} onOpenChange={(open) => !open && setSelectedServerId(null)}>
        <SheetContent
          className="w-full sm:max-w-[560px] p-0 flex flex-col border-l border-black/10 dark:border-white/10 bg-surface-modal shadow-[0_0_40px_rgba(0,0,0,0.2)]"
          side="right"
        >
          {selectedServer && (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="border-b border-black/10 px-7 py-6 dark:border-white/10">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="truncate text-2xl font-serif font-normal tracking-tight text-foreground">
                      {selectedServer.name}
                    </h2>
                    <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                      {getMcpServerTarget(selectedServer)}
                    </p>
                  </div>
                  <Switch
                    checked={selectedServer.enabled}
                    onCheckedChange={(enabled) => void updateServer({ id: selectedServer.id, enabled }).catch((err) => toast.error(String(err)))}
                  />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Badge variant="outline" className="rounded-full">{selectedServer.transport}</Badge>
                  <Badge variant="secondary" className="rounded-full">{selectedServer.scope}</Badge>
                  <Badge variant="outline" className="rounded-full">{selectedServer.runtimeStatus ?? 'registered'}</Badge>
                  <Badge variant="outline" className="rounded-full">network: {selectedServer.networkPolicy ?? 'localOnly'}</Badge>
                  {selectedServer.ownerId && <Badge variant="outline" className="rounded-full">{selectedServer.ownerId}</Badge>}
                </div>
                <div className="mt-4 rounded-xl bg-black/5 px-3 py-2 dark:bg-white/5">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-muted-foreground">{t('mcp.detail.localAddress')}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 rounded-full px-2 text-xs"
                      onClick={() => void handleCopyLocalAddress(selectedServer)}
                    >
                      <Copy className="mr-1 h-3.5 w-3.5" />
                      {t('mcp.actions.copy')}
                    </Button>
                  </div>
                  <p className="truncate font-mono text-xs text-foreground">
                    {getMcpLocalAddress(selectedServer)}
                  </p>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-7 py-5">
                <div className="mb-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl bg-black/5 p-3 dark:bg-white/5">
                    <p className="text-tiny text-muted-foreground">Runtime</p>
                    <p className="mt-1 font-mono text-xs text-foreground">{selectedServer.runtimeStatus ?? 'registered'}</p>
                  </div>
                  <div className="rounded-xl bg-black/5 p-3 dark:bg-white/5">
                    <p className="text-tiny text-muted-foreground">Heartbeat</p>
                    <p className="mt-1 font-mono text-xs text-foreground">
                      {heartbeatById[selectedServer.id]?.latencyMs != null
                        ? `${heartbeatById[selectedServer.id].latencyMs}ms`
                        : selectedServer.lastHeartbeatMs != null
                          ? `${selectedServer.lastHeartbeatMs}ms`
                          : '-'}
                    </p>
                  </div>
                  <div className="rounded-xl bg-black/5 p-3 dark:bg-white/5">
                    <p className="text-tiny text-muted-foreground">Tools</p>
                    <p className="mt-1 font-mono text-xs text-foreground">
                      {toolsById[selectedServer.id]?.success === false ? '-' : toolsById[selectedServer.id]?.tools.length ?? selectedServer.toolCount ?? 0}
                    </p>
                  </div>
                </div>
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-semibold text-foreground">{t('mcp.detail.jsonConfig')}</p>
                  {heartbeatById[selectedServer.id] && (
                    <span className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs',
                      heartbeatById[selectedServer.id].success
                        ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                        : 'bg-red-500/10 text-red-600 dark:text-red-400',
                    )}>
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {heartbeatById[selectedServer.id].success ? t('mcp.status.connectionOk') : t('mcp.status.connectionIssue')}
                    </span>
                  )}
                </div>
                <Textarea
                  value={detailJson}
                  onChange={(event) => setDetailJson(event.target.value)}
                  spellCheck={false}
                  className="min-h-[360px] rounded-xl border-transparent bg-black/5 font-mono text-xs leading-relaxed dark:bg-white/5"
                />
                {jsonError && <p className="mt-2 text-xs text-destructive">{jsonError}</p>}
                <div className="mt-5 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground">{t('mcp.detail.toolCatalog')}</p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 rounded-full px-3"
                      onClick={() => void handleListTools(selectedServer)}
                      disabled={loadingToolsId === selectedServer.id}
                    >
                      {loadingToolsId === selectedServer.id ? <LoadingSpinner size="sm" /> : <Activity className="mr-1.5 h-3.5 w-3.5" />}
                      {t('common:actions.refresh')}
                    </Button>
                  </div>
                  {toolsById[selectedServer.id] && (
                    <div className="rounded-xl border border-black/5 p-3 dark:border-white/5">
                      <p className="mb-2 text-xs font-medium text-foreground">{t('mcp.detail.toolCatalog')}</p>
                      {!toolsById[selectedServer.id].success ? (
                        <p role="alert" className="text-xs text-destructive">
                          {toolsById[selectedServer.id].error || t('common:status.error')}
                        </p>
                      ) : toolsById[selectedServer.id].tools.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          {toolsById[selectedServer.id].message || t('mcp.detail.noRuntimeTools')}
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {toolsById[selectedServer.id].tools.map((tool) => (
                            <div key={tool.name} className="rounded-lg bg-black/[0.03] px-3 py-2 dark:bg-white/[0.04]">
                              <p className="font-mono text-xs text-foreground">{tool.name}</p>
                              {tool.description && <p className="mt-1 text-xs text-muted-foreground">{tool.description}</p>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-black/10 px-7 py-4 dark:border-white/10">
                <Button
                  variant="ghost"
                  className="rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => {
                    void deleteServer(selectedServer.id)
                      .then(() => {
                        setSelectedServerId(null);
                        toast.success(t('mcp.toast.deleted'));
                      })
                      .catch((err) => toast.error(String(err)));
                  }}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  {t('common:actions.delete')}
                </Button>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="rounded-full bg-transparent"
                    onClick={() => void handleHeartbeat(selectedServer)}
                    disabled={testingId === selectedServer.id}
                  >
                    {testingId === selectedServer.id ? <LoadingSpinner size="sm" /> : <Activity className="mr-1.5 h-3.5 w-3.5" />}
                    {t('mcp.actions.heartbeat')}
                  </Button>
                  <Button className="rounded-full" onClick={() => void handleSaveDetail()} disabled={saving}>
                    {saving ? <LoadingSpinner size="sm" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
                    {t('common:actions.save')}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

export default Skills;
