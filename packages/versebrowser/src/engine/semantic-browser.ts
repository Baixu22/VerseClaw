/** Optional read-only Stagehand adapter. Browser/session ownership stays in the existing Host API. */
import { Stagehand, localBrowser, type ClientLLM } from '@browserbasehq/stagehand';
import { z } from 'zod/v4';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, Page } from 'playwright';
import { allocatePort } from './persistent-sessions.ts';
import { redactSecretsInValue, redactSecretsInText } from '../security/redact-secrets.ts';

type ModelInput = Parameters<ClientLLM['generate']>[0];
type ModelOutput = Awaited<ReturnType<ClientLLM['generate']>>;
export type SemanticGateway = {
  modelId: string;
  maxCalls: number;
  maxInputChars: number;
  maxOutputChars: number;
  maxOutputTokens: number;
  generate(input: ModelInput, context: { signal: AbortSignal; modelId: string; maxOutputTokens: number }): Promise<ModelOutput>;
};
export type SemanticReadOptions = { action: 'observe' | 'extract'; instruction: string; schema?: Record<string, unknown>; timeoutMs?: number };
type Usage = { input: number; output: number; total: number; reasoning?: number; cachedInput?: number };
type CallReceipt = { status: 'pending' | 'completed' | 'failed'; usage: Usage | null; durationMs: number };

export async function prepareSemanticBrowser(gateway: SemanticGateway) {
  if (!gateway || typeof gateway.generate !== 'function' || typeof gateway.modelId !== 'string' || !gateway.modelId.trim() || gateway.modelId.length > 200) throw new Error('E_SEMANTIC_CONFIG: a host model callback and modelId are required');
  for (const [key, maximum] of [['maxCalls', 8], ['maxInputChars', 100000], ['maxOutputChars', 50000], ['maxOutputTokens', 32768]] as const) {
    const value = gateway[key];
    if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error('E_SEMANTIC_CONFIG: invalid host budget ' + key);
  }
  // Read the shipped extension asset relative to the public ESM export; never import internal implementation files.
  const entry = fileURLToPath(import.meta.resolve('@browserbasehq/stagehand'));
  const extensionPath = await realpath(join(dirname(entry), 'extension'));
  const manifest = JSON.parse(await readFile(join(extensionPath, 'manifest.json'), 'utf8'));
  if (manifest.name !== 'Stagehand Runtime' || manifest.version !== '1.0.2' || manifest.key) throw new Error('E_SEMANTIC_VERSION: unexpected bundled extension');
  const extensionId = createHash('sha256').update(extensionPath, process.platform === 'win32' ? 'utf16le' : 'utf8').digest('hex').slice(0, 32).replace(/[0-9a-f]/g, value => String.fromCharCode(97 + parseInt(value, 16)));
  const port = await allocatePort();
  return { extensionPath, extensionId, endpoint: 'http://127.0.0.1:' + port, gateway: { ...gateway },
    args: ['--enable-unsafe-extension-debugging', '--remote-debugging-port=' + port, '--remote-debugging-address=127.0.0.1',
      '--remote-allow-origins=chrome-extension://' + extensionId, '--proxy-bypass-list=<-loopback>;127.0.0.1:' + port] };
}

