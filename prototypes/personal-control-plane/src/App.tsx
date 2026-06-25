import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Check,
  CircleDot,
  Clock3,
  FileJson,
  Inbox,
  Laptop,
  Play,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  Terminal,
  X,
} from 'lucide-react';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from './components/ui/card';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './components/ui/select';
import { Separator } from './components/ui/separator';
import { Textarea } from './components/ui/textarea';
import { cn } from './lib/utils';

type TaskKind = 'message' | 'doctor' | 'settingsPatch';
type TaskStatus =
  | 'pending'
  | 'pendingApproval'
  | 'running'
  | 'completed'
  | 'failed'
  | 'rejected';

type TaskCommand =
  | { kind: 'message'; title: string; body: string }
  | { kind: 'doctor'; mode: 'diagnose' | 'fix' }
  | { kind: 'settingsPatch'; patch: Record<string, unknown> };

type AuditEvent = {
  at: string;
  event: string;
  detail: string;
};

type Task = {
  id: string;
  source: string;
  status: TaskStatus;
  command: TaskCommand;
  reason: string;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  completedAt: string | null;
  result: string;
  error: string;
  audit: AuditEvent[];
};

type ApiPayload<T> = T & {
  success: boolean;
  error?: string;
};

const endpoint = '127.0.0.1:42173';

function formatTime(value: string | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function taskLabel(task: Task) {
  if (task.command.kind === 'message') return task.command.title;
  if (task.command.kind === 'doctor') return `OpenClaw doctor ${task.command.mode}`;
  return `Settings patch: ${Object.keys(task.command.patch).join(', ')}`;
}

function commandSummary(command: TaskCommand) {
  if (command.kind === 'message') return command.body;
  if (command.kind === 'doctor') return `Run local doctor in ${command.mode} mode.`;
  return JSON.stringify(command.patch, null, 2);
}

function statusTone(status: TaskStatus) {
  if (status === 'completed') return 'success';
  if (status === 'pendingApproval') return 'warning';
  if (status === 'running') return 'info';
  if (status === 'failed' || status === 'rejected') return 'destructive';
  return 'outline';
}

function statusIcon(status: TaskStatus) {
  if (status === 'completed') return <Check className="h-3 w-3" />;
  if (status === 'pendingApproval') return <ShieldCheck className="h-3 w-3" />;
  if (status === 'running') return <Activity className="h-3 w-3" />;
  if (status === 'failed' || status === 'rejected') return <X className="h-3 w-3" />;
  return <Clock3 className="h-3 w-3" />;
}

async function api<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const payload = (await response.json()) as ApiPayload<T>;
  if (!response.ok || payload.success === false) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

function Sidebar({ connected }: { connected: boolean }) {
  return (
    <aside className="border-r border-border bg-surface-sidebar/70 p-3 lg:min-h-screen">
      <div className="mb-5 flex items-center gap-3 px-1">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface-modal font-mono text-sm font-semibold shadow-sm">
          CP
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">Control Plane</h1>
          <p className="text-tiny text-muted-foreground">Local task bridge</p>
        </div>
      </div>

      <nav className="grid gap-1">
        <a className="sidebar-nav-item" data-active="true" href="#inbox">
          <Inbox className="h-4 w-4" />
          Inbox
        </a>
        <a className="sidebar-nav-item" href="#transports">
          <Terminal className="h-4 w-4" />
          Transports
        </a>
        <a className="sidebar-nav-item" href="#settings">
          <Settings2 className="h-4 w-4" />
          Settings
        </a>
      </nav>

      <Separator className="my-4" />

      <div className="grid gap-3">
        <div className="rounded-lg border border-border bg-surface-modal p-3 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-meta font-medium">Bridge</span>
            <span
              className={cn(
                'h-2 w-2 rounded-full',
                connected ? 'bg-green-500' : 'bg-yellow-500'
              )}
            />
          </div>
          <div className="flex items-center gap-2 text-sm">
            <CircleDot className="h-4 w-4 text-muted-foreground" />
            {connected ? 'Connected' : 'Connecting'}
          </div>
          <code className="mt-2 block truncate rounded-md bg-surface-input px-2 py-1 font-mono text-tiny text-muted-foreground">
            {endpoint}
          </code>
        </div>

        <div className="rounded-lg border border-border bg-surface-modal p-3 shadow-sm">
          <div className="mb-2 text-meta font-medium">Transports</div>
          <div className="grid gap-2 text-sm">
            <TransportRow icon={<Laptop />} label="Local UI" state="Live" active />
            <TransportRow icon={<Terminal />} label="CLI bridge" state="Ready" active />
            <TransportRow icon={<FileJson />} label="Folder inbox" state="Next" />
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface-modal p-3 shadow-sm">
          <div className="mb-2 text-meta font-medium">CLI</div>
          <pre className="overflow-hidden rounded-md bg-surface-input p-2 font-mono text-tiny leading-4 text-muted-foreground">
node submit-task.mjs message "Review" "Check branch"
          </pre>
        </div>
      </div>
    </aside>
  );
}

function TransportRow({
  icon,
  label,
  state,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  state: string;
  active?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-black/5 dark:hover:bg-white/10">
      <span className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            'text-muted-foreground [&_svg]:h-4 [&_svg]:w-4',
            active && 'text-foreground'
          )}
        >
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </span>
      <span className="text-tiny text-muted-foreground">{state}</span>
    </div>
  );
}

