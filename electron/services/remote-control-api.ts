import { assertSensitiveCaptureAllowed } from './sensitive-capture-gate';
import WebSocket from 'ws';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { getAllSettings } from '../utils/store';
import { getRemoteControlLaunchState, normalizeRemoteDebuggingPort } from '../utils/remote-control';
import type {
  RemoteControlInspectTarget,
  RemoteControlTargetPayload,
} from '@shared/host-api/contract';
import { isRecord } from './payload-utils';

type CdpResponse = {
  id?: number;
  result?: unknown;
  error?: { message?: string; data?: string };
};

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`CDP endpoint returned HTTP ${response.status}`);
  }
  return await response.json() as T;
}

function normalizeTarget(value: unknown): RemoteControlInspectTarget | null {
  if (!isRecord(value)) return null;
  return {
    id: typeof value.id === 'string' ? value.id : undefined,
    title: typeof value.title === 'string' ? value.title : undefined,
    type: typeof value.type === 'string' ? value.type : undefined,
    url: typeof value.url === 'string' ? value.url : undefined,
    webSocketDebuggerUrl: typeof value.webSocketDebuggerUrl === 'string' ? value.webSocketDebuggerUrl : undefined,
  };
}

function getBaseUrl(): string {
  const launchState = getRemoteControlLaunchState();
  if (!launchState.effectivePort) {
    throw new Error('Electron CDP 调试端口当前未生效，请启用后重启 Verse Claw');
  }
  return `http://127.0.0.1:${launchState.effectivePort}`;
}

async function listTargets(): Promise<RemoteControlInspectTarget[]> {
  const rawTargets = await fetchJson<unknown[]>(`${getBaseUrl()}/json/list`);
  return Array.isArray(rawTargets)
    ? rawTargets.map(normalizeTarget).filter((target): target is RemoteControlInspectTarget => Boolean(target))
    : [];
}

function targetScore(target: RemoteControlInspectTarget): number {
  if (target.type !== 'page') return 0;
  if (target.url?.includes('localhost:5173') || target.title === 'Verse Claw') return 4;
  if (target.url && !target.url.startsWith('devtools://')) return 3;
  return 1;
}

async function resolveTarget(payload?: RemoteControlTargetPayload): Promise<RemoteControlInspectTarget> {
  const targets = await listTargets();
  const target = payload?.targetId
    ? targets.find((entry) => entry.id === payload.targetId)
    : payload?.urlIncludes
      ? targets.find((entry) => entry.url?.includes(payload.urlIncludes ?? ''))
      : [...targets].sort((a, b) => targetScore(b) - targetScore(a))[0];
  if (!target?.webSocketDebuggerUrl) {
    throw new Error('未找到可调试的 Electron 页面');
  }
  return target;
}

