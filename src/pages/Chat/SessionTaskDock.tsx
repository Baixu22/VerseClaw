/**
 * The conversation task strip shares the composer enclosure. Its durable goal
 * stays visible while current run steps open on demand; archived plans remain
 * in the transcript. Task acceptance comes from the ledger owner.
 * IDs and readback metadata live in the menu. Display preferences retain their
 * session scope; stale owner reads reveal a retry action.
 */
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  CircleSlash,
  Copy,
  ExternalLink,
  EyeOff,
  ListChecks,
  MoreHorizontal,
  Pause,
  RefreshCw,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { toastUserError } from '@/lib/user-error';
import { nextReadyPlanChild } from '@shared/task-system/types';
import { useDismissOnOutside, usePopover } from "@/components/settings/primitives/usePopover";
import { ToolUiPlanItemIcon, type ToolUiPlanTodoStatus } from "@/components/tool-ui/plan-view";
import { useOverlayPortalContainer } from "@/components/ui/overlay-portal";
import { hostApi } from "@/lib/host-api";
import { hostEvents } from "@/lib/host-events";
import { formatRelativeTime } from "@/lib/git-ui";
import { cn } from "@/lib/utils";
import type { ProjectPlanSnapshot, TaskSessionSnapshot, TaskView } from "@shared/task-system/types";
import type { RunPlanSurface } from "./run-surface-promotion";
import type { LongTaskControlStatus } from '@shared/types/long-task-control';
import { LongTaskControlDetails } from './LongTaskControlDetails';

type Mode = "collapsed" | "expanded" | "hidden";
type Translate = ReturnType<typeof useTranslation<"taskLedger">>["t"];
const storageKey = "verse-task-display-v1";
type Preference = { taskId: string; mode: Mode };
function readPreferences(): Record<string, Preference> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, Preference>)
      : {};
  } catch {
    return {};
  }
}
function readMode(scope: string, taskId: string): Mode {
  const value = readPreferences()[scope];
  return value?.taskId === taskId && ["collapsed", "expanded", "hidden"].includes(value.mode)
    ? value.mode
    : "collapsed";
}
function saveMode(scope: string, taskId: string, mode: Mode) {
  try {
    const previous = readPreferences();
    delete previous[scope];
    localStorage.setItem(
      storageKey,
      JSON.stringify(
        Object.fromEntries([...Object.entries(previous).slice(-99), [scope, { taskId, mode }]]),
      ),
    );
  } catch {
    /* Display preference can remain local when storage is unavailable. */
  }
}

/**
 * The handle a person can read back: UUIDs shorten to their first eight hex
 * digits (the way a commit shortens), short owner IDs stay whole.
 */
export function shortTaskId(id: string): string {
  const value = id.trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(value)) return value.slice(0, 8);
  return value.length <= 12 ? value : `${value.slice(0, 10)}…`;
}

function useSessionTask(workspaceId: string | null, sessionKey: string, active: boolean) {
  const scope = JSON.stringify([workspaceId, sessionKey]);
  const [view, setView] = useState<{
    scope: string;
    snapshot: TaskSessionSnapshot;
    stale: boolean;
  } | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!workspaceId || !sessionKey || !active) return;
    let disposed = false,
      inFlight = false,
      queued = false;
    let relatedSessions = new Set([sessionKey]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (inFlight) {
        queued = true;
        return;
      }
      inFlight = true;
      try {
        const result = await hostApi.taskLedger.sessionTask({ workspaceId, sessionKey });
        if (!result.success) throw new Error("Task status unavailable");
        if (!disposed) {
          relatedSessions = new Set([
            sessionKey,
            ...[result.task, ...result.children, result.projectPlan?.task, ...(result.projectPlan?.children ?? [])].flatMap((task) =>
              task?.claim ? [task.claim.sessionKey] : [],
            ),
          ]);
          setView({ scope, snapshot: result, stale: false });
        }
      } catch {
        if (!disposed) setView((old) => (old?.scope === scope ? { ...old, stale: true } : null));
      } finally {
        inFlight = false;
        if (queued && !disposed) {
          queued = false;
          schedule();
        }
      }
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void load(), 120);
    };
    void load();
    const unsubscribe = hostEvents.onChatRuntimeEvent((event) => {
      if (!event.sessionKey || !relatedSessions.has(event.sessionKey)) return;
      if (
        event.type === "run.started" ||
        event.type === "run.ended" ||
        (event.type === "tool.completed" && ["task_control", "sessions_spawn"].includes(event.name))
      )
        schedule();
    });
    const unsubscribeSubagent = hostEvents.onSubagentLifecycle?.((event) => {
      if (event.sessionKey === sessionKey) schedule();
    });
    window.addEventListener("focus", schedule);
    return () => {
      disposed = true;
      clearTimeout(timer);
      unsubscribe();
      unsubscribeSubagent?.();
      window.removeEventListener("focus", schedule);
    };
  }, [workspaceId, sessionKey, scope, active, refresh]);
  return {
    scope,
    snapshot: active && view?.scope === scope ? view.snapshot : null,
    stale: active && view?.scope === scope && view.stale,
    retry: () => setRefresh((value) => value + 1),
  };
}

