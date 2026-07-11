import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bot,
  CircleStop,
  Eye,
  EyeOff,
  Globe2,
  KeyRound,
  Monitor,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { hostApi } from '@/lib/host-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type {
  AgentBrowserCredentialMetadata,
  AgentBrowserProfileEntry,
  AgentBrowserSession,
  AgentBrowserTask,
} from '@shared/host-api/contract';

const statusStyles: Record<AgentBrowserTask['status'], string> = {
  queued: 'text-zinc-700 dark:text-zinc-300',
  running: 'text-blue-700 dark:text-blue-400',
  'waiting-approval': 'text-amber-700 dark:text-amber-400',
  paused: 'text-amber-700 dark:text-amber-400',
  completed: 'text-emerald-700 dark:text-emerald-400',
  failed: 'text-red-700 dark:text-red-400',
  cancelled: 'text-muted-foreground',
};

export function BrowserWorkbench() {
  const { t } = useTranslation('browser');
  const [sessions, setSessions] = useState<AgentBrowserSession[]>([]);
  const [tasks, setTasks] = useState<AgentBrowserTask[]>([]);
  const [profiles, setProfiles] = useState<AgentBrowserProfileEntry[]>([]);
  const [credentials, setCredentials] = useState<AgentBrowserCredentialMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [taskDraft, setTaskDraft] = useState({
    name: '',
    url: '',
    objective: '',
    profile: 'default',
    mode: 'headless' as const,
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [sessionResult, taskResult, profileResult, vaultResult] = await Promise.all([
        hostApi.agentBrowser.status(),
        hostApi.agentBrowser.tasks(),
        hostApi.agentBrowser.profiles(),
        hostApi.agentBrowser.vault(),
      ]);
      setSessions(sessionResult.sessions ?? []);
      setTasks(taskResult.tasks ?? []);
      setProfiles(profileResult.profiles ?? []);
      setCredentials(vaultResult.credentials ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const runTask = async () => {
    if (!taskDraft.name.trim() || !taskDraft.url.trim() || !taskDraft.objective.trim()) return;
    const created = await hostApi.agentBrowser.createTask({
      ...taskDraft,
      name: taskDraft.name.trim(),
      url: taskDraft.url.trim(),
      objective: taskDraft.objective.trim(),
    });
    await hostApi.agentBrowser.runTask({ taskId: created.task.id });
    setTaskDraft((current) => ({ ...current, name: '', url: '', objective: '' }));
    await refresh();
  };

  const activeRuns = useMemo(
    () => tasks.filter((task) => task.status !== 'queued').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [tasks],
  );

  return (
    <main className="flex h-full min-h-0 flex-col bg-background" data-testid="browser-workbench">
      <header className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-border px-5 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Globe2 className="h-5 w-5 text-foreground" />
            <h1 className="truncate font-serif text-2xl font-normal tracking-tight">{t('title')}</h1>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
            <span>{t('summary.sessions', { count: sessions.length })}</span>
            <span className="h-3 w-px bg-border" />
            <span>{t('summary.running', { count: tasks.filter((task) => task.status === 'running').length })}</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('actions.refresh')}
            onClick={() => void refresh()}
            disabled={loading}
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin motion-reduce:animate-none')} />
          </Button>
        </div>
      </header>

      <Tabs defaultValue="sessions" className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-border px-5">
          <TabsList className="h-11 rounded-none bg-transparent p-0">
            {(['sessions', 'tasks', 'profiles', 'vault', 'runs'] as const).map((tab) => (
              <TabsTrigger
                key={tab}
                value={tab}
                className="h-11 rounded-none border-b-2 border-transparent px-3 text-xs shadow-none data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              >
                {t(`tabs.${tab}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          <TabsContent value="sessions" className="m-0 space-y-2">
            {sessions.length === 0 ? <EmptyState icon={Monitor} text={t('sessions.empty')} /> : sessions.map((session) => (
              <div key={session.id} className="grid min-h-16 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-border py-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-surface-input">
                  {session.mode === 'headless' ? <Bot className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{session.title || t('sessions.untitled')}</p>
                    <span className="rounded-sm bg-black/5 px-1.5 py-0.5 text-[10px] text-muted-foreground dark:bg-white/10">
                      {t(`modes.${session.mode}`)}
                    </span>
                  </div>
                  <p className="truncate font-mono text-[11px] text-muted-foreground" title={session.url}>{session.url || t('sessions.blank')}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{session.profile}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" aria-label={session.mode === 'headless' ? t('actions.takeOver') : t('actions.hide')} onClick={async () => {
                    await (session.mode === 'headless'
                      ? hostApi.agentBrowser.show({ sessionId: session.id })
                      : hostApi.agentBrowser.hide({ sessionId: session.id }));
                    await refresh();
                  }}>
                    {session.mode === 'headless' ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={t('actions.stop')} onClick={async () => {
                    await hostApi.agentBrowser.close({ sessionId: session.id });
                    await refresh();
                  }}>
                    <CircleStop className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="tasks" className="m-0">
            <section className="grid gap-4 border-b border-border pb-5 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.7fr)]">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('tasks.name')}><Input aria-label={t('tasks.name')} value={taskDraft.name} onChange={(event) => setTaskDraft({ ...taskDraft, name: event.target.value })} /></Field>
                <Field label={t('tasks.url')}><Input aria-label={t('tasks.url')} value={taskDraft.url} onChange={(event) => setTaskDraft({ ...taskDraft, url: event.target.value })} placeholder="https://" /></Field>
                <div className="sm:col-span-2"><Field label={t('tasks.objective')}><Input aria-label={t('tasks.objective')} value={taskDraft.objective} onChange={(event) => setTaskDraft({ ...taskDraft, objective: event.target.value })} /></Field></div>
              </div>
              <div className="flex flex-col justify-end gap-3">
                <div className="grid grid-cols-2 gap-2">
                  <select className="h-9 rounded-md border border-input bg-surface-input px-2 text-sm" value={taskDraft.profile} onChange={(event) => setTaskDraft({ ...taskDraft, profile: event.target.value })}>
                    {profiles.map((profile) => <option key={profile.profile} value={profile.profile}>{profile.label || profile.profile}</option>)}
                  </select>
                  <select className="h-9 rounded-md border border-input bg-surface-input px-2 text-sm" value={taskDraft.mode} onChange={(event) => setTaskDraft({ ...taskDraft, mode: event.target.value as 'headless' })}>
                    <option value="headless">{t('modes.headless')}</option>
                    <option value="visible">{t('modes.visible')}</option>
                  </select>
                </div>
                <Button onClick={() => void runTask()}><Play className="mr-2 h-4 w-4" />{t('tasks.runNow')}</Button>
              </div>
            </section>
            <TaskList tasks={tasks} t={t} refresh={refresh} />
          </TabsContent>

          <TabsContent value="profiles" className="m-0">
            {profiles.map((profile) => (
              <div key={profile.profile} className="flex min-h-14 items-center gap-3 border-b border-border py-3">
                <UserRound className="h-4 w-4 text-muted-foreground" />
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{profile.label || profile.profile}</p><p className="truncate text-xs text-muted-foreground">{profile.description || profile.authStateName || t('profiles.localState')}</p></div>
                <span className="text-xs text-muted-foreground">{t('profiles.active', { count: profile.activeSessions ?? 0 })}</span>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="vault" className="m-0">
            <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />{t('vault.protected')}</div>
            {credentials.length === 0 ? <EmptyState icon={KeyRound} text={t('vault.empty')} /> : credentials.map((credential) => (
              <div key={credential.id} className="flex min-h-14 items-center gap-3 border-b border-border py-3">
                <KeyRound className="h-4 w-4 text-muted-foreground" />
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{credential.username}</p><p className="truncate font-mono text-[11px] text-muted-foreground">{credential.origin}</p></div>
                <span className="text-xs text-muted-foreground">{credential.profile}</span>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="runs" className="m-0">
            <TaskList tasks={activeRuns} t={t} refresh={refresh} />
          </TabsContent>
        </div>
      </Tabs>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1.5 text-xs font-medium text-muted-foreground"><span>{label}</span>{children}</label>;
}

function EmptyState({ icon: Icon, text }: { icon: typeof Globe2; text: string }) {
  return <div className="flex min-h-48 flex-col items-center justify-center gap-2 text-muted-foreground"><Icon className="h-6 w-6" /><p className="text-sm">{text}</p></div>;
}

function TaskList({ tasks, t, refresh }: { tasks: AgentBrowserTask[]; t: (key: string, options?: Record<string, unknown>) => string; refresh: () => Promise<void> }) {
  return <div>{tasks.length === 0 ? <EmptyState icon={Plus} text={t('tasks.empty')} /> : tasks.map((task) => (
    <div key={task.id} className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2"><p className="truncate text-sm font-medium">{task.name}</p><span className={cn('text-[11px]', statusStyles[task.status])}>{t(`status.${task.status}`)}</span></div>
        <p className="truncate text-xs text-muted-foreground">{task.objective}</p>
        <p className="truncate font-mono text-[11px] text-muted-foreground">{task.url}</p>
      </div>
      {(task.status === 'failed' || task.status === 'cancelled') && <Button variant="ghost" size="icon" aria-label={t('actions.retry')} onClick={async () => { await hostApi.agentBrowser.retryTask({ taskId: task.id }); await refresh(); }}><RefreshCw className="h-4 w-4" /></Button>}
      {task.status === 'running' && <Button variant="ghost" size="icon" aria-label={t('actions.cancel')} onClick={async () => { await hostApi.agentBrowser.cancelTask({ taskId: task.id }); await refresh(); }}><CircleStop className="h-4 w-4" /></Button>}
    </div>
  ))}</div>;
}
