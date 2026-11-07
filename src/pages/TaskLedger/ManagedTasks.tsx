import { useCallback, useEffect, useState } from "react";
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
  const [busy, setBusy] = useState(false);
  const [showForm,setShowForm]=useState(true);
  const [objective, setObjective] = useState("");
  const [target, setTarget] = useState("");
  const [expectedHash, setExpectedHash] = useState("");
  const [checkKind, setCheckKind] = useState<"file" | "command">("command");
  const [checkCommand, setCheckCommand] = useState("");
  const [acceptance, setAcceptance] = useState("");
  const [constraints, setConstraints] = useState("");
  const load = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const result = await hostApi.taskLedger.managedTasks({ workspaceId });
      setTasks(result.tasks);
      if(result.tasks.length>0)setShowForm(false);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }, [workspaceId]);
  useEffect(() => {
    void load();
  }, [load]);
  const command = async (command: TaskSystemCommand) => {
    if (!workspaceId) return;
    setBusy(true);
    setError("");
    try {
      const result = await hostApi.taskLedger.command({ workspaceId, command });
      if (!result.success) throw new Error(result.error);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-4" data-testid="managed-tasks">
      <p className="text-sm text-muted-foreground">{t("managed.description")}</p>
      {!showForm&&<Button variant="outline" onClick={()=>setShowForm(true)}>{t('managed.create')}</Button>}
      {showForm&&<div className="grid gap-2 rounded-md border border-border p-3">
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
        <div className="flex gap-2">
          <Button
            disabled={
              busy ||
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
          <Button variant="outline" disabled={busy} onClick={() => void load()}>
            {t("actions.refresh")}
          </Button>
        </div>
      </div>}
      {error && (
        <p role="alert" className="break-words text-sm text-red-700 dark:text-red-400">
          {t("managed.error", { error })}
        </p>
      )}
      {tasks.length === 0 && <p className="text-sm text-muted-foreground">{t("managed.empty")}</p>}
      {tasks.map((view) => {
        const { contract, claim } = view;
        const mine = claim?.sessionKey === sessionKey;
        return (
          <article
            key={contract.taskNodeId}
            data-testid="managed-task"
            className="space-y-2 rounded-md border border-border p-4"
          >
            <div className="flex flex-wrap justify-between gap-2">
              <h3 className="font-medium">{contract.objective}</h3>
              <span className="text-sm text-muted-foreground">
                {t(`managed.states.${contract.state}`)}
              </span>
            </div>
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
              {contract.acceptance.map((c) => (
                <li key={c.id}>{c.description}</li>
              ))}
            </ul>
            {view.checkpoint && (
              <p className="text-sm">
                {t("managed.nextAction", { action: view.checkpoint.nextAction })}
              </p>
            )}
            {view.pendingOperations > 0 && (
              <p className="text-sm text-amber-700 dark:text-amber-400">
                {t("managed.pending", { count: view.pendingOperations })}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {contract.state === "ready" && (
                <Button
                  size="sm"
                  disabled={busy || !sessionKey}
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
                  disabled={busy}
                  onClick={() => void command({ action: "pause", credential: claim })}
                >
                  {t("managed.pause")}
                </Button>
              )}
              {claim && ["paused", "recovery_required"].includes(claim.state) && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !sessionKey}
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
                  disabled={busy || view.pendingOperations > 0}
                  onClick={() => void command({ action: "release", credential: claim })}
                >
                  {t("managed.release")}
                </Button>
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}
