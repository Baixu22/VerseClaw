/** Shared persisted cron job envelope used by runtime and external config shapes. */
export type CronJobBase<TSchedule, TSessionTarget, TWakeMode, TPayload, TDelivery, TFailureAlert> =
  {
    id: string;
    agentId?: string;
    sessionKey?: string;
    name: string;
    description?: string;
    enabled: boolean;
    deleteAfterRun?: boolean;
    createdAtMs: number;
    updatedAtMs: number;
    schedule: TSchedule;
    sessionTarget: TSessionTarget;
    wakeMode: TWakeMode;
    payload: TPayload;
    delivery?: TDelivery;
    failureAlert?: TFailureAlert;
    /** Long-session coordinator generation fence for scheduled follow-ups. */
    coordinator?: {
      schemaVersion?: "CronCoordinatorScope/v1";
      workspaceId: string;
      coordinatorSessionKey: string;
      expectedSessionId: string;
      taskRef?: { kind: "task-ledger"; nodeId: string } | null;
      intent: "follow-up" | "check-in" | "status";
      expiresAtMs?: number | null;
      notificationPolicy: "silent-unless-result" | "errors-and-decisions";
    };
  };
