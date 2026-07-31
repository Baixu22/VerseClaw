import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bot,
  Check,
  CircleStop,
  Eye,
  EyeOff,
  Globe2,
  KeyRound,
  ListChecks,
  Monitor,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserRound,
  X,
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
  AgentBrowserTaskStepInput,
  AgentBrowserTaskSuccessCriteria,
} from '@shared/host-api/contract';

type TaskDraft = {
  name: string;
  url: string;
  objective: string;
  allowedDomains: string;
  profile: string;
  mode: 'headless' | 'visible';
};

const INITIAL_STEP: AgentBrowserTaskStepInput = { action: 'wait-for-selector', selector: 'body' };
const INITIAL_CRITERIA: AgentBrowserTaskSuccessCriteria = { kind: 'text-includes', value: '' };

const statusStyles: Record<AgentBrowserTask['status'], string> = {
  queued: 'text-zinc-700 dark:text-zinc-300',
  running: 'text-blue-700 dark:text-blue-400',
  'waiting-approval': 'text-amber-700 dark:text-amber-400',
  interrupted: 'text-amber-700 dark:text-amber-400',
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
  const [taskError, setTaskError] = useState('');
  const [taskActionId, setTaskActionId] = useState<string>();
  const [taskSteps, setTaskSteps] = useState<AgentBrowserTaskStepInput[]>([{ ...INITIAL_STEP }]);
  const [successCriteria, setSuccessCriteria] = useState<AgentBrowserTaskSuccessCriteria>({ ...INITIAL_CRITERIA });
  const [taskDraft, setTaskDraft] = useState<TaskDraft>({
    name: '',
    url: '',
    objective: '',
    allowedDomains: '',
    profile: 'default',
    mode: 'headless',
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

  const submitForApproval = async () => {
    if (!taskDraft.name.trim() || !taskDraft.url.trim() || !taskDraft.objective.trim() || !successCriteria.value.trim()) return;
    setTaskError('');
    try {
      await hostApi.agentBrowser.createTask({
        ...taskDraft,
        name: taskDraft.name.trim(),
        url: taskDraft.url.trim(),
        objective: taskDraft.objective.trim(),
        allowedDomains: taskDraft.allowedDomains.split(',').map((value) => value.trim()).filter(Boolean),
        steps: taskSteps,
        successCriteria: { ...successCriteria, value: successCriteria.value.trim() },
      });
      setTaskDraft((current) => ({ ...current, name: '', url: '', objective: '', allowedDomains: '' }));
      setTaskSteps([{ ...INITIAL_STEP }]);
      setSuccessCriteria({ ...INITIAL_CRITERIA });
      await refresh();
    } catch {
      setTaskError(t('verification.executionFailed'));
    }
  };

  const performTaskAction = async (taskId: string, action: 'approve' | 'reject' | 'retry' | 'cancel') => {
    setTaskActionId(taskId);
    setTaskError('');
    try {
      if (action === 'approve') await hostApi.agentBrowser.approveTask({ taskId });
      if (action === 'reject') await hostApi.agentBrowser.rejectTask({ taskId });
      if (action === 'retry') await hostApi.agentBrowser.retryTask({ taskId });
      if (action === 'cancel') await hostApi.agentBrowser.cancelTask({ taskId });
      await refresh();
    } catch {
      setTaskError(t('verification.executionFailed'));
    } finally {
      setTaskActionId(undefined);
    }
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
            <section className="space-y-4 border-b border-border pb-5">
              <div className="grid gap-3 lg:grid-cols-2">
                <Field label={t('tasks.name')}><Input aria-label={t('tasks.name')} value={taskDraft.name} onChange={(event) => setTaskDraft({ ...taskDraft, name: event.target.value })} /></Field>
                <Field label={t('tasks.url')}><Input aria-label={t('tasks.url')} value={taskDraft.url} onChange={(event) => setTaskDraft({ ...taskDraft, url: event.target.value })} placeholder="https://" /></Field>
                <Field label={t('tasks.objective')}><Input aria-label={t('tasks.objective')} value={taskDraft.objective} onChange={(event) => setTaskDraft({ ...taskDraft, objective: event.target.value })} /></Field>
                <Field label={t('tasks.allowedDomains')}><Input aria-label={t('tasks.allowedDomains')} value={taskDraft.allowedDomains} onChange={(event) => setTaskDraft({ ...taskDraft, allowedDomains: event.target.value })} placeholder={t('tasks.allowedDomainsPlaceholder')} /></Field>
              </div>

              <div className="border-y border-border py-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><ListChecks className="h-4 w-4" />{t('tasks.steps')}</div>
                  <Button variant="ghost" size="sm" onClick={() => setTaskSteps((current) => [...current, { action: 'wait-for-selector', selector: '' }])}>
                    <Plus className="mr-2 h-4 w-4" />{t('actions.addStep')}
                  </Button>
                </div>
                <div className="space-y-2">
                  {taskSteps.map((step, index) => (
                    <div key={index} className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)_36px]">
                      <select
                        aria-label={t('tasks.stepAction', { number: index + 1 })}
                        className="h-9 rounded-md border border-input bg-surface-input px-2 text-sm"
                        value={step.action}
                        onChange={(event) => setTaskSteps((current) => current.map((entry, entryIndex) => entryIndex === index ? {
                          action: event.target.value as AgentBrowserTaskStepInput['action'],
                          ...(event.target.value === 'navigate' ? { url: '' } : { selector: '' }),
                        } : entry))}
                      >
                        <option value="wait-for-selector">{t('stepActions.wait-for-selector')}</option>
                        <option value="click">{t('stepActions.click')}</option>
                        <option value="navigate">{t('stepActions.navigate')}</option>
                      </select>
                      <Input
                        aria-label={t('tasks.stepValue', { number: index + 1 })}
                        value={step.action === 'navigate' ? step.url ?? '' : step.selector ?? ''}
                        placeholder={step.action === 'navigate' ? 'https://' : t('tasks.selectorPlaceholder')}
                        onChange={(event) => setTaskSteps((current) => current.map((entry, entryIndex) => entryIndex === index ? {
                          ...entry,
                          ...(entry.action === 'navigate' ? { url: event.target.value } : { selector: event.target.value }),
                        } : entry))}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('actions.removeStep', { number: index + 1 })}
                        disabled={taskSteps.length === 1}
                        onClick={() => setTaskSteps((current) => current.filter((_, entryIndex) => entryIndex !== index))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid items-end gap-3 lg:grid-cols-[180px_minmax(0,1fr)_180px_180px]">
                <Field label={t('tasks.successKind')}>
                  <select
                    className="h-9 rounded-md border border-input bg-surface-input px-2 text-sm"
                    value={successCriteria.kind}
                    onChange={(event) => setSuccessCriteria((current) => ({ ...current, kind: event.target.value as AgentBrowserTaskSuccessCriteria['kind'] }))}
                  >
                    <option value="text-includes">{t('criteria.text-includes')}</option>
                    <option value="selector-visible">{t('criteria.selector-visible')}</option>
                    <option value="url-includes">{t('criteria.url-includes')}</option>
                  </select>
                </Field>
                <Field label={t('tasks.successValue')}><Input aria-label={t('tasks.successValue')} value={successCriteria.value} onChange={(event) => setSuccessCriteria({ ...successCriteria, value: event.target.value })} /></Field>
                <Field label={t('tasks.profile')}>
                  <select className="h-9 rounded-md border border-input bg-surface-input px-2 text-sm" value={taskDraft.profile} onChange={(event) => setTaskDraft({ ...taskDraft, profile: event.target.value })}>
                    {profiles.map((profile) => <option key={profile.profile} value={profile.profile}>{profile.label || profile.profile}</option>)}
                  </select>
                </Field>
                <Field label={t('tasks.mode')}>
                  <select className="h-9 rounded-md border border-input bg-surface-input px-2 text-sm" value={taskDraft.mode} onChange={(event) => setTaskDraft({ ...taskDraft, mode: event.target.value as TaskDraft['mode'] })}>
                    <option value="headless">{t('modes.headless')}</option>
                    <option value="visible">{t('modes.visible')}</option>
                  </select>
                </Field>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                {taskError ? <p role="alert" className="min-w-0 text-xs text-red-700 dark:text-red-400">{taskError}</p> : <span />}
                <Button
                  onClick={() => void submitForApproval()}
                  disabled={!taskDraft.name.trim() || !taskDraft.url.trim() || !taskDraft.objective.trim() || !successCriteria.value.trim()}
                >
                  <ShieldCheck className="mr-2 h-4 w-4" />{t('tasks.submitForApproval')}
                </Button>
              </div>
            </section>
            <TaskList tasks={tasks} t={t} actionId={taskActionId} onAction={performTaskAction} />
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
            <TaskList tasks={activeRuns} t={t} actionId={taskActionId} onAction={performTaskAction} />
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

function TaskList({
  tasks,
  t,
  actionId,
  onAction,
}: {
  tasks: AgentBrowserTask[];
  t: (key: string, options?: Record<string, unknown>) => string;
  actionId?: string;
  onAction: (taskId: string, action: 'approve' | 'reject' | 'retry' | 'cancel') => Promise<void>;
}) {
  return <div>{tasks.length === 0 ? <EmptyState icon={Plus} text={t('tasks.empty')} /> : tasks.map((task) => (
    <div key={task.id} className="grid min-h-16 gap-3 border-b border-border py-3 lg:grid-cols-[minmax(0,1fr)_auto]" data-testid={`task-row-${task.id}`}>
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-medium">{task.name}</p><span className={cn('text-[11px]', statusStyles[task.status])}>{t(`status.${task.status}`)}</span></div>
        <p className="text-xs text-muted-foreground">{task.objective}</p>
        <p className="break-all font-mono text-[11px] text-muted-foreground">{task.url}</p>
        {task.status === 'waiting-approval' && (
          <div className="mt-3 grid gap-2 border-l-2 border-amber-500 pl-3 text-xs sm:grid-cols-2" data-testid={`task-approval-${task.id}`}>
            <ApprovalValue label={t('approval.target')} value={new URL(task.url).origin} />
            <ApprovalValue label={t('approval.domains')} value={task.allowedDomains.join(', ')} />
            <ApprovalValue label={t('approval.mode')} value={t(`modes.${task.mode}`)} />
            <ApprovalValue label={t('approval.scope')} value={task.permissionScope.map((scope) => t(`permissionScope.${scope}`)).join(', ')} />
            <ApprovalValue label={t('approval.success')} value={`${t(`criteria.${task.successCriteria?.kind ?? 'text-includes'}`)}: ${task.successCriteria?.value ?? t('approval.missing')}`} />
            <ApprovalValue label={t('approval.steps')} value={t('approval.stepCount', { count: task.steps.length })} />
          </div>
        )}
        {task.steps.length > 0 && task.status !== 'waiting-approval' && (
          <ol className="mt-2 grid gap-1 text-[11px] text-muted-foreground" data-testid={`task-steps-${task.id}`}>
            {task.steps.map((step) => (
              <li key={step.id} className="flex min-w-0 items-center gap-2">
                <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', step.status === 'passed' ? 'bg-emerald-600' : step.status === 'failed' ? 'bg-red-600' : step.status === 'running' ? 'bg-blue-600' : 'bg-muted-foreground/40')} />
                <span className="shrink-0">{t(`stepActions.${step.action}`)}</span>
                <span className="truncate font-mono">{step.url ?? step.selector}</span>
              </li>
            ))}
          </ol>
        )}
        {task.verification && (
          <p className={cn('text-xs', task.verification.status === 'passed' ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400')}>
            {t(`verification.${task.verification.status}`)} [{task.verification.reasonCode}]
          </p>
        )}
        {task.errorCode && !task.verification ? <p className="text-xs text-red-700 dark:text-red-400">{t('verification.executionFailed')} [{task.errorCode}]</p> : null}
      </div>
      <div className="flex items-start justify-end gap-1">
        {task.status === 'waiting-approval' && <>
          <Button size="sm" disabled={actionId === task.id} onClick={() => void onAction(task.id, 'approve')}><Check className="mr-2 h-4 w-4" />{t('actions.approve')}</Button>
          <Button variant="ghost" size="sm" disabled={actionId === task.id} onClick={() => void onAction(task.id, 'reject')}><X className="mr-2 h-4 w-4" />{t('actions.reject')}</Button>
        </>}
        {(task.status === 'failed' || task.status === 'cancelled' || task.status === 'interrupted') && <Button variant="ghost" size="icon" aria-label={t('actions.retry')} disabled={actionId === task.id} onClick={() => void onAction(task.id, 'retry')}><RefreshCw className="h-4 w-4" /></Button>}
        {task.status === 'running' && <Button variant="ghost" size="icon" aria-label={t('actions.cancel')} disabled={actionId === task.id} onClick={() => void onAction(task.id, 'cancel')}><CircleStop className="h-4 w-4" /></Button>}
      </div>
    </div>
  ))}</div>;
}

function ApprovalValue({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><span className="text-muted-foreground">{label}</span><p className="break-words text-foreground">{value}</p></div>;
}
