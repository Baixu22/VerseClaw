import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hostApi } from "@/lib/host-api";
import type { TaskTraceReport } from "@shared/task-system/trace";

export function TaskTracePanel({
  workspaceId,
  taskNodeId,
  revision,
  digest,
  defaultOpen = false,
}: {
  workspaceId: string;
  taskNodeId: string;
  revision?: number;
  digest?: string;
  defaultOpen?: boolean;
}) {
  const { t, i18n } = useTranslation("taskLedger");
  const scope = JSON.stringify([workspaceId, taskNodeId, revision, digest]);
  const version = useRef(0),
    pending = useRef<string | null>(null);
  const [read, setRead] = useState<{
    scope: string;
    loading: boolean;
    failed: boolean;
    report?: TaskTraceReport;
  } | null>(null);
  const visible = read?.scope === scope ? read : null;
  const report = visible?.report;
  const load = useCallback(async () => {
    if (pending.current === scope) return;
    const ticket = ++version.current;
    pending.current = scope;
    setRead({ scope, loading: true, failed: false });
    try {
      const result = await hostApi.taskLedger.trace({ workspaceId, taskNodeId, revision, digest });
      if (ticket !== version.current) return;
      if (!result.success || result.report?.task.contract.taskNodeId !== taskNodeId)
        throw new Error("TASK_TRACE_SCOPE_MISMATCH");
      setRead({ scope, loading: false, failed: false, report: result.report });
    } catch {
      if (ticket === version.current) setRead({ scope, loading: false, failed: true });
    } finally {
      if (ticket === version.current) pending.current = null;
    }
  }, [workspaceId, taskNodeId, revision, digest, scope]);
  useEffect(
    () => () => {
      version.current++;
      pending.current = null;
    },
    [scope],
  );
  useEffect(() => {
    if (defaultOpen) void load();
  }, [defaultOpen, load]);
  const number = (value: number | null) =>
    value === null ? t("trace.unknown") : value.toLocaleString(i18n.language);
  const duration = (ms: number | null) =>
    ms === null
      ? t("trace.unknown")
      : t("trace.elapsed", { seconds: number(Math.round(ms / 100) / 10) });
  return (
    <details
      key={scope}
      className="group rounded-md border border-border bg-surface-input"
      open={defaultOpen || undefined}
      data-testid="task-trace-panel"
      data-task-node-id={taskNodeId}
      onToggle={(event) => {
        if (event.currentTarget.open && !visible && pending.current !== scope) void load();
      }}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronRight
          className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
        {t("trace.open")}
        {visible?.loading && (
          <Loader2 className="ml-auto h-4 w-4 animate-spin" aria-hidden="true" />
        )}
      </summary>
      <div className="space-y-3 border-t border-border p-3 text-sm">
        {visible?.loading && <p role="status">{t("trace.loading")}</p>}
        {visible?.failed && (
          <p role="alert" className="text-red-700 dark:text-red-400">
            {t("trace.unavailable")}
          </p>
        )}
        {report && (
          <>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="min-w-0 break-words font-medium">{report.task.contract.objective}</p>
              <span
                data-testid="task-trace-status"
                className={
                  report.status === "current"
                    ? "text-green-700 dark:text-green-400"
                    : "text-amber-700 dark:text-amber-400"
                }
              >
                {t(`trace.states.${report.status}`)}
              </span>
            </div>
            <p className="break-words text-muted-foreground">
              {t("trace.source", {
                revision: report.task.contract.revision,
                target: report.task.contract.target,
              })}
            </p>
            {report.ancestors.length > 0 && (
              <p className="break-words text-muted-foreground">
                {t("trace.goal", { goal: report.ancestors.at(-1)!.objective })}
              </p>
            )}
            <dl className="grid grid-cols-2 gap-3" data-testid="task-trace-cost">
              <div>
                <dt className="text-muted-foreground">{t("trace.calls")}</dt>
                <dd>{number(report.costs.calls)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("trace.tokens")}</dt>
                <dd>{number(report.costs.totalTokens)}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-muted-foreground">{t("trace.cost")}</dt>
                <dd>
                  {report.costs.totalUsd === null
                    ? t("trace.unknown")
                    : t("trace.estimatedCost", { amount: report.costs.totalUsd.toFixed(6) })}
                </dd>
              </div>
            </dl>
            <dl className="grid grid-cols-2 gap-3">
              {(["queue", "execution", "verification", "recovery"] as const).map((phase) => (
                <div key={phase}>
                  <dt className="text-muted-foreground">{t(`trace.phases.${phase}`)}</dt>
                  <dd>{duration(report.phases[phase].durationMs)}</dd>
                </div>
              ))}
            </dl>
            <details
              className="rounded-md border border-border p-2"
              data-testid="task-trace-execution"
            >
              <summary className="cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {t("trace.executionCount", {
                  runs: report.runs.length,
                  operations: report.operations.length,
                })}
              </summary>
              <ul className="mt-2 space-y-1">
                {report.operations.map((operation) => (
                  <li key={operation.operationId} className="break-words">
                    {operation.tool} ·{" "}
                    {t(
                      `trace.operations.${["completed", "pending", "unknown", "reconciled", "delegation_unknown"].includes(operation.state) ? operation.state : "unknown"}`,
                    )}
                    {" · "}
                    {duration(
                      operation.endedAt === null ? null : operation.endedAt - operation.startedAt,
                    )}
                  </li>
                ))}
              </ul>
            </details>
            <details
              className="rounded-md border border-border p-2"
              data-testid="task-trace-checks"
            >
              <summary className="cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {t("trace.checks", { count: report.checks.length })}
              </summary>
              <ul className="mt-2 space-y-3">
                {report.checks.map((check) => (
                  <li key={check.receipt.receiptId} className="space-y-1">
                    <p>
                      {report.task.contract.acceptance.find(
                        (c) => c.id === check.receipt.criterionId,
                      )?.description ?? check.receipt.criterionId}{" "}
                      · {t(`trace.artifacts.${check.state}`)}
                    </p>
                    {check.artifacts.map((artifact, index) => (
                      <p key={index} className="break-all text-xs text-muted-foreground">
                        {artifact.path} · {t(`trace.artifacts.${artifact.state}`)}
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
            </details>
            {report.diagnostics.length > 0 && (
              <details
                className="rounded-md border border-border p-2"
                data-testid="task-trace-diagnostics"
              >
                <summary className="cursor-pointer rounded-sm text-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-amber-400">
                  {t("trace.diagnosticCount", { count: report.diagnostics.length })}
                </summary>
                <ul className="mt-2 space-y-1">
                  {[
                    ...new Set(
                      report.diagnostics.map((d) =>
                        t(`trace.diagnostics.${d.code}`, {
                          ref: d.ref,
                          phase:
                            d.code === "phase_unknown" ? t(`trace.phases.${d.ref}`) : undefined,
                        }),
                      ),
                    ),
                  ].map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </details>
            )}
            <details className="rounded-md border border-border p-2" data-testid="task-trace-raw">
              <summary className="cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {t("trace.raw")}
              </summary>
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs">
                {JSON.stringify(
                  {
                    authorityId: report.authorityId,
                    revisions: report.revisions,
                    claims: report.claims,
                    runs: report.runs,
                    delegations: report.delegations,
                    operations: report.operations,
                    candidates: report.candidates,
                    checks: report.checks,
                    costs: report.costs,
                    phases: report.phases,
                    cleanup: report.cleanup,
                    diagnostics: report.diagnostics,
                    events: report.events,
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
          </>
        )}
        <Button variant="outline" size="sm" disabled={visible?.loading} onClick={() => void load()}>
          {t("actions.refresh")}
        </Button>
      </div>
    </details>
  );
}
