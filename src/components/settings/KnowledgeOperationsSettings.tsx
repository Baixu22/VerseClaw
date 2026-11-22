import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { hostApi } from "@/lib/host-api";
import { useWorkspacesStore } from "@/stores/workspaces";
import {
  PROJECT_RAG_DEFAULTS,
  type ProjectRagConfigInput,
  type ProjectRagConfigV2,
  type RetrievalCapabilitySnapshotV1,
  type KnowledgeIndexResult,
} from "@shared/knowledge/operations";

const configKey = (value: ProjectRagConfigV2) =>
  JSON.stringify([value.profile, value.answerMode, value.maxStorageBytes]);

export function KnowledgeOperationsSettings() {
  const { t } = useTranslation("settings");
  const workspaceId = useWorkspacesStore((state) => state.activeWorkspaceId);
  const [snapshot, setSnapshot] = useState<RetrievalCapabilitySnapshotV1>();
  const [form, setForm] = useState<ProjectRagConfigInput>(PROJECT_RAG_DEFAULTS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const edited = useRef(false);
  const pendingConfig = useRef<ProjectRagConfigV2 | undefined>(undefined);
  const epoch = useRef(0);
  const statusVersion = useRef(0);
  useEffect(() => {
    const token = ++epoch.current;
    let pending = false;
    setSnapshot(undefined);
    setError(false);
    setBusy(false);
    edited.current = false;
    pendingConfig.current = undefined;
    setRestarting(false);
    const refresh = async () => {
      if (pending) return;
      pending = true;
      const version = statusVersion.current;
      try {
        const result = await hostApi.knowledge.operationsStatus();
        if (epoch.current !== token || statusVersion.current !== version) return;
        if (
          !result.success ||
          !result.operations ||
          (workspaceId && result.operations.owner.workspaceId !== workspaceId)
        ) {
          setSnapshot(undefined);
          setError(true);
          return;
        }
        const next = result.operations;
        if (pendingConfig.current && configKey(next.config) !== configKey(pendingConfig.current)) return;
        setSnapshot(next);
        setError(false);
        if (pendingConfig.current && configKey(next.config) === configKey(pendingConfig.current)) {
          pendingConfig.current = undefined;
          edited.current = false;
          setRestarting(false);
        }
        if (!edited.current)
          setForm({
            profile: next.config.profile,
            answerMode: next.config.answerMode,
            maxStorageBytes: next.config.maxStorageBytes,
          });
      } catch {
        if (epoch.current === token && statusVersion.current === version) {
          setSnapshot(undefined);
          setError(true);
        }
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => {
      epoch.current = token + 1;
      window.clearInterval(timer);
    };
  }, [workspaceId]);

  const run = async (operation: () => Promise<KnowledgeIndexResult>) => {
    const token = epoch.current;
    setBusy(true);
    try {
      const result = await operation();
      if (epoch.current !== token) return;
      setError(!result.success);
      if (result.success) {
        const next = await hostApi.knowledge.operationsStatus();
        if (epoch.current === token && next.success) setSnapshot(next.operations);
      }
    } catch {
      if (epoch.current === token) setError(true);
    } finally {
      if (epoch.current === token) setBusy(false);
    }
  };
  const save = async () => {
    const token = epoch.current;
    statusVersion.current += 1;
    setBusy(true);
    try {
      const result = await hostApi.knowledge.operationsConfigure(form);
      if (epoch.current !== token) return;
      setError(!result.success);
      if (result.success && result.config) {
        statusVersion.current += 1;
        pendingConfig.current = result.config;
        edited.current = true;
        setRestarting(true);
        setSnapshot(undefined);
      }
    } catch {
      if (epoch.current === token) setError(true);
    } finally {
      if (epoch.current === token) setBusy(false);
    }
  };
  const change = (value: ProjectRagConfigInput) => {
    edited.current = true;
    setForm((current) => ({ ...current, ...value }));
  };
  const index = snapshot?.index;
  const enabled = index && !["disabled", "stopped", "unavailable"].includes(index.status);
  const blocked = busy || restarting || !snapshot;
  return (
    <section
      data-testid="knowledge-operations-settings"
      className="space-y-4 rounded-xl border border-border/60 bg-surface-modal p-5"
    >
      <div>
        <h2 className="font-serif text-xl font-normal tracking-tight">{t("operations.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("operations.description")}</p>
        <Link className="text-sm underline" to="/knowledge">
          {t("operations.sources")}
        </Link>
      </div>
      <p
        data-testid="operations-owner"
        data-owner={snapshot?.owner.workspaceId}
        className="text-sm"
      >
        {t("operations.owner")}
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm">
          <span className="block">{t("operations.profile")}</span>
          <select
            data-testid="operations-profile"
            className="h-9 rounded-md border border-input bg-surface-input px-3"
            value={form.profile}
            disabled={blocked}
            onChange={(event) =>
              change({ profile: event.target.value as ProjectRagConfigInput["profile"] })
            }
          >
            {(["local", "quality", "research"] as const).map((profile) => (
              <option key={profile} value={profile}>
                {t(`operations.profiles.${profile}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block">{t("operations.answerMode")}</span>
          <select
            data-testid="operations-answer-mode"
            className="h-9 rounded-md border border-input bg-surface-input px-3"
            value={form.answerMode}
            disabled={blocked}
            onChange={(event) =>
              change({ answerMode: event.target.value as ProjectRagConfigInput["answerMode"] })
            }
          >
            <option value="strict">{t("operations.answers.strict")}</option>
            <option value="open">{t("operations.answers.open")}</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block">{t("operations.storageBudget")}</span>
          <Input
            data-testid="operations-storage-budget"
            type="number"
            min={1}
            max={65536}
            value={(form.maxStorageBytes ?? PROJECT_RAG_DEFAULTS.maxStorageBytes) / 1024 ** 2}
            disabled={blocked}
            onChange={(event) =>
              change({ maxStorageBytes: Number(event.target.value) * 1024 ** 2 })
            }
          />
        </label>
        <Button data-testid="operations-save" disabled={blocked} onClick={() => void save()}>
          {t("operations.save")}
        </Button>
      </div>
      <p
        data-testid="operations-status"
        data-state={snapshot?.status ?? "unavailable"}
        aria-live="polite"
        className="text-sm"
      >
        {t("operations.status")}: {t(`operations.states.${snapshot?.status ?? "unavailable"}`)}
      </p>
      {snapshot?.reasons.map((reason) => (
        <p key={reason} className="text-sm text-amber-700 dark:text-amber-400">
          {t(`operations.reasons.${reason}`)}
        </p>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          data-testid="index-enable"
          disabled={blocked || !!enabled}
          onClick={() => void run(hostApi.knowledge.indexEnable)}
        >
          {t("operations.enable")}
        </Button>
        <Button
          data-testid="index-pause"
          variant="outline"
          disabled={blocked || !enabled || index?.status === "paused"}
          onClick={() => void run(hostApi.knowledge.indexPause)}
        >
          {t("operations.pause")}
        </Button>
        <Button
          data-testid="index-resume"
          variant="outline"
          disabled={blocked || index?.status !== "paused"}
          onClick={() => void run(hostApi.knowledge.indexResume)}
        >
          {t("operations.resume")}
        </Button>
        <Button
          data-testid="index-rebuild"
          variant="outline"
          disabled={blocked || !enabled || index?.status === "paused"}
          onClick={() => void run(hostApi.knowledge.indexRebuild)}
        >
          {t("operations.rebuild")}
        </Button>
        <Button
          data-testid="index-reconcile"
          variant="outline"
          disabled={blocked || !enabled}
          onClick={() => void run(hostApi.knowledge.indexReconcile)}
        >
          {t("operations.reconcile")}
        </Button>
        <Button
          data-testid="index-cleanup"
          variant="outline"
          disabled={blocked || !enabled || index?.status === "paused"}
          onClick={() => void run(hostApi.knowledge.indexCleanup)}
        >
          {t("operations.cleanup")}
        </Button>
        <Button
          data-testid="index-disable"
          variant="ghost"
          disabled={blocked || !enabled}
          onClick={() => void run(hostApi.knowledge.indexDisable)}
        >
          {t("operations.disable")}
        </Button>
      </div>
      {index && (
        <dl className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
          <div>
            <dt>{t("operations.generations")}</dt>
            <dd data-testid="index-generations">
              {index.sources.filter((source) => source.eligible && source.activeGeneration).length}
            </dd>
          </div>
          <div>
            <dt>{t("operations.lag")}</dt>
            <dd data-testid="index-lag">{index.lagCount}</dd>
          </div>
          <div>
            <dt>{t("operations.deleted")}</dt>
            <dd data-testid="index-deleted">{index.logicalDeletedCount}</dd>
          </div>
          <div>
            <dt>{t("operations.cleanupPending")}</dt>
            <dd data-testid="index-cleanup-pending">{index.cleanupPendingGenerations}</dd>
          </div>
          <div>
            <dt>{t("operations.storageUsed")}</dt>
            <dd data-testid="index-storage">
              {typeof index.storage.bytes === "number"
                ? (index.storage.bytes / 1024 ** 2).toFixed(2)
                : t("operations.states.unavailable")}
            </dd>
          </div>
        </dl>
      )}
      {restarting && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("operations.restarting")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {t("operations.failed")}
        </p>
      )}
    </section>
  );
}
