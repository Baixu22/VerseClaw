import { useCallback, useEffect, useState, useRef } from "react";
import { CheckCircle2, ChevronRight, Circle, Loader2, PauseCircle, Plus, Search } from 'lucide-react';
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { hostApi } from "@/lib/host-api";
import type { TaskSystemCommand, TaskView } from "@shared/task-system/types";
import { TaskTracePanel } from '@/components/task-ledger/TaskTracePanel';

export function ManagedTasks({
  workspaceId,
  sessionKey,
}: {
  workspaceId: string | null;
  sessionKey: string;
}) {
  const { t } = useTranslation("taskLedger");
  const [tasks, setTasks] = useState<TaskView[]>([]);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [objective, setObjective] = useState("");
  const [target, setTarget] = useState("");
  const [expectedHash, setExpectedHash] = useState("");
  const [checkKind, setCheckKind] = useState<"file" | "command">("command");
  const [checkCommand, setCheckCommand] = useState("");
  const [acceptance, setAcceptance] = useState("");
  const [constraints, setConstraints] = useState("");
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const [nextCursor, setNextCursor] = useState<string>();
  const [dependencyReads, setDependencyReads] = useState<Record<string, {
    status: "loading" | "more" | "missing" | "error"; cursor?: string;
  }>>({});
  const dependencyRead = useRef<object | null>(null);
  const taskCards = useRef(new Map<string, HTMLElement>());
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    dependencyRead.current = null;
    setDependencyReads({});
    setFocusTaskId(null);
    if (!workspaceId) {
      setTasks([]);
      setNextCursor(undefined);
      return;
    }
    try {
      const result = await hostApi.taskLedger.queryTasks({
        workspaceId,
        query,
        state: stateFilter === "all" ? undefined : (stateFilter as TaskView["contract"]["state"]),
        limit: 50,
      });
      if (version !== requestVersion.current) return;
      setTasks(result.tasks);
      setNextCursor(result.nextCursor);
      if (result.tasks.length > 0) setShowForm(false);
      setError("");
      setStale(false);
    } catch (e) {
      if (version !== requestVersion.current) return;
      setError(String(e));
      setStale(true);
    }
  }, [workspaceId, query, stateFilter]);
  useEffect(() => {
    setTasks([]);
    setNextCursor(undefined);
    setStale(false);
  }, [workspaceId]);
  useEffect(() => {
    const versionRef = requestVersion;
    const timer = setTimeout(() => void load(), 180);
    return () => {
      clearTimeout(timer);
      versionRef.current++;
      dependencyRead.current = null;
    };
  }, [load]);
  useEffect(() => {
    const card = focusTaskId ? taskCards.current.get(focusTaskId) : null;
    if (!card) return;
    card.scrollIntoView({ block: "nearest" });
    card.focus({ preventScroll: true });
    setFocusTaskId(null);
  }, [focusTaskId, tasks]);

  // A click reads one owner page and keeps only the requested dependency.
  const findDependency = async (taskNodeId: string) => {
    if (!workspaceId || stale || busy || dependencyRead.current) return;
    const intent = {};
    dependencyRead.current = intent;
    const version = requestVersion.current;
    const cursor = dependencyReads[taskNodeId]?.cursor;
    setDependencyReads((old) => ({ ...old, [taskNodeId]: { status: "loading", cursor } }));
    try {
      const result = await hostApi.taskLedger.queryTasks({ workspaceId, limit: 50, cursor });
      if (dependencyRead.current !== intent || version !== requestVersion.current) return;
      const found = result.tasks.find((task) => task.contract.taskNodeId === taskNodeId);
      if (found) {
        setTasks((old) => [...old.filter((task) => task.contract.taskNodeId !== taskNodeId), found]);
        setDependencyReads((old) => { const next = { ...old }; delete next[taskNodeId]; return next; });
        setFocusTaskId(taskNodeId);
      } else {
        setDependencyReads((old) => ({ ...old, [taskNodeId]: {
          status: result.nextCursor ? "more" : "missing", cursor: result.nextCursor,
        } }));
      }
    } catch {
      if (dependencyRead.current === intent && version === requestVersion.current) {
        setDependencyReads((old) => ({ ...old, [taskNodeId]: { status: "error", cursor } }));
      }
    } finally {
      if (dependencyRead.current === intent) dependencyRead.current = null;
    }
  };
  const loadMore = async () => {
    if (!workspaceId || !nextCursor || busy) return;
    setBusy(true);
    const version = requestVersion.current;
    try {
      const result = await hostApi.taskLedger.queryTasks({
        workspaceId,
        query,
        state: stateFilter === "all" ? undefined : (stateFilter as TaskView["contract"]["state"]),
        limit: 50,
        cursor: nextCursor,
      });
      if (version !== requestVersion.current) return;
      setTasks((old) => [
        ...old,
        ...result.tasks.filter(
          (task) =>
            !old.some((existing) => existing.contract.taskNodeId === task.contract.taskNodeId),
        ),
      ]);
      setNextCursor(result.nextCursor);
    } catch (e) {
      if (version === requestVersion.current) setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const command = async (command: TaskSystemCommand) => {
    if (!workspaceId) return;
    setBusy(true);
    setError("");
    try {
      const result = await hostApi.taskLedger.command({ workspaceId, command });
      if (!result.success) throw new Error(result.error);
      await load();
    } catch (e) {
      await load();
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-3" data-testid="managed-tasks">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <Input
          aria-label={t("managed.search")}
          placeholder={t("managed.search")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-8 pl-8 text-sm"
        />
        </div>
        <Select value={stateFilter} onValueChange={setStateFilter}>
          <SelectTrigger aria-label={t("managed.filter")} className="h-8 w-40 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("managed.all")}</SelectItem>
            {(
              ["ready", "doing", "paused", "review", "cancelling", "done", "cancelled"] as const
            ).map((state) => (
              <SelectItem key={state} value={state}>
                {t(`managed.states.${state}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button className="h-8" variant="outline" disabled={busy} onClick={() => void load()}>{t("actions.refresh")}</Button>
        {!showForm && <Button className="h-8" onClick={() => setShowForm(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {t("managed.create")}
        </Button>}
        {showForm && <Button className="h-8" variant="ghost" onClick={() => setShowForm(false)}>{t('managed.closeForm')}</Button>}
      </div>
      {showForm && (
        <div className="grid gap-2 rounded-lg border border-border bg-surface-input p-3">
          <p className="text-sm text-muted-foreground">{t("managed.description")}</p>
          <Input
            aria-label={t("managed.objective")}
            placeholder={t("managed.objective")}
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
          />
          <Input
            aria-label={t("managed.target")}
            placeholder={t("managed.target")}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
          <Input
            aria-label={t("managed.acceptance")}
            placeholder={t("managed.acceptance")}
            value={acceptance}
            onChange={(e) => setAcceptance(e.target.value)}
          />
          <Input
            aria-label={t("managed.constraints")}
            placeholder={t("managed.constraints")}
            value={constraints}
            onChange={(e) => setConstraints(e.target.value)}
          />
          <Select
            value={checkKind}
            onValueChange={(value) => setCheckKind(value as "file" | "command")}
          >
            <SelectTrigger aria-label={t("managed.verification")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="command">{t("managed.commandCheck")}</SelectItem>
              <SelectItem value="file">{t("managed.fileCheck")}</SelectItem>
            </SelectContent>
          </Select>
          {checkKind === "file" ? (
            <Input
              aria-label={t("managed.expectedHash")}
              placeholder={t("managed.expectedHash")}
              value={expectedHash}
              onChange={(e) => setExpectedHash(e.target.value)}
            />
          ) : (
            <Input
              aria-label={t("managed.command")}
              placeholder={t("managed.command")}
              value={checkCommand}
              onChange={(e) => setCheckCommand(e.target.value)}
            />
          )}
          <p className="text-xs text-muted-foreground">
            {t(
              checkKind === "file"
                ? "managed.fileCheckExplanation"
                : "managed.commandCheckExplanation",
            )}
          </p>
          <p className="text-xs text-muted-foreground">{t("managed.coverage")}</p>
          <div className="flex gap-2">
            <Button
              disabled={
                busy || stale ||
                !workspaceId ||
                !objective.trim() ||
                !target.trim() ||
                !acceptance.trim() ||
                (checkKind === "file" ? !/^[a-f0-9]{64}$/.test(expectedHash) : !checkCommand.trim())
              }
              onClick={() =>
                void command({
                  action: "create",
                  requestId: crypto.randomUUID(),
                  contract: {
                    objective,
                    constraints: constraints
                      .split("\n")
                      .map((x) => x.trim())
                      .filter(Boolean),
                    target,
                    acceptance: [
                      {
                        id: "artifact",
                        description: acceptance,
                        verification:
                          checkKind === "file"
                            ? { kind: "file-sha256", path: target, sha256: expectedHash }
                            : {
                                kind: "tool-result",
                                tool: "exec",
                                command: checkCommand,
                                files: target
                                  .split(",")
                                  .map((x) => x.trim())
                                  .filter(Boolean),
                                exitCode: 0,
                              },
                      },
                    ],
                  },
                })
              }
            >
              {t("managed.create")}
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="break-words text-sm text-red-700 dark:text-red-400">
          {t("managed.error", { error })}
        </p>
      )}
      {stale && tasks.length > 0 && <p role="status" className="text-sm text-amber-700 dark:text-amber-400">{t("managed.stale")}</p>}
      {tasks.length === 0 && <p className="text-sm text-muted-foreground">{t("managed.empty")}</p>}
      {tasks.length > 0 && <div className="divide-y divide-border rounded-lg border border-border bg-background" data-testid="managed-task-list">
      {tasks.map((view) => {
        const { contract, claim } = view;
        const stateTone = contract.state === 'doing' ? 'text-blue-700 dark:text-blue-400'
          : contract.state === 'done' ? 'text-green-700 dark:text-green-400'
            : ['paused', 'review', 'cancelling'].includes(contract.state) ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground';
        const StateIcon = contract.state === 'doing' ? Loader2 : contract.state === 'done' ? CheckCircle2
          : contract.state === 'paused' ? PauseCircle : Circle;
        const mine = claim?.sessionKey === sessionKey;
        const dependencies = (contract.dependencies ?? []).map((id) => ({ id,
          task: tasks.find((task) => task.contract.taskNodeId === id),
        })).filter(({ task }) => task?.contract.state !== "done");
        return (
          <article
            key={contract.taskNodeId}
            data-testid="managed-task"
            data-state={contract.state}
            tabIndex={-1}
            ref={(card) => {
              if (card) taskCards.current.set(contract.taskNodeId, card);
              else taskCards.current.delete(contract.taskNodeId);
            }}
            className="min-w-0 space-y-2.5 px-3 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2">
                <StateIcon className={`mt-0.5 h-4 w-4 shrink-0 ${stateTone}`} aria-hidden="true" />
                <h3 className="min-w-0 break-words text-sm font-medium text-foreground">{contract.objective}</h3>
              </div>
              <span className={`shrink-0 text-xs ${stateTone}`}>
                {t(`managed.states.${contract.state}`)}
              </span>
            </div>
            {view.checkpoint?.nextAction && !['done', 'cancelled'].includes(contract.state) && (
              <p className="pl-6 text-meta text-muted-foreground" data-testid="managed-task-next">
                {t("managed.nextAction", { action: view.checkpoint.nextAction })}
              </p>
            )}
            {view.pendingOperations > 0 && (
              <p className="pl-6 text-xs text-amber-700 dark:text-amber-400">
                {t("managed.pending", { count: view.pendingOperations })}
              </p>
            )}
            <details className="group/task-details pl-6" data-testid="managed-task-details">
              <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1.5 rounded-md text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <ChevronRight className="h-3.5 w-3.5 transition-transform group-open/task-details:rotate-90" aria-hidden="true" />
                {t('managed.details')}
              </summary>
              <div className="space-y-3 border-t border-border/60 py-2.5">
            <p className="break-all text-xs text-muted-foreground">
              {t("managed.owner", {
                owner:
                  claim?.state === "released"
                    ? t("managed.unassigned")
                    : (claim?.sessionKey ?? t("managed.unassigned")),
              })}
            </p>
            {claim && (
              <p className="break-all text-xs text-muted-foreground">
                {t("managed.worktree", { path: claim.worktree })} ·{" "}
                {t(`managed.claimStates.${claim.state}`)}
              </p>
            )}
            <ul className="list-disc pl-5 text-sm">
              {contract.constraints.map((constraint, index) => (
                <li key={`constraint-${index}`}>{t("managed.constraint", { text: constraint })}</li>
              ))}
              {contract.acceptance.map((c) => (
                <li key={c.id}>{c.description}</li>
              ))}
            </ul>
            {Boolean(view.childTaskNodeIds?.length) && (
              <p className="text-sm text-muted-foreground">{t("managed.children", { count: view.childTaskNodeIds!.length })}</p>
            )}
            {view.parentTaskNodeId && <p className="text-xs text-muted-foreground">{t("managed.parentGoal")}</p>}
            {dependencies.length > 0 && (
              <div className="space-y-1 text-sm">
                <p>{t("managed.waitingDependency")}</p>
                <ul className="space-y-1">
                  {dependencies.map(({ id, task }) => {
                    const read = dependencyReads[id];
                    return <li key={id} className="flex flex-wrap items-center gap-2">
                      {task ? <>
                        <button type="button" className="text-left underline underline-offset-2"
                          aria-label={t("managed.openDependency", { title: task.contract.objective })}
                          onClick={() => setFocusTaskId(id)}>{task.contract.objective}</button>
                        <span className="text-muted-foreground">{t(`managed.states.${task.contract.state}`)}</span>
                      </> : <>
                        <span role="status" className="text-muted-foreground">{t(read?.status === "missing"
                          ? "managed.dependencyMissing" : read?.status === "error"
                            ? "managed.dependencyReadFailed" : "managed.dependencyNotLoaded")}</span>
                        <button type="button" className="underline underline-offset-2 disabled:opacity-50"
                          disabled={busy || stale || Object.values(dependencyReads).some((value) => value.status === "loading")}
                          onClick={() => void findDependency(id)}>
                          {t(read?.status === "loading" ? "managed.readingDependency"
                            : read?.status === "more" ? "managed.findDependencyMore" : "managed.findDependency")}
                        </button>
                      </>}
                    </li>;
                  })}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {mine &&
                claim &&
                (claim.state !== "released" || Boolean(view.childTaskNodeIds?.length)) &&
                !["done", "cancelled", "cancelling"].includes(contract.state) && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || stale}
                    onClick={() => void command({ action: "cancel", credential: claim })}
                  >
                    {t("managed.cancel")}
                  </Button>
                )}
              {contract.state === "ready" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || stale || !sessionKey || dependencies.length > 0}
                  onClick={() =>
                    void command({
                      action: "claim",
                      taskNodeId: contract.taskNodeId,
                      sessionKey,
                      requestId: crypto.randomUUID(),
                    })
                  }
                >
                  {t("managed.claim")}
                </Button>
              )}
              {mine && claim?.state === "active" && contract.state === "doing" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || stale}
                  onClick={() => void command({ action: "pause", credential: claim })}
                >
                  {t("managed.pause")}
                </Button>
              )}
              {claim && ["paused", "recovery_required"].includes(claim.state) && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || stale || !sessionKey}
                  onClick={() =>
                    void command({
                      action: "recover",
                      taskNodeId: contract.taskNodeId,
                      targetSessionKey: sessionKey,
                    })
                  }
                >
                  {t("managed.resume")}
                </Button>
              )}
              {mine && claim && claim.state !== "released" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || stale || view.pendingOperations > 0}
                  onClick={() => void command({ action: "release", credential: claim })}
                >
                  {t("managed.release")}
                </Button>
              )}
            </div>
              </div>
            </details>
            {workspaceId && <TaskTracePanel workspaceId={workspaceId} taskNodeId={contract.taskNodeId} revision={contract.revision} digest={contract.digest} />}
          </article>
        );
      })}
      </div>}
      {nextCursor && (
        <Button variant="outline" disabled={busy} onClick={() => void loadMore()}>
          {t("managed.loadMore")}
        </Button>
      )}
    </section>
  );
}
