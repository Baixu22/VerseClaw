/** Public upstream MCP primitives inside the existing VB worker; no second policy or recorder. */
import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpRequest, Agent as HttpAgent, type IncomingMessage } from 'node:http';
import { request as httpsRequest, Agent as HttpsAgent } from 'node:https';
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib';
import { parseCanonicalIpAddress, normalizeIpAddress, extractEmbeddedIpv4FromIpv6, isIpv4Address, isBlockedSpecialUseIpv4Address, isBlockedSpecialUseIpv6Address, isCloudMetadataIpAddress } from '../security/net-policy/ip.ts';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, stat, lstat, open, unlink, type FileHandle } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createConnection } from '@playwright/mcp';
import type { Page, Frame, Dialog, CDPSession, FileChooser, Download, Response, ElementHandle } from 'playwright';
import { assertAgentBrowserNavigateUrl } from '../security/url-policy.ts';
import { redactSecretsInText } from '../security/redact-secrets.ts';
import { assertInsideRoot } from '../evidence/path-guard.ts';
import { writeEvidenceText } from '../evidence/output.ts';
import type { InteractiveElement } from './interactive-snapshot.ts';
import { observeFieldAction, readFieldState, readFormFieldDetails, assertSelectValues, assertFieldFocused, dragWithNativeStart } from './interactive-snapshot.ts';
import { REDACTED } from '../security/redact-secrets.ts';
import { redactSensitiveUrl } from '../security/net-policy/redact-sensitive-url.ts';
import type { AgentBrowserPointerPayload, AgentBrowserFindPayload, AgentBrowserPendingDialogNavigation, AgentBrowserScreenshotPayload, AgentBrowserScreenshotMetrics, AgentBrowserScreenshotResult } from '../types/host-api.ts';

/**
 * A single request that exceeds the controlled transport's 10 s budget used to surface as a bare
 * `Error: aborted`, indistinguishable from a policy abort (both end up as Playwright's
 * `blockedbyclient`). Name the deadline explicitly so a slow/large document is not misread as a
 * security refusal.
 */
export const DEFAULT_TRANSFER_TIMEOUT_MS = 10_000;
/** Largest accepted single-request budget; keeps a hung endpoint bounded even when configured. */
/** Ceiling for the host-supplied budget. The per-action queue deadline is capped at 60_000
 * (documented in README / upstream-reuse), so a larger transport budget could never be used. */
export const MAX_TRANSFER_TIMEOUT_MS = 60_000;
export const DEFAULT_NAVIGATION_DEADLINE_MS = 30_000;

/**
 * Navigation window for a given transport budget: the documented 30 s default, widened when the host
 * granted a larger single-request budget (a heavy document needs the navigation to outlive one
 * request). Never above the per-action queue ceiling, which `assertTransferTimeoutMs` enforces.
 */
export function navigationDeadlineMs(transferBudgetMs: number): number {
  return Math.max(DEFAULT_NAVIGATION_DEADLINE_MS, transferBudgetMs);
}

/**
 * Validate a host-supplied transfer budget. Omitted keeps the historical 10 s default; the value
 * is only ever widened by an explicit host grant, never by a page or tool argument.
 */
export function assertTransferTimeoutMs(value: unknown): number {
  if (value === undefined) return DEFAULT_TRANSFER_TIMEOUT_MS;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1000 || value > MAX_TRANSFER_TIMEOUT_MS) {
    throw new Error('E_UPSTREAM_CONFIG: transferTimeoutMs must be an integer within [1000, ' + MAX_TRANSFER_TIMEOUT_MS + ']');
  }
  return value;
}

