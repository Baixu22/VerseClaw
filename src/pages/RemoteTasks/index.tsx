import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Check, Inbox, Play, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { hostApi } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import type {
  RemoteTaskCommand,
  RemoteTaskKind,
  RemoteTaskPreview,
  RemoteTaskRecord,
  RemoteTaskStatus,
} from '@shared/types/remote-tasks';

const DEFAULT_PATCH = JSON.stringify({ theme: 'system' }, null, 2);

function statusTone(status: RemoteTaskStatus): string {
  if (status === 'completed') return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400';
  if (status === 'failed') return 'border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-400';
  if (status === 'rejected') return 'border-zinc-500/25 bg-zinc-500/10 text-zinc-700 dark:text-zinc-400';
  if (status === 'running') return 'border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-400';
  if (status === 'pendingApproval') return 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400';
  return 'border-border bg-black/5 text-muted-foreground dark:bg-white/10';
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function taskTitle(task: RemoteTaskRecord): string {
  if (task.command.kind === 'message') return task.command.title;
  if (task.command.kind === 'doctor') return `doctor:${task.command.mode}`;
  return Object.keys(task.command.patch).join(', ');
}

export function RemoteTasks() {
  const { t } = useTranslation(['remoteTasks', 'common']);
  const [tasks, setTasks] = useState<RemoteTaskRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<RemoteTaskPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [kind, setKind] = useState<RemoteTaskKind>('message');
  const [title, setTitle] = useState(t('form.defaultTitle'));
  const [body, setBody] = useState(t('form.defaultBody'));
  const [doctorMode, setDoctorMode] = useState<'diagnose' | 'fix'>('diagnose');
  const [patchText, setPatchText] = useState(DEFAULT_PATCH);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedId) ?? tasks[0] ?? null,
    [selectedId, tasks],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await hostApi.remoteTasks.list();
      setTasks(result.tasks);
      setSelectedId((current) => current && result.tasks.some((task) => task.id === current)
        ? current
        : result.tasks[0]?.id ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedTask) {
      setPreview(null);
      return;
    }
    hostApi.remoteTasks.preview({ id: selectedTask.id })
      .then((result) => setPreview({ requiresApproval: result.requiresApproval, changes: result.changes }))
      .catch(() => setPreview(null));
  }, [selectedTask]);

  const createTask = async () => {
    let command: RemoteTaskCommand;
    if (kind === 'message') {
      command = { kind, title: title.trim(), body: body.trim() };
    } else if (kind === 'doctor') {
      command = { kind, mode: doctorMode };
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(patchText);
      } catch {
        toast.error(t('toast.invalidJson'));
        return;
      }
      command = { kind, patch: parsed as Record<string, unknown> };
    }

    try {
      const result = await hostApi.remoteTasks.create({
        source: 'local',
        reason: t('form.localReason'),
        command,
      });
      setTasks((current) => [result.task, ...current]);
      setSelectedId(result.task.id);
      toast.success(t('toast.created'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const mutateTask = async (id: string, action: 'approve' | 'reject' | 'execute') => {
    setBusyId(id);
    try {
      const result = action === 'approve'
        ? await hostApi.remoteTasks.approve({ id })
        : action === 'reject'
          ? await hostApi.remoteTasks.reject({ id })
          : await hostApi.remoteTasks.execute({ id });
      setTasks((current) => current.map((task) => task.id === id ? result.task : task));
      toast.success(t(`toast.${action}`));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div data-testid="remote-tasks-page" className="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col gap-4">
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-normal tracking-tight text-foreground">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn('mr-1.5 h-4 w-4', loading && 'animate-spin')} />
          {t('actions.refresh')}
        </Button>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col gap-3 rounded-md border border-border/70 bg-background p-3">
          <div className="flex items-center gap-2">
            <Inbox className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-medium text-foreground">{t('form.title')}</h2>
          </div>

          <div className="space-y-2">
            <Label htmlFor="remote-task-kind">{t('form.kind')}</Label>
            <Select value={kind} onValueChange={(value) => setKind(value as RemoteTaskKind)}>
              <SelectTrigger id="remote-task-kind" className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="message">{t('kind.message')}</SelectItem>
                <SelectItem value="doctor">{t('kind.doctor')}</SelectItem>
                <SelectItem value="settingsPatch">{t('kind.settingsPatch')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {kind === 'message' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="remote-task-title">{t('form.messageTitle')}</Label>
                <Input id="remote-task-title" value={title} onChange={(event) => setTitle(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="remote-task-body">{t('form.messageBody')}</Label>
                <Textarea id="remote-task-body" value={body} onChange={(event) => setBody(event.target.value)} className="min-h-28" />
              </div>
            </>
          )}

          {kind === 'doctor' && (
            <div className="space-y-2">
              <Label htmlFor="remote-task-doctor">{t('form.doctorMode')}</Label>
              <Select value={doctorMode} onValueChange={(value) => setDoctorMode(value as 'diagnose' | 'fix')}>
                <SelectTrigger id="remote-task-doctor" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="diagnose">{t('doctor.diagnose')}</SelectItem>
                  <SelectItem value="fix">{t('doctor.fix')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {kind === 'settingsPatch' && (
            <div className="space-y-2">
              <Label htmlFor="remote-task-patch">{t('form.patch')}</Label>
              <Textarea
                id="remote-task-patch"
                value={patchText}
                onChange={(event) => setPatchText(event.target.value)}
                className="min-h-36 font-mono text-xs"
                spellCheck={false}
              />
              <p className="text-xs text-muted-foreground">{t('form.patchHint')}</p>
            </div>
          )}

          <Button type="button" onClick={() => void createTask()} data-testid="remote-task-create">
            <Inbox className="mr-1.5 h-4 w-4" />
            {t('actions.create')}
          </Button>
        </section>

        <section className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="min-h-0 overflow-y-auto rounded-md border border-border/70 bg-background p-2" data-testid="remote-task-list">
            {tasks.length === 0 ? (
              <div className="flex min-h-52 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                <Inbox className="h-8 w-8" />
                {t('empty')}
              </div>
            ) : tasks.map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => setSelectedId(task.id)}
                className={cn(
                  'mb-2 flex w-full flex-col gap-2 rounded-md border border-border/70 p-3 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5',
                  selectedTask?.id === task.id && 'bg-black/5 dark:bg-white/10',
                )}
                data-testid="remote-task-row"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{taskTitle(task)}</p>
                    <p className="text-xs text-muted-foreground">{formatTime(task.updatedAt)}</p>
                  </div>
                  <Badge variant="outline" className={cn('shrink-0 rounded-full text-2xs', statusTone(task.status))}>
                    {t(`status.${task.status}`)}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">{t(`kind.${task.command.kind}`)} · {t(`source.${task.source}`)}</p>
              </button>
            ))}
          </div>

          <div className="min-h-0 overflow-y-auto rounded-md border border-border/70 bg-background p-4" data-testid="remote-task-detail">
            {!selectedTask ? (
              <div className="flex min-h-52 items-center justify-center text-sm text-muted-foreground">{t('empty')}</div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-medium text-foreground">{taskTitle(selectedTask)}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">{selectedTask.id}</p>
                  </div>
                  <Badge variant="outline" className={cn('rounded-full', statusTone(selectedTask.status))}>
                    {t(`status.${selectedTask.status}`)}
                  </Badge>
                </div>

                <div className="grid gap-2 text-sm md:grid-cols-2">
                  <div>
                    <p className="text-xs text-muted-foreground">{t('detail.kind')}</p>
                    <p className="text-foreground">{t(`kind.${selectedTask.command.kind}`)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t('detail.source')}</p>
                    <p className="text-foreground">{t(`source.${selectedTask.source}`)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t('detail.created')}</p>
                    <p className="text-foreground">{formatTime(selectedTask.createdAt)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t('detail.updated')}</p>
                    <p className="text-foreground">{formatTime(selectedTask.updatedAt)}</p>
                  </div>
                </div>

                {selectedTask.command.kind === 'message' && (
                  <pre className="max-h-48 overflow-auto rounded-md bg-surface-input p-3 text-xs text-foreground whitespace-pre-wrap">
                    {selectedTask.command.body}
                  </pre>
                )}

                {selectedTask.command.kind === 'doctor' && (
                  <div className="flex items-center gap-2 rounded-md bg-surface-input p-3 text-sm text-foreground">
                    <Activity className="h-4 w-4 text-muted-foreground" />
                    {t(`doctor.${selectedTask.command.mode}`)}
                  </div>
                )}

                {preview?.changes && preview.changes.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <ShieldCheck className="h-4 w-4 text-amber-700 dark:text-amber-400" />
                      {t('preview.title')}
                    </div>
                    <div className="space-y-2">
                      {preview.changes.map((change) => (
                        <div key={change.key} className="rounded-md border border-border/70 p-3 text-xs">
                          <p className="font-medium text-foreground">{change.key}</p>
                          <p className="mt-1 text-muted-foreground">{t('preview.before')}: {formatValue(change.before)}</p>
                          <p className="text-foreground">{t('preview.after')}: {formatValue(change.after)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedTask.resultSummary && (
                  <p className="rounded-md bg-surface-input p-3 text-sm text-foreground">{selectedTask.resultSummary}</p>
                )}
                {selectedTask.error && (
                  <p className="rounded-md border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">{selectedTask.error}</p>
                )}

                <div className="flex flex-wrap gap-2">
                  {selectedTask.status === 'pendingApproval' && (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void mutateTask(selectedTask.id, 'approve')}
                        disabled={busyId === selectedTask.id}
                      >
                        <Check className="mr-1.5 h-4 w-4" />
                        {t('actions.approve')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void mutateTask(selectedTask.id, 'reject')}
                        disabled={busyId === selectedTask.id}
                      >
                        <X className="mr-1.5 h-4 w-4" />
                        {t('actions.reject')}
                      </Button>
                    </>
                  )}
                  {(selectedTask.status === 'pending' || selectedTask.status === 'failed') && (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void mutateTask(selectedTask.id, 'execute')}
                      disabled={busyId === selectedTask.id}
                      data-testid="remote-task-execute"
                    >
                      <Play className="mr-1.5 h-4 w-4" />
                      {t('actions.execute')}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
