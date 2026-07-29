import { BlockList, isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import type { AgentBrowserService } from './agent-browser-service';
import type {
  AgentBrowserTask,
  AgentBrowserTaskCounters,
  AgentBrowserTaskExecutionResult,
  AgentBrowserTaskProgress,
  AgentBrowserTaskStep,
  AgentBrowserTaskVerification,
} from './agent-browser-task-service';

type BrowserTaskRuntime = Pick<
  AgentBrowserService,
  'openSupervised' | 'assertSupervisedRequestSafe' | 'navigate' | 'waitForSelector' | 'click' | 'evaluate' | 'close' | 'isEnabled' | 'setEnabled'
>;

type LookupAddress = { address: string; family: number };
export type BrowserTaskLookup = (hostname: string) => Promise<LookupAddress[]>;

export type AgentBrowserSupervisedTaskExecutorOptions = {
  service: BrowserTaskRuntime;
  assertSandboxAllowed: () => Promise<void>;
  lookupAddresses?: BrowserTaskLookup;
  now?: () => Date;
};

const PRIVATE_NETWORKS = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  PRIVATE_NETWORKS.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
] as const) {
  PRIVATE_NETWORKS.addSubnet(network, prefix, 'ipv6');
}

const LOCAL_HOSTNAME = /(?:^|\.)(?:localhost|local|internal|home\.arpa)$/i;
const SENSITIVE_QUERY_KEY = /^(?:access[_-]?token|api[_-]?key|authorization|auth|credential|key|password|secret|session|sig|signature|token)$/i;

export class AgentBrowserSupervisedTaskError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AgentBrowserSupervisedTaskError';
    this.code = code;
  }
}

