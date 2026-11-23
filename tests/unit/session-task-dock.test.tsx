import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { TaskSessionSnapshot, TaskView } from "../../shared/task-system/types";
import type { ChatRuntimeEvent } from "../../shared/chat-runtime-events";
import type { TaskId } from "../../shared/types/identity-scope";
import type { RunPlanSurface } from "../../src/pages/Chat/run-surface-promotion";
import taskLedgerEn from "../../shared/i18n/locales/en/taskLedger.json";
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  command: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
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
vi.mock("sonner", () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }));
vi.mock("@/components/assistant-ui/number-roll", () => ({
  NumberRoll: ({ value }: { value: number }) => <span>{value}</span>,
}));
import { SessionTaskDock, shortTaskId } from "../../src/pages/Chat/SessionTaskDock";
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
const result = (id: string) => ({ success: true as const, task: task(id), children: [] as TaskView[] });
const openMenu = () => fireEvent.click(screen.getByTestId("session-task-menu"));
beforeEach(() => {
  localStorage.clear();
  mocks.read.mockReset();
  mocks.command.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
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
  it("docks beside the composer, collapsed to the current step, and hides from its menu without cancelling", async () => {
    const props = { workspaceId: "w", sessionKey: "a", hasConversation: true };
    const { unmount } = render(<SessionTaskDock {...props} />);
    const plan = await screen.findByTestId("session-task-plan");
    expect(screen.getByTestId("session-task-dock")).toHaveAttribute("data-placement", "composer");
    expect(plan.querySelector("button")).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("session-task-current")).toHaveTextContent("Verify the result");
    fireEvent.click(plan.querySelector("button")!);
    expect(screen.getByTestId("session-task-details")).toHaveTextContent("Verify the result");
    expect(screen.queryByTestId("session-task-current")).toBeNull();
    openMenu();
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
    openMenu();
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
    await waitFor(()=>expect(screen.getByTestId('session-task-status')).toHaveTextContent(taskLedgerEn.conversation.stale));
    expect(screen.getByTestId('session-task-plan')).toHaveTextContent('Deliver a');
    fireEvent.click(screen.getByTestId('session-task-plan').querySelector('button')!);
    mocks.read.mockResolvedValue(result('a'));
    fireEvent.click(screen.getByRole('button',{name:taskLedgerEn.conversation.refresh}));
    await waitFor(()=>expect(screen.getByTestId('session-task-status')).not.toHaveTextContent(taskLedgerEn.conversation.stale));
    expect(mocks.command).not.toHaveBeenCalled();
  });
  it("reveals a new task without inheriting the previous task's hidden preference",async()=>{
    render(<SessionTaskDock workspaceId="w" sessionKey="a" hasConversation/>);
    await screen.findByTestId('session-task-panel');openMenu();fireEvent.click(screen.getByTestId('session-task-close'));
    mocks.read.mockResolvedValue(result('new-goal'));fireEvent(window,new Event('focus'));
    await waitFor(()=>expect(screen.getByTestId('session-task-panel')).toHaveTextContent('Deliver new-goal'));
    expect(screen.getByTestId('session-task-plan').querySelector('button')).toHaveAttribute('aria-expanded','false');
  });
  it('shows the goal once and uses checkpoint facts as steps without inventing a percentage',async()=>{
    render(<SessionTaskDock workspaceId="w" sessionKey="a" hasConversation/>);
    const title=await screen.findByTestId('session-task-title');expect(title).toHaveTextContent('Deliver a');
    expect(screen.getAllByText('Deliver a')).toHaveLength(1);
    expect(screen.queryByRole('progressbar')).toBeNull();
    fireEvent.click(screen.getByTestId('session-task-plan').querySelector('button')!);
    expect(screen.getByTestId('session-task-steps')).toHaveTextContent('Verify the result');
    expect(screen.getAllByText('Deliver a')).toHaveLength(1);
  });
  it('derives progress from known child tasks and retains the parent acceptance state',async()=>{
    const first=task('first');first.contract.state='done';
    const second=task('second');second.contract.state='doing';
    mocks.read.mockResolvedValue({...result('parent'),children:[first,second]});
    render(<SessionTaskDock workspaceId="w" sessionKey="a" hasConversation/>);
    expect(await screen.findByRole('progressbar')).toHaveAttribute('aria-valuenow','50');
    expect(screen.getByTestId('session-task-status')).toHaveTextContent(taskLedgerEn.conversation.states.doing);
    expect(screen.getByTestId('session-task-status')).toHaveTextContent('1/2');
  });
});

