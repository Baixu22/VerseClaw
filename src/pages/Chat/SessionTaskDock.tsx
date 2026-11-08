import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ListChecks, RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ToolUiPlanView, type ToolUiPlanTodo } from "@/components/tool-ui/plan-view";
import { hostApi } from "@/lib/host-api";
import { hostEvents } from "@/lib/host-events";
import type { TaskSessionSnapshot, TaskView } from "@shared/task-system/types";
import type { RunPlanSurface } from "./run-surface-promotion";
import { cn } from "@/lib/utils";

type Mode = "collapsed" | "expanded" | "hidden";
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
            ...[result.task, ...result.children].flatMap((task) =>
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

function taskTodo(task: TaskView): ToolUiPlanTodo {
  const state = task.contract.state;
  return {
    id: task.contract.taskNodeId,
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

/** Presentation only: closing this dock never changes task ownership or execution. */
export function SessionTaskDock({
  workspaceId,
  sessionKey,
  hasConversation,
  plan,
}: {
  workspaceId: string | null;
  sessionKey: string;
  hasConversation: boolean;
  plan?: RunPlanSurface | null;
}) {
  const { t } = useTranslation("taskLedger");
  const { scope, snapshot, stale, retry } = useSessionTask(
    workspaceId,
    sessionKey,
    hasConversation,
  );
  const task = snapshot?.task;
  const taskId = task?.contract.taskNodeId ?? (plan?.todos.length ? `plan:${plan.id}` : "");
  if (!hasConversation || !taskId) return null;
  return (
    <TaskDockBody
      key={`${scope}:${taskId}`}
      {...{ scope, taskId, task, plan, stale, retry, t }}
      childrenTasks={snapshot?.children ?? []}
    />
  );
}

function TaskDockBody({
  scope,
  taskId,
  task,
  childrenTasks,
  plan,
  stale,
  retry,
  t,
}: {
  scope: string;
  taskId: string;
  task: TaskView | null | undefined;
  childrenTasks: TaskView[];
  plan?: RunPlanSurface | null;
  stale: boolean;
  retry: () => void;
  t: ReturnType<typeof useTranslation<"taskLedger">>["t"];
}) {
  const [mode, setMode] = useState<Mode>(() => readMode(scope, taskId));
  const container = useRef<HTMLElement>(null);
  const change = (next: Mode) => {
    setMode(next);
    saveMode(scope, taskId, next);
    if (next === "hidden" || mode === "hidden")
      requestAnimationFrame(() =>
        container.current?.querySelector<HTMLButtonElement>("button")?.focus(),
      );
  };
  const todos = childrenTasks.length
    ? childrenTasks.map(taskTodo)
    : task
      ? [
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
                  status:
                    task.contract.state === "doing"
                      ? ("in_progress" as const)
                      : ("pending" as const),
                },
              ]
            : []),
        ]
      : plan!.todos;
  const title = task?.contract.objective ?? plan?.title ?? t("conversation.task");
  const state =
    task?.contract.state ??
    (todos.length && todos.every((todo) => todo.status === "completed") ? "done" : undefined);
  const status = stale
    ? t("conversation.stale")
    : state
      ? t(`conversation.states.${state}`)
      : t("conversation.progress");
  const complete = state === "done";
  const completed = todos.filter((todo) => todo.status === "completed").length;
  const hasDefinedPlan = childrenTasks.length > 0 || (!task && Boolean(plan?.todos.length));
  const progress = complete
    ? 100
    : hasDefinedPlan
      ? Math.round((completed / todos.length) * 100)
      : null;
  const active =
    !stale &&
    (state === "doing" ||
      state === "review" ||
      (!state && todos.some((todo) => todo.status === "in_progress")));
  return (
    <section
      ref={container}
      className="relative w-full shrink-0 px-4 pb-3 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-200"
      data-testid="session-task-dock"
      data-placement="header"
      aria-label={t("conversation.task")}
    >
      {mode === "hidden" ? (
        <button
          type="button"
          data-testid="session-task-reopen"
          onClick={() => change("collapsed")}
          className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs text-muted-foreground hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/10"
          aria-label={t("conversation.reopen")}
        >
          {complete ? <Check className="h-3.5 w-3.5" /> : <ListChecks className="h-3.5 w-3.5" />}
          {t("conversation.task")}
          <span aria-hidden="true">· {status}</span>
        </button>
      ) : (
        <div
          className="max-h-[min(34vh,280px)] overflow-y-auto rounded-xl border border-border/60 bg-foreground/[0.025] px-4 py-3"
          data-testid="session-task-panel"
        >
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1" data-testid="session-task-plan">
              <button
                type="button"
                className="flex w-full min-w-0 items-center gap-2.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-expanded={mode === "expanded"}
                onClick={() => change(mode === "expanded" ? "collapsed" : "expanded")}
                title={title}
              >
                {complete ? (
                  <Check className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
                ) : (
                  <span
                    className={cn(
                      "h-2 w-2 shrink-0 rounded-full",
                      active ? "bg-orange-500 motion-safe:animate-pulse" : "bg-muted-foreground/50",
                    )}
                    aria-hidden="true"
                  />
                )}
                <h2
                  className="min-w-0 truncate text-sm font-medium tracking-tight text-foreground"
                  data-testid="session-task-title"
                >
                  {title}
                </h2>
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                    mode === "expanded" && "rotate-180",
                  )}
                />
              </button>
            </div>
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-xs",
                active
                  ? "bg-orange-500/10 text-orange-700 dark:text-orange-400"
                  : "bg-black/5 text-muted-foreground dark:bg-white/10",
              )}
              data-testid="session-task-status"
            >
              {status}
            </span>
            <button
              type="button"
              data-testid="session-task-close"
              onClick={() => change("hidden")}
              aria-label={t("conversation.hide")}
              title={t("conversation.hideHint")}
              className="rounded-md p-0.5 text-muted-foreground hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/10"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {progress !== null && (
            <div className="mt-2 flex items-center gap-2" data-testid="session-task-progress">
              <div
                role="progressbar"
                aria-label={t("conversation.progress")}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
                className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-black/5 dark:bg-white/10"
              >
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-200",
                    complete ? "bg-emerald-500" : "bg-orange-500",
                  )}
                  style={{ width: `${progress}%` }}
                />
              </div>
              {hasDefinedPlan && (
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {t("conversation.stepsProgress", { completed, total: todos.length })}
                </span>
              )}
            </div>
          )}
          {mode === "expanded" && (
            <div
              className="mt-3 border-t border-border/50 pt-3 text-xs text-muted-foreground"
              data-testid="session-task-details"
            >
              {todos.length > 0 ? (
                <ToolUiPlanView
                  title={t("conversation.steps")}
                  todos={todos}
                  compact
                  maxVisibleTodos={4}
                  showProgress={false}
                  testId="session-task-steps"
                />
              ) : (
                <p>{t(complete ? "conversation.accepted" : "conversation.waitingForPlan")}</p>
              )}
              {task?.referenceOnly && <p className="mt-2">{t("conversation.observing")}</p>}
              {task && task.pendingOperations > 0 && (
                <p className="mt-2">{t("conversation.settling")}</p>
              )}
              {stale && (
                <button
                  type="button"
                  onClick={retry}
                  className="mt-2 inline-flex items-center gap-1 rounded focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <RefreshCw className="h-3 w-3" />
                  {t("conversation.refresh")}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