export function describeTransferFailure(
  error: unknown,
  signal: AbortSignal,
  transferTimeoutMs: number = DEFAULT_TRANSFER_TIMEOUT_MS,
): Error {
  const reason = signal.reason as { name?: string } | undefined;
  if (signal.aborted && reason?.name === 'TimeoutError') {
    return new Error(
      'E_REQUEST_DEADLINE: a single request exceeded the ' + transferTimeoutMs / 1000 + 's transport budget',
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Pool key for the controlled transport. It includes the *validated* address and family, so a
 * keep-alive socket is only ever reused for the exact address the policy approved: repointing DNS
 * cannot make a pooled connection reach a host that was never validated.
 */
export function transferPoolKey(protocol: string, host: string, port: string, address: string, family: number): string {
  return protocol + '//' + host + ':' + port + '#' + address + '/' + family;
}

/** Host configuration accepts exact origins only; paths and wildcards are not grants. */
export function authorizedBrowserOrigins(values: readonly string[]): ReadonlySet<string> {
  if (!Array.isArray(values) || values.length > 32) throw new Error('E_UPSTREAM_ORIGIN: expected at most 32 exact origins');
  return new Set(values.map(value => {
    const url = new URL(assertAgentBrowserNavigateUrl(value, { allowLocalDocuments: false }));
    if (url.pathname !== '/' || url.search || url.hash || url.hostname.includes('*')) throw new Error('E_UPSTREAM_ORIGIN: expected exact HTTP(S) origin');
    return url.origin;
  }));
}

/** The caller must connect to this address without another DNS lookup. */
export async function resolveAuthorizedBrowserTarget(input: string, origins: ReadonlySet<string>) {
  const url = new URL(assertAgentBrowserNavigateUrl(input, { allowLocalDocuments: false }));
  if (!origins.has(url.origin)) throw new Error('E_UPSTREAM_ORIGIN: target origin is not authorized');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const literalFamily = isIP(hostname);
  const addresses = literalFamily ? [{ address: hostname, family: literalFamily }] : await lookup(hostname, { all: true });
  if (!addresses.length) throw new Error('E_UPSTREAM_ADDRESS: DNS returned no addresses');
  for (const { address } of addresses) {
    const parsed = parseCanonicalIpAddress(normalizeIpAddress(address));
    const embedded = parsed && !isIpv4Address(parsed) ? extractEmbeddedIpv4FromIpv6(parsed) : undefined;
    const explicitLoopback = literalFamily && (hostname === '127.0.0.1' || hostname === '::1');
    if (!parsed || isCloudMetadataIpAddress(address) || (!explicitLoopback && ((embedded && isBlockedSpecialUseIpv4Address(embedded)) || (isIpv4Address(parsed) ? isBlockedSpecialUseIpv4Address(parsed) : isBlockedSpecialUseIpv6Address(parsed))))) {
      throw new Error('E_UPSTREAM_ADDRESS: private or special-use target is not permitted');
    }
  }
  return { url, ...addresses[0]! };
}

export async function createUpstreamPageControl(page: Page, url: string, workspaceRoot: string, closeOwnedSession?: () => Promise<unknown>, allowedOrigins?: readonly string[], onNavigationState?: (owner:Page,state:{id:string;pending:boolean;failed?:boolean})=>void, allowedUploadPaths?: readonly string[], downloadOptions?:{allowedPaths:readonly string[];directory:string}, transferTimeoutMs: number = DEFAULT_TRANSFER_TIMEOUT_MS) {
  const transferBudgetMs = assertTransferTimeoutMs(transferTimeoutMs);
  /**
   * Why the controlled transport dropped a request. Playwright can only report its own
   * `blockedbyclient`, which is exactly what a policy refusal looks like, so the real reason is
   * remembered here and attached to a navigation failure. Cleared once consumed.
   */
  let lastTransferFailure: { message: string; at: number } | undefined;
  if ((createConnection as typeof createConnection & { versebrowserFocusVersion?: number }).versebrowserFocusVersion !== 1) throw new Error('E_UPSTREAM_PATCH: focus-preserving tab patch missing; run npm run patch:upstream');
  if ((createConnection as typeof createConnection & { versebrowserLogSinkVersion?: number }).versebrowserLogSinkVersion !== 1) {
    throw new Error('E_UPSTREAM_PATCH: required log safety patch missing; run npm run patch:upstream before starting the process');
  }
  if ((createConnection as typeof createConnection & { versebrowserFilesVersion?: number }).versebrowserFilesVersion !== 1) throw new Error('E_UPSTREAM_PATCH: buffered file chooser patch missing; run npm run patch:upstream');
  if ((createConnection as typeof createConnection & { versebrowserDownloadsVersion?: number }).versebrowserDownloadsVersion !== 1) throw new Error('E_UPSTREAM_PATCH: manual download patch missing; run npm run patch:upstream');
  const initial = new URL(assertAgentBrowserNavigateUrl(url, { allowLocalDocuments: false }));
  if (allowedOrigins === undefined && !['127.0.0.1', '[::1]'].includes(initial.hostname)) throw new Error('E_UPSTREAM_ORIGIN: experimental slice only supports literal loopback development URLs');
  const origins = authorizedBrowserOrigins(allowedOrigins ?? [initial.origin]);
  if (!origins.has(initial.origin)) throw new Error('E_UPSTREAM_ORIGIN: initial origin is not authorized');
  const context = page.context();
  const filePath = (value: string) => {
    if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new Error('E_ARG: file paths must be nonempty file paths');
    return assertInsideRoot(workspaceRoot, resolve(workspaceRoot, value), 'file path');
  };
  if (allowedUploadPaths !== undefined && (!Array.isArray(allowedUploadPaths) || allowedUploadPaths.length > 32)) throw new Error('E_UPSTREAM_CONFIG: at most 32 explicit upload paths required');
  const uploadGrants = new Set((allowedUploadPaths ?? []).map(filePath));
  if (downloadOptions && (!Array.isArray(downloadOptions.allowedPaths) || downloadOptions.allowedPaths.length>32)) throw new Error('E_UPSTREAM_CONFIG: at most 32 explicit download paths required');
  const downloadGrants=new Set((downloadOptions?.allowedPaths??[]).map(filePath));
  const downloadDirectory=downloadOptions?assertInsideRoot(workspaceRoot,downloadOptions.directory,'download staging'):undefined;
  let pendingDownload:{owner:Page;download?:Download;resolve:(value:Download)=>void;abort:(error:Error)=>void}|undefined;
  const downloadStarted=(download:Download)=>{
    if(pendingDownload && pendingDownload.owner===download.page() && !pendingDownload.download){pendingDownload.download=download;pendingDownload.resolve(download);return;}
    pendingDownload?.abort(new Error('E_DOWNLOAD_SCOPE: only one download from the selected page is allowed'));
    void download.cancel().then(()=>download.delete()).catch(error=>vbLogSink(Date.now(),'download cleanup: '+String(error)));
  };
  let uploadPayloads: Map<string,{name:string;mimeType:string;buffer:Buffer}> | undefined;
  const vbFilePayloads = (paths: string[]) => {
    if (closed || lifetime.signal.aborted || !uploadPayloads) throw new Error('E_FILE_PERMISSION: no active authorized file assignment');
    return paths.map(path => {
      const payload=uploadPayloads!.get(filePath(path));
      if (!payload) throw new Error('E_FILE_PERMISSION: source was not prepared for this upload');
      return payload;
    });
  };
  const guardedPages = new Set<Page>();
  const outputDir = assertInsideRoot(workspaceRoot, join(workspaceRoot, '.ae', 'evidence', `upstream-${randomUUID()}`), 'upstream output');
  let log = '', savedLog = '', omitted = false;
  const vbLogSink = (wallTime: number, text: string) => {
    const entry = `[${wallTime}] ${redactSecretsInText(text)}\n`;
    const available = 64_000 - log.length;
    if (entry.length > available) omitted = true;
    log += entry.slice(0, Math.max(0, available));
  };
  async function flushLog() {
    const content = log + (omitted ? '\n[upstream log truncated at 64000 characters]\n' : '');
    if (content === savedLog) return;
    assertInsideRoot(workspaceRoot, outputDir, 'upstream output');
    await mkdir(outputDir, { recursive: true });
    await writeEvidenceText(workspaceRoot, join(outputDir, 'console.log'), content);
    savedLog = content;
  }
  const lifetime = new AbortController();
  context.once('close', () => { lifetime.abort(); dropPools(); });
  let activeRequests = 0, bufferedBytes = 0;
  const waitingRequests: Array<() => void> = [];
  const bodyLimit = 4 * 1024 * 1024;
  /**
   * Connection pools, keyed by protocol + host:port + the *validated* address/family.
   *
   * Every request used `agent:false`, so each one paid a fresh TCP+TLS handshake. Measured on a
   * real 975 KB documentation page: first byte at 6.6 s and the HTML body complete at 10.8 s, then
   * ~20 more assets each with their own handshake - past any sane navigation budget, while
   * Chromium/undici finished the same page in ~2 s because they reuse connections.
   *
   * The key deliberately includes the validated address and family, so a pool is only ever reused
   * for the exact address `resolveAuthorizedBrowserTarget` approved: repointing DNS cannot make a
   * pooled socket reach a host the policy never validated. Agents are destroyed on close/abort.
   */
  const agents = new Map<string, HttpAgent | HttpsAgent>();
  /** Drop every pooled socket. Idle keep-alive sockets must not outlive their control/context. */
  function dropPools(): void {
    for (const agent of agents.values()) agent.destroy();
    agents.clear();
  }
  function agentFor(protocol: string, host: string, port: string, address: string, family: number): HttpAgent | HttpsAgent {
    const key = transferPoolKey(protocol, host, port, address, family);
    const existing = agents.get(key);
    if (existing) return existing;
    const agent = protocol === 'https:'
      ? new HttpsAgent({ keepAlive: true, maxSockets: 8, maxFreeSockets: 8 })
      : new HttpAgent({ keepAlive: true, maxSockets: 8, maxFreeSockets: 8 });
    agents.set(key, agent);
    return agent;
  }
  type ResponseData = {status:number;headers:Record<string,string>;body:Buffer};
  async function transfer(target:string, method:string, inputHeaders:Record<string,string>, postData:Buffer|undefined, canRedirect:boolean, deliver:(response:ResponseData)=>Promise<void>) {
    let received = 0, ownsSlot = false;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, lifetime.signal, AbortSignal.timeout(transferBudgetMs)]);
    let abortRead: (()=>void) | undefined;
    try {
      signal.throwIfAborted();
      if (activeRequests >= 8) {
        if (waitingRequests.length >= 8) throw new Error('too many pending responses');
        await new Promise<void>((resolve, reject) => {
          const admitted = () => { signal.removeEventListener('abort', cancelled); activeRequests++; resolve(); };
          const cancelled = () => {
            const index = waitingRequests.indexOf(admitted);
            if (index >= 0) waitingRequests.splice(index, 1);
            reject(signal.reason);
          };
          waitingRequests.push(admitted);
          signal.addEventListener('abort', cancelled, { once: true });
        });
      } else activeRequests++;
      ownsSlot = true;
      signal.throwIfAborted();
        // Resolve once; the socket lookup below must return only this validated IP.
        const resolved = await Promise.race([resolveAuthorizedBrowserTarget(target, origins),new Promise<never>((_,reject)=>{
          abortRead=()=>reject(signal.reason);signal.addEventListener('abort',abortRead,{once:true});
        })]);
        signal.throwIfAborted();
        const headers = Object.fromEntries(Object.entries(inputHeaders).map(([key,value])=>[key.toLowerCase(),value]));
        for (const name of ['host', 'connection', 'content-length', 'transfer-encoding', 'accept-encoding']) delete headers[name];
        const response = await new Promise<IncomingMessage>((resolve,reject)=>{
          const outbound = (resolved.url.protocol === 'https:' ? httpsRequest : httpRequest)(resolved.url, {
            method, headers,
            agent: agentFor(resolved.url.protocol, resolved.url.hostname, resolved.url.port || (resolved.url.protocol === 'https:' ? '443' : '80'), resolved.address, resolved.family),
            family:resolved.family,
            lookup: (_hostname, _options, done) => done(null,resolved.address,resolved.family),
            signal,
          },resolve);
          outbound.once('error',reject);
          outbound.end(postData ?? undefined);
        });
        try {
          const status = response.statusCode!;
          if (status >= 300 && status < 400) {
            if (allowedOrigins === undefined || !canRedirect) throw new Error('redirects not enabled for this scope');
            const location = response.headers.location;
            if (!location || !origins.has(new URL(assertAgentBrowserNavigateUrl(new URL(location,resolved.url).href,{allowLocalDocuments:false})).origin)) throw new Error('E_UPSTREAM_ORIGIN: redirect origin is not authorized');
          }
          if (Number(response.headers['content-length']) > bodyLimit) throw new Error('response exceeds slice limit');
          const chunks: Uint8Array[] = [];
          const encoding = response.headers['content-encoding'];
          const decoder = encoding === 'gzip' ? createGunzip() : encoding === 'deflate' ? createInflate() : encoding === 'br' ? createBrotliDecompress() : undefined;
          if (encoding && encoding !== 'identity' && !decoder) throw new Error('unsupported response content encoding');
          if (decoder) response.on('error',error=>decoder.destroy(error));
          try {
            for await (const value of decoder ? response.pipe(decoder) : response) {
              received += value.length; bufferedBytes += value.length;
              if (bufferedBytes > bodyLimit) throw new Error('responses exceed session body budget');
              chunks.push(value);
            }
          } finally { decoder?.destroy(); response.destroy(); }
          const responseHeaders: Record<string, string> = {};
          for (const [name,value] of Object.entries(response.headers)) {
            if (value !== undefined) responseHeaders[name] = Array.isArray(value) ? value.join(name === 'set-cookie' ? '\n' : ', ') : value;
          }
          for (const name of ['content-encoding', 'content-length', 'transfer-encoding', 'connection']) delete responseHeaders[name];
          await deliver({ status, headers: responseHeaders, body: Buffer.concat(chunks) });
        } finally { controller.abort(); }
    } catch (error) {
      const described = describeTransferFailure(error, signal, transferBudgetMs);
      lastTransferFailure = { message: described.message, at: Date.now() };
      throw described;
    } finally {
      if(abortRead)signal.removeEventListener('abort',abortRead);
      bufferedBytes -= received; controller.abort();
      if (ownsSlot) { activeRequests--; waitingRequests.shift()?.(); }
    }
  }
  await context.route('**/*', async route => {
    try {
      const request=route.request();
      let canRedirect=false;
      // A popup's first request may precede its Frame. Its origin is still
      // checked by transfer; only redirect permission requires a known frame.
      try { const frame=request.frame();canRedirect=guardedPages.has(frame.page()) && frame===frame.page().mainFrame(); } catch { /* Unknown scope cannot redirect. */ }
      await transfer(request.url(),request.method(),await request.allHeaders(),request.postDataBuffer() ?? undefined,canRedirect,response=>route.fulfill(response));
    } catch(error) {
      vbLogSink(Date.now(),`network blocked: ${redactSensitiveUrl(route.request().url())} ${String(error)}`);
      await route.abort('blockedbyclient').catch(() => {});
    }
  });
  async function attachRedirectGuard(targetPage:Page) {
    if(allowedOrigins===undefined || guardedPages.has(targetPage))return;
    // context.route sees only the first hop. Keep its context-wide guard and
    // intercept subsequent hops on this page before Chromium can send them.
    const cdp=await context.newCDPSession(targetPage);
    const mainFrame=(await cdp.send('Page.getFrameTree')).frameTree.frame.id;
    cdp.on('Fetch.requestPaused',event=>{void (async()=>{
      try {
        if(!event.redirectedRequestId) {await cdp.send('Fetch.continueRequest',{requestId:event.requestId});return;}
        if(event.frameId!==mainFrame)throw new Error('E_SCOPE: redirected frame is not supported');
        const request=event.request;
        let body:Buffer|undefined;
        if(request.hasPostData) {
          if(request.postDataEntries?.length && request.postDataEntries.every(entry=>entry.bytes!==undefined))body=Buffer.concat(request.postDataEntries.map(entry=>Buffer.from(entry.bytes!,'base64')));
          else {
            const contentType=Object.entries(request.headers).find(([name])=>name.toLowerCase()==='content-type')?.[1] ?? '';
            if(request.postData===undefined || !/^(?:application\/(?:x-www-form-urlencoded|json)|text\/[^;]+)(?:;|$)/i.test(contentType))throw new Error('E_UPSTREAM_RESULT: lossless redirected request body unavailable');
            body=Buffer.from(request.postData);
          }
        }
        await transfer(request.url,request.method,request.headers,body,true,async response=>{
          await cdp.send('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:response.status,
            responseHeaders:Object.entries(response.headers).flatMap(([name,value])=>name==='set-cookie'?value.split('\n').map(value=>({name,value})):[{name,value}]),body:response.body.toString('base64')});
        });
      }catch(error){
        vbLogSink(Date.now(),`redirect blocked: ${redactSensitiveUrl(event.request.url)} ${String(error)}`);
        await cdp.send('Fetch.failRequest',{requestId:event.requestId,errorReason:'BlockedByClient'}).catch(()=>{});
      }
    })();});
    await cdp.send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
    guardedPages.add(targetPage);
    targetPage.once('close',()=>guardedPages.delete(targetPage));
  }
  await attachRedirectGuard(page);
  await context.routeWebSocket('**/*', socket => socket.close());
  const config: Parameters<typeof createConnection>[0] & { vbLogSink: typeof vbLogSink; vbPreserveFocus: boolean; vbFilePayloads: typeof vbFilePayloads; vbManualDownloads: boolean } = {
    vbPreserveFocus: true, vbManualDownloads: true,
    browser: { isolated: false, initScript: [] }, network: { allowedOrigins: [], blockedOrigins: [] },
    webmcp: false, capabilities: ['vision'], imageResponses: 'omit', saveSession: false, snapshot: { mode: 'none' },
    outputDir, vbLogSink, vbFilePayloads,
  };
  const server = await createConnection(config, async () => context);
  const client = new Client({ name: 'versebrowser-control', version: '1.0.0' }, { capabilities: { roots: {} } });
  client.setRequestHandler(ListRootsRequestSchema, async () => ({ roots: [{ uri: pathToFileURL(resolve(workspaceRoot)).href }] }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  let closed = false;
  let toolsInitialized = false;
  const refs = new Map<string, string>();
  let documentRevision = 0;
  const invalidate = () => { documentRevision++; refs.clear(); };
  context.on('page', invalidate);
  let identity = randomUUID().slice(0, 8);
  let multiplePagesSelected = false;
  let pageGeneration = 0;
  const pageIds = new Map<Page,string>([[page,identity]]);
  // Detaching a CDP session can wait for an open dialog. Reuse one metadata
  // connection per owned page; its target closure releases the connection.
  const metadataSessions = new Map<Page,CDPSession>();
  async function metadataFor(candidate:Page){
    let metadata=metadataSessions.get(candidate);
    if(!metadata){metadata=await context.newCDPSession(candidate);metadataSessions.set(candidate,metadata);}
    return metadata;
  }
  let downloadControl:CDPSession|undefined,downloadContextId:string|undefined;
  const downloadBehavior=(behavior:'deny'|'allowAndName')=>downloadControl!.send('Browser.setDownloadBehavior',{behavior,browserContextId:downloadContextId,...(behavior==='allowAndName'?{downloadPath:assertInsideRoot(workspaceRoot,downloadDirectory!,'download staging')}:{})});
  if(downloadGrants.size){
    downloadContextId=(await (await metadataFor(page)).send('Target.getTargetInfo')).targetInfo.browserContextId;
    if(!downloadContextId)throw new Error('E_DOWNLOAD_SCOPE: owned browser context identity unavailable');
    downloadControl=await context.browser()!.newBrowserCDPSession();
    await downloadBehavior('deny');
  }
  const dialogs = new Map<Page,{id:string;dialog:Dialog;responseState:'pending'|'responding'|'unknown'}>();
  const dialogOpened = (dialog:Dialog) => {
    const owner=dialog.page();
    if(owner && pageIds.has(owner)){dialogs.set(owner,{id:randomUUID(),dialog,responseState:'pending'});invalidate();}
  };
  const dialogClosed = (dialog:Dialog) => {
    const owner=dialog.page();
    if(owner && dialogs.get(owner)?.dialog===dialog){dialogs.delete(owner);invalidate();}
  };
  const registerPage = (candidate:Page) => {
    pageGeneration++; multiplePagesSelected=false;
    if (!pageIds.has(candidate)) pageIds.set(candidate,randomUUID());
    candidate.on('framenavigated',invalidate);
    candidate.on('frameattached',invalidate);
    candidate.on('framedetached',invalidate);
    candidate.on('download',downloadStarted);
    candidate.on('dialog',dialogOpened);
    candidate.on('dialogclosed',dialogClosed);
    candidate.once('close',()=>{pageIds.delete(candidate);metadataSessions.delete(candidate);dialogs.delete(candidate);pageGeneration++;multiplePagesSelected=false;invalidate();});
  };
  for(const candidate of context.pages())registerPage(candidate);
  context.on('page',registerPage);
  let revision = 0;
  let pending = Promise.resolve();
  function serial<T>(action: (remaining: () => number) => Promise<T>, timeoutMs = 10000): Promise<T> {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60000) return Promise.reject(new Error('E_ARG: timeoutMs must be within (0, 60000]'));
    const deadline = Date.now() + timeoutMs;
    const queueError = () => new Error('E_QUEUE_TIMEOUT: deadline expired before execution; action not performed');
    let timer: ReturnType<typeof setTimeout>;
    const queuedTimeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(queueError()), timeoutMs); });
    const remaining = () => {
      const ms = deadline - Date.now();
      if (ms <= 0) throw new Error('E_ACTION_TIMEOUT: action deadline expired');
      return ms;
    };
    const next = pending.then(() => {
      clearTimeout(timer);
      if (Date.now() >= deadline) throw queueError();
      return action(remaining);
    });
    pending = next.then(() => undefined, () => undefined);
    return Promise.race([next, queuedTimeout]);
  }
  function abortPending() {
    closed = true; refs.clear(); uploadPayloads=undefined; lifetime.abort();
    dropPools();
  }
  async function close() {
    abortPending();
    for(const candidate of pageIds.keys()) {
      candidate.off('framenavigated',invalidate);
      candidate.off('frameattached',invalidate);
      candidate.off('framedetached',invalidate);
      candidate.off('download',downloadStarted);
      candidate.off('dialog',dialogOpened);
      candidate.off('dialogclosed',dialogClosed);
    }
    dialogs.clear();
    context.off('page', invalidate);
    context.off('page',registerPage);
    try { await client.close(); } finally { try { await server.close(); } finally { await flushLog(); } }
  }
  try { await server.connect(b); await client.connect(a); }
  catch (error) { await close(); throw error; }
  function assertPage(allowDialog=false) {
    if (closed || page.isClosed()) throw new Error('E_UPSTREAM_CLOSED: session control is closed');
    if (context.pages().length !== 1 && !multiplePagesSelected) throw new Error('E_UPSTREAM_PAGES: explicitly select a current session page before continuing');
    if(!allowDialog && dialogs.has(page))throw new Error('E_DIALOG_PENDING: respond to the observed dialog before page operations');
  }
  async function closeAfterTimeout(error: unknown) {
    abortPending();
    // The owner releases its dedicated browser; a bare adapter owns only its context.
    try { await (closeOwnedSession ? closeOwnedSession() : context.close()); }
    catch (cleanup) { throw new AggregateError([error, cleanup], 'Upstream timeout; session cleanup unconfirmed'); }
  }
  async function call(name: 'browser_file_upload' | 'browser_tabs' | 'browser_snapshot' | 'browser_click' | 'browser_type' | 'browser_press_key' | 'browser_fill_form' | 'browser_hover' | 'browser_mouse_wheel' | 'browser_mouse_move_xy', args: Record<string, unknown>, timeoutMs = 10_000) {
    if(name==='browser_tabs') {if(closed)throw new Error('E_UPSTREAM_CLOSED: session control is closed');}
    else assertPage();
    if(!toolsInitialized && dialogs.size)throw new Error('E_DIALOG_PENDING: respond to the initial dialog before initializing page operations');
    let result;
    try { result = await client.callTool({ name, arguments: { ...args, _meta: { json: true } } }, undefined, { timeout: timeoutMs }); }
    catch (error) {
      if ((error as { code?: number }).code === -32001) {
        await closeAfterTimeout(error);
      }
      throw error;
    }
    await flushLog();
    if (result.isError) throw new Error(redactSecretsInText(JSON.stringify(result.content)));
    toolsInitialized = true;
    if (!Array.isArray(result.content)) throw new Error('E_UPSTREAM_RESULT: missing content');
    if(name==='browser_tabs')return {} as {snapshot?:unknown};
    const text = result.content.filter((c: { type?: string; text?: unknown }) => c?.type === 'text' && typeof c.text === 'string').map((c: { text: string }) => c.text).join('\n');
    if (text.length > 100_000) throw new Error('E_UPSTREAM_RESULT: result exceeded bounded inline payload');
    return JSON.parse(text) as { snapshot?: unknown };
  }
  function target(selector: string) {
    const match = /^\[data-vb-ref=["']([^"']+)["']\]$/.exec(selector);
    if (match) {
      const ref = refs.get(match[1]);
      if (!ref) throw new Error('E_STALE_REF: take a fresh snapshot; reference is not from the current observation');
      return ref;
    }
    // Existing SDK callers may use CSS; raw upstream ref syntax is never accepted.
    if (/^(?:f\d+)?e\d+$/.test(selector) || selector.includes('data-vb-ref') || selector.includes('aria-ref=')) throw new Error('E_STALE_REF: use a VB snapshot reference');
    return selector;
  }
  const FRAME_REF = /^f(\d+)e\d+$/;
  /**
   * Whether a ref's `f<n>` prefix currently addresses a child frame by page.frames() position.
   *
   * Measured 2026-10-10: this only answers correctly on a fresh load. The prefix is really the
   * upstream frame sequence, so after a navigation it names f4/f5/... while page.frames() still
   * holds one entry per child, and this returns false. That is tolerated, not patched away: both
   * branches hand the same ref to upstream, and VB's own preflight locator does resolve
   * frame-prefixed refs through aria-ref (measured: a nested-frame click still landed after a
   * navigation), so a false negative costs the field-change observation, not the action. The
   * authoritative identity of a ref is its owning frame, which frameText resolves with
   * ownerFrame(); do not turn this into a second numbering scheme.
   */
  function isFrameRef(resolved: string): boolean {
    const match = FRAME_REF.exec(resolved);
    if (!match) return false;
    // Frame.seq does not exist on the Playwright Frame objects, so the prefix can only be tested
    // against page.frames() here.
    const position = Number(match[1]);
    if (!Number.isSafeInteger(position) || position < 1) return false;
    const frame = page.frames()[position];
    return Boolean(frame) && frame !== page.mainFrame();
  }
  function locator(selector: string) {
    const resolved = target(selector);
    // Upstream resolves a target ref through `page.locator('aria-ref=' + ref)`, and that selector
    // resolves into child frames as well (measured 2026-10-10: a ref whose prefix was f5 still
    // resolved after a navigation, and elementHandle().ownerFrame() returned the middle frame).
    // Verified against @playwright/mcp 0.0.83 targetLocators(). Routing by hand (splitting the
    // prefix and re-querying inside the child frame) breaks it, because the child frame renumbers
    // refs from e1 and the prefix is only meaningful to that resolver.
    return page.locator(selector.startsWith('[data-vb-ref=') ? `aria-ref=${resolved}` : resolved);
  }
  let continuation: { token: string; items: InteractiveElement[]; offset: number; document: number } | undefined;
  async function snapshot(remaining: () => number, selector?: string, paged = false) {
      continuation = undefined;
      const resolved = selector === undefined ? undefined : target(selector);
      refs.clear(); revision++;
      const observedDocument = documentRevision;
      const data = await call('browser_snapshot', resolved ? { target: resolved } : {}, remaining());
      assertPage();
      if (observedDocument !== documentRevision) throw new Error('E_STALE_REF: page/frame changed during observation; take a fresh snapshot');
      if (!Array.isArray(data.snapshot)) throw new Error('E_UPSTREAM_RESULT: structured snapshot unavailable');
      const nextRefs = new Map<string, string>();
      const items: InteractiveElement[] = [], queue: unknown[] = [...data.snapshot];
      let visited = 0;
      while (queue.length) {
        if (++visited > 1000) throw new Error('E_UPSTREAM_RESULT: snapshot exceeds slice budget');
        const node = queue.shift() as Record<string, unknown> | string;
        if (typeof node === 'string') continue;
        if (!node || typeof node.role !== 'string') throw new Error('E_UPSTREAM_RESULT: invalid snapshot node');
        if (typeof node.ref === 'string' && /^(?:f\d+)?e\d+$/.test(node.ref)) {
          if (!paged && items.length >= 80) throw new Error('E_UPSTREAM_RESULT: too many targets for this slice; use paged:true or a region selector');
          const token = `u${identity}-${revision}-${node.ref}`; nextRefs.set(token, node.ref);
          const name = node.name || (node.cursor === 'pointer' && typeof node.text === 'string' ? node.text : '');
          items.push({ ref: token, tag: '', role: node.role, name: redactSecretsInText(String(name).slice(0, 80)), disabled: node.disabled === true,
            ...(node.checked !== undefined ? { checked: node.checked === 'mixed' ? 'mixed' : node.checked === true } : {}),
            ...(node.selected !== undefined ? { selected: node.selected === true } : {}),
          });
        }
        if (Array.isArray(node.children)) queue.unshift(...node.children);
      }
      for (const [token, ref] of nextRefs) refs.set(token, ref);
      return items;
  }
  /**
   * TF-0164: child frames of one page.
   *
   * `frameId` is the page.frames() position (index 0 is the main frame and is not listed). It is
   * NOT the same number as the `f<n>` prefix a snapshot ref carries: that prefix is the upstream
   * frame sequence, so after a navigation the two disagree (measured 2026-10-10: middle-frame refs
   * were f5e* while this reported f1). frameText accepts both and resolves a prefix to its owning
   * frame, so a host that already holds a ref does not need this listing at all.
   *
   * A frame whose origin is not in the authorized set is still listed, marked unauthorized, so
   * the host can tell "not present" from "present but not permitted".
   */
  function frameListFor(owner: Page) {
    return owner.frames().map((frame, position) => {
      if (position === 0) return undefined;
      const frameUrl = frame.url();
      let authorized = false;
      try { authorized = origins.has(new URL(frameUrl).origin); } catch { authorized = false; }
      return { frameId: `f${position}`, index: position, url: redactSensitiveUrl(frameUrl), name: redactSecretsInText(frame.name()).slice(0, 120), authorized };
    }).filter((frame): frame is NonNullable<typeof frame> => frame !== undefined);
  }

  async function pageInventory() {
      if(closed)throw new Error('E_UPSTREAM_CLOSED: session control is closed');
      const candidates=context.pages().filter(candidate=>!candidate.isClosed());
      const pages=await Promise.all(candidates.map(async(candidate,index)=>{
        const opener=await candidate.opener();
        const openerPageId=opener?pageIds.get(opener):undefined;
        const url=candidate.url();
        const metadata=await metadataFor(candidate);
        const history=await metadata.send('Page.getNavigationHistory');
        const current=history.entries[history.currentIndex];
        if(candidate.url()!==url)throw new Error('E_PAGE_NOT_READY: page changed while reading its metadata');
        const titleAvailable=current?.url===url && typeof current.title==='string';
        const title=titleAvailable?current.title:'';
        return {pageId:pageIds.get(candidate)!,index,active:candidate===page,
          url:/^(data|javascript):/i.test(url)?`${url.split(':',1)[0]}:[inline content omitted]`:redactSensitiveUrl(url),
          title:redactSecretsInText(title).slice(0,200),...(!titleAvailable?{titleUnavailable:true}:{}),...(openerPageId?{openerPageId}:{}),
          // TF-0164: list this page's child frames in the same f<n> numbering the snapshot uses
          // for frame-scoped refs, so a caller can bind a ref to the frame that owns it.
          // about:blank / data: frames are reported as unauthorized rather than hidden.
          frames:frameListFor(candidate)};
      }));
      return {pages,...(!page.isClosed()?{activePageId:identity}:{})};
  }
  type PageSelected = (selected:Page,info:{title:string;titleUnavailable?:boolean})=>void;
  async function selectOwnedPage(pageId:string,remaining:()=>number,onSelected?:PageSelected) {
      const candidate=[...pageIds].find(([,id])=>id===pageId)?.[0];
      if(!candidate || candidate.isClosed())throw new Error('E_PAGE_ID: page is closed or not owned by this session');
      const generation=pageGeneration;
      await call('browser_tabs',{action:'list'},remaining());
      const index=context.pages().indexOf(candidate);
      if(index<0)throw new Error('E_PAGE_ID: page closed during selection');
      await call('browser_tabs',{action:'select',index},remaining());
      if(generation!==pageGeneration || candidate.isClosed())throw new Error('E_PAGE_ID: page set changed during selection; observe again');
      page=candidate;identity=pageId;multiplePagesSelected=true;invalidate();
      const inventory=await pageInventory();
      onSelected?.(page,inventory.pages.find(item=>item.pageId===pageId)!);
      return inventory;
  }
  async function navigateDocument(target:Page,url:string,waitUntil:'load'|'domcontentloaded',timeout:number):Promise<{pendingDialog?:AgentBrowserPendingDialogNavigation}> {
    const describe=(owner:Page,record:{id:string},started:boolean)=>({dialogId:record.id,pageId:pageIds.get(owner)!,requestedUrl:redactSensitiveUrl(url),navigationStarted:started});
    const existing=[...dialogs][0];
    if(existing)return {pendingDialog:describe(existing[0],existing[1],false)};
    const id=randomUUID();let blocked=false;
    let notify!:(record:{id:string})=>void;
    const dialogOpening=new Promise<{pendingDialog:AgentBrowserPendingDialogNavigation}>(resolve=>{notify=record=>resolve({pendingDialog:describe(target,record,true)});});
    const opened=()=>{
      const record=dialogs.get(target);
      if(record){blocked=true;onNavigationState?.(target,{id,pending:true});notify(record);}
    };
    target.on('dialog',opened);
    const navigation=target.goto(url,{waitUntil,timeout}).then(()=>{
      if(blocked)onNavigationState?.(target,{id,pending:false});
      lastTransferFailure = undefined;
      return {};
    },error=>{
      if(blocked)onNavigationState?.(target,{id,pending:false,failed:true});
      // Playwright reports a controlled-transport abort as `net::ERR_BLOCKED_BY_CLIENT`, which is
      // also what an origin refusal looks like. When the transport recorded its own reason during
      // this navigation, surface that instead of leaving the caller with the opaque abort.
      const recorded=lastTransferFailure;lastTransferFailure=undefined;
      if(recorded && Date.now()-recorded.at <= 30_000 && /ERR_BLOCKED_BY_CLIENT|ERR_FAILED|ERR_ABORTED/.test(String((error as Error)?.message ?? ''))) {
        throw new Error(String((error as Error)?.message ?? error) + ' (' + recorded.message + ')');
      }
      throw error;
    });
    try{return await Promise.race([navigation,dialogOpening]);}
    finally{target.off('dialog',opened);}
  }
  return {
    semanticRead: <T>(read: (page: Page, remaining: () => number) => Promise<T>, timeoutMs = 10000) => serial(async remaining => {
      assertPage();
      const owner = page, observed = documentRevision, generation = pageGeneration, pageId = identity;
      const result = await read(owner, remaining);
      remaining(); assertPage();
      if (owner !== page || observed !== documentRevision || generation !== pageGeneration) throw new Error('E_SEMANTIC_SCOPE: page changed during inference; observe again');
      return { result, source: { pageId, frameId: 'main' as const, observationId: randomUUID(), url: redactSensitiveUrl(owner.url()) } };
    }, timeoutMs),
    screenshot: (options: AgentBrowserScreenshotPayload) => serial(async remaining => {
      assertPage();
      const owner = page, pageId = identity, generation = pageGeneration, document = documentRevision;
      const assertOwner = () => {
        remaining(); assertPage();
        if (page !== owner || generation !== pageGeneration || document !== documentRevision) {
          throw new Error('E_SCREENSHOT_SCOPE: page changed during screenshot; observe again');
        }
      };
      let element: ElementHandle | null = null;
      const metrics = async (): Promise<AgentBrowserScreenshotMetrics | undefined> => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([(async () => {
            const cdp = await metadataFor(owner); remaining();
            const frameId = (await cdp.send('Page.getFrameTree')).frameTree.frame.id; remaining();
            // A named isolated world shares layout, not page-overridden globals. No caller script is accepted.
            const contextId = (await cdp.send('Page.createIsolatedWorld', { frameId, worldName: 'versebrowser-screenshot' })).executionContextId; remaining();
            const result = await cdp.send('Runtime.evaluate', { contextId, returnByValue: true,
              expression: '({viewport:{width:innerWidth,height:innerHeight},scroll:{x:scrollX,y:scrollY},devicePixelRatio})' });
            const value = result.result.value as AgentBrowserScreenshotMetrics | undefined;
            if (result.exceptionDetails || !value ||
                ![value.viewport?.width, value.viewport?.height, value.scroll?.x, value.scroll?.y, value.devicePixelRatio].every(Number.isFinite) ||
                value.viewport.width <= 0 || value.viewport.height <= 0 || value.devicePixelRatio <= 0) return undefined;
            return value;
          })(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('screenshot metadata deadline expired')), remaining()); })]);
        } catch { return undefined; }
        finally { if (timer) clearTimeout(timer); }
      };
      try {
        if (options.selector !== undefined) {
          const target = locator(options.selector), count = await target.count();
          if (count !== 1) throw new Error(count ? 'E_TARGET_AMBIGUOUS: screenshot selector is not unique' : 'E_TARGET_NOT_FOUND: screenshot target not found');
          element = await target.elementHandle({ timeout: remaining() });
          if (!element || !await element.isVisible()) throw new Error('E_TARGET_HIDDEN: screenshot target is not visible');
          await element.scrollIntoViewIfNeeded({ timeout: remaining() });
        }
        assertOwner();
        const before = await metrics(); assertOwner();
        const take = () => element ? element.screenshot({ type: 'png', timeout: remaining(), scale: 'device' })
          : owner.screenshot({ type: 'png', fullPage: options.fullPage ?? false, timeout: remaining(), scale: 'device' });
        let buffer: Buffer;
        try { buffer = await take(); }
        catch (error) {
          if (!/Protocol error \(Page\.captureScreenshot\): Unable to capture screenshot/iu.test(String(error))) throw error;
          await new Promise(resolve => setTimeout(resolve, Math.min(150, remaining()))); assertOwner();
          buffer = await take();
        }
        assertOwner();
        if (element && !await element.evaluate(node => node.isConnected)) throw new Error('E_STALE_REF: screenshot element was detached');
        const after = await metrics(); assertOwner();
        const capture: NonNullable<AgentBrowserScreenshotResult['capture']> = {
          kind: element ? 'element' : options.fullPage ? 'fullPage' : 'viewport', pageId,
          pixels: { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) },
          metrics: { state: !before || !after ? 'unavailable' : JSON.stringify(before) === JSON.stringify(after) ? 'stable' : 'changed',
            ...(before ? { before } : {}), ...(after ? { after } : {}) },
        };
        return { buffer, capture };
      } finally { await element?.dispose(); }
    }),
    readDialogs: () => {
      if(closed)throw new Error('E_UPSTREAM_CLOSED: session control is closed');
      return {dialogs:[...dialogs].map(([owner,record])=>{
        const message=redactSecretsInText(record.dialog.message()),value=redactSecretsInText(record.dialog.defaultValue());
        return {dialogId:record.id,pageId:pageIds.get(owner)!,type:record.dialog.type(),message:message.slice(0,500),responseState:record.responseState,
          ...(record.dialog.type()==='prompt'?{defaultValue:value.slice(0,200)}:{}),...(message.length>500||value.length>200?{truncated:true}:{})};
      })};
    },
    respondDialog: async (dialogId:string,accept:boolean,promptText?:string) => {
      if(closed)throw new Error('E_UPSTREAM_CLOSED: session control is closed');
      if(typeof accept!=='boolean'||(promptText!==undefined&&(typeof promptText!=='string'||promptText.length>2000)))throw new Error('E_ARG: explicit accept boolean and bounded prompt text required');
      const entry=[...dialogs].find(([,record])=>record.id===dialogId);
      if(!entry)throw new Error('E_DIALOG_ID: dialog is closed or not owned by this session');
      const [owner,record]=entry,type=record.dialog.type();
      const ownerPageId=pageIds.get(owner);
      if(!ownerPageId || owner.isClosed())throw new Error('E_DIALOG_ID: dialog page is closed or no longer owned');
      if(!['alert','confirm','prompt','beforeunload'].includes(type))throw new Error('E_DIALOG_TYPE: unsupported dialog cannot be answered');
      if(record.responseState!=='pending')throw new Error('E_DIALOG_RESPONSE_PENDING: response already attempted; inspect state without replaying it');
      if((promptText!==undefined && (!accept||type!=='prompt')) || (accept&&type==='prompt'&&promptText===undefined))throw new Error('E_ARG: accepting a prompt requires explicit promptText; other responses must omit it');
      record.responseState='responding';
      let timer:ReturnType<typeof setTimeout>|undefined;
      try {
        // The pinned Dialog can release a renderer blocked by another read. It
        // must not queue behind that read or act on a different current tab.
        await Promise.race([accept?record.dialog.accept(promptText):record.dialog.dismiss(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('E_DIALOG_TIMEOUT: response completion unknown; do not replay')),5000);})]);
        return {dialogId,pageId:ownerPageId,accepted:accept};
      }catch(error){record.responseState='unknown';throw error;}finally{clearTimeout(timer);}
    },
    listPages: () => serial(pageInventory),
    selectPage: (pageId:string,onSelected?:PageSelected) => serial(remaining=>selectOwnedPage(pageId,remaining,onSelected)),
    newPage: (url?:string,background=false,onSelected?:PageSelected) => serial(async remaining=>{
      if(typeof background!=='boolean')throw new Error('E_ARG: background must be boolean');
      if(url!==undefined && !origins.has(new URL(assertAgentBrowserNavigateUrl(url,{allowLocalDocuments:false})).origin))throw new Error('E_UPSTREAM_ORIGIN: new page origin is not authorized');
      if(closed || context.pages().length===0)throw new Error('E_UPSTREAM_CLOSED: open a session before creating another page');
      const previous=identity;
      let created:Page|undefined;
      try {
        await call('browser_tabs',{action:'list'},remaining());
        created=await context.newPage();
        const createdPageId=pageIds.get(created)!;
        await attachRedirectGuard(created);
        const navigation=url===undefined?{}:await navigateDocument(created,url,'load',remaining());
        const inventory=await selectOwnedPage(background?previous:createdPageId,remaining,onSelected);
        return {...inventory,createdPageId,...navigation};
      }catch(error){
        if(created && !created.isClosed()) {
          try{await created.close();}catch(cleanup){throw new AggregateError([error,cleanup],'new page failed; owned page cleanup unconfirmed');}
        }
        throw error;
      }
    },navigationDeadlineMs(transferBudgetMs)),
    closePage: (pageId=identity,onSelected?:PageSelected) => serial(async remaining=>{
      const candidate=[...pageIds].find(([,id])=>id===pageId)?.[0];
      if(!candidate || candidate.isClosed())throw new Error('E_PAGE_ID: page is closed or not owned by this session');
      if(context.pages().length<=1)throw new Error('E_LAST_PAGE: close the session to close its last page');
      const wasActive=candidate===page;
      remaining();
      // Close the pinned Page object; a shifting upstream index could close a sibling.
      await candidate.close();
      if(!candidate.isClosed())throw new Error('E_PAGE_CLOSE: page closure was not confirmed');
      const inventory=!wasActive&&!page.isClosed()?await selectOwnedPage(identity,remaining,onSelected):await pageInventory();
      return {...inventory,closedPageId:pageId};
    }),
    downloadFile: (selector:string, destination:string, timeoutMs=5000, beforeExecute?:()=>void) => serial(async remaining => {
      assertPage();
      const path=filePath(destination);
      if(!downloadGrants.has(path) || !downloadControl)throw new Error('E_FILE_PERMISSION: destination is not authorized by the host');
      const existing=await lstat(path).catch(error=>{if(error.code==='ENOENT')return undefined;throw error;});
      if(existing)throw new Error('E_FILE_EXISTS: download destination already exists');
      if(!(await stat(dirname(filePath(path)))).isDirectory())throw new Error('E_FILE_INPUT: destination parent must be an existing directory');
      const owner=page,pageId=identity,generation=pageGeneration,resolved=target(selector);
      const controller=new AbortController(),signal=AbortSignal.any([controller.signal,lifetime.signal]);
      const timer=setTimeout(()=>controller.abort(new Error('E_DOWNLOAD_TIMEOUT: download deadline expired; click will not be replayed')),remaining());
      let resolveDownload!:(value:Download)=>void,rejectDownload!:(error:unknown)=>void;
      const chosen=new Promise<Download>(resolve=>{resolveDownload=resolve;});
      const failed=new Promise<never>((_,reject)=>{rejectDownload=reject;});void failed.catch(()=>undefined);
      let stream:Readable|null|undefined,output:FileHandle|undefined,created:{ino:number;dev:number}|undefined;
      let outcome:({kind:'page';selected:Download}|{kind:'fetch';body:Buffer}|undefined);
      let disabled=false,released=false,complete=false,failure:unknown;
      let result:{pageId:string;file:{reference:string;bytes:number;mimeType:string|null};status:'completed'}|undefined;
      const aborted=()=>{stream?.destroy(signal.reason);rejectDownload(signal.reason);};
      const ended=()=>controller.abort(new Error('E_UPSTREAM_CLOSED: download page closed'));
      signal.addEventListener('abort',aborted,{once:true});owner.once('close',ended);
      const responseTypes=new Map<string,string|null>();
      const responseSeen=(response:Response)=>{
        const key=response.url();
        if(responseTypes.has(key))responseTypes.set(key,null);
        else if(responseTypes.size<16 && key.length<=4096)responseTypes.set(key,redactSecretsInText(response.headers()['content-type']?.split(';')[0]?.trim()??'').slice(0,128)||null);
      };
      owner.on('response',responseSeen);
      const attempt={owner,download:undefined as Download|undefined,resolve:resolveDownload,abort:(error:Error)=>controller.abort(error)};
      try {
        signal.throwIfAborted();assertPage();
        await Promise.race([downloadBehavior('allowAndName'),failed]);
        pendingDownload=attempt;
        beforeExecute?.();
        await call('browser_click',{target:resolved},remaining());
        // TF-0189: try the page-level download first so the accepted content-disposition path keeps
        // its existing behaviour (MIME attribution, one request per click). Only when that channel
        // yields no readable bytes do we fall back to fetching the element's href through the SAME
        // bounded transfer — which is what the browser's download-attribute channel needs, because it
        // bypasses context.route and a dead proxy never fulfils it. Origin guard, 4 MiB bound,
        // destination grants and exclusive-create checks apply to both paths.
        let outcome:({kind:'page';selected:Download}|{kind:'fetch';body:Buffer}|undefined);
        try{
          const selected=await Promise.race([chosen,failed]);
          signal.throwIfAborted();
          if(page!==owner || owner.isClosed() || generation!==pageGeneration || selected.page()!==owner)throw new Error('E_PAGE_ID: download ownership changed');
          const pageStream=await Promise.race([selected.createReadStream().then(value=>{if(signal.aborted){value?.destroy();throw signal.reason;}return value;}),failed]);
          if(pageStream){stream=pageStream;outcome={kind:'page',selected};}
          else throw new Error('E_DOWNLOAD_FAILED: native download stream unavailable');
        }catch{/* the attribute shape cancels the Download object; fall through to the guarded fetch */}
        if(!outcome){
          const href=await locator(selector).getAttribute('href',{timeout:Math.max(200,Math.min(remaining(),1500))}).catch(()=>null);
          if(typeof href!=='string'||!href.trim())throw new Error('E_DOWNLOAD_FAILED: no native download and no href to fetch');
          const url=new URL(href,owner.url()).toString();
          const fetched=await new Promise<{status:number;headers:Record<string,string>;body:Buffer}|undefined>((resolve)=>transfer(url,'GET',{},undefined,false,async(response)=>{resolve(response);}));
          if(!fetched||fetched.status<200||fetched.status>=300)throw new Error('E_DOWNLOAD_FAILED: authorized download fetch did not succeed');
          outcome={kind:'fetch',body:fetched.body};
          stream=Readable.from([fetched.body]);
        }
        if(!stream)throw new Error('E_DOWNLOAD_FAILED: no readable download source');
        const chunks:Buffer[]=[];let bytes=0;
        for await(const chunk of stream){
          signal.throwIfAborted();remaining();
          const buffer=Buffer.from(chunk);bytes+=buffer.length;
          if(bytes>bodyLimit)throw new Error('E_FILE_LIMIT: download exceeds the 4 MiB limit');
          chunks.push(buffer);
        }
        if(outcome.kind==='page'){
          const nativeFailure=await outcome.selected.failure();
          if(nativeFailure)throw new Error('E_DOWNLOAD_FAILED: '+nativeFailure);
          await outcome.selected.delete();released=true;
        }
        await downloadBehavior('deny');disabled=true;
        signal.throwIfAborted();remaining();assertPage();
        if(page!==owner || generation!==pageGeneration)throw new Error('E_PAGE_ID: download ownership changed');
        output=await open(filePath(path),'wx');created=await output.stat();
        const current=await stat(filePath(path));
        if(!current.isFile() || current.ino!==created.ino || current.dev!==created.dev)throw new Error('E_FILE_CHANGED: download destination identity changed');
        await output.writeFile(Buffer.concat(chunks));
        if((await output.stat()).size!==bytes)throw new Error('E_DOWNLOAD_FAILED: saved file size does not match received bytes');
        signal.throwIfAborted();remaining();
        await output.close();output=undefined;
        signal.throwIfAborted();remaining();assertPage();
        if(page!==owner || generation!==pageGeneration)throw new Error('E_PAGE_ID: download ownership changed');
        complete=true;
        result={pageId,file:{reference:relative(workspaceRoot,path).split(sep).join('/'),bytes,mimeType:outcome.kind==='page'?responseTypes.get(outcome.selected.url())??null:null},status:'completed'};
      } catch(error){failure=error;}
      finally {
        pendingDownload=undefined;clearTimeout(timer);signal.removeEventListener('abort',aborted);owner.off('close',ended);owner.off('response',responseSeen);refs.clear();
        const cleanupErrors:unknown[]=[];
        for(const cleanup of [
          async()=>{if(!disabled){await downloadBehavior('deny');disabled=true;}},
          async()=>{stream?.destroy();if(outcome?.kind==='page'&&attempt.download&&!released){await attempt.download.cancel().catch(()=>undefined);await attempt.download.delete().catch(()=>undefined);}},
          async()=>{if(output)await output.close();},
          async()=>{if(created&&!complete){const current=await lstat(filePath(path));if(current.ino!==created.ino||current.dev!==created.dev)throw new Error('E_FILE_CHANGED: refusing to delete a replaced destination');await unlink(filePath(path));}},
        ])try{await cleanup();}catch(error){cleanupErrors.push(error);}
        if(cleanupErrors.length){
          try{await (closeOwnedSession?closeOwnedSession():context.close());}catch(error){cleanupErrors.push(error);}
          failure=new AggregateError([...(failure===undefined?[]:[failure]),...cleanupErrors],'Download cleanup unconfirmed; owned-session shutdown attempted');
        }
      }
      if(failure!==undefined)throw failure;
      return result!;
    },timeoutMs),
    uploadFiles: (selector:string, paths:string[], timeoutMs=5000, beforeExecute?:()=>void) => serial(async remaining => {
      assertPage();
      if (!Array.isArray(paths) || !paths.length || paths.length > 10) throw new Error('E_ARG: upload requires one to ten files');
      const files=paths.map(filePath);
      if (new Set(files).size !== files.length) throw new Error('E_ARG: duplicate upload paths are not allowed');
      if (files.some(path=>!uploadGrants.has(path))) throw new Error('E_FILE_PERMISSION: source path is not authorized by the host');
      const owner=page, pageId=identity, generation=pageGeneration, resolved=target(selector);
      const prepared = new Map<string,{name:string;mimeType:string;buffer:Buffer}>();
      const metadata=[]; let bytes=0;
      for (const path of files) {
        const info=await stat(filePath(path)); remaining(); lifetime.signal.throwIfAborted();
        if (!info.isFile()) throw new Error('E_FILE_INPUT: upload source must be a regular file');
        bytes+=info.size;
        if (bytes>4*1024*1024) throw new Error('E_FILE_LIMIT: upload exceeds the 4 MiB aggregate limit');
        const file=await open(filePath(path),'r');
        try {
          const held=await file.stat(); filePath(path);
          if (!held.isFile() || held.dev!==info.dev || held.ino!==info.ino || held.size!==info.size || held.mtimeMs!==info.mtimeMs || held.ctimeMs!==info.ctimeMs) throw new Error('E_FILE_CHANGED: upload source changed before reading');
          const buffer=Buffer.alloc(info.size+1); let offset=0;
          while (offset<buffer.length) {
            remaining(); lifetime.signal.throwIfAborted();
            const {bytesRead}=await file.read(buffer,offset,Math.min(64*1024,buffer.length-offset),null);
            if (!bytesRead) break;
            offset+=bytesRead;
          }
          const after=await file.stat(); remaining(); lifetime.signal.throwIfAborted();
          if (offset!==info.size || after.size!==info.size || after.mtimeMs!==info.mtimeMs || after.ctimeMs!==info.ctimeMs) throw new Error('E_FILE_CHANGED: upload source changed while reading');
          // Buffered native Files preserve bytes in CDP; disk-backed Files expose opaque body entries.
          prepared.set(path,{name:basename(path),mimeType:'',buffer:buffer.subarray(0,offset)});
        } finally { await file.close(); }
        metadata.push({name:redactSecretsInText(basename(path)),bytes:info.size});
      }
      assertPage();
      if (page!==owner || generation!==pageGeneration) throw new Error('E_PAGE_ID: upload page ownership changed');
      let chooser:FileChooser|undefined, resolveChooser!:(value:FileChooser)=>void, rejectChooser!:(error:Error)=>void;
      const chosen=new Promise<FileChooser>((resolve,reject)=>{resolveChooser=resolve;rejectChooser=reject;});
      void chosen.catch(()=>undefined);
      const opened=(value:FileChooser)=>{chooser=value;resolveChooser(value);};
      const ended=()=>rejectChooser(new Error('E_UPSTREAM_CLOSED: upload page closed'));
      const chooserTimeout = new Error('E_FILE_CHOOSER_TIMEOUT: Request timed out waiting for file chooser; click will not be replayed');
      const timer=setTimeout(()=>rejectChooser(chooserTimeout),remaining());
      owner.on('filechooser',opened); owner.once('close',ended);
      let assigned=false;
      try {
        beforeExecute?.();
        await call('browser_click',{target:resolved},remaining());
        const selected=await chosen;
        if (closed || owner.isClosed() || page!==owner || generation!==pageGeneration || selected.page()!==owner) throw new Error('E_PAGE_ID: file chooser ownership changed');
        if (files.length>1 && !selected.isMultiple()) throw new Error('E_FILE_INPUT: chooser does not accept multiple files');
        for (const path of files) filePath(path);
        uploadPayloads=prepared;
        await call('browser_file_upload',{paths:files},remaining()); assigned=true;
        return {pageId,files:metadata,status:'assigned' as const};
      } catch(error) {
        if (error === chooserTimeout) await closeAfterTimeout(error);
        if (chooser && !assigned && !closed && !owner.isClosed() && generation===pageGeneration) {
          try { await call('browser_file_upload',{},remaining()); }
          catch(cleanup) { throw new AggregateError([error,cleanup],'Upload failed; file chooser cleanup unconfirmed'); }
        }
        throw error;
      } finally { uploadPayloads=undefined;clearTimeout(timer);owner.off('filechooser',opened);owner.off('close',ended);refs.clear(); }
    },timeoutMs),
    forms: (selector?: string) => serial(async remaining => {
      assertPage();
      const root = selector ? locator(selector) : page.locator('body');
      if (await root.count() !== 1) throw new Error('E_SCOPE: form region must match one element');
      const fields = await root.locator('input,select,textarea,button').elementHandles();
      if (fields.length > 40) { await Promise.all(fields.map(field => field.dispose())); throw new Error('E_OUTPUT_BUDGET: more than40 form fields; narrow region'); }
      const observedDocument = documentRevision;
      try {
        const items = await snapshot(remaining, selector, true);
        const records = [];
        for (const field of fields) {
          remaining();
          const facts = await field.evaluate(readFormFieldDetails);
          const state = await field.evaluate(readFieldState, REDACTED);
          let ref: string | null = null;
          for (const item of items) {
            const candidate = await locator(`[data-vb-ref="${item.ref}"]`).elementHandle({timeout:remaining()});
            if (!candidate) continue;
            try { if (await candidate.ownerFrame() === page.mainFrame() && await candidate.evaluate((element, expected)=>element===expected, field)) { ref=item.ref; break; } }
            finally { await candidate.dispose(); }
          }
          const { sourceUrl: _sourceUrl, ...fieldFacts } = facts;
          if (fieldFacts.validity) fieldFacts.validity = Object.fromEntries(Object.entries(fieldFacts.validity).filter(([key,value])=>key==='valid'||value));
          records.push({ ...fieldFacts, ...state, ref, referenceStatus: ref ? 'available' : 'not-in-snapshot', validityFormat: 'valid-and-true-flags' });
        }
        if (observedDocument !== documentRevision) throw new Error('E_STALE_REF: page changed while reading form fields');
        return { fields: records, scope: { pageId:identity,frameId:'main',observationId:`${identity}-${revision}`, sourceUrl:redactSensitiveUrl(page.url()) }, trust:'untrusted' };
      } catch (error) { refs.clear(); throw error; }
      finally { await Promise.all(fields.map(field=>field.dispose())); }
    }),
    snapshot: (selector?: string) => serial(remaining => snapshot(remaining, selector)),
    snapshotPage: (options: { selector?: string; cursor?: string }) => serial(async remaining => {
      assertPage();
      if (options.cursor !== undefined) {
        if (options.selector !== undefined) throw new Error('E_ARG: cursor cannot be combined with selector');
        if (!continuation || options.cursor !== continuation.token || continuation.document !== documentRevision ||
            continuation.items.some(item => !refs.has(item.ref))) throw new Error('E_STALE_CURSOR: observation is no longer available; start a new paged snapshot');
      } else {
        const items = await snapshot(remaining, options.selector, true);
        continuation = { token: randomUUID(), items, offset: 0, document: documentRevision };
      }
      const current = continuation!;
      const offset = current.offset;
      const items = current.items.slice(offset, offset + 20);
      current.offset += items.length;
      const truncated = current.offset < current.items.length;
      current.token = randomUUID();
      const result = { items, page: { observationId: `${identity}-${revision}`, offset, total: current.items.length, truncated,
        ...(truncated ? { nextCursor: current.token } : {}), source: 'cached observation' } };
      if (!truncated) continuation = undefined;
      return result;
    }),
    findElement: (query: AgentBrowserFindPayload) => serial(async remaining => {
      assertPage();
      const fields = ['role', 'name', 'label', 'testId'] as const;
      if (fields.some(key => query[key] !== undefined && (typeof query[key] !== 'string' || !query[key]!.trim() || query[key]!.length > 200)) ||
          (!query.role && !query.label && !query.testId) || (query.name !== undefined && !query.role)) {
        throw new Error('E_ARG: provide role (with optional name), label or testId; exact strings must contain 1–200 characters');
      }
      let matches = query.role ? page.getByRole(query.role as Parameters<Page['getByRole']>[0], { ...(query.name !== undefined ? { name: query.name, exact: true } : {}) }) : undefined;
      if (query.label) { const byLabel = page.getByLabel(query.label, { exact: true }); matches = matches ? matches.and(byLabel) : byLabel; }
      if (query.testId) { const byId = page.getByTestId(query.testId); matches = matches ? matches.and(byId) : byId; }
      refs.clear(); revision++;
      const observedDocument = documentRevision;
      const scope = () => ({ pageId: identity, frameId: 'main', observationId: `${identity}-${revision}` });
      const count = await matches!.count();
      if (observedDocument !== documentRevision) throw new Error('E_STALE_REF: document changed during query; observe again');
      if (count !== 1) return { match: count === 0 ? 'none' as const : 'ambiguous' as const, count, scope: scope() };
      // Pin identity before taking the snapshot; a replacement matching the same
      // label must not inherit the query result while asynchronous reads run.
      const handle = await matches!.elementHandle({ timeout: remaining() });
      if (!handle) throw new Error('E_STALE_REF: query target disappeared; observe again');
      try {
        const items = await snapshot(remaining, matches!.toString());
        let found: InteractiveElement | undefined;
        for (const item of items) {
          remaining();
          const candidate = await locator(`[data-vb-ref="${item.ref}"]`).elementHandle({ timeout: remaining() });
          if (!candidate) continue;
          try {
            if (await candidate.ownerFrame() === page.mainFrame() && await candidate.evaluate((element, expected) => element === expected, handle)) { found = item; break; }
          } finally { await candidate.dispose(); }
        }
        if (observedDocument !== documentRevision || !await matches!.evaluate((element, expected) => element === expected && element.isConnected, handle, { timeout: remaining() })) {
          throw new Error('E_STALE_REF: query target changed during observation; observe again');
        }
        if (!found) throw new Error('E_TARGET_UNAVAILABLE: exact target has no actionable upstream snapshot reference');
        const state = await handle.evaluate(readFieldState, REDACTED);
        if ((state.selectedValues?.length ?? 0) > 8) {
          state.selectedValues = state.selectedValues!.slice(0, 8);
          state.truncated = true;
        }
        const details = await handle.evaluate(readFormFieldDetails);
        if (observedDocument !== documentRevision) throw new Error('E_STALE_REF: document changed during details read');
        return { match: 'unique' as const, count: 1, scope: scope(), item: found,
          details: { ...details, ...state, sourceUrl: redactSensitiveUrl(details.sourceUrl), trust: 'untrusted' as const } };
      } catch (error) { refs.clear(); throw error; }
      finally { await handle.dispose(); }
    }, query.timeoutMs ?? 10000),
    wait: (selector: string, timeoutMs = 5000) => serial(async remaining => {
      assertPage();
      await locator(selector).waitFor({ state: 'visible', timeout: remaining() });
    }, timeoutMs),
    type: (selector: string, text: string, timeoutMs = 5000, beforeExecute?:()=>void) => serial(async remaining => {
      assertPage();
      const resolved = target(selector);
      beforeExecute?.();
      try { return await observeFieldAction(locator(selector), remaining(), async () => {
        await locator(selector).focus({ timeout: remaining() });
        await locator(selector).evaluate(assertFieldFocused, undefined, { timeout: remaining() });
        await call('browser_type', { target: resolved, text }, remaining());
      }); }
      finally { refs.clear(); }
    }, timeoutMs),
    setField: (selector: string, type: 'combobox' | 'checkbox', value: string, timeoutMs = 5000, beforeExecute?:()=>void) => serial(async remaining => {
      const resolved = target(selector);
      beforeExecute?.();
      try {
        if (type === 'combobox' && await locator(selector).evaluate((element, label) => Array.from((element as HTMLSelectElement).options ?? []).filter(option => option.label === label).length, value, { timeout: remaining() }) > 1) {
          throw new Error('E_AMBIGUOUS_OPTION: more than one option has this label; no selection performed');
        }
        return await observeFieldAction(locator(selector), remaining(), () => call('browser_fill_form', { fields: [{ name: 'requested field', target: resolved, type, value }] }, remaining()));
      }
      finally { refs.clear(); }
    }, timeoutMs),
    selectValues: (selector: string, values: string[], timeoutMs = 5000, beforeExecute?:()=>void) => serial(async remaining => {
      assertPage();
      const field = locator(selector);
      beforeExecute?.();
      try {
        await field.evaluate(assertSelectValues, values, { timeout: remaining() });
        return await observeFieldAction(field, remaining(), () => field.selectOption(values.map(value => ({ value })), { timeout: remaining() }));
      }
      finally { refs.clear(); }
    }, timeoutMs),
    appendText: (selector: string, text: string, timeoutMs = 5000, beforeExecute?:()=>void) => serial(async remaining => {
      assertPage();
      const resolved = target(selector);
      beforeExecute?.();
      try {
        if (!await locator(selector).isEditable({ timeout: remaining() })) throw new Error('E_FIELD_READONLY: field is not editable');
        const observedDocument = documentRevision;
        return await observeFieldAction(locator(selector), remaining(), async () => {
          await locator(selector).focus({ timeout: remaining() });
          await locator(selector).evaluate(assertFieldFocused, undefined, { timeout: remaining() });
          await locator(selector).press('ControlOrMeta+End', { timeout: remaining() });
          if (documentRevision !== observedDocument) throw new Error('E_STALE_REF: document changed before text insertion');
          await locator(selector).evaluate(assertFieldFocused, undefined, { timeout: remaining() });
          await call('browser_type', { target: resolved, text, slowly: true }, remaining());
        });
      } finally { refs.clear(); }
    }, timeoutMs),
    press: (key: string, selector?: string, beforeExecute?:()=>void) => serial(async remaining => {
      assertPage();
      beforeExecute?.();
      try {
        if (!selector) { await call('browser_press_key', { key }, remaining()); return; }
        const target = locator(selector);
        return await observeFieldAction(target, remaining(), async () => {
          await target.focus({ timeout: remaining() });
          await target.evaluate(assertFieldFocused, undefined, { timeout: remaining() });
          await call('browser_press_key', { key }, remaining());
        });
      } finally { refs.clear(); }
    }),
    click: (selector: string, timeoutMs = 5000, beforeExecute?: () => void, afterExecute?: () => Promise<void>) => serial(async remaining => {
      const resolved = target(selector);
      assertPage();
      beforeExecute?.();
        try {
          let change;
          // TF-0164: delegate a frame-scoped ref straight to upstream, which is the only authority
          // on its own refs and refuses invalid ones with its own error, rather than letting VB
          // re-interpret it. Measured 2026-10-10: the preflight would not actually have failed -
          // page.locator('aria-ref=...') does resolve into child frames - so this branch buys the
          // guarantee that a frame ref is never re-pointed by VB, while main-frame refs keep the
          // field-detection preflight.
          if (isFrameRef(resolved)) {
            await call('browser_click', { target: resolved }, remaining());
          } else {
            const field = locator(selector);
            if (await field.evaluate(element=>element.matches('input,select,textarea,[contenteditable="true"]'),undefined,{timeout:remaining()})) {
              change = await observeFieldAction(field,remaining(),()=>call('browser_click',{target:resolved},remaining()));
            } else await call('browser_click', { target: resolved }, remaining());
          }
            await afterExecute?.();
            return change;
        }
      finally { refs.clear(); }
    }, timeoutMs),
    pointer: (payload: AgentBrowserPointerPayload, beforeExecute?: () => void) => serial(async remaining => {
      assertPage();
      const resolved = payload.selector ? target(payload.selector) : undefined;
      const observedDocument = documentRevision;
      beforeExecute?.();
      try {
        if (payload.action === 'scroll-into-view') await locator(payload.selector!).scrollIntoViewIfNeeded({ timeout: remaining() });
        else if (payload.action === 'scroll') {
          if (resolved) await call('browser_hover', { target: resolved }, remaining());
          else await call('browser_mouse_move_xy', { x: 0, y: 0 }, remaining());
          assertPage();
          if (documentRevision !== observedDocument) throw new Error('E_STALE_REF: page changed while positioning the pointer; observe again');
          await call('browser_mouse_wheel', { deltaX: payload.deltaX ?? 0, deltaY: payload.deltaY ?? 0 }, remaining());
        } else if (payload.action === 'hover') await call('browser_hover', { target: resolved }, remaining());
        else await call('browser_click', { target: resolved, ...(payload.action === 'double-click' ? { doubleClick: true } : { button: 'right' }) }, remaining());
      } finally { refs.clear(); }
    }, payload.timeoutMs ?? 5000),
    drag: (sourceSelector: string, targetSelector: string, timeoutMs = 5000, beforeExecute?: () => void) => serial(async remaining => {
      assertPage();
      beforeExecute?.();
      try { await dragWithNativeStart(page, locator(sourceSelector), locator(targetSelector), remaining); }
      finally { refs.clear(); }
    }, timeoutMs),
    navigate: (url: string, waitUntil: 'load' | 'domcontentloaded') => serial(async remaining => {
      assertPage(true);
      if (!origins.has(new URL(assertAgentBrowserNavigateUrl(url, { allowLocalDocuments: false })).origin)) throw new Error('E_UPSTREAM_ORIGIN: navigation origin is not authorized');
      refs.clear();
      return navigateDocument(page,url,waitUntil,remaining());
    }, navigationDeadlineMs(transferBudgetMs)),
    /**
   * TF-0164: read visible text inside one frame scope.
   *
   * The native page is handed to a callback and never escapes, matching semanticRead.
   *
   * Two frame identities exist and they are NOT the same scheme (measured 2026-10-10): the
   * page.frames() position, which is what vb_pages reports as frameId, and the `f<n>` prefix
   * inside a snapshot ref, which is the upstream frame sequence and keeps increasing across
   * navigations (the main frame carries one too). They coincide on a fresh load only. Both are
   * accepted here: a position resolves through page.frames(), and anything else resolves through
   * the observation that produced the ref, via the element's ownerFrame(). An unknown,
   * unauthorized or detached frame is refused rather than falling back to the main frame.
   */
    frameText: (options: { frameId?: string; selector?: string; maxLength?: number }, timeoutMs = 10000) => serial(async remaining => {
      assertPage();
      const owner = page, observed = documentRevision, generation = pageGeneration, pageId = identity;
      const requested = options.frameId;
      let scope: Frame = page.mainFrame();
      let resolvedFrameId = 'main';
      // The frame that really owns an observation ref. `ownerFrame()` is the authority; the `f<n>`
      // prefix inside a ref is the upstream frame sequence and must not be read as a page.frames()
      // position (measured 2026-10-10: after one navigation the middle frame's refs were f5e*,
      // while vb_pages still reported it as f1).
      const owningFrame = async (upstreamRef: string): Promise<Frame | undefined> => {
        const handle = await page.locator(`aria-ref=${upstreamRef}`).elementHandle({ timeout: remaining() }).catch(() => null);
        if (!handle) return undefined;
        return (await handle.ownerFrame().catch(() => null)) ?? undefined;
      };
      const frameIdOf = (frame: Frame) => (frame === page.mainFrame() ? 'main' : `f${page.frames().indexOf(frame)}`);
      const authorizeFrame = (frame: Frame) => {
        let origin: string;
        try { origin = new URL(frame.url()).origin; } catch { throw new Error(`E_UPSTREAM_ORIGIN: frame origin is not authorized`); }
        if (!origins.has(origin)) throw new Error(`E_UPSTREAM_ORIGIN: frame origin ${redactSensitiveUrl(frame.url())} is not authorized`);
      };
      // A snapshot ref carries its own scope, so a read driven by a ref targets the frame that owns
      // it. That is what makes the snapshot scope and the read scope the same scope.
      const refSelector = typeof options.selector === 'string' && options.selector.includes('data-vb-ref') ? target(options.selector) : undefined;
      if (requested !== undefined && requested !== 'main') {
        const numeric = requested.startsWith('f') ? requested.slice(1) : requested;
        const position = Number(numeric);
        const byPosition = Number.isSafeInteger(position) && position >= 1 ? page.frames()[position] : undefined;
        if (byPosition && byPosition !== page.mainFrame()) {
          authorizeFrame(byPosition);
          scope = byPosition;
          resolvedFrameId = `f${position}`;
        } else {
          // Not a page.frames() position: accept an upstream frame-sequence prefix from the current
          // observation, rather than refusing an identifier the snapshot itself handed to the host.
          const upstreamRef = [...refs.values()].find((ref) => ref.startsWith(`f${numeric}e`));
          const owning = upstreamRef ? await owningFrame(upstreamRef) : undefined;
          if (!owning) throw new Error(`E_PAGE_TEXT: unknown frame ${requested} is not available; take a fresh frame listing with vb_pages`);
          authorizeFrame(owning);
          scope = owning;
          resolvedFrameId = frameIdOf(owning);
        }
      } else if (requested === undefined && refSelector !== undefined) {
        const owning = await owningFrame(refSelector);
        if (owning) {
          authorizeFrame(owning);
          scope = owning;
          resolvedFrameId = frameIdOf(owning);
        }
      }
      remaining(); assertPage();
      if (owner !== page || observed !== documentRevision || generation !== pageGeneration) {
        throw new Error(`E_FRAME_SCOPE: page changed during the frame text read; observe again`);
      }
      const text = await scope.evaluate((selector: string | null) => {
        // Running inside the frame: document here IS that frame's document.
        const target = selector ? document.querySelector(selector) : document.body;
        return target ? String(target.textContent ?? '').replace(/\s+/g, ' ').trim() : '';
      }, options.selector ?? null);
      remaining(); assertPage();
      if (owner !== page || observed !== documentRevision || generation !== pageGeneration) {
        throw new Error(`E_FRAME_SCOPE: page changed during the frame text read; observe again`);
      }
      const capped = options.maxLength === undefined ? text : text.slice(0, Math.max(0, options.maxLength));
      return {
        text: capped,
        truncated: options.maxLength !== undefined && text.length > capped.length,
        scope: { pageId, frameId: resolvedFrameId, observationId: `${identity}-${revision}`, url: redactSensitiveUrl(scope.url()) },
        trust: 'untrusted' as const,
      };
    }, timeoutMs),
    abortPending,
    close,
  };
}
