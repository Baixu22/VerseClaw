// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskTracePanel } from "@/components/task-ledger/TaskTracePanel";
import type { TaskTraceReport } from "@shared/task-system/trace";
import type { TaskId } from "@shared/types/identity-scope";
import labels from "@shared/i18n/locales/en/taskLedger.json";

const mock = vi.hoisted(() => ({ trace: vi.fn() }));
vi.mock("@/lib/host-api", () => ({ hostApi: { taskLedger: { trace: mock.trace } } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (key: string, values?: Record<string, unknown>) => {
      const source = key
        .split(".")
        .reduce(
          (value, part) =>
            value && typeof value === "object"
              ? (value as Record<string, unknown>)[part]
              : undefined,
          labels as unknown,
        );
      return typeof source === "string"
        ? source.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? ""))
        : key;
    },
  }),
}));

function report(id = "task-a"): TaskTraceReport {
  return {
    schemaVersion: 1,
    authorityId: "authority-a",
    generatedAt: 1,
    status: "current",
    task: {
      contract: {
        taskNodeId: id as TaskId,
        objective: `Result ${id}`,
        target: "result.txt",
        constraints: [],
        acceptance: [],
        origin: { source: "host", requestId: "request" },
        domain: "authority-a",
        revision: 1,
        digest: "a".repeat(64),
        state: "done",
        createdAt: 1,
        updatedAt: 1,
      },
      claim: null,
      checkpoint: null,
      pendingOperations: 0,
    },
    ancestors: [],
    revisions: [],
    claims: [],
    runs: [],
    operations: [],
    delegations: [],
    candidates: [],
    checks: [],
    costs: {
      scope: "task-subtree",
      state: "unknown",
      totalUsd: null,
      knownSubtotalUsd: 0,
      totalTokens: null,
      knownTokens: 0,
      calls: 0,
      unknownCalls: 0,
      duplicateObservations: 0,
      records: [],
    },
    phases: {
      queue: { durationMs: null, intervals: [] },
      execution: { durationMs: null, intervals: [] },
      verification: { durationMs: null, intervals: [] },
      recovery: { durationMs: null, intervals: [] },
    },
    cleanup: [],
    diagnostics: [],
    events: [],
  };
}
async function openReport() {
  const details = screen.getByTestId("task-trace-panel") as HTMLDetailsElement;
  await act(async () => {
    details.open = true;
    fireEvent(details, new Event("toggle"));
  });
}
beforeEach(() => mock.trace.mockReset());

describe("task report UI", () => {
  it("reads on expansion, preserves unknown amounts and avoids duplicate reads on collapse", async () => {
    mock.trace.mockResolvedValue({ success: true, report: report() });
    render(
      <TaskTracePanel
        workspaceId="workspace-a"
        taskNodeId="task-a"
        revision={1}
        digest={"a".repeat(64)}
      />,
    );
    expect(mock.trace).not.toHaveBeenCalled();
    await openReport();
    await waitFor(() => expect(screen.getByTestId("task-trace-cost")).toHaveTextContent("Unknown"));
    expect(mock.trace).toHaveBeenCalledWith({
      workspaceId: "workspace-a",
      taskNodeId: "task-a",
      revision: 1,
      digest: "a".repeat(64),
    });
    const details = screen.getByTestId("task-trace-panel") as HTMLDetailsElement;
    await act(async () => {
      details.open = false;
      fireEvent(details, new Event("toggle"));
      details.open = true;
      fireEvent(details, new Event("toggle"));
    });
    expect(mock.trace).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("task-trace-cost")).not.toHaveTextContent("USD 0");
  });
  it("discards delayed replies after changing the task scope", async () => {
    let settle!: (value: { success: boolean; report: TaskTraceReport }) => void;
    mock.trace
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            settle = resolve;
          }),
      )
      .mockResolvedValueOnce({ success: true, report: report("task-b") });
    const view = render(
      <TaskTracePanel workspaceId="workspace-a" taskNodeId="task-a" defaultOpen />,
    );
    await waitFor(() => expect(mock.trace).toHaveBeenCalledTimes(1));
    view.rerender(<TaskTracePanel workspaceId="workspace-b" taskNodeId="task-b" defaultOpen />);
    await waitFor(() => expect(screen.getByText("Result task-b")).toBeInTheDocument());
    await act(async () => settle({ success: true, report: report() }));
    expect(screen.queryByText("Result task-a")).not.toBeInTheDocument();
    expect(screen.getByText("Result task-b")).toBeInTheDocument();
  });
  it("rejects a mismatched report identity and allows an explicit retry", async () => {
    mock.trace
      .mockResolvedValueOnce({ success: true, report: report("foreign-task") })
      .mockResolvedValueOnce({ success: true, report: report() });
    render(<TaskTracePanel workspaceId="workspace-a" taskNodeId="task-a" defaultOpen />);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(labels.trace.unavailable),
    );
    expect(screen.queryByText("Result foreign-task")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: labels.actions.refresh }));
    await waitFor(() => expect(screen.getByText("Result task-a")).toBeInTheDocument());
  });
});
