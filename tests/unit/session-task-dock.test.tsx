import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { TaskSessionSnapshot, TaskView } from "../../shared/task-system/types";
import type { ChatRuntimeEvent } from "../../shared/chat-runtime-events";
import type { TaskId } from "../../shared/types/identity-scope";
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  command: vi.fn(),
  listeners: new Set<(e: ChatRuntimeEvent) => void>(),
}));
vi.mock("@/lib/host-api", () => ({
  hostApi: { taskLedger: { sessionTask: mocks.read, command: mocks.command } },
}));
vi.mock("@/lib/host-events", () => ({
  hostEvents: {
    onChatRuntimeEvent: (fn: (e: ChatRuntimeEvent) => void) => {
      mocks.listeners.add(fn);
      return () => mocks.listeners.delete(fn);
    },
  },
}));
vi.mock("@/components/assistant-ui/number-roll", () => ({
  NumberRoll: ({ value }: { value: number }) => <span>{value}</span>,
}));
import { SessionTaskDock } from "../../src/pages/Chat/SessionTaskDock";
const task = (id: string): TaskView => ({
  contract: {
    taskNodeId: id as TaskId,
    objective: `Deliver ${id}`,
    state: "doing",
    target: ".",
    constraints: [],
    acceptance: [],
    revision: 1,
    digest: "digest",
    domain: "domain",
    createdAt: 1,
    updatedAt: 1,
    origin: { source: "test", requestId: id },
  },
  claim: null,
  checkpoint: { nextAction: "Verify the result", completed: [], unresolved: [], artifacts: [] },
  pendingOperations: 0,
});
const result = (id: string) => ({ success: true as const, task: task(id), children: [] });
beforeEach(() => {
  localStorage.clear();
  mocks.read.mockReset();
  mocks.command.mockReset();
  mocks.listeners.clear();
  mocks.read.mockResolvedValue(result("a"));
});
afterEach(cleanup);
describe("quiet conversation task dock", () => {
  it("keeps a blank conversation free of task controls and performs no task lookup", () => {
    render(<SessionTaskDock workspaceId="w" sessionKey="a" hasConversation={false} />);
    expect(screen.queryByTestId("session-task-dock")).toBeNull();
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("reveals a collapsed task after owner resolution, hides without cancelling, and restores the preference", async () => {
    const props = { workspaceId: "w", sessionKey: "a", hasConversation: true };
    const { unmount } = render(<SessionTaskDock {...props} />);
    const plan = await screen.findByTestId("session-task-plan");
    expect(plan.querySelector("button")).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(plan.querySelector("button")!);
    expect(screen.getByTestId("session-task-details")).toHaveTextContent("Verify the result");
    fireEvent.click(screen.getByTestId("session-task-close"));
    expect(screen.queryByTestId("session-task-panel")).toBeNull();
    expect(mocks.command).not.toHaveBeenCalled();
    unmount();
    render(<SessionTaskDock {...props} />);
    await screen.findByTestId("session-task-reopen");
    fireEvent.click(screen.getByTestId("session-task-reopen"));
    expect(screen.getByTestId("session-task-panel")).toBeVisible();
  });
  it("ignores an old session response and preserves the new task when calls finish out of order", async () => {
    let resolveA!: (v: TaskSessionSnapshot & { success: true }) => void;
    mocks.read.mockImplementation(({ sessionKey }: { sessionKey: string }) =>
      sessionKey === "a"
        ? new Promise((resolve) => {
            resolveA = resolve;
          })
        : Promise.resolve(result("b")),
    );
    const { rerender } = render(<SessionTaskDock workspaceId="w" sessionKey="a" hasConversation />);
    rerender(<SessionTaskDock workspaceId="w" sessionKey="b" hasConversation />);
    await waitFor(() =>
      expect(screen.getByTestId("session-task-plan").querySelector("button")).toHaveTextContent(
        "Deliver b",
      ),
    );
    await act(async () => {
      resolveA(result("a"));
    });
    expect(screen.queryAllByText("Deliver a")).toHaveLength(0);
    expect(screen.getByTestId("session-task-plan").querySelector("button")).toHaveTextContent(
      "Deliver b",
    );
  });
  it("refreshes after the matching task tool completes, without reopening a hidden task", async () => {
    render(<SessionTaskDock workspaceId="w" sessionKey="a" hasConversation />);
    await screen.findByTestId("session-task-panel");
    fireEvent.click(screen.getByTestId("session-task-close"));
    const next = result("a");
    next.task.contract.state = "review";
    mocks.read.mockResolvedValue(next);
    act(() => {
      for (const fn of mocks.listeners) {
        fn({
          type: "tool.completed",
          name: "task_control",
          runId: "r",
          sessionKey: "other",
          toolCallId: "ignore",
        });
        fn({
          type: "tool.completed",
          name: "task_control",
          runId: "r",
          sessionKey: "a",
          toolCallId: "1",
        });
        fn({
          type: "tool.completed",
          name: "task_control",
          runId: "r",
          sessionKey: "a",
          toolCallId: "2",
        });
      }
    });
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("session-task-panel")).toBeNull();
    expect(screen.getByTestId("session-task-reopen")).toBeVisible();
  });
  it("keeps the last task marked stale when the owner is unavailable and recovers without changing ownership",async()=>{
    render(<SessionTaskDock workspaceId="w" sessionKey="a" hasConversation/>);
    await screen.findByTestId('session-task-panel');mocks.read.mockRejectedValue(new Error('offline'));
    fireEvent(window,new Event('focus'));
    await waitFor(()=>expect(screen.getByTestId('session-task-status')).toHaveTextContent('conversation.stale'));
    expect(screen.getByTestId('session-task-plan')).toHaveTextContent('Deliver a');
    fireEvent.click(screen.getByTestId('session-task-plan').querySelector('button')!);
    mocks.read.mockResolvedValue(result('a'));
    fireEvent.click(screen.getByTestId('session-task-details').querySelector('button')!);
    await waitFor(()=>expect(screen.getByTestId('session-task-status')).not.toHaveTextContent('conversation.stale'));
    expect(mocks.command).not.toHaveBeenCalled();
  });
  it("reveals a new task without inheriting the previous task's hidden preference",async()=>{
    render(<SessionTaskDock workspaceId="w" sessionKey="a" hasConversation/>);
    await screen.findByTestId('session-task-panel');fireEvent.click(screen.getByTestId('session-task-close'));
    mocks.read.mockResolvedValue(result('new-goal'));fireEvent(window,new Event('focus'));
    await waitFor(()=>expect(screen.getByTestId('session-task-panel')).toHaveTextContent('Deliver new-goal'));
    expect(screen.getByTestId('session-task-plan').querySelector('button')).toHaveAttribute('aria-expanded','false');
  });
});