describe("task handles", () => {
  const uuid = "3f9a2c71-5b0e-4d2a-9c11-8e4b6a7d0f21";
  it("shortens UUIDs like a commit and keeps short owner IDs whole", () => {
    expect(shortTaskId(uuid)).toBe("3f9a2c71");
    expect(shortTaskId("TF-0042")).toBe("TF-0042");
    expect(shortTaskId("a-very-long-custom-task-id")).toBe("a-very-lon…");
  });
  it("copies the full task ID from its menu without showing IDs in the task strip", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    mocks.read.mockResolvedValue(result(uuid));
    render(<SessionTaskDock workspaceId="w" sessionKey="a" hasConversation />);
    await screen.findByTestId('session-task-panel');
    fireEvent.click(screen.getByTestId('session-task-title').closest('button')!);
    expect(screen.queryByTestId('session-task-id')).toBeNull();
    openMenu();
    const copy = screen.getByTestId('session-task-menu-copy');
    expect(copy).toHaveTextContent(`#${uuid.slice(0, 8)}`);
    expect(copy).toHaveAttribute('title', uuid);
    fireEvent.click(copy);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(uuid));
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith(taskLedgerEn.conversation.idCopied.replace('{{id}}', shortTaskId(uuid))));
  });
  it("reports a copy failure instead of claiming success", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    mocks.read.mockResolvedValue(result(uuid));
    render(<SessionTaskDock workspaceId="w" sessionKey="a" hasConversation />);
    await screen.findByTestId('session-task-panel');
    openMenu();
    fireEvent.click(screen.getByTestId('session-task-menu-copy'));
    expect(mocks.toastError).toHaveBeenCalledWith(taskLedgerEn.conversation.copyFailed);
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });
  it("opens the task and each child task in the ledger by their own IDs", async () => {
    const onOpenTask = vi.fn();
    const child = task("child-1");
    mocks.read.mockResolvedValue({ ...result(uuid), children: [child] });
    render(<SessionTaskDock workspaceId="w" sessionKey="a" hasConversation onOpenTask={onOpenTask} />);
    await screen.findByTestId("session-task-panel");
    openMenu();
    fireEvent.click(screen.getByTestId("session-task-menu-open"));
    expect(onOpenTask).toHaveBeenLastCalledWith(uuid);
    fireEvent.click(screen.getByTestId("session-task-plan").querySelector("button")!);
    const steps = screen.getByTestId("session-task-steps");
    fireEvent.click(within(steps).getByTestId("session-task-step-open-child-1"));
    expect(onOpenTask).toHaveBeenLastCalledWith("child-1");
    fireEvent.click(screen.getByTestId("session-task-open-ledger"));
    expect(onOpenTask).toHaveBeenLastCalledWith(uuid);
  });
  it("offers no ID or ledger actions for a run plan that has no durable task", async () => {
    mocks.read.mockResolvedValue({ success: true, task: null, children: [] });
    const plan: RunPlanSurface = { id: "p1", todos: [
      { id: "1", label: "Read", status: "completed" },
      { id: "2", label: "Edit", status: "in_progress" },
    ] };
    render(<SessionTaskDock workspaceId="w" sessionKey="a" hasConversation plan={plan} runActive onOpenTask={vi.fn()} />);
    await screen.findByTestId("session-task-panel");
    expect(screen.getByTestId("session-task-title")).toHaveTextContent(taskLedgerEn.conversation.plan);
    expect(screen.queryByTestId("session-task-id")).toBeNull();
    openMenu();
    expect(screen.queryByTestId("session-task-menu-copy")).toBeNull();
    expect(screen.queryByTestId("session-task-menu-open")).toBeNull();
    expect(screen.getByTestId("session-task-close")).toBeInTheDocument();
  });
  it("supports arrow keys and Escape in the menu, returning focus to its trigger", async () => {
    render(<SessionTaskDock workspaceId="w" sessionKey="a" hasConversation />);
    await screen.findByTestId("session-task-panel");
    const trigger = screen.getByTestId("session-task-menu");
    fireEvent.click(trigger);
    const list = screen.getByTestId("session-task-menu-list");
    // The layer is measured on the next frame before it becomes visible.
    const items = await waitFor(() => within(list).getAllByRole("menuitem"));
    items[0].focus();
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(list, { key: "End" });
    expect(document.activeElement).toBe(items[items.length - 1]);
    fireEvent.keyDown(list, { key: "Escape" });
    expect(screen.queryByTestId("session-task-menu-list")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe("dock lifetime", () => {
  const plan = (statuses: Array<"completed" | "in_progress" | "pending">): RunPlanSurface => ({
    id: "plan-1",
    todos: statuses.map((status, index) => ({ id: String(index), label: `Step ${index}`, status })),
  });
  beforeEach(() => mocks.read.mockResolvedValue({ success: true, task: null, children: [] }));
  it("retires an incomplete run plan when its run ends", async () => {
    const { rerender } = render(<SessionTaskDock workspaceId="w" sessionKey="a" hasConversation plan={plan(["completed", "in_progress"])} runActive />);
    expect(await screen.findByTestId("session-task-panel")).toBeVisible();
    rerender(<SessionTaskDock workspaceId="w" sessionKey="a" hasConversation plan={plan(["completed", "in_progress"])} runActive={false} />);
    expect(screen.queryByTestId("session-task-panel")).toBeNull();
  });
  it("keeps a finished plan active until its run settles, then leaves the transcript record", async () => {
    const { rerender } = render(
      <SessionTaskDock workspaceId="w" sessionKey="a" hasConversation plan={plan(["completed", "completed"])} runActive />,
    );
    expect(await screen.findByTestId("session-task-dock")).toHaveAttribute("data-state", "doing");
    expect(screen.getByTestId("session-task-run-finished")).toHaveTextContent(taskLedgerEn.conversation.runStepsComplete);
    expect(screen.queryByTestId("session-task-current")).toBeNull();
    rerender(<SessionTaskDock workspaceId="w" sessionKey="a" hasConversation plan={plan(["completed", "completed"])} runActive={false} />);
    expect(screen.queryByTestId("session-task-dock")).toBeNull();
  });
  it("folds a finished durable task to a one-line receipt instead of removing its ID", async () => {
    const done = result("finished");
    done.task.contract.state = "done";
    mocks.read.mockResolvedValue(done);
    render(<SessionTaskDock workspaceId="w" sessionKey="a" hasConversation />);
    expect(await screen.findByTestId("session-task-status")).toHaveTextContent(taskLedgerEn.conversation.states.done);
    expect(screen.queryByTestId("session-task-id")).toBeNull();
    openMenu();
    expect(screen.getByTestId('session-task-menu-copy')).toBeInTheDocument();
    expect(screen.queryByTestId("session-task-current")).toBeNull();
    expect(screen.queryByTestId("session-task-details")).toBeNull();
  });
});

describe('live run and durable task scales', () => {
  it('shows current run steps under the durable objective and restores durable steps after the run', async () => {
    const root = result('durable-goal');
    const child = task('durable-child');
    mocks.read.mockResolvedValue({ ...root, children: [child] });
    const plan: RunPlanSurface = { id: 'live-plan', todos: [
      { id: 'read', label: 'Read current files', status: 'completed' },
      { id: 'verify', label: 'Verify the live patch', status: 'in_progress' },
    ] };
    const { rerender } = render(<SessionTaskDock workspaceId="w" sessionKey="a" hasConversation plan={plan} runActive />);
    await waitFor(() => expect(screen.getByTestId('session-task-title')).toHaveTextContent(root.task.contract.objective));
    expect(screen.getByTestId('session-task-current')).toHaveTextContent('Verify the live patch');
    fireEvent.click(screen.getByTestId('session-task-title').closest('button')!);
    expect(screen.getByTestId('session-task-step-label')).toHaveTextContent(taskLedgerEn.conversation.runSteps);
    expect(screen.getByTestId('session-task-steps')).toHaveTextContent('Verify the live patch');
    const finishedPlan = { ...plan, todos: plan.todos.map(todo => ({ ...todo, status: 'completed' as const })) };
    rerender(<SessionTaskDock workspaceId="w" sessionKey="a" hasConversation plan={finishedPlan} runActive />);
    expect(screen.getByTestId('session-task-dock')).toHaveAttribute('data-state', 'doing');
    expect(screen.getByTestId('session-task-status')).toHaveTextContent(taskLedgerEn.conversation.states.doing);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    rerender(<SessionTaskDock workspaceId="w" sessionKey="a" hasConversation plan={finishedPlan} runActive={false} />);
    expect(screen.getByTestId('session-task-steps')).toHaveTextContent(child.contract.objective);
    expect(screen.queryByText('Verify the live patch')).toBeNull();
  });

  it('folds an accepted task once and permits opening the receipt again', async () => {
    mocks.read.mockResolvedValue(result('owner-task'));
    render(<SessionTaskDock workspaceId="w" sessionKey="a" hasConversation />);
    await screen.findByTestId('session-task-title');
    fireEvent.click(screen.getByTestId('session-task-title').closest('button')!);
    const accepted = result('owner-task'); accepted.task.contract.state = 'done';
    mocks.read.mockResolvedValue(accepted);
    fireEvent(window, new Event('focus'));
    await waitFor(() => expect(screen.getByTestId('session-task-dock')).toHaveAttribute('data-state', 'done'));
    expect(screen.queryByTestId('session-task-details')).toBeNull();
    fireEvent.click(screen.getByTestId('session-task-title').closest('button')!);
    expect(screen.getByTestId('session-task-details')).toBeInTheDocument();
  });

  it('reveals a stale status and retry action even when its healthy display was hidden', async () => {
    mocks.read.mockResolvedValue(result('owner-task'));
    render(<SessionTaskDock workspaceId="w" sessionKey="a" hasConversation />);
    await screen.findByTestId('session-task-title');
    openMenu(); fireEvent.click(screen.getByTestId('session-task-close'));
    mocks.read.mockRejectedValue(new Error('owner read unavailable'));
    fireEvent(window, new Event('focus'));
    expect(await screen.findByTestId('session-task-retry')).toBeVisible();
    expect(screen.getByTestId('session-task-status')).toHaveTextContent(taskLedgerEn.conversation.stale);
  });
});