/** One row of the dock: a plan item, a checkpoint fact, or a child task. */
type DockStep = {
  id: string;
  label: string;
  status: ToolUiPlanTodoStatus;
  /** Present when the step is itself a durable task the ledger can open. */
  taskNodeId?: string;
};

function childStep(task: TaskView): DockStep {
  const state = task.contract.state;
  return {
    id: task.contract.taskNodeId,
    taskNodeId: task.contract.taskNodeId,
    label: task.contract.objective,
    status:
      state === "done"
        ? "completed"
        : state === "cancelled"
          ? "cancelled"
          : state === "doing" || state === "review"
            ? "in_progress"
            : "pending",
  };
}

function checkpointSteps(task: TaskView): DockStep[] {
  return [
    ...(task.checkpoint?.completed ?? []).map((label, index) => ({
      id: `completed-${index}`,
      label,
      status: "completed" as const,
    })),
    ...(task.checkpoint?.nextAction && !["done", "cancelled"].includes(task.contract.state)
      ? [
          {
            id: "next",
            label: task.checkpoint.nextAction,
            status: task.contract.state === "doing" ? ("in_progress" as const) : ("pending" as const),
          },
        ]
      : []),
  ];
}

function isSettled(status: ToolUiPlanTodoStatus) {
  return status === "completed" || status === "cancelled";
}

/** Presentation only: closing this dock never changes task ownership or execution. */
export function SessionTaskDock({
  workspaceId,
  sessionKey,
  hasConversation,
  projectEntry = false,
  plan,
  runActive = false,
  controlStatus,
  onOpenTask,
}: {
  workspaceId: string | null;
  sessionKey: string;
  hasConversation: boolean;
  projectEntry?: boolean;
  plan?: RunPlanSurface | null;
  /** A run is streaming in this session; a finished plan stays until it ends. */
  runActive?: boolean;
  controlStatus?: LongTaskControlStatus | null;
  /** Opens a durable task (or one of its children) in the Task Ledger. */
  onOpenTask?: (taskNodeId: string) => void;
}) {
  const { t, i18n } = useTranslation("taskLedger");
  const { scope, snapshot, stale, retry } = useSessionTask(
    workspaceId,
    sessionKey,
    hasConversation || projectEntry,
  );
  const projectPlan = projectEntry ? snapshot?.projectPlan : undefined;
  const [dispatching, setDispatching] = useState(false);
  const activeChild = projectPlan?.children.find(child => !['ready', 'done', 'cancelled'].includes(child.contract.state));
  const nextChild = activeChild ? (activeChild.contract.state === 'doing' && activeChild.claim?.sessionKey === sessionKey ? activeChild : undefined)
    : projectPlan && nextReadyPlanChild(projectPlan.children);
  const dispatch = projectPlan && workspaceId && nextChild && !stale && !runActive && !dispatching ? async () => {
      setDispatching(true);
      try {
        const result = await hostApi.sessions.dispatchPlanTask({ workspaceId, sessionKey,
          expectedSessionGeneration:projectPlan.revisions[0].generation, planId:projectPlan.task.contract.taskNodeId,
          expectedRevision:projectPlan.task.contract.revision, expectedChildId:nextChild.contract.taskNodeId });
        if (!result.success) throw new Error(result.error ?? result.status);
        toast.success(t('conversation.dispatchAccepted'));
      } catch (error) { toastUserError(error); }
      finally { setDispatching(false); retry(); }
    } : undefined;
  const task = projectPlan?.task ?? snapshot?.task ?? null;
  const planTodos = plan?.todos ?? [];
  const planVisible = planTodos.length > 0 && runActive;
  const taskId = task?.contract.taskNodeId ?? (planVisible && plan ? `plan:${plan.id}` : "");
  if ((!hasConversation && !projectPlan) || !taskId) return null;
  return (
    <TaskDockBody
      key={`${scope}:${taskId}`}
      {...{ scope, taskId, task, stale, retry, runActive, onOpenTask, t, controlStatus }}
      plan={planVisible ? plan : null}
      locale={i18n.language}
      childrenTasks={projectPlan?.children ?? snapshot?.children ?? []}
      projectPlan={projectPlan}
      dispatch={dispatch}
    />
  );
}