async function withCdp<T>(
  target: RemoteControlInspectTarget,
  callback: (send: (method: string, params?: Record<string, unknown>) => Promise<unknown>) => Promise<T>,
): Promise<T> {
  if (!target.webSocketDebuggerUrl) throw new Error('目标页面缺少 CDP WebSocket 地址');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let nextId = 0;
  const pending = new Map<number, (response: CdpResponse) => void>();

  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(String(data)) as CdpResponse;
      if (typeof message.id === 'number' && pending.has(message.id)) {
        pending.get(message.id)?.(message);
        pending.delete(message.id);
      }
    } catch {
      // Ignore unsolicited or malformed CDP traffic.
    }
  });

  const send = (method: string, params: Record<string, unknown> = {}) => new Promise<unknown>((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP request timed out: ${method}`));
    }, 8000);
    pending.set(id, (response) => {
      clearTimeout(timer);
      if (response.error) {
        reject(new Error(response.error.data || response.error.message || `CDP request failed: ${method}`));
        return;
      }
      resolve(response.result);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });

  try {
    return await callback(send);
  } finally {
    ws.close();
  }
}

function extractRemoteObjectValue(result: unknown): { value?: unknown; description?: string } {
  if (!isRecord(result)) return {};
  const remoteObject = isRecord(result.result) ? result.result : {};
  return {
    value: 'value' in remoteObject ? remoteObject.value : undefined,
    description: typeof remoteObject.description === 'string' ? remoteObject.description : undefined,
  };
}

function getNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

async function getSelectorCenter(
  send: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
  selector: string,
): Promise<{ x: number; y: number }> {
  const expression = `(async () => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'center', inline: 'center' });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`;
  const result = extractRemoteObjectValue(await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }));
  if (!isRecord(result.value)) {
    throw new Error(`未找到选择器: ${selector}`);
  }
  return {
    x: getNumber(result.value.x, 0),
    y: getNumber(result.value.y, 0),
  };
}

export function createRemoteControlApi(): CompleteHostServiceRegistry['remoteControl'] {
  return {
    status: async () => {
      const settings = await getAllSettings();
      const configuredPort = normalizeRemoteDebuggingPort(settings.cdpRemoteDebuggingPort);
      const launchState = getRemoteControlLaunchState();
      const configuredEnabled = settings.cdpRemoteControlEnabled === true;
      return {
        success: true,
        configuredEnabled,
        configuredPort,
        effectiveEnabled: launchState.effectiveEnabled,
        effectivePort: launchState.effectivePort,
        endpoint: launchState.endpoint,
        envOverride: launchState.envOverride,
        restartRequired: configuredEnabled !== launchState.effectiveEnabled
          || (configuredEnabled && configuredPort !== launchState.effectivePort),
      };
    },
    inspect: async () => {
      const launchState = getRemoteControlLaunchState();
      if (!launchState.effectivePort) {
        return {
          success: false,
          error: 'Electron CDP 调试端口当前未生效，请启用后重启 Verse Claw',
          endpoint: launchState.endpoint,
          webSocketDebuggerUrl: null,
          browser: null,
          protocolVersion: null,
          targets: [],
        };
      }
      const baseUrl = `http://127.0.0.1:${launchState.effectivePort}`;
      try {
        const version = await fetchJson<Record<string, unknown>>(`${baseUrl}/json/version`);
        const targets = await listTargets();
        return {
          success: true,
          endpoint: `${baseUrl}/json/version`,
          webSocketDebuggerUrl: typeof version.webSocketDebuggerUrl === 'string' ? version.webSocketDebuggerUrl : null,
          browser: typeof version.Browser === 'string' ? version.Browser : null,
          protocolVersion: typeof version['Protocol-Version'] === 'string' ? version['Protocol-Version'] : null,
          targets,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          endpoint: `${baseUrl}/json/version`,
          webSocketDebuggerUrl: null,
          browser: null,
          protocolVersion: null,
          targets: [],
        };
      }
    },
    pageInfo: async (payload = {}) => {
      try {
        const target = await resolveTarget(payload);
        const result = await withCdp(target, async (send) => {
          await send('Runtime.enable');
          return extractRemoteObjectValue(await send('Runtime.evaluate', {
            expression: `(() => ({
              title: document.title,
              url: location.href,
              viewport: { width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio || 1 },
              scroll: { x: scrollX, y: scrollY, width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
              textSample: document.body ? document.body.innerText.slice(0, 1200) : ''
            }))()`,
            returnByValue: true,
          })).value;
        });
        const info = isRecord(result) ? result : {};
        return {
          success: true,
          target,
          title: typeof info.title === 'string' ? info.title : target.title,
          url: typeof info.url === 'string' ? info.url : target.url,
          viewport: isRecord(info.viewport)
            ? {
              width: getNumber(info.viewport.width, 0),
              height: getNumber(info.viewport.height, 0),
              deviceScaleFactor: getNumber(info.viewport.deviceScaleFactor, 1),
            }
            : undefined,
          scroll: isRecord(info.scroll)
            ? {
              x: getNumber(info.scroll.x, 0),
              y: getNumber(info.scroll.y, 0),
              width: getNumber(info.scroll.width, 0),
              height: getNumber(info.scroll.height, 0),
            }
            : undefined,
          textSample: typeof info.textSample === 'string' ? info.textSample : undefined,
        };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    evaluate: async (payload) => {
      try {
        const target = await resolveTarget(payload);
        const result = await withCdp(target, async (send) => {
          await send('Runtime.enable');
          return extractRemoteObjectValue(await send('Runtime.evaluate', {
            expression: payload.expression,
            returnByValue: true,
            awaitPromise: true,
          }));
        });
        return { success: true, ...result };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    click: async (payload) => {
      try {
        const target = await resolveTarget(payload);
        await withCdp(target, async (send) => {
          await send('Runtime.enable');
          await send('Input.setIgnoreInputEvents', { ignore: false });
          const point = payload.selector
            ? await getSelectorCenter(send, payload.selector)
            : { x: payload.x, y: payload.y };
          await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
          await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
          await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
        });
        return { success: true, target };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    scroll: async (payload = {}) => {
      try {
        const target = await resolveTarget(payload);
        await withCdp(target, async (send) => {
          await send('Runtime.enable');
          const deltaX = payload.deltaX ?? 0;
          const deltaY = payload.deltaY ?? 500;
          if (payload.selector) {
            await send('Runtime.evaluate', {
              expression: `(() => {
                const el = document.querySelector(${JSON.stringify(payload.selector)});
                if (!el) throw new Error('selector not found');
                el.scrollBy(${JSON.stringify(deltaX)}, ${JSON.stringify(deltaY)});
              })()`,
              awaitPromise: true,
            });
            return;
          }
          await send('Runtime.evaluate', {
            expression: `window.scrollBy(${JSON.stringify(deltaX)}, ${JSON.stringify(deltaY)})`,
            awaitPromise: true,
          });
        });
        return { success: true, target };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    screenshot: async (payload = {}) => {
      await assertSensitiveCaptureAllowed('screenshot', typeof payload.grantId === 'string' ? payload.grantId : undefined);
      const format = payload.format ?? 'png';
      try {
        const target = await resolveTarget(payload);
        const result = await withCdp(target, async (send) => {
          await send('Page.enable');
          const params: Record<string, unknown> = {
            format,
            captureBeyondViewport: payload.fullPage === true,
            fromSurface: true,
          };
          if (format !== 'png' && typeof payload.quality === 'number') {
            params.quality = Math.max(0, Math.min(100, Math.round(payload.quality)));
          }
          // Optional clip: capture only a sub-rect of the viewport (CSS pixels).
          // Used by the Web preview panel to screenshot just the iframe region.
          if (
            payload.clip
            && typeof payload.clip === 'object'
            && typeof payload.clip.x === 'number'
            && typeof payload.clip.y === 'number'
            && typeof payload.clip.width === 'number'
            && typeof payload.clip.height === 'number'
            && payload.clip.width > 0
            && payload.clip.height > 0
          ) {
            const c = payload.clip;
            params.clip = {
              x: Math.max(0, c.x),
              y: Math.max(0, c.y),
              width: Math.max(1, c.width),
              height: Math.max(1, c.height),
              scale: typeof c.scale === 'number' && c.scale > 0 ? c.scale : 1,
            };
            // When clipping, do not capture beyond viewport.
            params.captureBeyondViewport = false;
          }
          return await send('Page.captureScreenshot', params);
        });
        const data = isRecord(result) && typeof result.data === 'string' ? result.data : '';
        return {
          success: Boolean(data),
          target,
          dataUrl: data ? `data:image/${format};base64,${data}` : undefined,
          format,
          error: data ? undefined : '截图失败：CDP 未返回图片数据',
        };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error), format };
      }
    },
  };
}