function mappedIpv4(address: string): string | undefined {
  const normalized = address.toLowerCase();
  const dotted = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1];
  const hex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return undefined;
  const high = Number.parseInt(hex[1], 16);
  const low = Number.parseInt(hex[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

export function isPrivateBrowserTaskAddress(address: string): boolean {
  const mapped = mappedIpv4(address);
  if (mapped) return PRIVATE_NETWORKS.check(mapped, 'ipv4');
  const family = isIP(address);
  if (family === 4) return PRIVATE_NETWORKS.check(address, 'ipv4');
  if (family === 6) return PRIVATE_NETWORKS.check(address, 'ipv6');
  return true;
}

function hostnameMatchesAllowedDomain(hostname: string, allowedDomains: string[]): boolean {
  return allowedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

async function defaultLookupAddresses(hostname: string): Promise<LookupAddress[]> {
  return await lookup(hostname, { all: true, verbatim: true });
}

export async function assertPublicBrowserTaskUrl(
  value: string,
  allowedDomains: string[],
  lookupAddresses: BrowserTaskLookup = defaultLookupAddresses,
  options: { enforceApprovedDomains?: boolean } = {},
): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new AgentBrowserSupervisedTaskError('INVALID_TASK_URL', 'Browser task URL is invalid', { cause: error });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AgentBrowserSupervisedTaskError('INVALID_TASK_URL', 'Browser task URL must use http or https');
  }
  if (parsed.username || parsed.password) {
    throw new AgentBrowserSupervisedTaskError(
      'CREDENTIAL_IN_URL_DENIED',
      'Browser task URL credentials are denied; use the protected Vault',
    );
  }
  for (const key of parsed.searchParams.keys()) {
    if (SENSITIVE_QUERY_KEY.test(key)) {
      throw new AgentBrowserSupervisedTaskError(
        'CREDENTIAL_IN_URL_DENIED',
        `Sensitive URL query parameter is denied: ${key}`,
      );
    }
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (options.enforceApprovedDomains !== false && !hostnameMatchesAllowedDomain(hostname, allowedDomains)) {
    throw new AgentBrowserSupervisedTaskError(
      'DOMAIN_NOT_APPROVED',
      `Browser task target is outside the approved domains: ${hostname}`,
    );
  }
  if (!hostname.includes('.') || LOCAL_HOSTNAME.test(hostname)) {
    throw new AgentBrowserSupervisedTaskError(
      'PRIVATE_NETWORK_DENIED',
      `Browser task private or local target is denied: ${hostname}`,
    );
  }

  const literalFamily = isIP(hostname);
  let addresses: LookupAddress[];
  try {
    addresses = literalFamily
      ? [{ address: hostname, family: literalFamily }]
      : await lookupAddresses(hostname);
  } catch (error) {
    throw new AgentBrowserSupervisedTaskError(
      'DNS_LOOKUP_FAILED',
      `Browser task target could not be resolved: ${hostname}`,
      { cause: error },
    );
  }
  if (addresses.length === 0) {
    throw new AgentBrowserSupervisedTaskError('DNS_LOOKUP_FAILED', `Browser task target had no addresses: ${hostname}`);
  }
  if (addresses.some(({ address }) => isPrivateBrowserTaskAddress(address))) {
    throw new AgentBrowserSupervisedTaskError(
      'PRIVATE_NETWORK_DENIED',
      `Browser task target resolved to a private or special-use address: ${hostname}`,
    );
  }
  parsed.hash = '';
  return parsed.toString();
}

function countersFor(steps: AgentBrowserTaskStep[]): AgentBrowserTaskCounters {
  return {
    totalSteps: steps.length,
    passedSteps: steps.filter((step) => step.status === 'passed').length,
    failedSteps: steps.filter((step) => step.status === 'failed').length,
  };
}

function cloneSteps(steps: AgentBrowserTaskStep[]): AgentBrowserTaskStep[] {
  return steps.map((step) => ({ ...step }));
}

function verificationResult(
  task: AgentBrowserTask,
  status: AgentBrowserTaskVerification['status'],
  reasonCode: string,
  message: string,
  checkedAt: string,
): AgentBrowserTaskVerification {
  const criteria = task.successCriteria ?? { kind: 'text-includes' as const, value: '' };
  return { ...criteria, status, reasonCode, message, checkedAt };
}

export function createAgentBrowserSupervisedTaskExecutor(options: AgentBrowserSupervisedTaskExecutorOptions) {
  const now = options.now ?? (() => new Date());
  const lookupAddresses = options.lookupAddresses ?? defaultLookupAddresses;

  return async (
    task: AgentBrowserTask,
    signal: AbortSignal,
    report: (progress: AgentBrowserTaskProgress) => void,
  ): Promise<AgentBrowserTaskExecutionResult> => {
    if (task.approval.status !== 'consumed') {
      throw new AgentBrowserSupervisedTaskError('APPROVAL_REQUIRED', 'Browser task approval was not consumed for this run');
    }
    await options.assertSandboxAllowed();
    signal.throwIfAborted();

    const runtimeWasEnabled = options.service.isEnabled();
    if (!runtimeWasEnabled) options.service.setEnabled(true);
    let sessionId: string | undefined;
    let keepSession = false;
    const steps = cloneSteps(task.steps);
    const runId = task.runId ?? task.id;
    const reportProgress = () => report({
      steps: cloneSteps(steps),
      counters: countersFor(steps),
      ...(sessionId ? { sessionId } : {}),
      runId,
    });
    const assertActive = () => {
      signal.throwIfAborted();
      if (!options.service.isEnabled()) {
        throw new AgentBrowserSupervisedTaskError('RUNTIME_DISABLED', 'Browser control was disabled during task execution');
      }
    };
    const closeOnAbort = () => {
      if (!sessionId) return;
      try {
        options.service.close(sessionId);
      } catch {
        // The session may already be closed by a concurrent user action.
      }
    };
    signal.addEventListener('abort', closeOnAbort, { once: true });

    try {
      for (const [index, step] of steps.entries()) {
        assertActive();
        step.status = 'running';
        step.startedAt = now().toISOString();
        reportProgress();
        try {
          if (step.action === 'navigate') {
            const url = await assertPublicBrowserTaskUrl(step.url ?? '', task.allowedDomains, lookupAddresses);
            if (index === 0) {
              const opened = await options.service.openSupervised(
                { url, profile: task.profile, mode: task.mode },
                async (requestUrl, requestOptions) => {
                  await assertPublicBrowserTaskUrl(
                    requestUrl,
                    task.allowedDomains,
                    requestOptions.lookupAddresses ?? lookupAddresses,
                    { enforceApprovedDomains: requestOptions.enforceApprovedDomains },
                  );
                },
              );
              sessionId = opened.session.id;
              options.service.assertSupervisedRequestSafe(sessionId);
            } else {
              if (!sessionId) throw new AgentBrowserSupervisedTaskError('SESSION_MISSING', 'Browser task session is missing');
              await options.service.navigate({ sessionId, url, waitUntil: 'load' });
              options.service.assertSupervisedRequestSafe(sessionId);
            }
          } else if (step.action === 'wait-for-selector') {
            if (!sessionId) throw new AgentBrowserSupervisedTaskError('SESSION_MISSING', 'Browser task session is missing');
            await options.service.waitForSelector({
              sessionId,
              selector: step.selector ?? '',
              timeoutMs: step.timeoutMs,
            });
            options.service.assertSupervisedRequestSafe(sessionId);
          } else if (step.action === 'click') {
            if (!sessionId) throw new AgentBrowserSupervisedTaskError('SESSION_MISSING', 'Browser task session is missing');
            const session = await options.service.click({
              sessionId,
              selector: step.selector ?? '',
              timeoutMs: step.timeoutMs,
            });
            options.service.assertSupervisedRequestSafe(sessionId);
            if (session.url) {
              await assertPublicBrowserTaskUrl(session.url, task.allowedDomains, lookupAddresses);
            }
          }
          assertActive();
          step.status = 'passed';
          step.endedAt = now().toISOString();
          reportProgress();
        } catch (error) {
          const cancelled = signal.aborted;
          step.status = cancelled ? 'cancelled' : 'failed';
          step.endedAt = now().toISOString();
          step.errorCode = cancelled
            ? 'TASK_CANCELLED'
            : error instanceof AgentBrowserSupervisedTaskError ? error.code : 'STEP_FAILED';
          step.error = cancelled ? 'Browser task was cancelled' : error instanceof Error ? error.message : String(error);
          reportProgress();
          throw error;
        }
      }

      assertActive();
      const checkedAt = now().toISOString();
      let verification: AgentBrowserTaskVerification;
      if (!task.successCriteria) {
        verification = verificationResult(
          task,
          'failed',
          'SUCCESS_CRITERIA_MISSING',
          'Browser task did not define a success criterion',
          checkedAt,
        );
      } else if (!sessionId) {
        verification = verificationResult(task, 'failed', 'SESSION_MISSING', 'Browser task session is missing', checkedAt);
      } else if (task.successCriteria.kind === 'url-includes') {
        const session = await options.service.evaluate({ sessionId, expression: 'window.location.href' });
        assertActive();
        options.service.assertSupervisedRequestSafe(sessionId);
        const passed = typeof session.value === 'string' && session.value.includes(task.successCriteria.value);
        verification = verificationResult(
          task,
          passed ? 'passed' : 'failed',
          passed ? 'SUCCESS_CRITERIA_MET' : 'URL_CRITERIA_NOT_MET',
          passed ? 'Final URL matched the approved success criterion' : 'Final URL did not match the success criterion',
          checkedAt,
        );
      } else if (task.successCriteria.kind === 'text-includes') {
        const expression = `String(document.body?.innerText ?? '').includes(${JSON.stringify(task.successCriteria.value)})`;
        const result = await options.service.evaluate({ sessionId, expression });
        assertActive();
        options.service.assertSupervisedRequestSafe(sessionId);
        const passed = result.value === true;
        verification = verificationResult(
          task,
          passed ? 'passed' : 'failed',
          passed ? 'SUCCESS_CRITERIA_MET' : 'TEXT_CRITERIA_NOT_MET',
          passed ? 'Page text matched the approved success criterion' : 'Page text did not match the success criterion',
          checkedAt,
        );
      } else {
        try {
          await options.service.waitForSelector({
            sessionId,
            selector: task.successCriteria.value,
            timeoutMs: task.successCriteria.timeoutMs,
          });
          assertActive();
          options.service.assertSupervisedRequestSafe(sessionId);
          verification = verificationResult(
            task,
            'passed',
            'SUCCESS_CRITERIA_MET',
            'Success selector became visible',
            checkedAt,
          );
        } catch {
          signal.throwIfAborted();
          if (!options.service.isEnabled()) {
            throw new AgentBrowserSupervisedTaskError(
              'RUNTIME_DISABLED',
              'Browser control was disabled during task verification',
            );
          }
          options.service.assertSupervisedRequestSafe(sessionId);
          verification = verificationResult(
            task,
            'failed',
            'SELECTOR_CRITERIA_NOT_MET',
            'Success selector did not become visible',
            checkedAt,
          );
        }
      }
      keepSession = true;
      return {
        sessionId,
        runId,
        steps: cloneSteps(steps),
        verification,
        counters: countersFor(steps),
      };
    } finally {
      signal.removeEventListener('abort', closeOnAbort);
      if ((!keepSession || signal.aborted) && sessionId) closeOnAbort();
      if (!runtimeWasEnabled && options.service.isEnabled()) options.service.setEnabled(false);
    }
  };
}