type Tone = "active" | "done" | "cancelled" | "warn" | "idle";

/** Semantic status colours with progress only when the step count is known. */
function StatusGlyph({ tone, progress }: { tone: Tone; progress: number | null }) {
  if (tone === "done") {
    return <Check className="h-3.5 w-3.5 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />;
  }
  if (tone === "cancelled") {
    return <CircleSlash className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />;
  }
  if (tone === "warn") {
    return <Pause className="h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />;
  }
  if (tone === "active" && progress !== null) {
    // A ring that fills with known progress — no percentage is invented for
    // tasks that only report a next action. Track and fill are two layers so
    // the gradient stays a plain `currentColor` stop.
    return (
      <span className="relative inline-flex h-3.5 w-3.5 shrink-0 text-blue-700 dark:text-blue-400" aria-hidden="true">
        <span className="absolute inset-0 rounded-full border-[1.5px] border-foreground/15" />
        <span
          className="absolute inset-0 rounded-full"
          style={{
            background: `conic-gradient(currentColor ${Math.max(progress, 6)}%, transparent 0)`,
            WebkitMaskImage: "radial-gradient(circle, transparent 52%, #000 56%)",
            maskImage: "radial-gradient(circle, transparent 52%, #000 56%)",
          }}
        />
      </span>
    );
  }
  if (tone === "active") {
    return (
      <span
        className="h-3.5 w-3.5 shrink-0 rounded-full border-[1.5px] border-blue-500/20 border-t-blue-700 motion-safe:animate-spin dark:border-t-blue-400"
        aria-hidden="true"
      />
    );
  }
  return (
    <span
      className="h-3.5 w-3.5 shrink-0 rounded-full border-[1.5px] border-dashed border-muted-foreground/45"
      aria-hidden="true"
    />
  );
}

function copyTaskId(id: string, t: Translate) {
  const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  if (!clipboard?.writeText) {
    toast.error(t("conversation.copyFailed"));
    return;
  }
  void clipboard.writeText(id).then(
    () => toast.success(t("conversation.idCopied", { id: shortTaskId(id) })),
    () => toast.error(t("conversation.copyFailed")),
  );
}

type MenuItem = {
  key: string;
  testId: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  run: () => void;
};

/** Secondary handles and readback metadata open without widening the task strip. */
function TaskMenu({ t, items, metadata }: { t: Translate; items: MenuItem[]; metadata?: string }) {
  const popover = usePopover<HTMLButtonElement>({ align: "right", gap: 6, minWidth: 208 });
  const overlayContainer = useOverlayPortalContainer();
  const { open, setOpen, triggerRef, layerRef } = popover;
  useDismissOnOutside({ open, onDismiss: () => setOpen(false), refs: [triggerRef, layerRef] });
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() =>
      layerRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [open, layerRef]);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const entries = Array.from(
      layerRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
    );
    const index = entries.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      entries[(index + step + entries.length) % entries.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      entries[event.key === "Home" ? 0 : entries.length - 1]?.focus();
    } else if (event.key === "Escape" || event.key === "Tab") {
      setOpen(false);
      triggerRef.current?.focus();
    }
  };
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-testid="session-task-menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("conversation.more")}
        title={t("conversation.more")}
        onClick={() => setOpen(!open)}
        className={cn(
          "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors",
          "hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/10",
          open && "bg-black/5 text-foreground dark:bg-white/10",
        )}
      >
        <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={layerRef}
            style={popover.style}
            role="menu"
            aria-label={t("conversation.more")}
            data-testid="session-task-menu-list"
            onKeyDown={onKeyDown}
            className="flex flex-col gap-0.5 rounded-xl border border-border/70 bg-surface-modal p-1 text-[13px] shadow-lg motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-150"
          >
            {metadata && <p className="border-b border-border px-2 py-1.5 text-xs text-muted-foreground" data-testid="session-task-updated">{metadata}</p>}
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                data-testid={item.testId}
                aria-label={item.label}
                title={item.hint}
                onClick={() => {
                  setOpen(false);
                  item.run();
                }}
                className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-foreground/90 outline-none transition-colors hover:bg-black/5 focus-visible:bg-black/5 dark:hover:bg-white/10 dark:focus-visible:bg-white/10"
              >
                <span className="text-muted-foreground" aria-hidden="true">{item.icon}</span>
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              </button>
            ))}
          </div>,
          overlayContainer ?? document.body,
        )}
    </>
  );
}

