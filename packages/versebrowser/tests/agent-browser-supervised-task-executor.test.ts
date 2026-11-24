import { describe, expect, it, vi } from 'vitest';
import {
  AgentBrowserSupervisedTaskError,
  assertPublicBrowserTaskUrl,
  createAgentBrowserSupervisedTaskExecutor,
  isPrivateBrowserTaskAddress,
  type AgentBrowserSupervisedTaskExecutorOptions,
} from '../src/engine/supervised-task-executor';
import {
  AgentBrowserTaskService,
  type AgentBrowserTask,
} from '../src/engine/task-service';

function createRunningTask(overrides: Partial<AgentBrowserTask> = {}): AgentBrowserTask {
  const factory = new AgentBrowserTaskService({ execute: async () => { throw new Error('unused'); } });
  const created = factory.create({
    name: 'Inspect example',
    url: 'https://example.com',
    objective: 'Read and verify the example page',
    profile: 'default',
    mode: 'headless',
    steps: [
      { action: 'wait-for-selector', selector: 'h1' },
      { action: 'click', selector: 'a' },
    ],
    successCriteria: { kind: 'text-includes', value: 'Example Domain' },
  });
  return {
    ...created,
    ...overrides,
    status: 'running',
    runId: 'run-1',
    approval: { ...created.approval, status: 'consumed', consumedAt: created.updatedAt },
  };
}

function createRuntime() {
  let enabled = false;
  const runtime = {
    openSupervised: vi.fn(async (payload: { url?: string }, guard: (url: string, options: { enforceApprovedDomains: boolean }) => Promise<void>) => {
      await guard(payload.url ?? '', { enforceApprovedDomains: true });
      return { session: { id: 'session-1', url: 'https://example.com/' }, textSample: 'Example Domain' };
    }),
    assertSupervisedRequestSafe: vi.fn(),
    navigate: vi.fn(async ({ url }: { url: string }) => ({ id: 'session-1', url })),
    waitForSelector: vi.fn(async () => ({ id: 'session-1', url: 'https://example.com/' })),
    click: vi.fn(async () => ({ id: 'session-1', url: 'https://example.com/' })),
    evaluate: vi.fn(async () => ({ session: { id: 'session-1' }, value: true })),
    close: vi.fn(),
    isEnabled: vi.fn(() => enabled),
    setEnabled: vi.fn((value: boolean) => {
      enabled = value;
      return { enabled };
    }),
  };
  return runtime as unknown as AgentBrowserSupervisedTaskExecutorOptions['service'];
}

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

describe('agent browser supervised task network policy', () => {
  it('denies private, local, and special-use addresses', () => {
    expect(isPrivateBrowserTaskAddress('127.0.0.1')).toBe(true);
    expect(isPrivateBrowserTaskAddress('192.168.1.4')).toBe(true);
    expect(isPrivateBrowserTaskAddress('169.254.169.254')).toBe(true);
    expect(isPrivateBrowserTaskAddress('::1')).toBe(true);
    expect(isPrivateBrowserTaskAddress('fc00::1')).toBe(true);
    expect(isPrivateBrowserTaskAddress('93.184.216.34')).toBe(false);
  });

  it('denies DNS rebinding, unapproved domains, and URL credentials', async () => {
    await expect(assertPublicBrowserTaskUrl(
      'https://example.com',
      ['example.com'],
      async () => [{ address: '10.0.0.8', family: 4 }],
    )).rejects.toMatchObject({ code: 'PRIVATE_NETWORK_DENIED' });
    await expect(assertPublicBrowserTaskUrl(
      'https://other.example.net',
      ['example.com'],
      publicLookup,
    )).rejects.toMatchObject({ code: 'DOMAIN_NOT_APPROVED' });
    await expect(assertPublicBrowserTaskUrl(
      'https://user:secret@example.com',
      ['example.com'],
      publicLookup,
    )).rejects.toMatchObject({ code: 'CREDENTIAL_IN_URL_DENIED' });
    await expect(assertPublicBrowserTaskUrl(
      'https://example.com/?token=secret',
      ['example.com'],
      publicLookup,
    )).rejects.toMatchObject({ code: 'CREDENTIAL_IN_URL_DENIED' });
    // C96/TF-0123: the anchored list missed the network-alias and field-family names.
    for (const key of ['private_key', 'cookie', 'csrf', 'xsrf', 'passwd', 'auth_token', 'otp', 'pin']) {
      await expect(assertPublicBrowserTaskUrl(
        `https://example.com/?${key}=secret`,
        ['example.com'],
        publicLookup,
      ), key).rejects.toMatchObject({ code: 'CREDENTIAL_IN_URL_DENIED' });
    }
    // An ordinary query parameter is still accepted (no over-refusal).
    await expect(assertPublicBrowserTaskUrl(
      'https://example.com/items?page=2&q=hello',
      ['example.com'],
      publicLookup,
    )).resolves.toContain('page=2');
  });

  it('accepts public addresses inside the approved domain set', async () => {
    await expect(assertPublicBrowserTaskUrl(
      'https://docs.example.com/guide#start',
      ['example.com'],
      publicLookup,
    )).resolves.toBe('https://docs.example.com/guide');
    await expect(assertPublicBrowserTaskUrl(
      'https://cdn.example.net/app.js',
      ['example.com'],
      publicLookup,
      { enforceApprovedDomains: false },
    )).resolves.toBe('https://cdn.example.net/app.js');
  });
});

