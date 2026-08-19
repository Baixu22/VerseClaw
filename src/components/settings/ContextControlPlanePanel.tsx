import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toUserMessage } from "@/lib/error-message";
import { hostApi } from "@/lib/host-api";
import { cn } from "@/lib/utils";
import {
  projectStage6DiffFromReports,
  projectStage6ReplayInputFromReports,
  simulateStage6Policy,
  type Stage6PolicyCandidate,
  type Stage6PolicySimulation,
  type Stage6ReplayInputProjection,
} from "@shared/types/context-control-plane/stage6-control-plane-explain";

type Snapshot = {
  status: Awaited<ReturnType<typeof hostApi.localControlPlane.status>>["status"];
  contextReports: Awaited<ReturnType<typeof hostApi.localControlPlane.reports>>["reports"];
  evidenceReports: Awaited<ReturnType<typeof hostApi.localControlPlane.reports>>["reports"];
  correlations: Awaited<ReturnType<typeof hostApi.localControlPlane.correlations>>["correlations"];
};

type ReportProjection = ReturnType<typeof projectStage6DiffFromReports>;

const DRY_RUN_RULE = "stage6-local-dry-run:v1";
const DRY_RUN_DIGEST = `sha256:${"0".repeat(64)}`;

const STAGE6_REASON_I18N_KEYS: Record<string, string> = {
  "selected-by-plan": "selectedByPlan",
  "selected-by-report": "selectedByReport",
  "report-summary": "reportSummary",
  "protected-section": "protectedSection",
  "context.truncated_or_omitted": "contextTruncatedOrOmitted",
  "protected-rule": "protectedRule",
  "budget-allow": "budgetAllow",
  "protected-over-budget": "protectedOverBudget",
  "budget-drop": "budgetDrop",
  "duplicate": "duplicate",
  "budget-truncate": "budgetTruncate",
  "flag-off": "flagOff",
  "kill-switch": "killSwitch",
  "stale": "stale",
  "sensitivity": "sensitivity",
  "policy-denied": "policyDenied",
};

const STAGE6_DECISION_I18N_KEYS: Record<string, string> = {
  allow: "allow",
  drop: "drop",
};

function stage6ReasonTranslationKey(reason: string): string {
  return STAGE6_REASON_I18N_KEYS[reason] ?? "unknown";
}

function stage6DecisionTranslationKey(decision: string): string {
  return STAGE6_DECISION_I18N_KEYS[decision] ?? "unknown";
}

function candidatesForDiff(projection: ReportProjection): Stage6PolicyCandidate[] {
  const entries = projection.entries.slice(0, 50);
  const candidates: Stage6PolicyCandidate[] = [];
  for (const entry of entries) {
    if (entry.status === "selected") {
      candidates.push({
        refId: entry.id,
        priority: entry.reason === "protected-section" ? "critical" : "normal",
        units: 1,
        protectedFlag: entry.reason === "protected-section",
      });
    } else {
      candidates.push({ refId: entry.id, priority: "optional", units: 1, protectedFlag: false });
    }
  }
  return candidates;
}

