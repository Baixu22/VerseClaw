import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import {
  type HostApiContribution,
  type HostResponse,
  type HostServiceRegistry,
  type RuntimeHostAction,
  isHostRequest,
} from './host-contract';
import {
  assertAuthorizedHostSender,
  sanitizeHostErrorMessage,
  validateHostPayload,
  type HostSenderAuthorization,
  type IpcEventLike,
} from './host-invoke-security';
import { hostActionTimeoutMs } from '@shared/host-api/host-action-timeouts';

class HostActionTimeoutError extends Error {
  constructor(moduleName: string, actionName: string, timeoutMs: number) {
    super(`Host action ${moduleName}.${actionName} timed out after ${Math.round(timeoutMs / 1000)}s`);
    this.name = 'HostActionTimeoutError';
  }
}

async function withHostActionTimeout<T>(
  promise: Promise<T>,
  moduleName: string,
  actionName: string,
): Promise<T> {
  const timeoutMs = hostActionTimeoutMs(moduleName, actionName);
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new HostActionTimeoutError(moduleName, actionName, timeoutMs)), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type RegisteredHostAction = {
  action: RuntimeHostAction;
  ownerId: string;
};

export type HostInvokeDispatcherOptions = {
  senderAuth?: HostSenderAuthorization;
  /** When true, require an IPC event with authorized sender (production default). */
  requireSender?: boolean;
};

function assertValidContributionKey(kind: 'module' | 'action', value: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(value)) {
    throw new Error(`Invalid host API ${kind}: ${value}`);
  }
}

export class HostApiRegistry {
  private modules = new Map<string, Map<string, RegisteredHostAction>>();

  registerCoreServices(services: HostServiceRegistry): void {
    for (const [moduleName, actions] of Object.entries(services)) {
      if (!actions || typeof actions !== 'object') continue;
      for (const [actionName, action] of Object.entries(actions)) {
        if (typeof action !== 'function') continue;
        this.registerAction(moduleName, actionName, action as RuntimeHostAction, 'core');
      }
    }
  }

  registerExtensionContributions(extensionId: string, contributions: HostApiContribution[]): () => void {
    const registered: Array<{ module: string; action: string }> = [];

    for (const contribution of contributions) {
      assertValidContributionKey('module', contribution.module);
      for (const [actionName, action] of Object.entries(contribution.actions)) {
        assertValidContributionKey('action', actionName);
        this.registerAction(contribution.module, actionName, action, extensionId);
        registered.push({ module: contribution.module, action: actionName });
      }
    }

    return () => {
      for (const { module, action } of registered) {
        const moduleActions = this.modules.get(module);
        const registeredAction = moduleActions?.get(action);
        if (registeredAction?.ownerId === extensionId) {
          moduleActions?.delete(action);
        }
        if (moduleActions?.size === 0) {
          this.modules.delete(module);
        }
      }
    };
  }

  resolve(moduleName: string, actionName: string): RuntimeHostAction | undefined {
    return this.modules.get(moduleName)?.get(actionName)?.action;
  }

  private registerAction(
    moduleName: string,
    actionName: string,
    action: RuntimeHostAction,
    ownerId: string,
  ): void {
    const moduleActions = this.modules.get(moduleName) ?? new Map<string, RegisteredHostAction>();
    if (moduleActions.has(actionName)) {
      throw new Error(`Host API action already registered: ${moduleName}.${actionName}`);
    }
    moduleActions.set(actionName, { action, ownerId });
    this.modules.set(moduleName, moduleActions);
  }
}

function toHostApiRegistry(registryOrServices: HostApiRegistry | HostServiceRegistry): HostApiRegistry {
  if (registryOrServices instanceof HostApiRegistry) {
    return registryOrServices;
  }
  const registry = new HostApiRegistry();
  registry.registerCoreServices(registryOrServices);
  return registry;
}

export function createHostInvokeDispatcher(
  registryOrServices: HostApiRegistry | HostServiceRegistry,
  options: HostInvokeDispatcherOptions = {},
) {
  const registry = toHostApiRegistry(registryOrServices);
  return async function dispatchHostRequest(
    request: unknown,
    event?: IpcEventLike,
  ): Promise<HostResponse> {
    const requestId = request && typeof request === 'object'
      ? String((request as Record<string, unknown>).id ?? '')
      : undefined;

    if (options.requireSender || options.senderAuth) {
      const senderFailure = assertAuthorizedHostSender(event, options.senderAuth);
      if (senderFailure) {
        return {
          id: requestId,
          ok: false,
          error: { code: 'VALIDATION', message: senderFailure.message },
        };
      }
    }

    if (!isHostRequest(request)) {
      return {
        id: requestId,
        ok: false,
        error: { code: 'VALIDATION', message: 'Invalid host request format' },
      };
    }

    // Reject polluted request shells (module/action only; payload checked next).
    if (Object.prototype.hasOwnProperty.call(request, '__proto__')
      || Object.prototype.hasOwnProperty.call(request, 'constructor')
      || Object.prototype.hasOwnProperty.call(request, 'prototype')) {
      return {
        id: request.id,
        ok: false,
        error: { code: 'VALIDATION', message: 'Host request contains dangerous keys' },
      };
    }

    const payloadFailure = validateHostPayload(request.payload);
    if (payloadFailure) {
      return {
        id: request.id,
        ok: false,
        error: { code: 'VALIDATION', message: payloadFailure.message },
      };
    }

    const action = registry.resolve(request.module, request.action);
    if (typeof action !== 'function') {
      return {
        id: request.id,
        ok: false,
        error: {
          code: 'UNSUPPORTED',
          message: `Unsupported host request: ${request.module}.${request.action}`,
        },
      };
    }

    try {
      // R0-4: per-action timeout — a hung host action must fail closed with a
      // TIMEOUT code instead of leaving the renderer waiting forever. Long
      // actions (git fetch/pull/push, installs, doctor, downloads, …) get the
      // extended budget from the shared whitelist.
      const data = await withHostActionTimeout(Promise.resolve(action(request.payload)), request.module, request.action);
      return { id: request.id, ok: true, data };
    } catch (error) {
      if (error instanceof HostActionTimeoutError) {
        return {
          id: request.id,
          ok: false,
          error: { code: 'TIMEOUT', message: sanitizeHostErrorMessage(error.message) },
        };
      }
      const rawMessage = error instanceof Error ? error.message : String(error);
      return {
        id: request.id,
        ok: false,
        error: {
          code: 'INTERNAL',
          message: sanitizeHostErrorMessage(rawMessage),
        },
      };
    }
  };
}

export function registerHostInvokeHandler(
  registry: HostApiRegistry,
  options: HostInvokeDispatcherOptions = {},
): void {
  const dispatch = createHostInvokeDispatcher(registry, {
    requireSender: true,
    ...options,
  });
  ipcMain.handle('host:invoke', async (event: IpcMainInvokeEvent, request: unknown) => (
    dispatch(request, event)
  ));
}