function Metrics({ tasks }: { tasks: Task[] }) {
  const metrics = [
    { label: 'Total', value: tasks.length, icon: Inbox },
    {
      label: 'Needs approval',
      value: tasks.filter((task) => task.status === 'pendingApproval').length,
      icon: ShieldCheck,
    },
    {
      label: 'Running',
      value: tasks.filter((task) => task.status === 'running').length,
      icon: Activity,
    },
    {
      label: 'Completed',
      value: tasks.filter((task) => task.status === 'completed').length,
      icon: Check,
    },
  ];

  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map((metric) => (
        <div className="stat-card" key={metric.label}>
          <div className="flex items-center justify-between">
            <span className="text-meta text-muted-foreground">{metric.label}</span>
            <metric.icon className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="mt-2 text-2xl font-semibold tracking-tight">{metric.value}</div>
        </div>
      ))}
    </section>
  );
}

function TaskComposer({
  onSubmit,
  submitting,
}: {
  onSubmit: (command: TaskCommand) => Promise<void>;
  submitting: boolean;
}) {
  const [kind, setKind] = useState<TaskKind>('message');
  const [title, setTitle] = useState('Review current branch');
  const [body, setBody] = useState('Please inspect the current branch before I continue.');
  const [doctorMode, setDoctorMode] = useState<'diagnose' | 'fix'>('diagnose');
  const [patchJson, setPatchJson] = useState('{\n  "theme": "dark"\n}');
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    try {
      if (kind === 'message') {
        await onSubmit({ kind, title, body });
        return;
      }
      if (kind === 'doctor') {
        await onSubmit({ kind, mode: doctorMode });
        return;
      }
      await onSubmit({ kind, patch: JSON.parse(patchJson) as Record<string, unknown> });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Card className="min-h-[520px]" id="settings">
      <CardHeader>
        <div className="panel-heading">
          <div>
            <CardTitle>Create Task</CardTitle>
            <CardDescription>Submit a local envelope into the inbox.</CardDescription>
          </div>
          <Badge variant="outline">local</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="field-stack">
            <Label>Kind</Label>
            <Select value={kind} onValueChange={(value) => setKind(value as TaskKind)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="message">Message</SelectItem>
                <SelectItem value="doctor">Doctor</SelectItem>
                <SelectItem value="settingsPatch">Settings patch</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {kind === 'message' && (
            <>
              <div className="field-stack">
                <Label htmlFor="message-title">Title</Label>
                <Input
                  id="message-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>
              <div className="field-stack">
                <Label htmlFor="message-body">Body</Label>
                <Textarea
                  id="message-body"
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                />
              </div>
            </>
          )}

          {kind === 'doctor' && (
            <div className="field-stack">
              <Label>Mode</Label>
              <Select
                value={doctorMode}
                onValueChange={(value) => setDoctorMode(value as 'diagnose' | 'fix')}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="diagnose">Diagnose</SelectItem>
                  <SelectItem value="fix">Fix</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {kind === 'settingsPatch' && (
            <div className="field-stack">
              <Label htmlFor="settings-patch">Patch JSON</Label>
              <Textarea
                id="settings-patch"
                className="min-h-[168px] font-mono text-xs leading-5"
                value={patchJson}
                onChange={(event) => setPatchJson(event.target.value)}
              />
              <p className="text-tiny leading-5 text-muted-foreground">
                Allowed keys: theme, language, gatewayAutoStart, telemetryEnabled,
                autoCheckUpdate, autoDownloadUpdate, cdpRemoteControlEnabled,
                cdpRemoteDebuggingPort.
              </p>
            </div>
          )}

          {formError && (
            <div className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-meta text-red-700 dark:text-red-400">
              {formError}
            </div>
          )}

          <Button className="mt-1 w-full" disabled={submitting} type="submit">
            <Send className="h-4 w-4" />
            {submitting ? 'Submitting' : 'Submit task'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function TaskList({
  tasks,
  selectedId,
  onSelect,
}: {
  tasks: Task[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <Card className="min-h-[520px]" id="inbox">
      <CardHeader>
        <div className="panel-heading">
          <div>
            <CardTitle>Inbox</CardTitle>
            <CardDescription>Tasks from local bridge and CLI.</CardDescription>
          </div>
          <Badge variant="outline">{tasks.length}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {tasks.length === 0 ? (
          <div className="flex min-h-[392px] items-center justify-center rounded-md border border-dashed border-border bg-surface-input p-6 text-center text-sm text-muted-foreground">
            Submit a task from the form or CLI.
          </div>
        ) : (
          <div className="grid max-h-[620px] gap-2 overflow-auto pr-1">
            {tasks.map((task) => (
              <button
                className={cn(
                  'rounded-lg border border-border bg-background/40 p-3 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/10',
                  task.id === selectedId && 'bg-black/5 dark:bg-white/10'
                )}
                key={task.id}
                onClick={() => onSelect(task.id)}
                type="button"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{taskLabel(task)}</div>
                    <p className="mt-1 truncate text-tiny text-muted-foreground">
                      {task.command.kind} / {task.source} / {formatTime(task.updatedAt)}
                    </p>
                  </div>
                  <Badge className="shrink-0" variant={statusTone(task.status)}>
                    {statusIcon(task.status)}
                    {task.status}
                  </Badge>
                </div>
                <p className="mt-2 line-clamp-2 text-meta text-muted-foreground">
                  {commandSummary(task.command)}
                </p>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TaskDetail({
  task,
  onMutate,
  busyAction,
}: {
  task: Task | undefined;
  onMutate: (id: string, action: 'approve' | 'reject' | 'execute') => Promise<void>;
  busyAction: string | null;
}) {
  if (!task) {
    return (
      <Card className="min-h-[520px]">
        <CardContent className="flex min-h-[520px] items-center justify-center p-6">
          <div className="max-w-[280px] text-center">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface-input">
              <Inbox className="h-5 w-5 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-semibold">No task selected</h3>
            <p className="mt-1 text-meta text-muted-foreground">
              Create or select a task to inspect its command envelope and audit trail.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const canApprove = task.status === 'pendingApproval';
  const canExecute = task.status === 'pending' || task.status === 'failed';

  return (
    <Card className="min-h-[520px]">
      <CardHeader>
        <div className="panel-heading">
          <div className="min-w-0">
            <p className="mb-1 text-tiny uppercase tracking-normal text-muted-foreground">
              {task.command.kind} / {task.source}
            </p>
            <CardTitle className="truncate">{taskLabel(task)}</CardTitle>
            <CardDescription className="truncate">
              {task.reason || 'Submitted through local bridge'}
            </CardDescription>
          </div>
          <Badge className="shrink-0" variant={statusTone(task.status)}>
            {statusIcon(task.status)}
            {task.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid grid-cols-2 gap-2 text-meta xl:grid-cols-4">
          <MetaCell label="Created" value={formatTime(task.createdAt)} />
          <MetaCell label="Updated" value={formatTime(task.updatedAt)} />
          <MetaCell label="Approved" value={formatTime(task.approvedAt)} />
          <MetaCell label="Completed" value={formatTime(task.completedAt)} />
        </div>

        <section className="grid gap-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <FileJson className="h-4 w-4 text-muted-foreground" />
            Envelope
          </div>
          <pre className="code-block whitespace-pre-wrap">{renderCommand(task.command)}</pre>
        </section>

        {task.result && (
          <section className="grid gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Check className="h-4 w-4 text-green-700 dark:text-green-400" />
              Result
            </div>
            <pre className="code-block whitespace-pre-wrap">{task.result}</pre>
          </section>
        )}

        <section className="grid gap-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Activity className="h-4 w-4 text-muted-foreground" />
            Audit
          </div>
          <div className="grid gap-2">
            {task.audit.map((event, index) => (
              <div
                className="rounded-md border border-border bg-background/40 px-3 py-2"
                key={`${event.at}-${event.event}-${index}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-meta font-medium">{event.event}</span>
                  <span className="text-tiny text-muted-foreground">{formatTime(event.at)}</span>
                </div>
                <p className="mt-1 text-meta text-muted-foreground">{event.detail}</p>
              </div>
            ))}
          </div>
        </section>

        {(canApprove || canExecute) && (
          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            {canApprove && (
              <>
                <Button
                  disabled={busyAction === `${task.id}:approve`}
                  onClick={() => onMutate(task.id, 'approve')}
                  size="sm"
                  type="button"
                >
                  <Check className="h-4 w-4" />
                  Approve
                </Button>
                <Button
                  disabled={busyAction === `${task.id}:reject`}
                  onClick={() => onMutate(task.id, 'reject')}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <X className="h-4 w-4" />
                  Reject
                </Button>
              </>
            )}
            {canExecute && (
              <Button
                disabled={busyAction === `${task.id}:execute`}
                onClick={() => onMutate(task.id, 'execute')}
                size="sm"
                type="button"
              >
                <Play className="h-4 w-4" />
                Execute
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-input px-3 py-2">
      <div className="text-tiny text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-medium">{value}</div>
    </div>
  );
}

function renderCommand(command: TaskCommand) {
  if (command.kind === 'message') return command.body;
  if (command.kind === 'doctor') {
    return JSON.stringify({ kind: command.kind, mode: command.mode }, null, 2);
  }
  return JSON.stringify(command.patch, null, 2);
}

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedId),
    [selectedId, tasks]
  );

  async function loadTasks() {
    const payload = await api<{ tasks: Task[] }>('/api/tasks');
    setTasks(payload.tasks);
    setSelectedId((current) => current || payload.tasks[0]?.id || null);
  }

  async function createTask(command: TaskCommand) {
    setSubmitting(true);
    setError(null);
    try {
      const payload = await api<{ task: Task }>('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          source: 'local',
          reason: 'Submitted from prototype UI',
          command,
        }),
      });
      setSelectedId(payload.task.id);
      await loadTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function mutateTask(id: string, action: 'approve' | 'reject' | 'execute') {
    setBusyAction(`${id}:${action}`);
    setError(null);
    try {
      const payload = await api<{ task: Task }>(`/api/tasks/${id}/${action}`, {
        method: 'POST',
        body: '{}',
      });
      setTasks((current) =>
        current.map((task) => (task.id === id ? payload.task : task))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  }

  useEffect(() => {
    const source = new EventSource('/api/events');
    source.addEventListener('ready', () => setConnected(true));
    source.addEventListener('tasks', (event) => {
      const payload = JSON.parse(event.data) as { tasks: Task[] };
      setTasks(payload.tasks);
      setSelectedId((current) => current || payload.tasks[0]?.id || null);
    });
    source.addEventListener('error', () => setConnected(false));

    void loadTasks().catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
    });

    return () => source.close();
  }, []);

  useEffect(() => {
    if (selectedId && tasks.some((task) => task.id === selectedId)) return;
    setSelectedId(tasks[0]?.id || null);
  }, [selectedId, tasks]);

  return (
    <div className="app-shell">
      <Sidebar connected={connected} />

      <main className="min-w-0 p-4 lg:p-6">
        <div className="mx-auto grid max-w-[1480px] gap-4">
          <header className="flex flex-col gap-3 rounded-lg border border-border bg-surface-modal px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-tiny uppercase tracking-normal text-muted-foreground">
                Personal developer remote control
              </p>
              <h2 className="mt-1 truncate font-serif text-2xl font-normal tracking-tight">
                Task Inbox
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={connected ? 'success' : 'warning'}>
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    connected ? 'bg-green-500' : 'bg-yellow-500'
                  )}
                />
                {connected ? 'SSE online' : 'Connecting'}
              </Badge>
              <Button
                onClick={() =>
                  void loadTasks().catch((err) =>
                    setError(err instanceof Error ? err.message : String(err))
                  )
                }
                size="sm"
                type="button"
                variant="outline"
              >
                <RefreshCw className="h-4 w-4" />
                Refresh
              </Button>
            </div>
          </header>

          {error && (
            <div className="flex items-start justify-between gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-400">
              <span>{error}</span>
              <button
                className="rounded-sm p-1 hover:bg-black/5 dark:hover:bg-white/10"
                onClick={() => setError(null)}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          <Metrics tasks={tasks} />

          <section className="grid gap-4 xl:grid-cols-[360px_minmax(320px,440px)_minmax(0,1fr)]">
            <TaskComposer onSubmit={createTask} submitting={submitting} />
            <TaskList tasks={tasks} selectedId={selectedId} onSelect={setSelectedId} />
            <TaskDetail task={selectedTask} onMutate={mutateTask} busyAction={busyAction} />
          </section>
        </div>
      </main>
    </div>
  );
}