export function ContextControlPlanePanel() {
  const { t } = useTranslation("settings");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [simulation, setSimulation] = useState<Stage6PolicySimulation | null>(null);
  const [replay, setReplay] = useState<Stage6ReplayInputProjection | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [status, context, evidence, correlations] = await Promise.all([
        hostApi.localControlPlane.status(),
        hostApi.localControlPlane.reports({ kind: "context", limit: 50 }),
        hostApi.localControlPlane.reports({ kind: "evidence", limit: 50 }),
        hostApi.localControlPlane.correlations({ groupBy: "evidence" }),
      ]);
      setSnapshot({
        status: status.status,
        contextReports: context.reports,
        evidenceReports: evidence.reports,
        correlations: correlations.correlations,
      });
      setSimulation(null);
      setReplay(null);
    } catch (error) {
      toast.error(t("developer.contextControlPlane.loadFailed", { error: toUserMessage(error) || String(error) }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const diff = useMemo<ReportProjection>(() => {
    const reports = [
      ...(snapshot?.contextReports ?? []),
      ...(snapshot?.evidenceReports ?? []),
    ];
    return projectStage6DiffFromReports(reports);
  }, [snapshot]);

  const enabledKinds = useMemo(() => {
    const flags = snapshot?.status.flags;
    if (!flags) return [];
    return (Object.entries(flags) as Array<[string, boolean]>)
      .filter(([, enabled]) => enabled)
      .map(([kind]) => kind);
  }, [snapshot]);

  const reasonText = useCallback((reason: string) => {
    return t(`developer.contextControlPlane.reasons.${stage6ReasonTranslationKey(reason)}`);
  }, [t]);

  const decisionText = useCallback((decision: string) => {
    return t(`developer.contextControlPlane.decisions.${stage6DecisionTranslationKey(decision)}`);
  }, [t]);

  const runSimulation = useCallback(() => {
    const result = simulateStage6Policy({
      policy: {
        ruleId: DRY_RUN_RULE,
        policyDigest: DRY_RUN_DIGEST,
        protectPriorities: ["critical", "constraint", "evidence"],
        budgetUnits: diff.selectedCount,
      },
      candidates: candidatesForDiff(diff),
    });
    setSimulation(result.ok ? result.simulation : null);
  }, [diff]);

  const runReplay = useCallback(() => {
    const reports = [
      ...(snapshot?.contextReports ?? []),
      ...(snapshot?.evidenceReports ?? []),
    ];
    setReplay(projectStage6ReplayInputFromReports({ reports }));
  }, [snapshot]);

  const reportCount = (snapshot?.contextReports.length ?? 0) + (snapshot?.evidenceReports.length ?? 0);
  const correlationCount = snapshot?.correlations.groups.length ?? 0;

  return (
    <div
      className="space-y-4 rounded-lg border border-black/10 bg-black/[0.03] p-5 dark:border-white/10 dark:bg-white/[0.04]"
      data-testid="settings-context-control-plane-panel"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Label className="text-sm font-medium text-foreground">
            {t("developer.contextControlPlane.title")}
          </Label>
          <p className="mt-1 text-meta text-muted-foreground">
            {t("developer.contextControlPlane.description")}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
          className="h-9 rounded-full border-black/10 bg-transparent px-4 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
          data-testid="settings-ccp-refresh"
        >
          <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loading && "animate-spin")} />
          {loading ? t("common:status.loading") : t("common:actions.refresh")}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-surface-modal p-3" data-testid="settings-ccp-reports">
          <p className="text-tiny uppercase text-muted-foreground">{t("developer.contextControlPlane.reports")}</p>
          <p className="mt-1 text-2xl font-semibold">{reportCount}</p>
        </div>
        <div className="rounded-lg bg-surface-modal p-3" data-testid="settings-ccp-correlations">
          <p className="text-tiny uppercase text-muted-foreground">{t("developer.contextControlPlane.correlations")}</p>
          <p className="mt-1 text-2xl font-semibold">{correlationCount}</p>
        </div>
        <div className="rounded-lg bg-surface-modal p-3" data-testid="settings-ccp-status">
          <p className="text-tiny uppercase text-muted-foreground">{t("developer.contextControlPlane.enabledKinds")}</p>
          <p className="mt-1 text-meta font-semibold">
            {enabledKinds.length > 0 ? enabledKinds.join(", ") : t("developer.contextControlPlane.defaultOff")}
          </p>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-lg bg-surface-modal p-4" data-testid="settings-ccp-diff">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-sm font-medium text-foreground">{t("developer.contextControlPlane.diff")}</Label>
            <div className="flex gap-2">
              <Badge variant="secondary" className="rounded-full px-2 py-0.5">
                {t("developer.contextControlPlane.selectedCount", { count: diff.selectedCount })}
              </Badge>
              <Badge variant="secondary" className="rounded-full px-2 py-0.5">
                {t("developer.contextControlPlane.omittedCount", { count: diff.omittedCount })}
              </Badge>
            </div>
          </div>
          {diff.entries.length === 0 ? (
            <p className="mt-3 text-meta text-muted-foreground">{t("developer.contextControlPlane.noReports")}</p>
          ) : (
            <ul className="mt-3 max-h-64 space-y-2 overflow-auto">
              {diff.entries.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-2 rounded-lg border border-black/5 bg-black/[0.03] px-3 py-2 dark:border-white/5 dark:bg-white/[0.03]">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-tiny text-foreground/80">{entry.refId}</p>
                    <p className="truncate text-tiny text-muted-foreground">
                      {entry.status === "selected"
                        ? t("developer.contextControlPlane.includedBecause", { reason: reasonText(entry.reason) })
                        : t("developer.contextControlPlane.omittedBecause", { reason: reasonText(entry.reason) })}
                    </p>
                  </div>
                  <Badge
                    variant="secondary"
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5",
                      entry.status === "selected"
                        ? "border-emerald-500/20 text-emerald-700 dark:text-emerald-400"
                        : "border-amber-500/30 text-amber-700 dark:text-amber-400",
                    )}
                  >
                    {entry.status === "selected"
                      ? t("developer.contextControlPlane.selected")
                      : t("developer.contextControlPlane.omitted")}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg bg-surface-modal p-4" data-testid="settings-ccp-simulate">
          <div className="flex items-center justify-between gap-2">
            <div>
              <Label className="text-sm font-medium text-foreground">{t("developer.contextControlPlane.simulation")}</Label>
              <p className="mt-1 text-tiny text-muted-foreground">{t("developer.contextControlPlane.simulationDesc")}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={runSimulation}
              disabled={diff.entries.length === 0}
              className="h-8 rounded-full border-black/10 bg-transparent px-3 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
              data-testid="settings-ccp-run-simulation"
            >
              <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
              {t("developer.contextControlPlane.runSimulation")}
            </Button>
          </div>
          {simulation ? (
            <div className="mt-3" data-testid="settings-ccp-simulation-result">
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary" className="rounded-full px-2 py-0.5">
                  {t("developer.contextControlPlane.dryRun")}
                </Badge>
                <Badge variant="secondary" className="rounded-full px-2 py-0.5">
                  {t("developer.contextControlPlane.sideEffects", { count: simulation.sideEffects })}
                </Badge>
                <Badge variant="secondary" className="rounded-full px-2 py-0.5">
                  {t("developer.contextControlPlane.usedUnits", { used: simulation.usedUnits, budget: simulation.budgetUnits })}
                </Badge>
              </div>
              <ul className="mt-3 max-h-40 space-y-1 overflow-auto">
                {simulation.decisions.map((decision) => (
                  <li key={decision.refId} className="flex items-center justify-between gap-2 text-tiny">
                    <span className="truncate font-mono text-foreground/80">{decision.refId}</span>
                    <span className={decision.decision === "allow" ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}>
                      {decisionText(decision.decision)} · {reasonText(decision.reason)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      </div>

      <section className="rounded-lg bg-surface-modal p-4" data-testid="settings-ccp-replay">
        <div className="flex items-center justify-between gap-2">
          <div>
            <Label className="text-sm font-medium text-foreground">{t("developer.contextControlPlane.replay")}</Label>
            <p className="mt-1 text-tiny text-muted-foreground">{t("developer.contextControlPlane.replayDesc")}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={runReplay}
            disabled={reportCount === 0}
            className="h-8 rounded-full border-black/10 bg-transparent px-3 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
            data-testid="settings-ccp-build-replay"
          >
            {t("developer.contextControlPlane.buildReplayInput")}
          </Button>
        </div>
        {replay ? (
          <div className="mt-3 grid gap-2 text-tiny sm:grid-cols-2" data-testid="settings-ccp-replay-result">
            <p>
              {t("developer.contextControlPlane.reportIds")}:{" "}
              <span className="font-mono text-foreground/80">{replay.reportIds.join(", ") || "-"}</span>
            </p>
            <p>
              {t("developer.contextControlPlane.evidenceRefs")}:{" "}
              <span className="font-mono text-foreground/80">
                {replay.evidenceRefs.map((ref) => `${ref.type}:${ref.ref}`).join(", ") || "-"}
              </span>
            </p>
            <p>
              {t("developer.contextControlPlane.effectsReplayed")}:{" "}
              <span className="font-semibold">{String(replay.effectsReplayed)}</span>
            </p>
            <p>
              {t("developer.contextControlPlane.rawPayloadIncluded")}:{" "}
              <span className="font-semibold">{String(replay.rawPayloadIncluded)}</span>
            </p>
          </div>
        ) : null}
      </section>
    </div>
  );
}