describe('agent browser supervised task executor', () => {
  it('keeps the shared runtime enabled until a retry finishes after the old close settles', async () => {
    const service = createRuntime();
    const firstController = new AbortController();
    const steps: Array<() => void> = [];
    let releaseClose!: () => void;
    vi.mocked(service.waitForSelector).mockImplementation(async () => {
      await new Promise<void>(resolve => steps.push(resolve));
      return { id: 'session-1' } as never;
    });
    vi.mocked(service.close).mockImplementationOnce(() => new Promise<void>(resolve => { releaseClose = resolve; }));
    const execute = createAgentBrowserSupervisedTaskExecutor({ service, assertSandboxAllowed: async () => {}, lookupAddresses: publicLookup });
    const first = execute(createRunningTask(), firstController.signal, () => {}).catch(error => error);
    await vi.waitFor(() => expect(steps).toHaveLength(1));
    firstController.abort();
    steps[0]();
    await vi.waitFor(() => expect(releaseClose).toBeTypeOf('function'));
    const second = execute({ ...createRunningTask(), runId: 'run-2' }, new AbortController().signal, () => {});
    await vi.waitFor(() => expect(steps).toHaveLength(2));
    try {
      releaseClose();
      expect(await first).toBeInstanceOf(Error);
      expect(service.isEnabled()).toBe(true);
    } finally { steps[1](); }
    expect((await second).verification.status).toBe('passed');
    expect(service.isEnabled()).toBe(false);
    expect(service.setEnabled).toHaveBeenCalledTimes(2);
  });

  it('awaits one asynchronous owner cleanup before completing cancellation', async () => {
    const service=createRuntime();const controller=new AbortController();
    let releaseStep!:()=>void, releaseClose!:()=>void;
    vi.mocked(service.waitForSelector).mockImplementationOnce(async ()=>{await new Promise<void>(resolve=>{releaseStep=resolve;});return {id:'session-1'} as never;});
    vi.mocked(service.close).mockImplementationOnce(()=>new Promise<void>(resolve=>{releaseClose=resolve;}));
    const execute=createAgentBrowserSupervisedTaskExecutor({service,assertSandboxAllowed:async()=>{},lookupAddresses:publicLookup});
    let settled=false;
    const run=execute(createRunningTask(),controller.signal,()=>{}).catch(error=>error).finally(()=>{settled=true;});
    await vi.waitFor(()=>expect(service.waitForSelector).toHaveBeenCalledOnce());
    controller.abort();releaseStep();
    await vi.waitFor(()=>expect(service.close).toHaveBeenCalledOnce());
    expect(settled).toBe(false);releaseClose();
    expect(await run).toBeInstanceOf(Error);expect(service.close).toHaveBeenCalledOnce();
  });
  it('executes ordered steps and verifies success with progress counters', async () => {
    const service = createRuntime();
    const reports: unknown[] = [];
    const execute = createAgentBrowserSupervisedTaskExecutor({
      service,
      assertSandboxAllowed: vi.fn(async () => undefined),
      lookupAddresses: publicLookup,
    });

    const result = await execute(createRunningTask(), new AbortController().signal, (progress) => reports.push(progress));

    expect(service.setEnabled).toHaveBeenNthCalledWith(1, true);
    expect(service.setEnabled).toHaveBeenLastCalledWith(false);
    expect(service.openSupervised).toHaveBeenCalledOnce();
    expect(service.waitForSelector).toHaveBeenCalledWith(expect.objectContaining({ selector: 'h1' }));
    expect(service.click).toHaveBeenCalledWith(expect.objectContaining({ selector: 'a' }));
    expect(result.verification).toMatchObject({ status: 'passed', reasonCode: 'SUCCESS_CRITERIA_MET' });
    expect(result.counters).toEqual({ totalSteps: 3, passedSteps: 3, failedSteps: 0 });
    expect(reports.length).toBeGreaterThanOrEqual(6);
  });

  it('returns an explainable verification failure instead of completing on navigation alone', async () => {
    const service = createRuntime();
    vi.mocked(service.evaluate).mockResolvedValue({ session: { id: 'session-1' }, value: false } as never);
    const execute = createAgentBrowserSupervisedTaskExecutor({
      service,
      assertSandboxAllowed: async () => undefined,
      lookupAddresses: publicLookup,
    });

    const result = await execute(createRunningTask(), new AbortController().signal, () => undefined);

    expect(result.verification).toMatchObject({ status: 'failed', reasonCode: 'TEXT_CRITERIA_NOT_MET' });
  });

  it('fails closed when the request guard blocks traffic during success verification', async () => {
    const service = createRuntime();
    let waitCount = 0;
    vi.mocked(service.waitForSelector).mockImplementation(async () => {
      waitCount += 1;
      if (waitCount === 2) {
        vi.mocked(service.assertSupervisedRequestSafe).mockImplementation(() => {
          throw new AgentBrowserSupervisedTaskError(
            'PRIVATE_NETWORK_DENIED',
            'Browser task verification triggered a private-network request',
          );
        });
      }
      return { id: 'session-1', url: 'https://example.com/' } as never;
    });
    const execute = createAgentBrowserSupervisedTaskExecutor({
      service,
      assertSandboxAllowed: async () => undefined,
      lookupAddresses: publicLookup,
    });

    await expect(execute(createRunningTask({
      successCriteria: { kind: 'selector-visible', value: '#complete' },
    }), new AbortController().signal, () => undefined))
      .rejects.toMatchObject({ code: 'PRIVATE_NETWORK_DENIED' });
  });

  it('fails before opening a session when the target resolves private', async () => {
    const service = createRuntime();
    const execute = createAgentBrowserSupervisedTaskExecutor({
      service,
      assertSandboxAllowed: async () => undefined,
      lookupAddresses: async () => [{ address: '127.0.0.1', family: 4 }],
    });

    await expect(execute(createRunningTask(), new AbortController().signal, () => undefined))
      .rejects.toMatchObject({ code: 'PRIVATE_NETWORK_DENIED' });
    expect(service.openSupervised).not.toHaveBeenCalled();
  });

  it('closes the session and skips verification when cancelled during a step', async () => {
    const service = createRuntime();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(service.waitForSelector).mockImplementation(async () => {
      await gate;
      return { id: 'session-1', url: 'https://example.com/' } as never;
    });
    const controller = new AbortController();
    const execute = createAgentBrowserSupervisedTaskExecutor({
      service,
      assertSandboxAllowed: async () => undefined,
      lookupAddresses: publicLookup,
    });

    const running = execute(createRunningTask(), controller.signal, () => undefined);
    await vi.waitUntil(() => vi.mocked(service.waitForSelector).mock.calls.length === 1);
    controller.abort();
    release();

    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(service.close).toHaveBeenCalledWith('session-1');
    expect(service.evaluate).not.toHaveBeenCalled();
  });

  it('completes 20 sequential synthetic public runs with a fresh approval each time', async () => {
    const runtime = createRuntime();
    const execute = createAgentBrowserSupervisedTaskExecutor({
      service: runtime,
      assertSandboxAllowed: async () => undefined,
      lookupAddresses: publicLookup,
    });
    const tasks = new AgentBrowserTaskService({ execute });

    for (let index = 0; index < 20; index += 1) {
      const created = tasks.create({
        name: `Synthetic public run ${index + 1}`,
        url: 'https://example.com',
        objective: 'Verify the synthetic public page fixture',
        profile: 'default',
        mode: 'headless',
        steps: [{ action: 'wait-for-selector', selector: 'h1' }],
        successCriteria: { kind: 'text-includes', value: 'Example Domain' },
      });
      expect(created).toMatchObject({
        status: 'waiting-approval',
        approval: { status: 'pending' },
      });

      const completed = await tasks.approveAndRun(created.id);
      expect(completed).toMatchObject({
        status: 'completed',
        approval: { status: 'consumed' },
        verification: { status: 'passed', reasonCode: 'SUCCESS_CRITERIA_MET' },
        counters: { totalSteps: 2, passedSteps: 2, failedSteps: 0 },
      });
    }

    expect(runtime.openSupervised).toHaveBeenCalledTimes(20);
    expect(runtime.setEnabled).toHaveBeenCalledTimes(40);
  });

  /**
   * The step loop had no final else, so a step whose action matched none of navigate /
   * wait-for-selector / click fell straight through to `step.status = 'passed'` - a typo'd action
   * was recorded as a successful no-op and the task could still complete. Fail closed instead.
   */
  it('fails an unknown step action instead of recording it as a passed no-op', async () => {
    const service = createRuntime();
    const execute = createAgentBrowserSupervisedTaskExecutor({
      service,
      assertSandboxAllowed: async () => undefined,
      lookupAddresses: publicLookup,
    });

    await expect(execute(createRunningTask({
      steps: [
        { id: 'step-1', action: 'navigate', url: 'https://example.com', status: 'pending' },
        { id: 'step-2', action: 'clic' as never, selector: '#a', status: 'pending' },
      ],
    }), new AbortController().signal, () => undefined))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_STEP_ACTION' });
  });
});