function TaskDockBody({
  dispatch,
  scope,
  taskId,
  task,
  childrenTasks,
  projectPlan,
  plan,
  stale,
  retry,
  runActive,
  controlStatus,
  onOpenTask,
  locale,
  t,
}: {
  dispatch?: () => Promise<void>;
  scope: string;
  taskId: string;
  task: TaskView | null;
  childrenTasks: TaskView[];
  projectPlan?: ProjectPlanSnapshot;
  plan?: RunPlanSurface | null;
  stale: boolean;
  retry: () => void;
  runActive: boolean;
  controlStatus?: LongTaskControlStatus | null;
  onOpenTask?: (taskNodeId: string) => void;
  locale: string;
  t: Translate;
}) {
  const [mode, setMode] = useState<Mode>(() => readMode(scope, taskId));
  const container = useRef<HTMLElement>(null);
  const change = (next: Mode) => {
    setMode(next);
    saveMode(scope, taskId, next);
    if (next === "hidden" || mode === "hidden")
      requestAnimationFrame(() =>
        container.current?.querySelector<HTMLButtonElement>("[data-dock-focus]")?.focus(),
      );
  };
  const hasRunPlan = Boolean(plan?.todos.length);
  const steps: DockStep[] = hasRunPlan
    ? plan!.todos
    : childrenTasks.length
    ? childrenTasks.map(childStep)
    : task
      ? checkpointSteps(task)
      : (plan?.todos ?? []);
  const durableId = task?.contract.taskNodeId ?? null;
  const title = task?.contract.objective ?? plan?.title ?? t("conversation.plan");
  const state =
    task?.contract.state ??
    (runActive ? "doing" : steps.length && steps.every((step) => isSettled(step.status)) ? "done" : undefined);
  const complete = state === "done";
  const finished = complete || state === "cancelled";
  const completed = steps.filter((step) => step.status === "completed").length;
  const total = steps.length;
  const hasDefinedPlan = hasRunPlan || childrenTasks.length > 0 || (!task && total > 0);
  const progress = hasDefinedPlan ? Math.round((completed / total) * 100) : complete ? 100 : null;
  const active =
    !stale &&
    !finished &&
    (state === "doing" ||
      state === "review" ||
      runActive ||
      (!state && (runActive || steps.some((step) => step.status === "in_progress"))));
  const tone: Tone = stale || state === "paused" || state === "cancelling"
    ? "warn"
    : complete
      ? "done"
      : state === "cancelled"
        ? "cancelled"
        : active
          ? "active"
          : "idle";
  const status = stale
    ? t("conversation.stale")
    : state
      ? t(`conversation.states.${state}`)
      : t("conversation.progress");
  const current = finished && !hasRunPlan
    ? undefined
    : (steps.find((step) => step.status === "in_progress") ??
      steps.find((step) => step.status === "pending"));
  const finishedPreviously = useRef(false);
  useEffect(() => {
    if (finished && !finishedPreviously.current && mode === 'expanded') {
      setMode('collapsed');
      saveMode(scope, taskId, 'collapsed');
    }
    finishedPreviously.current = finished;
  }, [finished, mode, scope, taskId]);
  const displayMode = tone === 'warn' && mode === 'hidden' ? 'collapsed' : mode;
  const expanded = displayMode === "expanded";
  const updated = task ? formatRelativeTime(task.contract.updatedAt, locale) : "";
  const openTask = durableId && onOpenTask ? () => onOpenTask(durableId) : undefined;
  const menuItems: MenuItem[] = [
    ...(dispatch ? [{key:'dispatch', testId:'project-plan-dispatch', label:t('conversation.dispatchNext'),
      icon:<ListChecks className="h-3.5 w-3.5" />, run:() => void dispatch()}] : []),
    ...(durableId
      ? [
          {
            key: "copy",
            testId: "session-task-menu-copy",
            label: `${t("conversation.copyId")} · #${shortTaskId(durableId)}`,
            hint: durableId,
            icon: <Copy className="h-3.5 w-3.5" />,
            run: () => copyTaskId(durableId, t),
          },
        ]
      : []),
    ...(openTask
      ? [
          {
            key: "open",
            testId: "session-task-menu-open",
            label: t("conversation.openInLedger"),
            icon: <ExternalLink className="h-3.5 w-3.5" />,
            run: openTask,
          },
        ]
      : []),
    {
      key: "steps",
      testId: "session-task-menu-steps",
      label: t(expanded ? "conversation.hideSteps" : "conversation.showSteps"),
      icon: <ListChecks className="h-3.5 w-3.5" />,
      run: () => change(expanded ? "collapsed" : "expanded"),
    },
    ...(durableId
      ? [
          {
            key: "refresh",
            testId: "session-task-menu-refresh",
            label: t("conversation.refresh"),
            icon: <RefreshCw className="h-3.5 w-3.5" />,
            run: retry,
          },
        ]
      : []),
    ...(tone !== 'warn' ? [{
      key: "hide",
      testId: "session-task-close",
      label: t("conversation.hide"),
      hint: t("conversation.hideHint"),
      icon: <EyeOff className="h-3.5 w-3.5" />,
      run: () => change("hidden"),
    }] : []),
  ];
  return (
    <section
      ref={container}
      className="relative w-full shrink-0 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200"
      data-testid="session-task-dock"
      data-placement="composer"
      data-state={state ?? (active ? "doing" : "ready")}
      data-mode={displayMode}
      data-step-source={hasRunPlan ? 'run-plan' : 'task'}
      aria-label={t("conversation.task")}
    >
      {displayMode === "hidden" ? (
        <button
          type="button"
          data-dock-focus
          data-testid="session-task-reopen"
          onClick={() => change("collapsed")}
          className="ml-2 inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/10"
          aria-label={t("conversation.reopen")}
          title={title}
        >
          <StatusGlyph tone={tone} progress={progress} />
          <span>{t("conversation.task")}</span>
          <span aria-hidden="true" className="truncate tabular-nums">
            · {status}
            {hasDefinedPlan ? ` ${completed}/${total}` : ""}
          </span>
        </button>
      ) : (
        <div
          className="relative overflow-hidden rounded-t-xl border border-b-0 border-border bg-background"
          data-testid="session-task-panel"
        >
          <div className="flex min-h-9 min-w-0 items-center gap-1.5 pl-3 pr-1.5">
            <div className="min-w-0 flex-1" data-testid="session-task-plan">
              <button
                type="button"
                data-dock-focus
                className="flex min-h-8 w-full min-w-0 items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                aria-expanded={expanded}
                onClick={() => change(expanded ? "collapsed" : "expanded")}
                title={title}
              >
                <StatusGlyph tone={tone} progress={progress} />
                <h2
                  className={cn(
                    "min-w-0 flex-1 truncate text-[13px] font-medium tracking-tight",
                    finished ? "text-muted-foreground" : "text-foreground",
                  )}
                  data-testid="session-task-title"
                >
                  {title}
                </h2>
                {!expanded && current && (
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" data-testid="session-task-current">
                    <span className="mr-1">{t(current.status === 'in_progress' ? 'conversation.current' : 'conversation.next')}</span>
                    {current.label}
                  </span>
                )}
                {!expanded && hasRunPlan && completed === total && !complete && (
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" data-testid="session-task-run-finished">
                    {t('conversation.runStepsComplete')}
                  </span>
                )}
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-200",
                    expanded && "rotate-180",
                  )}
                  aria-hidden="true"
                />
              </button>
            </div>
            <span
              className={cn(
                "shrink-0 whitespace-nowrap px-1 text-xs tabular-nums",
                tone === 'warn' ? 'text-amber-700 dark:text-amber-400'
                  : tone === 'active' ? 'text-blue-700 dark:text-blue-400'
                  : tone === 'done' ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-muted-foreground',
              )}
              data-testid="session-task-status"
              title={hasDefinedPlan ? t(hasRunPlan ? 'conversation.runStepsProgress' : 'conversation.stepsProgress', { completed, total }) : undefined}
            >
              {status}
              {hasDefinedPlan && <span className="text-muted-foreground/70"> · {completed}/{total}</span>}
            </span>
            {stale && <button type="button" data-testid="session-task-retry" onClick={retry}
              className="shrink-0 rounded px-1.5 py-1 text-xs text-amber-700 hover:bg-black/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:text-amber-400 dark:hover:bg-white/10">
              {t('conversation.refresh')}
            </button>}
            {state === 'paused' && (task?.checkpoint?.unresolved.length ?? 0) > 0 && openTask && (
              <button type="button" data-testid="session-task-blockers" onClick={openTask}
                className="shrink-0 rounded px-1.5 py-1 text-xs text-amber-700 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:text-amber-400">
                {t('conversation.viewBlockers')}
              </button>
            )}
            <TaskMenu t={t} items={menuItems} metadata={updated ? t('conversation.updated', { time: updated }) : undefined} />
          </div>
          {expanded && (
            <div
              className="border-t border-black/[0.06] px-3 pb-2 pt-1.5 text-xs text-muted-foreground motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200 dark:border-white/[0.07]"
              data-testid="session-task-details"
            >
              {projectPlan && <ProjectPlanDetails plan={projectPlan} t={t} />}
              {hasRunPlan && <p className="py-1 font-medium text-foreground" data-testid="session-task-step-label">{t('conversation.runSteps')}</p>}
              {steps.length > 0 ? (
                <ol
                  className="max-h-[min(30vh,220px)] space-y-0.5 overflow-y-auto overscroll-contain pr-1"
                  data-testid="session-task-steps"
                  aria-label={t("conversation.steps")}
                >
                  {steps.map((step) => (
                    <li
                      key={step.id}
                      data-status={step.status}
                      className="flex min-w-0 items-start gap-2 py-[3px]"
                      aria-current={step === current ? "step" : undefined}
                    >
                      <span className="mt-0.5">
                        <ToolUiPlanItemIcon status={step.status} />
                      </span>
                      <span
                        className={cn(
                          "min-w-0 flex-1 text-[13px] leading-5",
                          step.status === "completed" && "text-muted-foreground",
                          step.status === "in_progress" && "text-foreground",
                          step.status === "pending" && "text-muted-foreground",
                          step.status === "cancelled" && "text-muted-foreground/50 line-through",
                        )}
                      >
                        {step.label}
                      </span>
                      {step.taskNodeId &&
                        (onOpenTask ? (
                          <button
                            type="button"
                            data-testid={`session-task-step-open-${step.taskNodeId}`}
                            onClick={() => onOpenTask(step.taskNodeId!)}
                            title={`${step.taskNodeId}\n${t("conversation.openInLedger")}`}
                            aria-label={t("conversation.openStep", { title: step.label })}
                            className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:hover:bg-white/10"
                          >
                            <ExternalLink className="size-3" aria-hidden="true" />
                          </button>
                        ) : (
                          null
                        ))}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="py-1">{t(complete ? "conversation.accepted" : "conversation.waitingForPlan")}</p>
              )}
              <LongTaskControlDetails status={controlStatus} />
              {(task?.referenceOnly || (task && task.pendingOperations > 0) || openTask) && (
                <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {task?.referenceOnly && <span>{t("conversation.observing")}</span>}
                  {task && task.pendingOperations > 0 && <span>{t("conversation.settling")}</span>}
                  {openTask && (
                    <button
                      type="button"
                      data-testid="session-task-open-ledger"
                      onClick={openTask}
                      className="ml-auto inline-flex items-center gap-1 rounded hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {t("conversation.openInLedger")}
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {progress !== null && (
            <span
              role="progressbar"
              aria-label={t("conversation.progress")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              data-testid="session-task-progress"
              className="sr-only"
            />
          )}
        </div>
      )}
    </section>
  );
}

function ProjectPlanDetails({ plan, t }: { plan: ProjectPlanSnapshot; t: Translate }) {
  const [current] = plan.revisions;
  if (!current) return null;
  return (
    <details className="my-1 break-words" data-testid="project-plan-history">
      <summary className="cursor-pointer py-1 font-medium text-foreground">
        {t("conversation.planRevision", { revision: current.revision })}
      </summary>
      <div className="max-h-44 space-y-2 overflow-auto py-1">
        {plan.revisions.map((entry) => (
          <div key={entry.revision} className="space-y-1 border-b border-border pb-1">
            <p>{t("conversation.planRevision", { revision: entry.revision })}: {entry.objective}</p>
            {entry.reason && <p>{entry.reason}</p>}
            <p>{t("conversation.next")}: {entry.nextAction}</p>
            {entry.assumptions.map((value, index) => <p key={`a${index}`}>{t("conversation.planAssumption")}: {value}</p>)}
            {entry.pendingDecisions.map((value, index) => <p key={`d${index}`}>{t("conversation.planDecision")}: {value}</p>)}
          </div>
        ))}
      </div>
    </details>
  );
}