export async function attachSemanticBrowser(browser: Browser, prepared: Awaited<ReturnType<typeof prepareSemanticBrowser>>) {
  const metadata = await browser.newBrowserCDPSession();
  try {
    const loaded = await metadata.send('Extensions.loadUnpacked', { path: prepared.extensionPath });
    const installed = (await metadata.send('Extensions.getExtensions')).extensions.find(item => item.id === loaded.id);
    if (loaded.id !== prepared.extensionId || !installed?.enabled || installed.name !== 'Stagehand Runtime' || installed.version !== '1.0.2' || await realpath(installed.path) !== prepared.extensionPath) throw new Error('E_SEMANTIC_VERSION: installed extension identity mismatch');
  } finally { await metadata.detach(); }
  const handle = await localBrowser.connect({ cdpUrl: prepared.endpoint, extensionId: prepared.extensionId });
  const gateway = prepared.gateway;
  let active: { controller: AbortController; signal: AbortSignal; calls: CallReceipt[]; inputChars: number; outputChars: number } | undefined;
  let closed = false;
  let stage: Stagehand;
  const generate: ClientLLM['generate'] = async input => {
    const call = active;
    if (closed || !call) throw new Error('E_SEMANTIC_SCOPE: no active host-authorized semantic read');
    call.signal.throwIfAborted();
    if (input.responseFormat?.type !== 'json_schema' || 'tools' in input) throw new Error('E_SEMANTIC_MODEL: only structured read inference is allowed');
    if (call.calls.length >= gateway.maxCalls) throw new Error('E_SEMANTIC_BUDGET: host model call budget exhausted');
    if (input.messages.some(message => (Array.isArray(message.content) ? message.content : [message.content]).some(block => block.type !== 'text'))) throw new Error('E_SEMANTIC_MODEL: only text model requests are allowed');
    const safeInput: ModelInput = { ...input, ...(input.systemPrompt ? { systemPrompt: redactSecretsInText(input.systemPrompt) } : {}),
      messages: input.messages.map(message => ({ ...message, content: redactSecretsInValue(message.content) })) };
    call.inputChars += JSON.stringify(safeInput).length;
    if (call.inputChars > gateway.maxInputChars) throw new Error('E_SEMANTIC_BUDGET: host input character budget exceeded');
    const receipt: CallReceipt = { status: 'pending', usage: null, durationMs: 0 }, startedAt = Date.now();
    call.calls.push(receipt);
    try {
      const result = await gateway.generate(safeInput, { signal: call.signal, modelId: gateway.modelId, maxOutputTokens: gateway.maxOutputTokens });
      const usage = result.usage;
      if (usage && ![usage.inputTokens, usage.outputTokens, usage.totalTokens, usage.reasoningTokens ?? 0, usage.cachedInputTokens ?? 0].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error('E_SEMANTIC_MODEL: invalid model usage');
      receipt.usage = usage ? { input: usage.inputTokens, output: usage.outputTokens, total: usage.totalTokens,
        ...(usage.reasoningTokens !== undefined ? { reasoning: usage.reasoningTokens } : {}), ...(usage.cachedInputTokens !== undefined ? { cachedInput: usage.cachedInputTokens } : {}) } : null;
      call.signal.throwIfAborted();
      call.outputChars += JSON.stringify(result).length;
      if (call.outputChars > gateway.maxOutputChars || (result.usage?.outputTokens ?? 0) > gateway.maxOutputTokens) throw new Error('E_SEMANTIC_BUDGET: host model exceeded its output allowance');
      receipt.status = 'completed';
      // Usage is validated numeric protocol metadata, not a credential-bearing payload.
      return { ...result, content: redactSecretsInValue(result.content),
        ...(result.stopReason ? { stopReason: redactSecretsInText(result.stopReason) } : {}),
        ...(result.outputFormat === 'json_schema' ? { structuredContent: redactSecretsInValue(result.structuredContent) } : {}) };
    } catch (error) {
      receipt.status = 'failed';
      // The causal value crosses the same secret boundary as the public message.
      const message = redactSecretsInText(error instanceof Error ? error.message : String(error));
      const sanitizedOptions: ErrorOptions = { cause: message };
      throw new Error(message, sanitizedOptions);
    } finally { receipt.durationMs = Date.now() - startedAt; }
  };
  try {
    stage = await Stagehand.create({ browser: handle, model: { generate }, cache: false, selfHeal: false, logging: { level: 'off' },
      // The pinned SDK defaults to a remote exporter and has no disable switch. Port zero cannot host a collector.
      telemetry: { traces: { endpoint: 'http://127.0.0.1:0/v1/traces', headers: {} } } });
  } catch (error) { await handle.close(); throw error; }
  type Cleanup = { browserClosed: true; sdk: Array<{ part: string; state: 'closed' | 'already_disconnected'; detail?: string }> };
  let stopping: Promise<void> | undefined, closing: Promise<Cleanup> | undefined;
  const stop = () => stopping ??= (async () => {
    closed = true; active?.controller.abort(new Error('E_SEMANTIC_CANCELLED: semantic adapter closed'));
    await stage.close();
  })();
  const close = () => closing ??= (async (): Promise<Cleanup> => {
    closed = true; active?.controller.abort(new Error('E_SEMANTIC_CANCELLED: semantic adapter closed'));
    // Native owner shutdown is authoritative and releases a stuck inference RPC.
    // Pinned Stagehand close methods reject on an already-disconnected socket; record that separately.
    await browser.close({ reason: 'semantic adapter closed' });
    if (browser.isConnected()) throw new Error('E_SEMANTIC_CLEANUP: owned browser shutdown unconfirmed');
    const results = await Promise.allSettled([stop(), handle.close()]);
    const sdk: Cleanup['sdk'] = results.map((result, index) => {
      const part = index === 0 ? 'stagehand' : 'transport';
      if (result.status === 'fulfilled') return { part, state: 'closed' };
      const detail = redactSecretsInText(String(result.reason));
      if (!/^(?:Error: (?:RPC client is closed|CDP client is closed|CDP connection is not open)|CDPConnectionClosedError: CDP connection closed)$/.test(detail)) throw result.reason;
      return { part, state: 'already_disconnected', detail };
    });
    return { browserClosed: true, sdk };
  })().catch(error => { closing = undefined; throw error; });
  return {
    stop, close,
    read: async (page: Page, options: SemanticReadOptions, signal?: AbortSignal) => {
      if (closed || active) throw new Error('E_SEMANTIC_SCOPE: adapter is closed or another read is active');
      if (page.frames().length !== 1) throw new Error('E_SEMANTIC_SCOPE: this slice requires a single main frame');
      if (!['observe', 'extract'].includes(options.action) || typeof options.instruction !== 'string' || !options.instruction.trim() || options.instruction.length > 2000) throw new Error('E_ARG: semantic action and bounded instruction are required');
      if (options.action === 'observe' && options.schema !== undefined) throw new Error('E_ARG: observe does not accept an extraction schema');
      if (options.action === 'extract' && (!options.schema || options.schema.type !== 'object' || Array.isArray(options.schema) || JSON.stringify(options.schema).length > 16000)) throw new Error('E_ARG: extract requires an explicit bounded object JSON Schema');
      const schema = options.action === 'extract' ? z.fromJSONSchema(options.schema as Parameters<typeof z.fromJSONSchema>[0]) : undefined;
      const timeout = options.timeoutMs ?? 10000;
      if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 60000) throw new Error('E_ARG: semantic timeout must be within (0, 60000]');
      const deadline = Date.now() + timeout;
      const remaining = () => { const ms = deadline - Date.now(); if (ms <= 0) throw new Error('E_SEMANTIC_TIMEOUT: original deadline expired'); return ms; };
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(new Error('E_SEMANTIC_TIMEOUT: original deadline expired')), timeout);
      const pageChanged = () => controller.abort(new Error('E_SEMANTIC_SCOPE: page/frame changed during inference'));
      page.on('framenavigated', pageChanged); page.on('frameattached', pageChanged); page.on('framedetached', pageChanged); page.on('close', pageChanged);
      const combined = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]);
      const call = { controller, signal: combined, calls: [] as CallReceipt[], inputChars: 0, outputChars: 0 }; active = call;
      const report = () => ({ modelId: gateway.modelId, calls: call.calls.map(row => ({ ...row })), usageComplete: call.calls.length > 0 && call.calls.every(row => row.usage !== null) });
      let rejectAbort: (() => void) | undefined;
      try {
        combined.throwIfAborted();
        const work = (async () => {
          const cdp = await page.context().newCDPSession(page);
          let nativeId: string;
          try { nativeId = (await cdp.send('Target.getTargetInfo')).targetInfo.targetId; } finally { await cdp.detach(); }
          combined.throwIfAborted();
          const target = (await handle.context.pages()).find(candidate => candidate.pageId === nativeId);
          if (!target) throw new Error('E_SEMANTIC_SCOPE: native page is not owned by the semantic browser');
          const result = schema ? await stage.extract(options.instruction, schema, { page: target, timeout: remaining(), cache: false, screenshot: false })
            : await stage.observe(options.instruction, { page: target, timeout: remaining(), cache: false });
          combined.throwIfAborted();
          return { data: redactSecretsInValue(result.data), model: report() };
        })();
        return await Promise.race([work, new Promise<never>((_, reject) => { rejectAbort = () => reject(combined.reason); combined.addEventListener('abort', rejectAbort, { once: true }); if (combined.aborted) rejectAbort(); })]);
      } catch (error) {
        if (combined.aborted) {
          // A host callback may ignore AbortSignal. End the owned browser so Stagehand's pending RPC cannot outlive cancellation.
          await close();
        }
        throw Object.assign(new Error(redactSecretsInText(error instanceof Error ? error.message : String(error))), { semantic: report() });
      } finally { clearTimeout(timer); if (rejectAbort) combined.removeEventListener('abort', rejectAbort);
        page.off('framenavigated', pageChanged); page.off('frameattached', pageChanged); page.off('framedetached', pageChanged); page.off('close', pageChanged); active = undefined; }
    },
  };
}
