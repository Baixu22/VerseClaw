import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Cpu,
  HardDrive,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { hostApi } from '@/lib/host-api';
import { useChatStore } from '@/stores/chat';
import type {
  SystemInfoResult,
  SystemScanResult,
  SystemScanCategory,
  SystemScanItem,
} from '@shared/host-api/contract';

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatDate(ms: number): string {
  if (!ms) return '-';
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(ms));
  } catch {
    return '-';
  }
}

function percent(used: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((used / total) * 100));
}

export function StorageCleanerSection() {
  const { t } = useTranslation('settings');
  const navigate = useNavigate();
  const [info, setInfo] = useState<SystemInfoResult | null>(null);
  const [scan, setScan] = useState<SystemScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['logs']));
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      const [infoResult, scanResult] = await Promise.all([
        hostApi.system.info(),
        hostApi.system.scan({}),
      ]);
      setInfo(infoResult);
      setScan(scanResult);
      setSelected(new Set());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error(t('storage.toast.scanFailed', { error: msg }));
    } finally {
      setScanning(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelect = useCallback((item: SystemScanItem) => {
    if (!item.safeToDelete) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  }, []);

  const selectedItems = useCallback((): Array<{ id: string; path: string }> => {
    if (!scan) return [];
    const result: Array<{ id: string; path: string }> = [];
    for (const cat of scan.categories) {
      for (const item of cat.items) {
        if (selected.has(item.id)) {
          result.push({ id: item.id, path: item.path });
        }
      }
    }
    return result;
  }, [scan, selected]);

  const handleDelete = useCallback(async () => {
    const items = selectedItems();
    if (items.length === 0) return;
    setDeleting(true);
    setError(null);
    try {
      const dryRun = await hostApi.system.deleteItems({ items, dryRun: true });
      if (!dryRun.success) {
        throw new Error(dryRun.error ?? 'dry-run failed');
      }
      const freedPreview = formatBytes(dryRun.freedBytes);
      const confirmed = window.confirm(
        t('storage.actions.confirmDelete') +
          `\n\n${items.length} item(s), ~${freedPreview}`,
      );
      if (!confirmed) {
        setDeleting(false);
        return;
      }
      const real = await hostApi.system.deleteItems({
        items,
        dryRun: false,
        approvalId: dryRun.auditId,
      });
      if (!real.success && real.errors.length > 0) {
        const firstErr = real.errors[0]?.error ?? 'unknown';
        toast.error(t('storage.toast.deleteFailed', { error: firstErr }));
      } else {
        toast.success(
          t('storage.toast.deleteSucceeded', {
            count: real.removed.length,
            bytes: formatBytes(real.freedBytes),
          }),
        );
      }
      await refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error(t('storage.toast.deleteFailed', { error: msg }));
    } finally {
      setDeleting(false);
    }
  }, [selectedItems, t, refresh]);

  const handleAskAgent = useCallback(async () => {
    const prompt = t('storage.agent.recommendPrompt');
    try {
      const { sendMessage } = useChatStore.getState();
      await sendMessage(prompt);
      navigate('/');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(t('storage.toast.scanFailed', { error: msg }));
    }
  }, [t, navigate]);

  const ramUsed = info ? info.ram.totalBytes - info.ram.freeBytes : 0;
  const ramTotal = info?.ram.totalBytes ?? 0;
  const ramPercent = percent(ramUsed, ramTotal);
  const diskInfo = info?.disk[0];
  const diskUsed = diskInfo ? diskInfo.totalBytes - diskInfo.freeBytes : 0;
  const diskPercent = percent(diskUsed, diskInfo?.totalBytes ?? 0);
  const selectedCount = selected.size;
  const totalScannedBytes = scan?.categories.reduce((s: number, c: SystemScanCategory) => s + c.totalBytes, 0) ?? 0;

  return (
    <div data-testid="settings-storage-section" className="space-y-6">
      {/* System info cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div
          data-testid="storage-info-ram"
          className="rounded-lg border border-black/5 bg-surface-modal p-4 dark:border-white/10"
        >
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
            <Activity className="size-4 text-blue-600 dark:text-blue-400" />
            {t('storage.systemInfo.ram')}
          </div>
          <div className="mb-2 text-2xl font-serif font-normal tracking-tight text-foreground">
            {formatBytes(ramUsed)} / {formatBytes(ramTotal)}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
            <div
              className="h-full rounded-full bg-blue-600 dark:bg-blue-400 transition-all"
              style={{ width: `${ramPercent}%` }}
            />
          </div>
          <div className="mt-1 text-xs text-foreground/60">
            {t('storage.systemInfo.free')}: {formatBytes(info?.ram.freeBytes ?? 0)}
          </div>
        </div>

        <div
          data-testid="storage-info-disk"
          className="rounded-lg border border-black/5 bg-surface-modal p-4 dark:border-white/10"
        >
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
            <HardDrive className="size-4 text-emerald-600 dark:text-emerald-400" />
            {t('storage.systemInfo.disk')}
          </div>
          <div className="mb-2 text-2xl font-serif font-normal tracking-tight text-foreground">
            {formatBytes(diskUsed)} / {formatBytes(diskInfo?.totalBytes ?? 0)}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
            <div
              className="h-full rounded-full bg-emerald-600 dark:bg-emerald-400 transition-all"
              style={{ width: `${diskPercent}%` }}
            />
          </div>
          <div className="mt-1 text-xs text-foreground/60">
            {t('storage.systemInfo.free')}: {formatBytes(diskInfo?.freeBytes ?? 0)}
          </div>
        </div>

        <div
          data-testid="storage-info-cpu"
          className="rounded-lg border border-black/5 bg-surface-modal p-4 dark:border-white/10"
        >
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
            <Cpu className="size-4 text-amber-600 dark:text-amber-400" />
            {t('storage.systemInfo.cpu')}
          </div>
          <div className="mb-2 text-2xl font-serif font-normal tracking-tight text-foreground">
            {info?.cpu.available
              ? t('storage.systemInfo.load', { percent: info.cpu.loadPercent })
              : t('storage.systemInfo.notAvailable')}
          </div>
          <div className="text-xs text-foreground/60">
            {t('storage.systemInfo.cores', { count: info?.cpu.cores ?? 0 })}
          </div>
        </div>
      </div>

      {/* Action toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="storage-scan-refresh"
          onClick={() => void refresh()}
          disabled={scanning}
          className="inline-flex items-center gap-1.5 rounded-md border border-black/10 bg-surface-input px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-black/5 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/10"
        >
          {scanning ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          {t('storage.actions.refresh')}
        </button>
        <button
          type="button"
          data-testid="storage-ask-agent-button"
          onClick={() => void handleAskAgent()}
          className="inline-flex items-center gap-1.5 rounded-md border border-black/10 bg-surface-input px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
        >
          <Sparkles className="size-3.5" />
          {t('storage.actions.askAgent')}
        </button>
        <div className="ml-auto text-xs text-foreground/60">
          {t('storage.actions.itemsSelected', { count: selectedCount })}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-400">
          <AlertTriangle className="size-3.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Category list */}
      <div className="space-y-2">
        {scan?.categories.map((cat) => (
          <CategoryBlock
            key={cat.id}
            category={cat}
            expanded={expanded.has(cat.id)}
            selected={selected}
            onToggleExpand={() => toggleExpand(cat.id)}
            onToggleSelect={toggleSelect}
            t={t}
          />
        ))}
      </div>

      {/* Delete bar */}
      {selectedCount > 0 && (
        <div className="sticky bottom-0 flex items-center justify-between rounded-lg border border-black/5 bg-surface-modal px-4 py-3 shadow-sm dark:border-white/10">
          <div className="text-sm text-foreground">
            {t('storage.actions.itemsSelected', { count: selectedCount })} ·{' '}
            {formatBytes(totalScannedBytes)}
          </div>
          <button
            type="button"
            data-testid="storage-delete-button"
            onClick={() => void handleDelete()}
            disabled={deleting}
            className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
          >
            {deleting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Trash2 className="size-3.5" />
            )}
            {t('storage.actions.deleteSelected')}
          </button>
        </div>
      )}
    </div>
  );
}

