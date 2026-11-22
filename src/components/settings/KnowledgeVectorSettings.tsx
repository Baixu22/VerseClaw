import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { hostApi } from "@/lib/host-api";
import type { KnowledgeVectorStatus, KnowledgeVectorStatusResult } from "@shared/knowledge/vector";

export function KnowledgeVectorSettings() {
  const { t } = useTranslation("settings");
  const [backend, setBackend] = useState<"sqlite-flat" | "lancedb-ann">("sqlite-flat");
  const [status, setStatus] = useState<KnowledgeVectorStatus>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const edited = useRef(false);
  useEffect(() => {
    let active = true,
      pending = false;
    const poll = async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await hostApi.knowledge.vectorStatus();
        if (active) {
          if (result.success && result.vector) {
            setStatus(result.vector);
            if (!edited.current && result.vector.requestedBackend)
              setBackend(result.vector.requestedBackend);
          } else setStatus(undefined);
        }
      } catch {
        if (active) setStatus(undefined);
      } finally {
        pending = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);
  const run = async (operation: () => Promise<KnowledgeVectorStatusResult>) => {
    setBusy(true);
    try {
      const result = await operation();
      if (result.success && result.vector) {
        setStatus(result.vector);
        setError(undefined);
        edited.current = false;
      } else setError(result.error || t("vector.failed"));
    } catch {
      setError(t("vector.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      data-testid="knowledge-vector-settings"
      className="space-y-4 rounded-xl border border-border/60 bg-surface-modal p-5"
    >
      <div>
        <h2 className="font-serif text-xl font-normal tracking-tight">{t("vector.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("vector.description")}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <select
          aria-label={t("vector.backend")}
          data-testid="vector-backend"
          className="h-9 rounded-md border border-input bg-surface-input px-3"
          value={backend}
          disabled={busy || !status || status.indexing}
          onChange={(event) => {
            edited.current = true;
            setBackend(event.target.value as typeof backend);
          }}
        >
          <option value="sqlite-flat">{t("vector.portable")}</option>
          <option value="lancedb-ann">{t("vector.ann")}</option>
        </select>
        <Button
          data-testid="vector-configure"
          disabled={busy || !status || status.indexing}
          onClick={() => void run(() => hostApi.knowledge.vectorConfigure({ backend }))}
        >
          {t("vector.configure")}
        </Button>
        <Button
          data-testid="vector-rebuild"
          variant="outline"
          disabled={busy || !status?.generation || status.indexing}
          onClick={() => void run(() => hostApi.knowledge.vectorRebuild())}
        >
          {t("vector.rebuild")}
        </Button>
        <Button
          data-testid="vector-optimize"
          variant="outline"
          disabled={busy || !status?.generation || status.indexing}
          onClick={() => void run(() => hostApi.knowledge.vectorOptimize())}
        >
          {t("vector.optimize")}
        </Button>
        <Button
          data-testid="vector-disable"
          variant="ghost"
          disabled={busy || !status || status.status === "disabled"}
          onClick={() => void run(() => hostApi.knowledge.vectorDisable())}
        >
          {t("vector.disable")}
        </Button>
      </div>
      <p
        data-testid="vector-status"
        data-state={status?.status ?? "unavailable"}
        className="text-sm"
        aria-live="polite"
      >
        {t("vector.status")}: {t(`vector.states.${status?.status ?? "unavailable"}`)}
        {status?.generation && (
          <span className="ml-2 text-muted-foreground">
            {t(status.effectiveBackend === "lancedb-ann" ? "vector.ann" : "vector.portable")} ·{" "}
            {status.generation.rowCount}
          </span>
        )}
      </p>
      {status?.requestedBackend === "lancedb-ann" && !status.capability.available && (
        <p
          data-testid="vector-capability"
          role="status"
          className="text-sm text-amber-700 dark:text-amber-400"
        >
          {t("vector.nativeUnavailable")}
        </p>
      )}
      {(error || (status?.reason && status.status !== "ready")) && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error || t("vector.failed")}
        </p>
      )}
    </section>
  );
}