interface CategoryBlockProps {
  category: SystemScanCategory;
  expanded: boolean;
  selected: Set<string>;
  onToggleExpand: () => void;
  onToggleSelect: (item: SystemScanItem) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

function CategoryBlock({
  category,
  expanded,
  selected,
  onToggleExpand,
  onToggleSelect,
  t,
}: CategoryBlockProps) {
  const labelKey = `storage.categories.${category.id}.label`;
  const label = t(labelKey);
  return (
    <div
      data-testid={`storage-category-${category.id}`}
      className="overflow-hidden rounded-md border border-black/5 dark:border-white/10"
    >
      <button
        type="button"
        onClick={onToggleExpand}
        className="flex w-full items-center gap-2 bg-surface-input/50 px-3 py-2 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/10"
      >
        {expanded ? (
          <ChevronDown className="size-3.5 shrink-0 text-foreground/60" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-foreground/60" />
        )}
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-xs text-foreground/60">
          {category.itemCount} · {formatBytes(category.totalBytes)}
        </span>
        {category.regenerate && (
          <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-2xs text-emerald-700 dark:text-emerald-400">
            {t('storage.status.regenerable')}
          </span>
        )}
        {category.truncated && (
          <span className="text-2xs text-amber-700 dark:text-amber-400">
            {t('storage.status.truncated', { count: category.items.length })}
          </span>
        )}
      </button>
      {expanded && (
        <div className="divide-y divide-black/5 dark:divide-white/5">
          {category.items.length === 0 ? (
            <div className="px-3 py-3 text-xs text-foreground/60">
              {t('storage.status.empty')}
            </div>
          ) : (
            category.items.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                checked={selected.has(item.id)}
                onToggle={() => onToggleSelect(item)}
                t={t}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

interface ItemRowProps {
  item: SystemScanItem;
  checked: boolean;
  onToggle: () => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

function ItemRow({ item, checked, onToggle, t }: ItemRowProps) {
  return (
    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors hover:bg-black/5 dark:hover:bg-white/5">
      <input
        type="checkbox"
        data-testid={`storage-item-checkbox-${item.id}`}
        checked={checked}
        onChange={onToggle}
        disabled={!item.safeToDelete}
        className="size-3.5 rounded border-black/20 dark:border-white/20"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs text-foreground" title={item.path}>
          {item.path}
        </div>
        <div className="text-2xs text-foreground/60">
          {formatBytes(item.sizeBytes)} · {formatDate(item.mtime)}
          {item.isDir && ' · dir'}
        </div>
      </div>
      {item.safeToDelete ? (
        <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-2xs text-emerald-700 dark:text-emerald-400">
          {t('storage.status.safeToDelete')}
        </span>
      ) : (
        <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-2xs text-amber-700 dark:text-amber-400">
          {t('storage.status.notDeletable')}
        </span>
      )}
    </label>
  );
}
