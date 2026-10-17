import { inlineMarkdown } from '../security/markdown.ts';
import { redactSensitiveUrl } from '../security/net-policy/redact-sensitive-url.ts';
import { redactSecretsInValue, REDACTED } from '../security/redact-secrets.ts';
import { isNavigationReadError, recoveryHint } from './navigation-errors.ts';
/**
 * Engine facade: shared session orchestration for MCP / CLI.
 * Screenshots land on disk and return paths (never base64 into context).
 */
import { mkdir } from 'node:fs/promises';
import { writeEvidenceText, writeEvidenceJson, writeEvidenceBinary } from '../evidence/output.ts';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  createEvidenceRef,
  errResult,
  okResult,
  type ConsoleIncrementalDiff,
  type DiagnosisReport,
  type EvidenceRef,
  type NetworkFailureSummary,
  type TimelineEventKind,
  type TimelineRecord,
  type ToolResult,
  type VerifyExpectation,
  type VerifyExpectationResult,
  type VerifyOutcome,
  type VerifyReport,
  type VerifySelectorResult,
} from '../contracts/index.ts';
import type { AgentBrowserHostApi, AgentBrowserOpenPayload, AgentBrowserSnapshotItem, AgentBrowserPointerPayload, AgentBrowserDragPayload, AgentBrowserActionResult, AgentBrowserFindPayload, AgentBrowserUploadPayload, AgentBrowserDownloadPayload, AgentBrowserSemanticPayload } from '../types/host-api.ts';
import { getWorkspaceRoot, getWorkspaceEvidenceRoot, getWorkspaceSessionDir, getWorkspaceSessionsRoot, toWorkspaceRelative } from '../host/workspace-paths.ts';
import { explainError, type SourceMapResolver } from '../mcp/explain-error.ts';
import { TimelineWriter, readTimeline } from '../evidence/timeline.ts';
import { diagnoseTimeline, writeDiagnosisPack } from '../evidence/diagnosis.ts';
import {
  DEFAULT_DIAGNOSE_BUDGET,
  renderDiagnosePack,
  type DiagnosePackBudget,
} from './diagnose-pack.ts';
import { formatVerifyPrComment, formatPrComment } from '../evidence/pr-comment.ts';
import { writeTrajectoryViewer } from '../evidence/viewer.ts';
import { readEvidencePack } from '../evidence/reader.ts';
import { assertInsideRoot, sanitizeSegment } from '../evidence/path-guard.ts';
import { RuntimeModePolicy } from '../core/runtime-mode-policy.ts';
import { HitlSessionStore, type HitlCheckpoint, type HitlReason } from './hitl-checkpoint.ts';
import {
  ReplayToolExecutor,
  type ReplayContext,
  type ReplayRecorderLike,
} from './browser-control/replay-tool-executor.ts';
import type { BoundaryGrantContext } from '../core/tool-authorization.ts';
import {
  profileFromHostApi,
  ASSUMED_FULL_DRIVER_PROFILE,
  type DriverProfile,
} from './driver-profile.ts';

export type FacadeOptions = {
  api: AgentBrowserHostApi;
  workspaceRoot?: string;
  evidenceRoot?: string;
  resolveSourceMap?: SourceMapResolver;
  /**
   * Required legacy methods are assumed present; optional actions are discovered
   * on the injected API. Dynamic proxies may provide an explicit profile.
   */
  driverProfile?: DriverProfile;
};

export type VerifyFlowOptions = {
  sessionId: string;
  selectors?: string[];
  /** Business assertions. When omitted, verify only covers health signals. */
  expect?: VerifyExpectation[];
  baselineConsoleCount?: number;
  /**
   * Number of earlier session requests to exclude from the network verdict.
   * Defaults to the watermark taken at the last successful navigation, so a
   * multi-page session judges the page under verification instead of every
   * 404 the session has ever seen (TF-0095).
   */
  baselineNetworkCount?: number;
  screenshot?: boolean;
  evidenceDirName?: string;
  /**
   * Health-only runs return a compact verdict (default). Set false to get the
   * pre-fix full acceptance report — used to A/B the change inside one run.
   */
  compactHealthSummary?: boolean;
};

type NetworkListRow = {
  id: string;
  url: string;
  method: string;
  status?: number;
  failed?: boolean;
  error?: string;
};

/**
 * Verdict window for one signal channel.
 *
 * `anchor` identifies the last entry observed before the current page (request
 * id / log line). Counting alone is not safe: hosts cap the list
 * (`DEFAULT_LIST_LIMIT` = 200 requests, `MAX_CONSOLE_MESSAGES` = 200 lines), so
 * an index-based window can slice itself empty and silently PASS a broken page.
 * An anchor survives eviction of *older* entries; when the anchor itself is
 * gone the caller judges everything instead (over-report, never a silent pass).
 */
type SignalWindow = { count: number; anchor?: string; allPages?: boolean };

function resolveWindow<T>(
  rows: T[],
  window: SignalWindow,
  identity: (row: T) => string,
  currentPageStart = 0,
): { windowed: T[]; excluded: number; anchorMissing: boolean } {
  const scoped = (excluded: number, anchorMissing: boolean) => {
    const start = Math.max(excluded, currentPageStart);
    return { windowed: rows.slice(start), excluded: start, anchorMissing };
  };
  if (window.anchor !== undefined) {
    const index = rows.findIndex((row) => identity(row) === window.anchor);
    if (index >= 0) {
      return scoped(index + 1, false);
    }
    return scoped(0, true);
  }
  // Explicit count from a caller: only usable while the list still holds it.
  if (window.count > 0 && window.count < rows.length) {
    return scoped(window.count, false);
  }
  return scoped(0, false);
}

/**
 * Actionable hint when a `[data-vb-ref]` selector no longer resolves: a real
 * task run showed the model burning a 5s timeout on a ref invalidated by its own
 * preceding action, with nothing in the error saying so (TF-0100).
 */
function refHint(selector: string): string {
  return /\[data-vb-ref=/u.test(selector)
    ? ' — refs are per-snapshot: the page changed since that snapshot; take a fresh snapshot and use the new ref'
    : '';
}

/** In-page predicate for `vb_wait` (evaluated by the driver). */
function buildWaitExpression(conditions: {
  selector?: string;
  absent?: boolean;
  valueEquals?: string;
  valueNotEquals?: string;
  textEquals?: string;
  textNotEquals?: string;
  text?: string;
  urlIncludes?: string;
}): string {
  const parts: string[] = [];
  if (conditions.selector) {
    const query = `document.querySelectorAll(${JSON.stringify(conditions.selector)})`;
    if (conditions.absent) parts.push(`${query}.length === 0`);
    else if (conditions.valueEquals !== undefined || conditions.valueNotEquals !== undefined) {
      parts.push(`(() => { const nodes = ${query}; if (nodes.length > 1) throw new Error('E_AMBIGUOUS_TARGET: wait requires one field'); if (!nodes.length) return false; if (!('value' in nodes[0])) throw new Error('E_WAIT_TARGET: target has no value'); return nodes[0].value ${conditions.valueEquals !== undefined ? '===' : '!=='} ${JSON.stringify(conditions.valueEquals ?? conditions.valueNotEquals)}; })()`);
    } else if (conditions.textEquals !== undefined || conditions.textNotEquals !== undefined) {
      parts.push(`(() => { const nodes = ${query}; if (nodes.length > 1) throw new Error('E_AMBIGUOUS_TARGET: wait requires one element'); if (!nodes.length) return false; return nodes[0].textContent ${conditions.textEquals !== undefined ? '===' : '!=='} ${JSON.stringify(conditions.textEquals ?? conditions.textNotEquals)}; })()`);
    } else parts.push(`Boolean(document.querySelector(${JSON.stringify(conditions.selector)}))`);
  }
  if (conditions.text) {
    parts.push(
      `((document.body && document.body.innerText || '').includes(${JSON.stringify(conditions.text)}))`,
    );
  }
  if (conditions.urlIncludes) {
    parts.push(`location.href.includes(${JSON.stringify(conditions.urlIncludes)})`);
  }
  return parts.join(' && ');
}

/** One interactive item as remembered between snapshots (TF-0102). */
type SnapshotIndexItem = Pick<AgentBrowserSnapshotItem, 'ref' | 'expanded' | 'value' | 'disabled' | 'readOnly' | 'checked' | 'selected'> & { signature: string };

function indexSnapshotItem(item: AgentBrowserSnapshotItem): SnapshotIndexItem {
  item = redactSecretsInValue(item);
  return { ref: item.ref, signature: itemSignature(item), expanded: item.expanded,
    value: item.valueRedacted ? REDACTED : item.value?.slice(0, 120), disabled: item.disabled,
    readOnly: item.readOnly, checked: item.checked, selected: item.selected };
}
/** Page facts the snapshot header always carries, plus item identities. */
type SnapshotFacts = {
  url?: string;
  title?: string;
  htmlBytes?: number;
  textChars?: number;
  items?: SnapshotIndexItem[];
  at: number;
};

/** Stable identity for an interactive element (refs are re-assigned per snapshot). */
function itemSignature(item: { tag?: string; role?: string; name?: string; href?: string }): string {
  const role = item.role ?? item.tag ?? '?';
  return `${role} | ${JSON.stringify((item.name ?? '').slice(0, 80))}${item.href ? ` | href=${item.href}` : ''}`;
}

/**
 * TF-0111: severity of a rendered console line, from the `[level]` prefix the
 * driver emits (`getConsoleMessages` formats every line as `[<type>] <text>`).
 *
 * Only falls back to wording when no level prefix is present at all — a host
 * driver that returns raw text — and that fallback never overrides a known
 * level. The previous rule keyword-matched the whole line, so a *warning* whose
 * message contained "error" counted as an error, and `verify_flow` treats any
 * new error as a hard failure: a healthy page logging
 * `[warning] Error with Feature-Policy header…` came back as FAIL.
 */
function classifyConsoleLine(line: string): 'error' | 'warning' | 'info' {
  const prefixed = /^\s*\[([a-z]+)\]/iu.exec(line);
  const level = prefixed?.[1]?.toLowerCase();
  if (level) {
    // Playwright/Chromium level names, plus the `pageerror` bucket the driver adds.
    if (level === 'error' || level === 'pageerror' || level === 'assert') return 'error';
    if (level === 'warning' || level === 'warn') return 'warning';
    return 'info';
  }
  // No level reported (host driver returning bare text): fall back to wording.
  if (/\b(error|exception|failed)\b/iu.test(line)) return 'error';
  if (/\b(warn|warning)\b/iu.test(line)) return 'warning';
  return 'info';
}

/** Read url / title / metrics out of the formatted snapshot header. */
function parseSnapshotFacts(text: string): Omit<SnapshotFacts, 'items' | 'at'> {
  const raw = (label: string): string | undefined => {
    const match = new RegExp(`^- ${label}: (.*)$`, 'mu').exec(text);
    const value = match?.[1]?.trim();
    return value ? value : undefined;
  };
  const count = (label: string): number | undefined => {
    const value = raw(label);
    const parsed = value === undefined ? Number.NaN : Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const title = raw('title');
  const url = raw('url');
  const htmlBytes = count('html_bytes');
  const textChars = count('text_chars');
  return {
    ...(title ? { title } : {}),
    ...(url ? { url } : {}),
    ...(htmlBytes !== undefined ? { htmlBytes } : {}),
    ...(textChars !== undefined ? { textChars } : {}),
  };
}

/**
 * TF-0102: compact "what changed since the last snapshot" block, so a repeated
 * observation does not have to be re-read in full.
 */
function formatSnapshotDiff(previous: SnapshotFacts, current: SnapshotFacts): string {
  const lines: string[] = [
    `## Since last snapshot (${Math.max(0, Math.round((current.at - previous.at) / 1000))}s ago)`,
  ];
  let changed = false;
  if (previous.url !== current.url) {
    lines.push(`- url: ${previous.url ?? '?'} -> ${current.url ?? '?'}`);
    changed = true;
  }
  if (previous.title !== current.title) {
    lines.push(
      `- title: ${JSON.stringify(previous.title ?? '')} -> ${JSON.stringify(current.title ?? '')}`,
    );
    changed = true;
  }
  if (previous.htmlBytes !== current.htmlBytes || previous.textChars !== current.textChars) {
    lines.push(
      `- metrics: html_bytes ${previous.htmlBytes ?? '?'} -> ${current.htmlBytes ?? '?'}, text_chars ${previous.textChars ?? '?'} -> ${current.textChars ?? '?'}`,
    );
    changed = true;
  }
  if (previous.items && current.items) {
    const before = new Set(previous.items.map((item) => item.signature));
    const after = new Set(current.items.map((item) => item.signature));
    const added = [...after].filter((signature) => !before.has(signature));
    const removed = [...before].filter((signature) => !after.has(signature));
    lines.push(
      `- interactive: ${previous.items.length} -> ${current.items.length} (+${added.length} / -${removed.length})`,
    );
    for (const signature of added.slice(0, 5)) lines.push(`- added: ${signature}`);
    for (const signature of removed.slice(0, 5)) lines.push(`- removed: ${signature}`);
    if (added.length > 5) lines.push(`- (+${added.length - 5} more added; full list in the snapshot above)`);
    if (removed.length > 5) lines.push(`- (+${removed.length - 5} more removed)`);
    if (added.length > 0 || removed.length > 0) changed = true;

    // TF-0107: a disclosure toggling is a *state* change on an element that is
    // still the same element. Signature is identity, so match on it and compare
    // `aria-expanded` — reporting it as added/removed would be misleading.
    const stateChanges: string[] = [];
    const fields = ['expanded', 'value', 'disabled', 'readOnly', 'checked', 'selected'] as const;
    const reportedDuplicates = new Set<string>();
    for (const item of current.items) {
      const matches = previous.items.filter((beforeItem) => beforeItem.signature === item.signature);
      if (matches.length === 0) continue;
      const currentMatches = current.items.filter((currentItem) => currentItem.signature === item.signature);
      if (matches.length !== 1 || currentMatches.length !== 1) {
        const states = (items: SnapshotIndexItem[]) => JSON.stringify(items.map(entry => fields.map(field => entry[field])));
        if (!reportedDuplicates.has(item.signature) && states(matches) !== states(currentMatches)) {
          stateChanges.push(`${item.signature}: ambiguous repeated items changed; inspect the full snapshot`);
          reportedDuplicates.add(item.signature);
        }
        continue;
      }
      for (const field of fields) {
        const was = matches[0]![field];
        if (was !== item[field]) {
          const show = (value: unknown) => value === undefined ? 'unavailable' : JSON.stringify(value);
          stateChanges.push(`${item.signature} ${field} ${show(was)} -> ${show(item[field])}`);
        }
      }
    }
    for (const line of stateChanges.slice(0, 5)) lines.push(`- state: ${line}`);
    if (stateChanges.length > 5) lines.push(`- (+${stateChanges.length - 5} more state changes)`);
    if (stateChanges.length > 0) changed = true;
  } else {
    lines.push('- interactive: item identity unavailable on this driver (no structured items)');
  }
  if (!changed) lines.push('- no observable change');
  return lines.join('\n');
}

export class AgentBrowserFacade {
  private readonly workspaceRoot: string;
  private readonly ownedSessions = new Set<string>();
  private readonly pendingOpens = new Set<Promise<ToolResult>>();
  private acceptingSessions = true;
  private disposal?: Promise<ToolResult>;
  private readonly api: AgentBrowserHostApi;
  private readonly evidenceRoot: string;
  private readonly resolveSourceMap?: SourceMapResolver;
  private readonly consoleBaselines = new Map<string, SignalWindow>();
  /** Network watermark per session: requests observed before the last navigation. */
  private readonly networkBaselines = new Map<string, SignalWindow>();
  /** Last snapshot facts per session, for diffing and stale-ref resolution (TF-0102). */
  private readonly snapshotFacts = new Map<string, SnapshotFacts>();
  /**
   * TF-0167: sessions whose human gate was just resumed. Cleared by the next plain observation.
   */
  private readonly hitlNeedsReobserve = new Map<string, string>();
  private readonly recorders = new Map<string, TimelineWriter>();
  private readonly recorderDirs = new Map<string, string>();
  /** Dedupe keys for auto-ingested network/console failure signals. */
  private readonly ingestedSignals = new Map<string, Set<string>>();
  private readonly modePolicy = new RuntimeModePolicy();
  /**
   * TF-0167: human-gate checkpoints. One store per facade, reusing the existing implementation.
   * Assigned in the constructor because it has to follow THIS facade's workspace root: the store
   * defaults to the process-wide sessions root, which made checkpoints (and their resume material)
   * leak across workspaces.
   */
  private readonly hitl: HitlSessionStore;
  private readonly replayExecutors = new Map<string, ReplayToolExecutor>();
  private readonly replayContexts = new Map<string, ReplayContext>();
  private readonly driverProfile: DriverProfile;

  constructor(options: FacadeOptions) {
    this.api = options.api;
    this.workspaceRoot = getWorkspaceRoot(options.workspaceRoot);
    this.hitl = new HitlSessionStore(getWorkspaceSessionsRoot(this.workspaceRoot));
    // Workspace jail default: <workspace>/.ae/evidence (TF-0017).
    // Explicit evidenceRoot (CLI --out / host) still wins; getDataDir is last-resort only.
    this.evidenceRoot = options.evidenceRoot ?? getWorkspaceEvidenceRoot(this.workspaceRoot);
    this.resolveSourceMap = options.resolveSourceMap;
    const concrete = options.driverProfile ? undefined : profileFromHostApi(options.api);
    this.driverProfile = options.driverProfile ?? { ...ASSUMED_FULL_DRIVER_PROFILE,
      unavailableMethods: new Set(['selectOption', 'selectValues', 'appendText', 'setChecked', 'pointer', 'drag', 'findElement', 'readForms', 'readDialogs', 'respondDialog', 'uploadFiles', 'downloadFile', 'semanticRead'].filter(method => !concrete?.methods?.has(method))),
    };
  }

  /** Driver capability profile used to gate the MCP tool surface (TF-0064). */
  getDriverProfile(): DriverProfile {
    return this.driverProfile;
  }

  /** Active evidence root (workspace `.ae/evidence` unless overridden). */
  getEvidenceRoot(): string {
    return this.evidenceRoot;
  }

  /** Workspace-relative ref path when possible; otherwise absolute. */
  private refPath(absolutePath: string): string {
    return toWorkspaceRelative(absolutePath, this.workspaceRoot) ?? absolutePath;
  }

  private sessionDir(sessionId: string): string {
    return getWorkspaceSessionDir(sessionId, this.workspaceRoot);
  }

  open(payload: AgentBrowserOpenPayload = {}, options?: { signal?: AbortSignal }): Promise<ToolResult> {
    if (!this.acceptingSessions) return Promise.resolve(errResult('E_DISPOSED', 'browser toolbox is disposing or disposed'));
    const pending = this.openSession(payload, options);
    this.pendingOpens.add(pending);
    void pending.then(() => this.pendingOpens.delete(pending), () => this.pendingOpens.delete(pending));
    return pending;
  }

  private async openSession(payload: AgentBrowserOpenPayload, options?: { signal?: AbortSignal }): Promise<ToolResult> {
    try {
      const result = await (options ? this.api.open(payload, options) : this.api.open(payload));
      if (!result.success) {
        throw new Error(result.error ?? 'open failed');
      }
      this.ownedSessions.add(result.session.id);
      return okResult(`session ${result.session.id} opened${result.pendingDialog?'; navigation waiting for a dialog':''}`, { session: result.session,...(result.pendingDialog?{pendingDialog:result.pendingDialog}:{}) });
    } catch (error) {
      const recoverySessionId = (error as { recoverySessionId?: unknown } | null)?.recoverySessionId;
      if (typeof recoverySessionId === 'string' && /^[A-Za-z0-9_-]{1,64}$/u.test(recoverySessionId)) {
        this.ownedSessions.add(recoverySessionId);
        return errResult('E_OPEN', toMessage(error), { recoverySessionId, recoveryHint: recoveryHint(error,false) });
      }
      return errResult('E_OPEN', toMessage(error), { recoveryHint: recoveryHint(error,false) });
    }
  }

  /** Drain pending opens and close only sessions created here. Failed cleanup can be retried. */
  dispose(): Promise<ToolResult> {
    this.acceptingSessions = false;
    if (this.disposal) return this.disposal;
    const pending = (async () => {
      await Promise.all([...this.pendingOpens]);
      const failures: Array<{ sessionId: string; error: string }> = [];
      for (const sessionId of [...this.ownedSessions]) {
        const result = await this.close(sessionId);
        if (!result.ok) failures.push({ sessionId, error: result.content });
      }
      return failures.length ? errResult('E_DISPOSE', 'some owned sessions could not be closed; retry disposal', { failures }) : okResult('browser toolbox disposed');
    })();
    this.disposal = pending;
    void pending.then(() => { this.disposal = undefined; }, () => { this.disposal = undefined; });
    return pending;
  }

  async nav(sessionId: string, url: string, waitUntil?: 'dom-ready' | 'load'): Promise<ToolResult> {
    const hitlBlocked = await this.hitlGate(sessionId); if (hitlBlocked) return hitlBlocked;
    // Watermarks BEFORE navigation: everything the target page emits — including
    // its own 404 or console error — stays inside the verdict window, while the
    // previous page's signals stay out of it (TF-0095).
    const [networkWatermark, consoleWatermark] = await Promise.all([
      this.networkWindow(sessionId),
      this.consoleWindow(sessionId),
    ]);
    try {
      const result = await this.api.navigate({ sessionId, url, ...(waitUntil ? { waitUntil } : {}) });
      if (!result.success) throw new Error(result.error ?? 'navigation failed');
      if(result.pendingDialog)return okResult('navigation waiting for a dialog; inspect vb_dialogs before continuing',{session:result.session,pendingDialog:result.pendingDialog});
      if (networkWatermark) this.networkBaselines.set(sessionId, networkWatermark);
      this.consoleBaselines.set(sessionId, consoleWatermark);
      await this.note(sessionId, 'action', 'nav', { url }, true);
      return okResult(`navigated to ${result.session.url ?? url}`, { session: result.session });
    } catch (error) {
      await this.note(sessionId, 'action', 'nav', { url }, false);
      return errResult('E_NAV', toMessage(error), { recoveryHint: recoveryHint(error,false) });
    }
  }

  /**
   * TF-0101: one observation call for an agent — interactive refs (default) and,
   * on request, budgeted visible page text in the same reply, so a "read then
   * act" turn does not need two round-trips. The default output is byte-identical
   * to before (published snapshot readings must not move).
   */
  async snapshot(
    sessionId: string,
    options: { includeText?: boolean; textChars?: number; diff?: boolean; selector?: string; paged?: boolean; cursor?: string } = {},
  ): Promise<ToolResult> {
    try {
      if ((options.selector !== undefined || options.paged || options.cursor !== undefined) && (options.includeText || options.diff)) return errResult('E_ARG', 'scoped/paged snapshots require includeText and diff to be omitted; read text separately');
      if (options.selector !== undefined && !this.driverProfile.readFeatures?.has('scopedSnapshot')) return errResult('E_NOT_IMPLEMENTED', 'driver does not declare scoped snapshots');
      if ((options.paged || options.cursor !== undefined) && !this.driverProfile.readFeatures?.has('pagedSnapshot')) return errResult('E_NOT_IMPLEMENTED', 'driver does not declare paged snapshots');
      const result = await this.api.takeSnapshot({ sessionId, ...(options.selector !== undefined ? { selector: options.selector } : {}), ...(options.paged ? { paged: true } : {}), ...(options.cursor !== undefined ? { cursor: options.cursor } : {}) });
      if (result.success === false) throw new Error(result.error ?? 'E_WAIT_COLLECTION: snapshot observation failed');
      // TF-0167: a plain observation satisfies the post-human "re-observe before acting" rule.
      if (options.selector === undefined && !options.paged && options.cursor === undefined) this.hitlNeedsReobserve.delete(sessionId);
      const interactive =
        result.snapshot.length > 8000 ? `${result.snapshot.slice(0, 8000)}...` : result.snapshot;
      const data: Record<string, unknown> = { snapshot: result.snapshot, ...(options.selector !== undefined ? { scope: { selector: options.selector, sessionId } } : {}) };
      if (result.page) { delete data.snapshot; data.page = result.page; }

      // TF-0102: remember the facts, and on request say what moved since last time.
      const previous = this.snapshotFacts.get(sessionId);
      const current: SnapshotFacts = {
        ...parseSnapshotFacts(result.snapshot),
        ...(result.items
          ? {
              items: result.items.map(indexSnapshotItem),
            }
          : {}),
        at: Date.now(),
      };
      this.snapshotFacts.set(sessionId, current);

      let content = interactive;
      if (result.page) content = `Observation page: ${JSON.stringify(result.page)}\n${content}`;

      // OBS-03 / TF-0109: the change summary goes **before** the page-text section.
      // The model-facing envelope caps content at 12,000 chars and clips from the
      // tail (src/mcp/result-envelope.ts) while the facade may assemble up to
      // 8,000 (interactive) + 20,000 (text). With the diff appended last, combining
      // `includeText` with `diff` pushed the whole "what changed" block — including
      // the TF-0107 `state:` lines — out of the model's context, which is exactly
      // the affordance that is supposed to save a re-read.
      if (options.diff) {
        content += `\n\n${
          previous
            ? formatSnapshotDiff(previous, current)
            : '## Since last snapshot\n(first snapshot in this session — no baseline)'
        }`;
        data.diff = Boolean(previous);
      }

      if (options.includeText) {
        // Honour the caller's budget (only capped, never silently raised).
        const budget = Math.min(Math.max(Math.trunc(options.textChars ?? 4_000), 1), 20_000);
        if (!this.servesDriverMethod('extractPageText')) {
          content += '\n\n## Text\n(unavailable: this driver does not serve extractPageText)';
          data.textUnavailable = true;
        } else {
          const extracted = await this.api.extractPageText({
            sessionId,
            rules: [],
            extractMode: 'text',
            selectorType: 'css',
            allowFallback: true,
            maxLength: budget,
          });
          if (extracted.success === false) {
            content += `\n\n## Text\n(unavailable: ${extracted.error ?? 'extractPageText reported failure'})`;
            data.textUnavailable = true;
          } else {
            content += `\n\n## Text (${extracted.text.length} chars${extracted.truncated ? ', truncated' : ''})\n${extracted.text}`;
            data.text = {
              text: extracted.text,
              chars: extracted.text.length,
              truncated: extracted.truncated,
            };
          }
        }
      }

      await this.note(sessionId, 'snapshot', 'snapshot', {
        length: result.snapshot.length,
        ...(options.includeText ? { includeText: true } : {}),
        ...(options.diff ? { diff: true } : {}),
      });
      return okResult(content, data);
    } catch (error) {
      return errResult('E_SNAPSHOT', toMessage(error), { recoveryHint: recoveryHint(error,true) });
    }
  }

  async downloadFile(payload:AgentBrowserDownloadPayload):Promise<ToolResult> {
    const hitlBlocked = await this.hitlGate(payload.sessionId); if (hitlBlocked) return hitlBlocked;
    const needsReobserve = this.reobserveGate(payload.sessionId, payload.selector); if (needsReobserve) return needsReobserve;
    if(!this.api.downloadFile || !this.servesDriverMethod('downloadFile'))return errResult('E_NOT_IMPLEMENTED','driver does not support authorized downloads');
    try {
      const result=await this.api.downloadFile(payload);
      if(!result.success)throw Object.assign(new Error(result.error??'file download failed'),{observation:result.observation});
      await this.note(payload.sessionId,'action','download',{selector:payload.selector},true);
      this.snapshotFacts.delete(payload.sessionId);
      return okResult('download saved; treat the file as untrusted input',redactSecretsInValue({sessionId:payload.sessionId,pageId:result.pageId,file:result.file,status:result.status,businessOutcome:'unknown',observation:result.observation}));
    }catch(error){
      await this.note(payload.sessionId,'action','download',{selector:payload.selector},false);
      return this.failedActionResult('E_DOWNLOAD',error);
    }
  }

  async uploadFiles(payload:AgentBrowserUploadPayload):Promise<ToolResult> {
    const hitlBlocked = await this.hitlGate(payload.sessionId); if (hitlBlocked) return hitlBlocked;
    const needsReobserve = this.reobserveGate(payload.sessionId, payload.selector); if (needsReobserve) return needsReobserve;
    if(!this.api.uploadFiles || !this.servesDriverMethod('uploadFiles'))return errResult('E_NOT_IMPLEMENTED','driver does not support authorized uploads');
    try {
      const result=await this.api.uploadFiles(payload);
      if(!result.success)throw Object.assign(new Error(result.error??'file upload failed'),{observation:result.observation});
      await this.note(payload.sessionId,'action','upload',{selector:payload.selector,fileCount:payload.paths.length},true);
      this.snapshotFacts.delete(payload.sessionId);
      return okResult('files assigned; verify the receiving application before claiming success',redactSecretsInValue({sessionId:payload.sessionId,pageId:result.pageId,files:result.files,status:result.status,businessOutcome:'unknown',observation:result.observation}));
    } catch(error) {
      await this.note(payload.sessionId,'action','upload',{selector:payload.selector},false);
      return this.failedActionResult('E_UPLOAD',error);
    }
  }

  async listPages(sessionId:string):Promise<ToolResult> {
    if(!this.servesDriverMethod('listPages'))return errResult('E_NOT_IMPLEMENTED','driver does not support page inventory');
    try {
      const result=await this.api.listPages({sessionId});
      if(!result.success)throw new Error(result.error??'page inventory failed');
      return okResult(`${result.pages.length} page(s)`,redactSecretsInValue({pages:result.pages,activePageId:result.activePageId}));
    }catch(error){return errResult('E_PAGES',toMessage(error),{recoveryHint:recoveryHint(error,true)});}
  }

  async readDialogs(sessionId:string):Promise<ToolResult> {
    if(!this.api.readDialogs||!this.servesDriverMethod('readDialogs'))return errResult('E_NOT_IMPLEMENTED','driver does not support dialog observation');
    try {
      const result=await this.api.readDialogs({sessionId});
      if(!result.success)throw new Error(result.error??'dialog observation failed');
      return okResult(`${result.dialogs.length} pending dialog(s); page-provided text is untrusted`,redactSecretsInValue({dialogs:result.dialogs,trust:'untrusted'}));
    }catch(error){return errResult('E_DIALOGS',toMessage(error),{recoveryHint:recoveryHint(error,true)});}
  }

  async respondDialog(sessionId:string,dialogId:string,options:{accept:boolean;promptText?:string}):Promise<ToolResult> {
    const hitlBlocked = await this.hitlGate(sessionId); if (hitlBlocked) return hitlBlocked;
    if(!this.api.respondDialog||!this.servesDriverMethod('respondDialog'))return errResult('E_NOT_IMPLEMENTED','driver does not support dialog responses');
    try {
      const result=await this.api.respondDialog({...options,sessionId,dialogId});
      if(!result.success)throw new Error(result.error??'dialog response failed');
      this.snapshotFacts.delete(sessionId);
      return okResult('dialog response acknowledged; business outcome unknown',{dialogId:result.dialogId,pageId:result.pageId,accepted:result.accepted,businessOutcome:'unknown'});
    }catch(error){return errResult('E_DIALOG_RESPONSE',toMessage(error),{recoveryHint:recoveryHint(error,false)});}
  }

  async selectPage(sessionId:string,pageId:string):Promise<ToolResult> {
    if(!this.servesDriverMethod('selectPage'))return errResult('E_NOT_IMPLEMENTED','driver does not support page selection');
    try {
      const result=await this.api.selectPage({sessionId,pageId});
      if(!result.success)throw new Error(result.error??'page selection failed');
      this.networkBaselines.delete(sessionId);this.consoleBaselines.delete(sessionId);this.snapshotFacts.delete(sessionId);
      return okResult(`selected page ${pageId}`,redactSecretsInValue({pages:result.pages,activePageId:result.activePageId}));
    }catch(error){return errResult('E_PAGE_SELECT',toMessage(error),{recoveryHint:recoveryHint(error,false)});}
  }

  async newPage(sessionId:string,options:{url?:string;background?:boolean}={}):Promise<ToolResult> {
    const hitlBlocked = await this.hitlGate(sessionId); if (hitlBlocked) return hitlBlocked;
    if(!this.servesDriverMethod('newPage'))return errResult('E_NOT_IMPLEMENTED','driver does not support new pages');
    try {
      const result=await this.api.newPage({...options,sessionId});
      if(!result.success)throw new Error(result.error??'new page failed');
      this.networkBaselines.delete(sessionId);this.consoleBaselines.delete(sessionId);this.snapshotFacts.delete(sessionId);
      return okResult(result.pendingDialog?'page created; navigation waiting for a dialog':'page created',redactSecretsInValue({pages:result.pages,activePageId:result.activePageId,createdPageId:result.createdPageId,...(result.pendingDialog?{pendingDialog:result.pendingDialog}:{})}));
    }catch(error){return errResult('E_PAGE_NEW',toMessage(error),{recoveryHint:recoveryHint(error,false)});}
  }

  async closePage(sessionId:string,pageId?:string):Promise<ToolResult> {
    if(!this.servesDriverMethod('closePage'))return errResult('E_NOT_IMPLEMENTED','driver does not support closing pages');
    try {
      const result=await this.api.closePage({sessionId,...(pageId===undefined?{}:{pageId})});
      if(!result.success)throw new Error(result.error??'page close failed');
      this.networkBaselines.delete(sessionId);this.consoleBaselines.delete(sessionId);this.snapshotFacts.delete(sessionId);
      return okResult(result.activePageId?'page closed':'page closed; explicitly select a remaining page',redactSecretsInValue({pages:result.pages,activePageId:result.activePageId,closedPageId:result.closedPageId}));
    }catch(error){return errResult('E_PAGE_CLOSE',toMessage(error),{recoveryHint:recoveryHint(error,false)});}
  }

  async semanticRead(payload: AgentBrowserSemanticPayload, options?: { signal?: AbortSignal }): Promise<ToolResult> {
    if (!this.api.semanticRead) return errResult('E_SEMANTIC_CONFIG', 'semantic read requires a host-configured model gateway');
    try {
      const result = await this.api.semanticRead(payload, options);
      if (!result.success) throw new Error(result.error ?? 'semantic read failed');
      const data = redactSecretsInValue({ mode: 'semantic', action: payload.action, value: result.value, source: result.source, model: result.model, trust: 'untrusted', businessOutcome: 'unknown' });
      const output = okResult('Model-assisted read; independently verify extracted facts and reobserve before acting.', data);
      if (JSON.stringify(output).length > 5500) return errResult('E_OUTPUT_BUDGET', 'semantic result exceeds response budget; narrow the instruction/schema', { source: data.source, model: data.model });
      return output;
    } catch (error) {
      return errResult('E_SEMANTIC', toMessage(error), { ...(error && typeof error === 'object' && 'semantic' in error ? { model: error.semantic } : {}), recoveryHint: recoveryHint(error, true) });
    }
  }

  async readForms(sessionId: string, selector?: string): Promise<ToolResult> {
    if (!this.api.readForms) return errResult('E_NOT_IMPLEMENTED','driver does not support form overview');
    try {
      const result = await this.api.readForms({sessionId,selector});
      if (!result.success) throw new Error(result.error ?? 'E_WAIT_COLLECTION: form observation failed');
      const data = redactSecretsInValue({fields:result.fields,scope:{...result.scope,sessionId},trust:'untrusted'});
      const output = okResult('Read-only form fields; server validation remains unknown.',data);
      if (JSON.stringify(output).length > 5500) return errResult('E_OUTPUT_BUDGET','form overview exceeds response budget; narrow selector');
      return output;
    } catch(error) { return errResult('E_FORMS',toMessage(error), { recoveryHint: recoveryHint(error,true) }); }
  }

  async findElement(query: AgentBrowserFindPayload): Promise<ToolResult> {
    if (!this.api.findElement) return errResult('E_NOT_IMPLEMENTED', 'driver does not support exact reference queries');
    try {
      const result = await this.api.findElement(query);
      if (!result.success) throw new Error(result.error ?? 'E_WAIT_COLLECTION: query failed');
      return okResult(`${result.match}: ${result.count} exact target(s)${result.match === 'ambiguous' ? '; narrow the query before acting' : ''}`, {
        match: result.match, count: result.count, scope: result.scope, ...(result.item ? { item: result.item } : {}), ...(result.details ? { details: redactSecretsInValue(result.details) } : {}),
      });
    } catch (error) { return errResult('E_FIND', toMessage(error), { recoveryHint: recoveryHint(error,true) }); }
  }

  /** Does the active driver really serve this host-api method? */
  private servesDriverMethod(method: string): boolean {
    const methods = this.driverProfile.methods;
    return methods === null || methods.has(method);
  }

  /**
   * TF-0102: a dead `[data-vb-ref]` is the most common real friction (a real run
   * burned a 5s timeout on one). Offer only a uniquely similar candidate for
   * inspection: a matching signature does not establish element identity.
   */
  private async staleRefNote(sessionId: string, selector: string): Promise<string> {
    const match = /\[data-vb-ref=["']([^"']+)["']\]/u.exec(selector);
    if (!match) return '';
    const ref = match[1] as string;
    const oldItem = this.snapshotFacts.get(sessionId)?.items?.find((item) => item.ref === ref);
    if (!oldItem) return refHint(selector);
    try {
      const fresh = await this.api.takeSnapshot({ sessionId });
      const items = (fresh.items ?? []).map(indexSnapshotItem);
      this.snapshotFacts.set(sessionId, {
        ...parseSnapshotFacts(fresh.snapshot),
        items,
        at: Date.now(),
      });
      const candidates = items.filter((item) => item.signature === oldItem.signature);
      const prefix = ` — ref "${ref}" could not be used (${oldItem.signature})`;
      if (candidates.length > 1) return `${prefix}; ${candidates.length} similar candidates; identity is ambiguous. Inspect a fresh snapshot; no action was replayed`;
      return candidates.length === 1
        ? `${prefix}; similar candidate [data-vb-ref="${candidates[0]!.ref}"], but identity is not confirmed. Inspect before acting; no action was replayed`
        : `${prefix}; no similar candidate in the fresh snapshot; observe again before acting`;
    } catch {
      return refHint(selector);
    }
  }

  /**
   * TF-0098: budgeted page-text read (visible text, whitespace-normalized,
   * truncation declared). Without a selector the whole page body is read, so an
   * agent can quote a page instead of inferring content from the interactive
   * snapshot — which carries no body text at all.
   */
  async extractPageText(options: {
    metadata?: boolean;
    rows?: import('../types/host-api.ts').AgentBrowserExtractPageTextPayload['rows'];
    structured?: boolean;
    sessionId: string;
    selector?: string;
    maxLength?: number;
    extractMode?: 'text' | 'all';
    selectorType?: 'css' | 'xpath';
    /** TF-0164 frame scope: a frameId from the page inventory, or omitted / "main". */
    frameId?: string;
  }): Promise<ToolResult> {
    try {
      if ((options.rows || options.metadata) && !this.driverProfile.readFeatures?.has('rowExtraction')) return errResult('E_NOT_IMPLEMENTED', 'driver does not declare deterministic extraction');
      if (options.structured && !this.driverProfile.readFeatures?.has('structuredText')) return errResult('E_NOT_IMPLEMENTED', 'driver does not declare structured text');
      const selector = options.selector?.trim();
      /*
       * 2026-10-03：调用方**给了 selector** 时不再允许静默回退。
       *
       * 旧行为（实测）：`vb_page_text {selector:'#does-not-exist'}` 返回 ok:true，content 却是**整页正文**，
       * 唯一信号是 `data.usedFallback`——而 payload 大时信封会省略 `data`，恰好在正文长到需要预算时信号丢失；
       * 导航期间还会回退成**上一页**的文本。调用方按 selector 取到的可能不是它要的东西，却无从分辨。
       * 现在：给了 selector 却没产出可见正文 → 稳定错误码 + 指名 selector；不给 selector 时保持整页语义。
       */
      const allowFallback = !selector;
      const result = await this.api.extractPageText({
        ...(options.metadata ? { metadata: true } : {}),
        ...(options.rows ? { rows: options.rows } : {}),
        ...(options.structured ? { structured: true } : {}),
        sessionId: options.sessionId,
        ...(options.frameId !== undefined ? { frameId: options.frameId } : {}),
        rules: selector
          ? [
              {
                id: 'inline-selector',
                alias: 'inline-selector',
                urlPattern: '.*',
                selectorsText: selector,
                sortOrder: 0,
                createdAt: 0,
                updatedAt: 0,
              },
            ]
          : [],
        extractMode: options.extractMode ?? 'text',
        selectorType: options.selectorType ?? 'css',
        allowFallback,
        ...(options.maxLength !== undefined ? { maxLength: options.maxLength } : {}),
      });
      if (result.success === false) {
        throw new Error(result.error ?? 'E_WAIT_COLLECTION: extractPageText reported failure');
      }
      if (options.structured || options.rows || options.metadata) {
        const blocks = JSON.parse(result.text) as Array<{ links?: Array<{ href: string }> }>;
        if (!Array.isArray(blocks)) throw new Error('E_EXTRACTION_RESULT: structured blocks unavailable');
        if (options.structured) for (const block of blocks) for (const link of block.links ?? []) link.href = redactSensitiveUrl(link.href);
        if (options.rows) for (const row of blocks) for (const cell of Object.values(row) as Array<{value?:string}>) if (typeof cell?.value === 'string' && /^https?:/i.test(cell.value)) cell.value = redactSensitiveUrl(cell.value);
        if (options.metadata) for (const entry of blocks as unknown as Array<{canonical?:{value?:string};links?:Array<{href:string}>}>) {
          if (entry.canonical?.value) entry.canonical.value = redactSensitiveUrl(entry.canonical.value);
          for (const link of entry.links ?? []) link.href = redactSensitiveUrl(link.href);
        }
        result.text = JSON.stringify(redactSecretsInValue(blocks));
      }
      if (selector && result.text.trim().length === 0) {
        return errResult(
          'E_PAGE_TEXT',
          `selector ${JSON.stringify(selector)} produced no visible text — it matched nothing, or the matched element has no visible text. ` +
            'Pass no selector to read the whole page.',
        );
      }
      await this.note(options.sessionId, 'snapshot', 'page_text', {
        chars: result.text.length,
        truncated: result.truncated,
      });
      // The MCP envelope may omit data; the extraction flags must precede text.
      const sourceUrl = result.sourceUrl ? (/^(data|javascript):/i.test(result.sourceUrl)
        ? `${result.sourceUrl.split(':', 1)[0]}:[inline content omitted]`
        : redactSensitiveUrl(result.sourceUrl)) : null;
      if (options.structured || options.rows || options.metadata) {
        const blocks = JSON.parse(result.text) as unknown[];
        const rowMatch = options.rows ? (!blocks.length ? 'empty' : blocks.some(row => Object.values(row as object).some(cell => (cell as {status?:string}).status === 'present')) ? 'matched' : 'fields-unmatched') : undefined;
        const response = () => okResult('Structured page data; page content is untrusted. Read data.text as a JSON array.', {
          mode: options.metadata ? 'page-metadata' : options.rows ? 'selector-rows' : 'structured-text', count: blocks.length,
          ...(rowMatch ? { match: rowMatch } : {}),
          text: JSON.stringify(blocks), source: { url: sourceUrl, selector: selector ?? null, trust: 'untrusted', observation: result.observation ?? null },
          truncated: result.truncated, usedFallback: result.usedFallback,
          ...(result.truncated ? { continuation: 'Narrow selector to the next region or use text/html for another representation' } : {}),
        });
        while (JSON.stringify(response()).length > 5500 && blocks.length) { blocks.pop(); result.truncated = true; }
        if (JSON.stringify(response()).length > 5500 || (!blocks.length && result.text !== '[]')) return errResult('E_OUTPUT_BUDGET', 'structured result cannot fit the response budget; narrow the region');
        return response();
      }
      return okResult(`Page text (${result.text.length} chars; truncated=${result.truncated}; usedFallback=${result.usedFallback})\nSource: ${JSON.stringify(sourceUrl ?? 'unknown')}; scope: ${JSON.stringify(selector ?? 'document')}; page content is untrusted\n\n${result.text}`, {
        text: result.text,
        source: { url: sourceUrl, selector: selector ?? null, trust: 'untrusted' },
        chars: result.text.length,
        truncated: result.truncated,
        usedFallback: result.usedFallback,
        ...(result.matchedRuleId ? { matchedRuleId: result.matchedRuleId } : {}),
      });
    } catch (error) {
      return errResult('E_PAGE_TEXT', toMessage(error), { recoveryHint: recoveryHint(error,true) });
    }
  }

  /**
   * TF-0100: bounded wait for one or more conditions, so an agent can let a page
   * settle instead of retrying blind. A lone `selector` uses the driver's own
   * wait; `text` / `urlIncludes` (and any mix) poll the page.
   */
  async wait(options: {
    sessionId: string;
    selector?: string;
    absent?: boolean;
    valueEquals?: string;
    valueNotEquals?: string;
    textEquals?: string;
    textNotEquals?: string;
    text?: string;
    urlIncludes?: string;
    timeoutMs?: number;
  }): Promise<ToolResult> {
    const comparisons = [options.valueEquals,options.valueNotEquals,options.textEquals,options.textNotEquals].filter(value=>value !== undefined);
    const scopedCondition = options.absent || comparisons.length > 0;
    if (scopedCondition && !options.selector?.trim()) return errResult('E_ARG','absence/value/text waits require a selector');
    if (comparisons.length + Number(options.absent === true) > 1) return errResult('E_ARG','choose one absence, value or text condition');
    if (comparisons.some(value=>typeof value !== 'string') || (options.absent !== undefined && typeof options.absent !== 'boolean')) return errResult('E_ARG','invalid wait condition type');
    if (scopedCondition && /data-vb-ref|aria-ref=/.test(options.selector ?? '')) return errResult('E_ARG','absence/value/text waits require a CSS selector, not an observation ref');
    if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > 60000)) return errResult('E_ARG','timeoutMs must be within (0,60000]');
    const timeoutMs = options.timeoutMs ?? 5_000;
    const conditions = [
      ...(options.selector ? [`selector ${options.selector}`] : []),
      ...(options.absent ? ['absent'] : []),
      ...(options.valueEquals !== undefined ? ['value equals requested value'] : []),
      ...(options.valueNotEquals !== undefined ? ['value differs from previous value'] : []),
      ...(options.textEquals !== undefined ? ['text equals requested text'] : []),
      ...(options.textNotEquals !== undefined ? ['text differs from previous text'] : []),
      ...(options.text ? [`text ${JSON.stringify(options.text)}`] : []),
      ...(options.urlIncludes ? [`url~${options.urlIncludes}`] : []),
    ];
    if (conditions.length === 0) {
      return errResult('E_WAIT', 'wait requires at least one of: selector, text, urlIncludes');
    }
    const startedAt = Date.now();
    const deadline = startedAt + timeoutMs;
    const boundedRead = async <T>(read: () => T | Promise<T>): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (Date.now() >= deadline) throw new Error(`timeout after ${timeoutMs}ms waiting for condition observation`);
      try {
        return await Promise.race([read(),new Promise<never>((_,reject)=>{
          timer=setTimeout(()=>reject(new Error(`timeout after ${timeoutMs}ms waiting for condition observation`)),Math.max(0,deadline-Date.now()));
        })]);
      } finally { clearTimeout(timer); }
    };
    try {
      if (options.selector && !options.text && !options.urlIncludes && !scopedCondition) {
        const waited = await boundedRead(() => this.api.waitForSelector({
          sessionId: options.sessionId,
          selector: options.selector!,
          timeoutMs,
        }));
        if (!waited.success) throw new Error(waited.error ?? 'driver wait failed');
      } else {
        const expression = buildWaitExpression(options);
        for (;;) {
          if (Date.now() >= deadline) {
            throw new Error(`timeout after ${timeoutMs}ms waiting for ${conditions.join(' and ')}`);
          }
          let probe;
          let transient = false;
          try {
            probe = await boundedRead(() => this.api.evaluate({ sessionId: options.sessionId, expression }));
          } catch (error) {
            if (!isNavigationReadError(error)) throw error;
            transient = true;
          }
          if (!transient) {
            if (probe?.success === false) throw new Error(`E_WAIT_COLLECTION: ${probe.error ?? 'condition observation failed'}`);
            if (typeof probe?.value !== 'boolean') throw new Error('E_WAIT_COLLECTION: missing boolean condition observation');
            if (probe.value) break;
          }
          if (Date.now() >= deadline) {
            throw new Error(`timeout after ${timeoutMs}ms waiting for ${conditions.join(' and ')}`);
          }
          await new Promise((resolve) => setTimeout(resolve, Math.min(250, deadline - Date.now())));
        }
      }
      const elapsedMs = Date.now() - startedAt;
      await this.note(
        options.sessionId,
        'action',
        'wait',
        { conditions: conditions.join(' and '), elapsedMs },
        true,
      );
      return okResult(`waited ${elapsedMs}ms for ${conditions.join(' and ')}`, {
        elapsedMs,
        conditions,
      });
    } catch (error) {
      await this.note(
        options.sessionId,
        'action',
        'wait',
        { conditions: conditions.join(' and ') },
        false,
      );
      return errResult(
        'E_WAIT',
        `waited ${Date.now() - startedAt}ms for ${conditions.join(' and ')} — ${toMessage(error)}${options.selector ? refHint(options.selector) : ''}`,
        { recoveryHint: recoveryHint(error,true) },
      );
    }
  }

  /**
   * 2026-10-03：Chromium 在资源压力下会**偶发**返回
   * `Protocol error (Page.captureScreenshot): Unable to capture screenshot`（日志显示字体已加载完；
   * Chromium 返回空图像，尚未确定复制 surface 失败的触发原因）。实测它只在整套并发负载下出现（15 fork × 数十个 Chromium、
   * 空闲内存降到 ~1 GB），定向压测 1800 次截图反而不复现。产品当时如实返回 `E_SCREENSHOT`，
   * 但 agent 的 verify 证据包会因此缺截图。
   *
   * 这里只对该协议错误做**一次**有界重试（150ms 短路延迟）：二次仍失败就原样抛出，不掩盖真错；
   * 其它错误（未知会话、页面已关闭等）**不重试**，失败语义不变。
   */
  private async captureScreenshot(sessionId: string, fullPage?: boolean, selector?: string) {
    const take = () => this.api.screenshot({ sessionId, ...(fullPage ? { fullPage: true } : {}), ...(selector !== undefined ? { selector } : {}) });
    // The upstream adapter retries once inside its original deadline and pinned page/element.
    if (this.driverProfile.kind === 'upstream') return take();
    try {
      return await take();
    } catch (error) {
      if (!/Protocol error \(Page\.captureScreenshot\): Unable to capture screenshot/iu.test(toMessage(error))) throw error;
      await new Promise((resolve) => setTimeout(resolve, 150));
      return take();
    }
  }

  async screenshotToDisk(
    sessionId: string,
    options: { fullPage?: boolean; fileName?: string; selector?: string } = {},
  ): Promise<ToolResult> {
    if (options.selector !== undefined && (typeof options.selector !== 'string' || !options.selector.trim() || options.fullPage)) return errResult('E_ARG', 'screenshot selector must be nonempty and cannot be combined with fullPage');
    if (options.selector !== undefined && !this.driverProfile.readFeatures?.has('elementScreenshot')) return errResult('E_NOT_IMPLEMENTED', 'driver does not declare element screenshots');
    try {
      const result = await this.captureScreenshot(sessionId, options.fullPage, options.selector);
      if (!result.success) throw new Error(result.error ?? 'screenshot failed');
      const evidence = await this.writeScreenshot(sessionId, result.dataUrl, options.fileName);
      await this.note(sessionId, 'action', 'screenshot', { path: evidence.path }, true);
      return okResult(
        `screenshot saved: ${evidence.path}`,
        { path: evidence.path, size: evidence.size, format: 'png', capture: result.capture ?? { kind: options.fullPage ? 'fullPage' : 'viewport', metrics: { state: 'unavailable' } } },
        [evidence],
      );
    } catch (error) {
      return errResult('E_SCREENSHOT', toMessage(error));
    }
  }

  async click(sessionId: string, selector: string, timeoutMs?: number, after?: 'popup' | 'download' | 'navigation'): Promise<ToolResult> {
    const hitlBlocked = await this.hitlGate(sessionId); if (hitlBlocked) return hitlBlocked;
    const needsReobserve = this.reobserveGate(sessionId, selector); if (needsReobserve) return needsReobserve;
    try {
      if (after !== undefined && !['popup','download','navigation'].includes(after)) return errResult('E_ARG','unknown after event');
      if (after && !this.driverProfile.clickAfter) return errResult('E_NOT_IMPLEMENTED','driver does not declare click event waits');
      const timeout = timeoutMs ?? 5000;
      if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 60000) throw new Error('E_ARG: timeoutMs must be within (0, 60000]');
      const deadline = Date.now() + timeout;
      const waited = await this.api.waitForSelector({
        sessionId,
        selector,
        timeoutMs: timeout,
      });
      if (!waited.success) throw new Error(waited.error ?? 'target wait failed; click not performed');
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('E_CLICK_TIMEOUT: deadline expired before click; action not performed');
      const result = await this.api.click({
        sessionId,
        selector,
        timeoutMs: remaining,
        ...(after ? { after } : {}),
      });
      if (!result.success) throw Object.assign(new Error(result.error ?? 'click failed'), {observation:result.observation});
      await this.note(sessionId, 'action', 'click', { selector }, true);
      const observation = result.observation ? { ...result.observation, beforeUrl: redactSensitiveUrl(result.observation.beforeUrl), afterUrl: redactSensitiveUrl(result.observation.afterUrl) } : { changed:'unknown', businessOutcome:'unknown' };
      return okResult(`clicked ${selector}; observed change=${observation.changed}; business outcome unknown`, { session: result.session, observation,
        ...(result.fieldChange ? {fieldChange:redactSecretsInValue(result.fieldChange),targetChange:result.fieldChange.changed===true?'changed':result.fieldChange.changed===false?'no_change':'unknown'} : {targetChange:'unknown'}) });
    } catch (error) {
      await this.note(sessionId, 'action', 'click', { selector }, false);
      return this.failedActionResult('E_CLICK',error,await this.staleRefNote(sessionId, selector));
    }
  }

  async pointer(payload: AgentBrowserPointerPayload): Promise<ToolResult> {
    const hitlBlocked = await this.hitlGate(payload.sessionId); if (hitlBlocked) return hitlBlocked;
    const needsReobserve = this.reobserveGate(payload.sessionId, payload.selector); if (needsReobserve) return needsReobserve;
    if (!this.api.pointer) return errResult('E_NOT_IMPLEMENTED', 'driver does not support pointer actions');
    try {
      const result = await this.api.pointer(payload);
      if (!result.success) throw Object.assign(new Error(result.error ?? 'pointer action failed'),{observation:result.observation});
      await this.note(payload.sessionId, 'action', payload.action, { selector: payload.selector }, true);
      return this.observedActionResult(`${payload.action} executed; observe the page to confirm its effect`, result);
    } catch (error) {
      await this.note(payload.sessionId, 'action', payload.action, { selector: payload.selector }, false);
      return this.failedActionResult('E_POINTER',error);
    }
  }

  async drag(payload: AgentBrowserDragPayload): Promise<ToolResult> {
    const hitlBlocked = await this.hitlGate(payload.sessionId); if (hitlBlocked) return hitlBlocked;
    const needsReobserve = this.reobserveGate(payload.sessionId, payload.sourceSelector) ?? this.reobserveGate(payload.sessionId, payload.targetSelector); if (needsReobserve) return needsReobserve;
    if (!this.api.drag) return errResult('E_NOT_IMPLEMENTED', 'driver does not support drag');
    try {
      const result = await this.api.drag(payload);
      if (!result.success) throw Object.assign(new Error(result.error ?? 'drag failed'),{observation:result.observation});
      await this.note(payload.sessionId, 'action', 'drag', { sourceSelector: payload.sourceSelector, targetSelector: payload.targetSelector }, true);
      return this.observedActionResult('drag executed; observe the target to confirm its effect', result);
    } catch (error) {
      await this.note(payload.sessionId, 'action', 'drag', { sourceSelector: payload.sourceSelector, targetSelector: payload.targetSelector }, false);
      return this.failedActionResult('E_DRAG',error);
    }
  }

  async type(
    sessionId: string,
    selector: string,
    text: string,
    options: { clear?: boolean; timeoutMs?: number } = {},
  ): Promise<ToolResult> {
    const hitlBlocked = await this.hitlGate(sessionId); if (hitlBlocked) return hitlBlocked;
    const needsReobserve = this.reobserveGate(sessionId, selector); if (needsReobserve) return needsReobserve;
    try {
      const result = await this.api.type({
        sessionId,
        selector,
        text,
        ...(options.clear !== undefined ? { clear: options.clear } : {}),
        ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      });
      if (!result.success) throw Object.assign(new Error(result.error ?? 'typing failed'),{observation:result.observation});
      await this.note(sessionId, 'action', 'type', { selector }, true);
      return this.fieldResult(`typed into ${selector}`, result);
    } catch (error) {
      await this.note(sessionId, 'action', 'type', { selector }, false);
      return this.failedActionResult('E_TYPE',error,await this.staleRefNote(sessionId, selector));
    }
  }

  /**
   * TF-0113: bounded keyboard input. `vb_type` fills a field but never presses a
   * key, so an Enter-to-submit form (or a keyboard-navigated widget) could not be
   * driven at all. The key is validated by the driver's allow-list, and a
   * rejected key is reported as E_KEY / E_ARG rather than silently doing nothing.
   */
  async pressKey(sessionId: string, key: string, selector?: string): Promise<ToolResult> {
    const hitlBlocked = await this.hitlGate(sessionId); if (hitlBlocked) return hitlBlocked;
    const needsReobserve = this.reobserveGate(sessionId, selector); if (needsReobserve) return needsReobserve;
    try {
      const result = await this.api.pressKey({
        sessionId,
        key,
        ...(selector ? { selector } : {}),
      });
      if (!result.success) throw Object.assign(new Error(result.error ?? 'key action failed'),{observation:result.observation});
      await this.note(sessionId, 'action', 'press', { key, ...(selector ? { selector } : {}) }, true);
      return this.fieldResult(
        `pressed ${key}${selector ? ` (focus ${selector})` : ''}`,
        result,
      );
    } catch (error) {
      const code = (error as { code?: string }).code;
      await this.note(sessionId, 'action', 'press', { key, ...(selector ? { selector } : {}) }, false);
      // A disallowed key is an argument problem, not a driver failure.
      const errCode = code === 'E_KEY_NOT_ALLOWED' ? 'E_KEY_NOT_ALLOWED' : 'E_PRESS';
      return this.failedActionResult(errCode,error,selector ? await this.staleRefNote(sessionId, selector) : '');
    }
  }

  async selectOption(sessionId: string, selector: string, label: string, timeoutMs?: number): Promise<ToolResult> {
    const hitlBlocked = await this.hitlGate(sessionId); if (hitlBlocked) return hitlBlocked;
    const needsReobserve = this.reobserveGate(sessionId, selector); if (needsReobserve) return needsReobserve;
    if (typeof label !== 'string') return errResult('E_ARG', 'label must be a string');
    if (!this.api.selectOption) return errResult('E_NOT_IMPLEMENTED', 'driver does not support selectOption');
    try {
      const result = await this.api.selectOption({ sessionId, selector, label, timeoutMs });
      if (!result.success) throw Object.assign(new Error(result.error ?? 'selection failed'),{observation:result.observation});
      await this.note(sessionId, 'action', 'select', { selector }, true);
      return this.fieldResult(`selected option in ${selector}`, result);
    } catch (error) {
      await this.note(sessionId, 'action', 'select', { selector }, false);
      return this.failedActionResult('E_SELECT',error,await this.staleRefNote(sessionId, selector));
    }
  }

  async setChecked(sessionId: string, selector: string, checked: boolean, timeoutMs?: number): Promise<ToolResult> {
    const hitlBlocked = await this.hitlGate(sessionId); if (hitlBlocked) return hitlBlocked;
    const needsReobserve = this.reobserveGate(sessionId, selector); if (needsReobserve) return needsReobserve;
    if (typeof checked !== 'boolean') return errResult('E_ARG', 'checked must be a boolean');
    if (!this.api.setChecked) return errResult('E_NOT_IMPLEMENTED', 'driver does not support setChecked');
    try {
      const result = await this.api.setChecked({ sessionId, selector, checked, timeoutMs });
      if (!result.success) throw Object.assign(new Error(result.error ?? 'check failed'),{observation:result.observation});
      await this.note(sessionId, 'action', 'check', { selector, checked }, true);
      return this.fieldResult(`set checked=${checked} on ${selector}`, result);
    } catch (error) {
      await this.note(sessionId, 'action', 'check', { selector, checked }, false);
      return this.failedActionResult('E_CHECK',error,await this.staleRefNote(sessionId, selector));
    }
  }

  private observedActionResult(message: string, result: AgentBrowserActionResult): ToolResult {
    const observation = result.observation ? { ...result.observation,
      beforeUrl: redactSensitiveUrl(result.observation.beforeUrl), afterUrl: redactSensitiveUrl(result.observation.afterUrl),
      businessOutcome: 'unknown',
    } : { changed: 'unknown', businessOutcome: 'unknown' };
    return okResult(message, { session: result.session, observation: redactSecretsInValue(observation) });
  }

  private failedActionResult(code:string,error:unknown,note=''):ToolResult {
    const observation=(error as {observation?:AgentBrowserActionResult['observation']})?.observation;
    return errResult(code,`${toMessage(error)}${note}`,{recoveryHint:recoveryHint(error,false),...(observation?{observation:redactSecretsInValue({...observation,beforeUrl:redactSensitiveUrl(observation.beforeUrl),afterUrl:redactSensitiveUrl(observation.afterUrl)}),recovery:'observe-before-retry'}:{})});
  }

  private fieldResult(message: string, result: AgentBrowserActionResult): ToolResult {
    if (!result.success) throw Object.assign(new Error(result.error ?? 'field action failed'),{observation:result.observation});
    const fieldChange = result.fieldChange ?? { before: {}, changed: 'unknown' as const, stateUnavailable: true };
    const output = this.observedActionResult(message + (fieldChange.stateUnavailable ? '; state unavailable; observe before repeating' : ''), result);
    output.data = { ...(output.data as Record<string,unknown>), fieldChange: redactSecretsInValue(fieldChange) };
    return output;
  }

  async selectValues(sessionId: string, selector: string, values: string[], timeoutMs?: number): Promise<ToolResult> {
    const hitlBlocked = await this.hitlGate(sessionId); if (hitlBlocked) return hitlBlocked;
    const needsReobserve = this.reobserveGate(sessionId, selector); if (needsReobserve) return needsReobserve;
    if (!this.api.selectValues) return errResult('E_NOT_IMPLEMENTED', 'driver does not support value selection');
    try {
      const result = await this.api.selectValues({ sessionId, selector, values, timeoutMs });
      if (!result.success) throw Object.assign(new Error(result.error ?? 'selection failed'),{observation:result.observation});
      await this.note(sessionId, 'action', 'select-values', { selector }, true);
      return this.fieldResult(`selected values in ${selector}`, result);
    } catch (error) { await this.note(sessionId, 'action', 'select-values', { selector }, false); return this.failedActionResult('E_SELECT',error); }
  }

  async appendText(sessionId: string, selector: string, text: string, timeoutMs?: number): Promise<ToolResult> {
    const hitlBlocked = await this.hitlGate(sessionId); if (hitlBlocked) return hitlBlocked;
    const needsReobserve = this.reobserveGate(sessionId, selector); if (needsReobserve) return needsReobserve;
    if (!this.api.appendText) return errResult('E_NOT_IMPLEMENTED', 'driver does not support appendText');
    try {
      const result = await this.api.appendText({ sessionId, selector, text, timeoutMs });
      if (!result.success) throw Object.assign(new Error(result.error ?? 'append failed'),{observation:result.observation});
      await this.note(sessionId, 'action', 'append', { selector }, true);
      return this.fieldResult(`appended into ${selector}`, result);
    } catch (error) { await this.note(sessionId, 'action', 'append', { selector }, false); return this.failedActionResult('E_TYPE',error); }
  }

  async console(sessionId: string): Promise<ToolResult> {    try {
      const result = await this.api.getConsoleMessages({ sessionId });
      if(result.success===false)throw new Error(result.error??'console collection failed');
      return okResult((result.collection==='degraded'?`Console collection degraded: ${result.collectionError ?? 'earlier observations unavailable'}\n`:'')+result.content,
        { content: result.content,...(result.collection==='degraded'?{collection:result.collection,collectionError:result.collectionError}:{}) });
    } catch (error) {
      return errResult('E_CONSOLE', toMessage(error));
    }
  }

  /** Current console watermark candidate: line count plus the last line as anchor. */
  private async consoleWindow(sessionId: string): Promise<SignalWindow> {
    const result = await Promise.resolve(
      this.api.getConsoleMessages({ sessionId }),
    ).catch(() => undefined);
    const lines = (result?.content ?? '').split('\n').filter(Boolean);
    const last = lines[lines.length - 1];
    return { count: lines.length, ...(last ? { anchor: last } : {}) };
  }

  /**
   * TF-0118: does this session actually exist?
   *
   * Probes by **error code from a real (side-effect-free) driver call**, not by
   * `status().sessions`. The latter lists only sessions already attached in
   * *this* process, so a fresh process driving a persistent session — the
   * documented `vb verify --session <id>` workflow (TF-0097) — sees an empty
   * list, and a `status()`-based check would reject a perfectly valid session.
   * The driver's `ensureState` attaches on demand and throws `E_NO_SESSION` for
   * an id it cannot resolve, so that error code is the authoritative signal.
   *
   * Returns `'unknown'` for any other failure, so a stub or host driver whose
   * console read fails for its own reasons keeps its previous behaviour instead
   * of being mistaken for a missing session. `getConsoleMessages` is used
   * because it is read-only and cheap.
   */
  private async sessionExists(sessionId: string): Promise<boolean | 'unknown'> {
    try {
      const result = await this.api.getConsoleMessages({ sessionId });
      // A driver that answers at all proves the session resolved.
      return result !== undefined;
    } catch (error) {
      return (error as { code?: string }).code === 'E_NO_SESSION' ? false : 'unknown';
    }
  }

  /**
   * TF-0118: stable "no such session" failure, matching the sibling tools
   * (`E_SNAPSHOT`, `E_CLICK`, …) which already return `ok: false` with a message
   * that names the missing session.
   */
  private noSessionResult(sessionId: string): ToolResult {
    return errResult(
      'E_NO_SESSION',
      `unknown session: ${sessionId || '(empty)'} — no such live session in this process; ` +
        'run `vb open` or check `vb sessions`',
    );
  }

  async markConsoleBaseline(sessionId: string): Promise<number> {
    const window = await this.consoleWindow(sessionId);
    this.consoleBaselines.set(sessionId, window);
    return window.count;
  }

  /**
   * TF-0118: `vb_errors { action: 'mark-baseline' }` counterpart that refuses a
   * session which does not exist, instead of reporting a baseline of 0 lines.
   */
  async markConsoleBaselineChecked(sessionId: string): Promise<ToolResult> {
    if ((await this.sessionExists(sessionId)) === false) return this.noSessionResult(sessionId);
    const count = await this.markConsoleBaseline(sessionId);
    return okResult(`console baseline set to ${count} lines`, { baselineCount: count });
  }

  /** Current network watermark candidate; undefined when the list is unavailable. */
  private async networkWindow(sessionId: string): Promise<SignalWindow | undefined> {
    try {
      const result = await this.api.networkListRequests({ sessionId, redacted: true });
      if (!result?.success) return undefined;
      const rows = result.requests as NetworkListRow[];
      const last = rows[rows.length - 1];
      return { count: rows.length, ...(last?.id ? { anchor: last.id } : {}) };
    } catch {
      return undefined;
    }
  }

  /**
   * Scope the next network verdict to requests captured from here on — the
   * network counterpart of `markConsoleBaseline`. `nav()` calls it
   * automatically so "verify this page" means this page (TF-0095).
   */
  async markNetworkBaseline(sessionId: string): Promise<number> {
    const window = (await this.networkWindow(sessionId)) ?? { count: 0 };
    this.networkBaselines.set(sessionId, window);
    return window.count;
  }

  async networkList(
    sessionId: string,
    filter?: { urlIncludes?: string; method?: string; status?: number; limit?: number },
  ): Promise<ToolResult> {
    try {
      const result = await this.api.networkListRequests({
        sessionId,
        ...(filter ? { filter } : {}),
      });
      if (result.success === false) return errResult('E_NETWORK', result.error ?? 'network collection unavailable');
      return okResult(`${result.requests.length} requests${result.collection==='degraded'?`; collection degraded: ${result.collectionError ?? 'earlier observations unavailable'}`:''}`,
        { requests: result.requests, ...(result.cursor ? { cursor: result.cursor } : {}),...(result.collection==='degraded'?{collection:result.collection,collectionError:result.collectionError}:{}) });
    } catch (error) {
      return errResult('E_NETWORK', toMessage(error));
    }
  }

  /**
   * TF-0103: details for ids from `networkList` — headers always, response body
   * when it was textual and within the capture cap. Sensitive fields stay
   * redacted on the standalone driver (no full-access path there).
   */
  async networkDetail(sessionId: string, requestIds: string[]): Promise<ToolResult> {
    const ids = requestIds.map((id) => String(id).trim()).filter(Boolean);
    if (ids.length === 0) {
      return errResult('E_NETWORK_DETAIL', 'networkDetail requires at least one request id');
    }
    try {
      const result = await this.api.networkGetRequestDetails({ sessionId, requestIds: ids });
      if (result.success === false) {
        return errResult('E_NETWORK_DETAIL', result.error ?? 'networkGetRequestDetails reported failure');
      }
      const details = Array.isArray(result.details) ? result.details : [];
      const missing = ids.filter((id) => !details.some((detail) => (detail as { id?: string })?.id === id));
      const withBody = details.filter((detail) => Boolean((detail as { responseBody?: string }).responseBody)).length;
      await this.note(sessionId, 'snapshot', 'network_detail', { requested: ids.length, found: details.length });
      return okResult(
        `${details.length}/${ids.length} request(s) detailed, ${withBody} with body${missing.length > 0 ? `, missing: ${missing.join(', ')}` : ''}`,
        {
          details,
          ...(missing.length > 0 ? { missing } : {}),
        },
      );
    } catch (error) {
      return errResult('E_NETWORK_DETAIL', toMessage(error));
    }
  }

  /**
   * TF-0104: wait for a matching request, or (without a filter) for the page to go
   * quiet. With a filter, an empty result means "nothing matched in time" and is
   * reported as a failure the agent can act on — not as a silent empty list.
   */
  async networkWait(
    sessionId: string,
    options: {
      responseComplete?: boolean;
      filter?: { urlIncludes?: string; method?: string; status?: number };
      timeoutMs?: number;
      sinceCursor?: string;
    } = {},
  ): Promise<ToolResult> {
    if (options.responseComplete && !options.filter) return errResult('E_ARG','responseComplete requires a filter');
    if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > 30000)) return errResult('E_ARG','timeoutMs must be within (0,30000]');
    const timeoutMs = options.timeoutMs ?? 5_000;
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const target = options.filter
      ? `request matching ${JSON.stringify(options.filter)}`
      : 'network idle';
    try {
      const result = await Promise.race([this.api.networkWaitForRequests({
        sessionId,
        ...(options.responseComplete ? { responseComplete: true } : {}),
        ...(options.sinceCursor !== undefined ? { sinceCursor: options.sinceCursor } : {}),
        ...(options.filter ? { filter: options.filter } : {}),
        timeoutMs,
      }),new Promise<never>((_,reject)=>{
        timer=setTimeout(()=>reject(new Error(`E_NETWORK_TIMEOUT: no ${target} observed within ${timeoutMs}ms — observation deadline exceeded`)),Math.max(0,startedAt+timeoutMs-Date.now()));
      })]);
      if (result.success === false) {
        throw new Error(`E_WAIT_COLLECTION: ${result.error ?? 'networkWaitForRequests reported failure'}`);
      }
      if (options.responseComplete && result.responseComplete !== true) return errResult('E_NOT_IMPLEMENTED','driver did not confirm response completion observation');
      if (!Array.isArray(result.requests)) throw new Error('E_WAIT_COLLECTION: missing network requests observation');
      // The driver matches URLs before redaction; repeating that match here
      // would reject a legitimate response whose secret query was removed.
      const rows = result.requests.filter(row =>
        (!options.filter?.method || row.method === options.filter.method) &&
        (options.filter?.status === undefined || row.status === options.filter.status));
      const elapsedMs = Date.now() - startedAt;
      await this.note(sessionId, 'snapshot', 'network_wait', {
        rows: rows.length,
        elapsedMs,
        filtered: Boolean(options.filter),
      });
      if (options.filter && rows.length === 0) {
        return errResult(
          'E_NETWORK_WAIT',
          `no ${target} within ${timeoutMs}ms — the request may not have been made, or it failed before a response (check vb_network_list / vb_console)`,
          { recoveryHint: recoveryHint(new Error('E_NETWORK_TIMEOUT'),true) },
        );
      }
      return okResult(`${rows.length} request(s) after ${elapsedMs}ms (${target})`, {
        requests: rows,
        ...(options.responseComplete ? { responseComplete: true } : {}),
        elapsedMs,
        ...(options.filter ? { filter: options.filter } : {}),
      });
    } catch (error) {
      return errResult('E_NETWORK_WAIT', toMessage(error), { recoveryHint: recoveryHint(error,true) });
    } finally { clearTimeout(timer); }
  }

  async networkFailures(
    sessionId: string,
    window: SignalWindow = { count: 0 },
  ): Promise<NetworkFailureSummary> {
    try {
      const result = await this.api.networkListRequests({ sessionId, redacted: true });
      if (!result?.success) {
        return {
          count: 0,
          failures: [],
          collection: 'failed',
          collectionError: result?.error ?? 'networkListRequests reported failure',
        };
      }
      const rows = result.requests as NetworkListRow[];
      // Anchored window: robust to the host evicting older rows. When the anchor
      // is gone we judge the whole list — over-reporting is recoverable, a
      // silently scoped-down PASS is not.
      const resolved = resolveWindow(rows, window, (row) => row.id, window.allPages ? 0 : result.currentPageStart);
      const failures = resolved.windowed
        .filter((request: NetworkListRow) => request.failed || (request.status ?? 0) >= 400)
        .map((request: NetworkListRow) => ({
          id: request.id,
          url: request.url,
          method: request.method,
          ...(request.status !== undefined ? { status: request.status } : {}),
          ...(request.error ? { error: request.error } : {}),
        }));
      return {
        count: failures.length,
        failures,
        collection: result.collection ?? 'ok',
        ...(result.collectionError?{collectionError:result.collectionError}:{}),
        ...(resolved.excluded > 0 ? { baseline: resolved.excluded } : {}),
        ...(resolved.anchorMissing ? { baselineMissing: true } : {}),
      };
    } catch (error) {
      // Collection failure is NOT "zero failures" — surface it as failed collection.
      return {
        count: 0,
        failures: [],
        collection: 'failed',
        collectionError: toMessage(error),
      };
    }
  }

  async explain(errorText: string): Promise<ToolResult> {
    const explained = await explainError(errorText, {
      ...(this.resolveSourceMap ? { resolve: this.resolveSourceMap } : {}),
    });
    // TF-0115: this used to return an evidence ref with **no `path`** — a pointer
    // that names no file. `explain` writes nothing to disk, so the honest shape is
    // no evidence at all rather than a ref that cannot be followed.
    return okResult(explained.content, explained);
  }

  /**
   * One-shot page diagnosis pack for coding agents:
   * console/network (with collection status) + explain_error + actionable snapshot.
   * Summary-first so the agent can act without opening extra tools.
   */
  async diagnosePage(options: {
    sessionId: string;
    /** Prefer this stack when present; otherwise first console error line. */
    errorText?: string;
    snapshot?: boolean;
    /**
     * Content budget for the model-facing summary. The `data` payload keeps the
     * full evidence, so trimming here never loses anything — it only stops the
     * pack from taxing every agent turn.
     */
    budget?: DiagnosePackBudget;
  }): Promise<ToolResult> {
    const sessionId = options.sessionId;
    // TF-0118: same reasoning as verify_flow — do not emit a diagnosis for a
    // session that does not exist.
    if ((await this.sessionExists(sessionId)) === false) {
      return this.noSessionResult(sessionId);
    }
    // Same window semantics as verify_flow: the diagnosis pack describes the
    // page currently under observation, not every earlier page in the session.
    const consoleDiff = await this.diffConsole(
      sessionId,
      this.consoleBaselines.get(sessionId) ?? { count: 0 },
    );
    const networkFailures = await this.networkFailures(
      sessionId,
      this.networkBaselines.get(sessionId) ?? { count: 0 },
    );

    let snapshotText = '';
    if (options.snapshot !== false) {
      try {
        const snap = await this.api.takeSnapshot({ sessionId });
        snapshotText = snap.snapshot;
      } catch (error) {
        snapshotText = `# snapshot unavailable\n- ${toMessage(error)}`;
      }
    }

    const consoleErrorLines = consoleDiff.newErrors;
    const firstNet = networkFailures.failures[0];
    const firstError =
      options.errorText?.trim() ||
      consoleErrorLines[0] ||
      (firstNet
        ? `${firstNet.method} ${firstNet.url} -> ${firstNet.status ?? firstNet.error ?? 'failed'}`
        : '');

    let explain: Awaited<ReturnType<typeof explainError>> | null = null;
    if (firstError) {
      try {
        explain = await explainError(firstError, {
          ...(this.resolveSourceMap ? { resolve: this.resolveSourceMap } : {}),
        });
      } catch (error) {
        explain = null;
        void error;
      }
    }

    const collectionOverall =
      consoleDiff.collection === 'failed' || networkFailures.collection === 'failed'
        ? 'failed'
        : consoleDiff.collection === 'degraded' || networkFailures.collection === 'degraded'
          ? 'degraded'
          : 'ok';

    const primary = explain?.primary
      ? `${explain.primary.source ?? explain.primary.url ?? '?'}:${explain.primary.originalLine ?? explain.primary.line ?? '?'}`
      : undefined;

    // Budget the model-facing summary; `data` below keeps the full evidence.
    const pack = renderDiagnosePack(
      {
        collectionOverall,
        consoleCollection: consoleDiff.collection,
        networkCollection: networkFailures.collection,
        consoleWatermarkMissing: consoleDiff.watermarkMissing,
        networkBaselineMissing: networkFailures.baselineMissing,
        consoleErrors: consoleErrorLines,
        consoleWarnings: consoleDiff.newWarnings,
        networkFailures: networkFailures.failures,
        networkCount: networkFailures.count,
        ...(primary ? { primary } : {}),
        ...(firstError ? { unmappedError: firstError } : {}),
        ...(explain?.content ? { explainContent: explain.content } : {}),
        snapshotText,
      },
      options.budget ?? DEFAULT_DIAGNOSE_BUDGET,
    );
    const summaryMarkdown = pack.markdown;
    await this.note(
      sessionId,
      'action',
      'diagnose_page',
      {
        collection: collectionOverall,
        consoleErrors: consoleErrorLines.length,
        networkFailures: networkFailures.count,
      },
      collectionOverall === 'ok',
    );

    return okResult(
      summaryMarkdown,
      {
        collection: {
          console: consoleDiff.collection,
          network: networkFailures.collection,
          overall: collectionOverall,
        },
        consoleDiff,
        networkFailures,
        snapshot: snapshotText,
        explain,
        summaryMarkdown,
        /** Model-facing size, so harnesses can measure the pack's real cost. */
        contextChars: pack.chars,
        truncated: pack.truncated,
        budget: options.budget ?? DEFAULT_DIAGNOSE_BUDGET,
      },
    );
  }

  // ---- M3 Flight Recorder ----

  async recordStart(sessionId: string, options: { dirName?: string } = {}): Promise<ToolResult> {
    try {
      // TF-0118: recording a session that does not exist used to report
      // "recording started", so a caller believed evidence was being captured.
      if ((await this.sessionExists(sessionId)) === false) {
        return this.noSessionResult(sessionId);
      }
      const dir = assertInsideRoot(
        this.evidenceRoot,
        join(this.evidenceRoot, 'record', sanitize(options.dirName ?? `rec-${randomUUID().slice(0, 8)}`)),
        'recording dir',
      );
      const writer = new TimelineWriter({ dir, sessionId });
      await writer.action('record.start', { sessionId });
      this.recorders.set(sessionId, writer);
      this.recorderDirs.set(sessionId, dir);
      return okResult(`recording started: ${dir}`, { dir, sessionId });
    } catch (error) {
      return errResult('E_RECORD', toMessage(error));
    }
  }

  async recordStop(sessionId: string): Promise<ToolResult> {
    try {
      // Recorder state is authoritative: preserve evidence even if the browser is gone.
      const writer = this.recorders.get(sessionId);
      if (!writer) return errResult('E_RECORD', `no active recording for ${sessionId}`);
      await writer.action('record.stop');
      const record = await writer.stop();
      const dir = this.recorderDirs.get(sessionId) ?? '';
      this.recorders.delete(sessionId);
      this.recorderDirs.delete(sessionId);
      this.ingestedSignals.delete(sessionId);
      return okResult(
        `recording stopped: ${record.events.length} events`,
        { events: record.events.length, startedAt: record.startedAt, endedAt: record.endedAt, dir },
        [createEvidenceRef({ kind: 'timeline', label: 'timeline', path: this.refPath(join(dir, 'timeline.json')), mimeType: 'application/json' })],
      );
    } catch (error) {
      return errResult('E_RECORD', toMessage(error));
    }
  }

  async diagnose(options: { sessionId?: string; dir?: string } = {}): Promise<ToolResult> {
    try {
      let timeline: TimelineRecord | undefined;
      let dir = options.dir;
      if (options.sessionId && this.recorders.has(options.sessionId)) {
        timeline = this.recorders.get(options.sessionId)!.toRecord();
        dir = this.recorderDirs.get(options.sessionId) ?? dir;
      }
      // TF-0119: `dir` is caller-supplied and this method both **reads** a timeline
      // from it and **writes** a diagnosis pack back into it. It was the third sink
      // found reading/writing outside the evidence root (after screenshot fileName
      // and pr-comment packDir) — verified by planting a `timeline.json` outside the
      // workspace, which was read and echoed into the model's context while
      // diagnosis.json/md + viewer.html were written next to it.
      if (dir) {
        dir = assertInsideRoot(this.evidenceRoot, dir, 'diagnosis dir');
      }
      if (!timeline && dir) {
        timeline = await readTimeline(dir);
      }
      if (!timeline) {
        return errResult('E_DIAGNOSE', 'no timeline found; start a recording or pass dir');
      }
      dir = dir ?? join(this.evidenceRoot, 'diagnose', sanitize(randomUUID().slice(0, 8)));
      assertInsideRoot(this.evidenceRoot, dir, 'diagnosis dir');
      const report = diagnoseTimeline({ dir, timeline });
      await writeDiagnosisPack(dir, report);
      const viewer = await writeTrajectoryViewer(dir);
      return okResult(report.summaryMarkdown, report, [
        createEvidenceRef({ kind: 'summary', label: 'diagnosis', path: this.refPath(join(dir, 'diagnosis.md')), mimeType: 'text/markdown' }),
        createEvidenceRef({ kind: 'summary', label: 'trajectory viewer', path: this.refPath(viewer.outPath), mimeType: 'text/html' }),
      ]);
    } catch (error) {
      return errResult('E_DIAGNOSE', toMessage(error));
    }
  }

  /** Export a GitHub PR/CI comment from an Evidence Pack directory (offline). */
  async exportPrComment(packDir: string): Promise<ToolResult> {
    try {
      // TF-0116: this reads `manifest.json` (and referenced pack files) from the
      // given directory **and writes `pr-comment.md` back into it**. Unchecked, it
      // was a read-anywhere primitive that also echoed outside content into the
      // model's context, and a write-anywhere sink. Keep it inside the evidence
      // root, like every other evidence sink.
      const resolved = assertInsideRoot(this.evidenceRoot, packDir, 'packDir');
      const pack = await readEvidencePack(resolved);
      const comment = formatPrComment({
        label: pack.manifest.label,
        packDir: this.refPath(resolved),
        ...(pack.verify ? { verify: pack.verify } : {}),
        ...(pack.diagnosis ? { diagnosis: pack.diagnosis } : {}),
        ...(pack.explain ? { explain: pack.explain } : {}),
        ...(pack.networkFailures ? { networkFailures: pack.networkFailures } : {}),
        ...(pack.consoleDiff ? { consoleDiff: pack.consoleDiff } : {}),
        ...(pack.summaryMarkdown ? { summaryMarkdown: pack.summaryMarkdown } : {}),
        screenshotCount: pack.screenshots.length,
      });
      const outPath = assertInsideRoot(this.evidenceRoot, join(resolved, 'pr-comment.md'), 'PR comment');
      await writeEvidenceText(this.evidenceRoot, outPath, comment);
      return okResult(comment, { path: this.refPath(outPath), comment }, [
        createEvidenceRef({
          kind: 'summary',
          label: 'pr-comment',
          path: this.refPath(outPath),
          mimeType: 'text/markdown',
        }),
      ]);
    } catch (error) {
      // Do not echo the resolved absolute path (it discloses the process layout).
      return errResult('E_PR_COMMENT', toMessage(error).replace(/[A-Za-z]:\\[^\s'"]+/gu, '<path>'));
    }
  }

  async note(
    sessionId: string,
    kind: TimelineEventKind,
    name: string,
    detail?: Record<string, unknown>,
    ok?: boolean,
  ): Promise<void> {
    const writer = this.recorders.get(sessionId);
    if (writer) await writer.append(kind, name, detail, ok);
    if (writer) await this.ingestSessionSignals(sessionId);
  }

  /**
   * Flight Recorder auto-ingest: pull network failures and console errors
   * into the active timeline (deduped). Called after noted actions while recording.
   */
  private async ingestSessionSignals(sessionId: string): Promise<void> {
    const writer = this.recorders.get(sessionId);
    if (!writer) return;
    let seen = this.ingestedSignals.get(sessionId);
    if (!seen) {
      seen = new Set();
      this.ingestedSignals.set(sessionId, seen);
    }

    try {
      const listed = await this.api.networkListRequests({ sessionId, redacted: true });
      for (const request of listed.requests as NetworkListRow[]) {
        const failed = request.failed || (request.status ?? 0) >= 400;
        if (!failed) continue;
        const key = `net:${request.method}:${request.url}:${request.status ?? request.error ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        await writer.network(
          `${request.method} ${request.url}`,
          {
            id: request.id,
            method: request.method,
            url: request.url,
            ...(request.status !== undefined ? { status: request.status } : {}),
            ...(request.error ? { error: request.error } : {}),
            failed: true,
          },
          false,
        );
      }
    } catch {
      // network list unavailable — skip ingest
    }

    try {
      const consoleResult = await this.api.getConsoleMessages({ sessionId });
      const lines = (consoleResult.content ?? '').split('\n').filter(Boolean);
      for (const line of lines) {
        if (classifyConsoleLine(line) !== 'error') continue;
        const key = `con:${line.slice(0, 200)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        await writer.console(line.slice(0, 200), { level: 'error', text: line.slice(0, 500) }, false);
      }
    } catch {
      // console unavailable — skip ingest
    }
  }

  // ---- M4 Runtime Mode ----

  async requestModeUpgrade(request: {
    sessionId: string;
    target: 'controlled_enhanced' | 'full_access';
    confirmed: boolean;
    reason?: string;
    ttlMs?: number;
    tabId?: number;
    origin?: string;
  }): Promise<ToolResult> {
    const decision = this.modePolicy.requestUpgrade(request);
    await this.note(
      request.sessionId,
      'mode',
      decision.granted ? 'mode.upgrade.granted' : 'mode.upgrade.denied',
      { target: request.target, confirmed: request.confirmed },
      decision.granted,
    );
    if (!decision.granted) {
      return errResult(decision.code, decision.message);
    }
    return this.modeResult(
      `mode upgraded to ${decision.mode}`,
      request.sessionId,
    );
  }

  async revokeMode(sessionId: string): Promise<ToolResult> {
    const result = this.modePolicy.revoke(sessionId);
    await this.note(sessionId, 'mode', 'mode.revoke', { revoked: result.revoked }, true);
    return this.modeResult(
      result.revoked ? 'elevated mode revoked' : 'already normal_restricted',
      sessionId,
    );
  }

  /**
   * TF-0167: record that this session now needs a human, and hand back the checkpoint.
   *
   * Automation stops here: the reason is one of the human-only gates (login wall, MFA,
   * captcha, ToS review). No credential is captured and nothing is auto-bypassed; the caller
   * gets a resume token and must re-observe the page afterwards instead of assuming the
   * previous verification is still valid.
   */
  /**
   * TF-0167: after a human gate the page may have changed while the agent was not watching, so a
   * ref observed BEFORE the pause must not be acted on. The resume message alone was advisory —
   * measured on the real upstream path, a pre-pause ref still submitted after resume. Ref-based
   * actions are therefore refused until the caller re-observes. `E_STALE_REF` is reused on purpose
   * so hosts keep the existing stale/reobserve recovery hint instead of a new error code.
   */
  private reobserveGate(sessionId: string, selector: string | undefined): ToolResult | undefined {
    if (!selector) return undefined;
    const reason = this.hitlNeedsReobserve.get(sessionId);
    if (!reason) return undefined;
    if (!/\[data-vb-ref=["'][^"']+["']\]/u.test(selector)) return undefined;
    return errResult(
      'E_STALE_REF',
      `ref ${selector} was observed before a human gate (${reason}); re-observe the page before acting — no action was replayed`,
      // The comment above promises hosts keep the stale/reobserve hint, so attach it (the sibling
      // failedActionResult path already does; MCP adds it when absent, but SDK/CLI callers do not).
      { recovery: 'reobserve', reason, recoveryHint: recoveryHint({ code: 'E_STALE_REF' }, false) },
    );
  }

  /**
   * TF-0167 fail-closed gate for state-changing actions.
   *
   * Measured before this existed: HitlSessionStore.assertResumed() had no callers, so a paused
   * session could keep acting — a write landed while the gate was open. The gate now refuses
   * anything that can change the page or send a request.
   *
   * Observation deliberately stays open: the human-continuation contract requires the agent to
   * re-observe the page after a human finishes, so reads, evidence writes, cleanup and the HITL
   * methods themselves are not gated.
   *
   * E_HITL_PAUSED is mapped to needs_user by recoveryHint(), so a host sees a human gate rather
   * than a plain denial, and the checkpoint travels with it.
   *
   * The check reads the persisted checkpoint when this process has not seen the session yet, so a
   * restart cannot silently drop a gate (see HitlSessionStore.assertResumedPersisted).
   */
  private async hitlGate(sessionId: string | undefined): Promise<ToolResult | undefined> {
    if (!sessionId) return undefined;
    try {
      await this.hitl.assertResumedPersisted(sessionId);
      return undefined;
    } catch (error) {
      const code = (error as { code?: string } | null)?.code ?? 'E_HITL_PAUSED';
      const checkpoint = await this.hitl.ensureLoaded(sessionId);
      return errResult(code, error instanceof Error ? error.message : String(error), {
        recovery: 'human_step',
        // The doc promise (browser-ops section 2): a paused gate carries recoveryHint.needs_user.
        recoveryHint: recoveryHint(error, false),
        ...(checkpoint ? { checkpoint } : {}),
      });
    }
  }

  /**
   * Checkpoint as the agent-facing tool surface may show it.
   *
   * TF-0167: neither the resume token nor the material used to verify it is exposed here. The raw
   * token is issued once to the operator channel (a human reads that file); the salted hash stays in
   * the store. The channel's location is deliberately NOT returned either: these results reach the
   * agent, and for any host with filesystem access a path would be a pointer to the secret. The
   * convention is documented for humans in docs/mcp.md instead.
   */
  private humanGateView(checkpoint: HitlCheckpoint) {
    return {
      schemaVersion: checkpoint.schemaVersion,
      id: checkpoint.id,
      sessionId: checkpoint.sessionId,
      status: checkpoint.status,
      reason: checkpoint.reason,
      message: checkpoint.message,
      createdAt: checkpoint.createdAt,
      updatedAt: checkpoint.updatedAt,
      credentialRefs: checkpoint.credentialRefs,
    };
  }

  async pauseForHuman(input: { sessionId: string; reason: HitlReason; message: string }): Promise<ToolResult> {
    // `sessionExists` is async: testing the Promise (as this used to) is always false, so this guard
    // never fired. Match the sibling tools — only a definite E_NO_SESSION blocks, 'unknown' proceeds.
    if ((await this.sessionExists(input.sessionId)) === false) return this.noSessionResult(input.sessionId);
    const checkpoint = await this.hitl.pause({
      sessionId: input.sessionId,
      reason: input.reason,
      message: redactSecretsInValue(String(input.message ?? '')).slice(0, 500),
    });
    return okResult(
      `automation paused for a human step (${checkpoint.reason}); re-observe the page after resuming` +
        // The caller that paused must neither be able to open its own gate nor be pointed at the
        // token: the one-time token goes to the human operator channel (convention in docs/mcp.md).
        `\nA human must complete the step, then resume with the one-time token from the human operator channel.` +
        `\n${checkpoint.message}`,
      this.humanGateView(checkpoint),
    );
  }

  /**
   * TF-0167: resume after the human finished. Completing the gate does not re-validate the
   * page: the caller must observe again, because the page may have changed while paused.
   */
  async resumeAfterHuman(sessionId: string, resumeToken: string): Promise<ToolResult> {
    // Same async-guard fix as pauseForHuman. Resuming is about letting a LIVE session continue after
    // the human acted, so a definite E_NO_SESSION is refused; closing a dead session's gate for
    // bookkeeping is what HitlSessionStore.complete() is for, not this.
    if ((await this.sessionExists(sessionId)) === false) return this.noSessionResult(sessionId);
    try {
      const checkpoint = await this.hitl.resume(sessionId, resumeToken);
      // TF-0167: the page may have changed while the human worked, so a ref observed before the
      // pause is refused until the caller re-observes (see reobserveGate).
      this.hitlNeedsReobserve.set(sessionId, checkpoint.reason);
      return okResult(
        `gate completed (${checkpoint.reason}); re-observe the page before acting — ref-based actions are refused until you do` +
          `\n${checkpoint.message}`,
        this.humanGateView(checkpoint),
      );
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'E_HITL_NOT_FOUND' || code === 'E_HITL_DENIED') return errResult(code, String((error as Error).message));
      throw error;
    }
  }

  /** Current human-gate checkpoint for a session, if any. Never returns credentials. */
  async humanGateStatus(sessionId: string): Promise<ToolResult> {
    // TF-0167: a gate outlives the process. Read the persisted checkpoint so a restarted host's
    // status agrees with the action guard (assertResumedPersisted) and resumeAfterHuman, instead
    // of reporting `paused:false` for a session whose state-changing actions are still refused.
    const checkpoint = await this.hitl.ensureLoaded(sessionId);
    if (!checkpoint) return okResult('no pending human gate for this session', { paused: false });
    return okResult(
      `paused=${checkpoint.status === 'paused'}; reason=${checkpoint.reason}` +
        (checkpoint.status === 'paused'
          ? `\nresuming needs the one-time token from the human operator channel`
          : `\n${checkpoint.message}`),
      { paused: checkpoint.status === 'paused', reason: checkpoint.reason },
    );
  }

  async modeStatus(sessionId: string): Promise<ToolResult> {
    const status = this.modePolicy.describe(sessionId);
    return this.modeResult(`mode=${status.mode}`, sessionId);
  }

  private modeResult(content: string, sessionId: string): ToolResult {
    const status = this.modePolicy.describe(sessionId);
    return okResult(
      `${content}\nauthMode=${status.authMode}; expiresAt=${status.expiresAt ?? 'none'}; hasBoundaryGrant=${status.hasBoundaryGrant}`,
      status,
    );
  }

  /**
   * TF-0105: bounded runtime-globals read (the `inspect-globals` action).
   *
   * Deep-read semantics match the host engine: reading page globals is not a
   * normal-mode observation, so the session must be elevated to
   * `controlled_enhanced` (`vb_request_mode_upgrade`, which is TTL-bounded and
   * revocable). The read itself is the product's **fixed** template — allow-listed
   * dotted paths (never arbitrary JavaScript), depth/entry/byte budgets,
   * accessors skipped so a read cannot fire page getters, sensitive keys/values
   * redacted. `search-modules` / `describe-function` remain host-engine
   * capabilities and are not reachable through this tool.
   */
  async runtimeRead(options: {
    sessionId: string;
    paths: string[];
    maxDepth?: number;
    limit?: number;
  }): Promise<ToolResult> {
    if (!this.modePolicy.canRuntimeReadSession(options.sessionId)) {
      const status = this.modePolicy.describe(options.sessionId);
      return errResult(
        'E_RUNTIME_MODE',
        `runtime read needs controlled_enhanced mode (current: ${status.mode}); ` +
          'call vb_request_mode_upgrade with target=controlled_enhanced, confirmed=true first',
      );
    }
    try {
      const result = await this.api.runtimeInspectGlobals({
        sessionId: options.sessionId,
        paths: options.paths,
        ...(options.maxDepth !== undefined ? { maxDepth: options.maxDepth } : {}),
        ...(options.limit !== undefined ? { limit: options.limit } : {}),
      });
      if (result.success === false || result.isError === true) {
        return errResult(
          'E_RUNTIME_READ',
          result.error ?? result.content ?? 'runtimeInspectGlobals reported failure',
        );
      }
      const redacted = result.redacted === true;
      const truncated = result.truncated === true;
      await this.note(options.sessionId, 'snapshot', 'runtime_read', {
        action: 'inspect-globals',
        paths: options.paths.length,
        redacted,
        truncated,
      });
      return okResult(result.content, {
        action: 'inspect-globals',
        paths: options.paths,
        redacted,
        truncated,
      });
    } catch (error) {
      return errResult('E_RUNTIME_READ', toMessage(error));
    }
  }

  // ---- M3 Replay / Compare ----

  bindReplayContext(
    sessionId: string,
    context: { tabId?: number; origin?: string; enhanced: boolean; grant?: BoundaryGrantContext },
  ): void {
    this.replayContexts.set(sessionId, {
      ...(context.tabId !== undefined ? { tabId: context.tabId } : {}),
      ...(context.origin ? { origin: context.origin } : {}),
      enhanced: context.enhanced,
      ...(context.grant ? { grant: context.grant } : {}),
    });
    this.replayExecutors.delete(sessionId);
  }

  private getReplayExecutor(sessionId: string): ReplayToolExecutor {
    const existing = this.replayExecutors.get(sessionId);
    if (existing) return existing;
    const recorder: ReplayRecorderLike = {
      isEnabled: true,
      getRawRequestMeta: () => undefined,
      getDetails: async () => [],
    };
    const executor = new ReplayToolExecutor(
      recorder,
      fetch,
      () => this.replayContexts.get(sessionId) ?? { enhanced: false },
    );
    this.replayExecutors.set(sessionId, executor);
    return executor;
  }

  async replayPrepare(sessionId: string, requestId: string): Promise<ToolResult> {
    const result = this.getReplayExecutor(sessionId).prepareRequest({ requestId });
    await this.note(sessionId, 'action', 'replay.prepare', { requestId }, !result.isError);
    return result.isError
      ? errResult('E_REPLAY', result.content)
      : okResult(result.content, result);
  }

  async replaySend(sessionId: string, draftId: string): Promise<ToolResult> {
    const hitlBlocked = await this.hitlGate(sessionId); if (hitlBlocked) return hitlBlocked;
    const result = await this.getReplayExecutor(sessionId).sendRequest({ draftId });
    await this.note(sessionId, 'network', 'replay.send', { draftId }, !result.isError);
    return result.isError
      ? errResult('E_REPLAY', result.content)
      : okResult(result.content, result);
  }

  async replayCompare(sessionId: string, draftId: string): Promise<ToolResult> {
    const result = await this.getReplayExecutor(sessionId).compareResponses({ draftId });
    await this.note(sessionId, 'action', 'replay.compare', { draftId }, !result.isError);
    return result.isError
      ? errResult('E_REPLAY', result.content)
      : okResult(result.content, result);
  }

  /** Offline compare of two captured requests (status / outcome). */
  async networkCompare(sessionId: string, requestIds: [string, string]): Promise<ToolResult> {
    try {
      const listed = await this.api.networkListRequests({ sessionId, redacted: true });
      const rows = listed.requests as NetworkListRow[];
      const [a, b] = requestIds.map((id) => rows.find((r) => r.id === id));
      if (!a || !b) {
        return errResult('E_COMPARE', 'one or both request ids not found');
      }
      const diff = {
        a: { id: a.id, url: a.url, method: a.method, status: a.status ?? null, failed: !!a.failed },
        b: { id: b.id, url: b.url, method: b.method, status: b.status ?? null, failed: !!b.failed },
        statusDelta: (b.status ?? 0) - (a.status ?? 0),
        sameUrl: a.url === b.url,
        sameMethod: a.method === b.method,
        outcomeChanged:
          Boolean(a.failed) !== Boolean(b.failed) || (a.status ?? null) !== (b.status ?? null),
      };
      await this.note(sessionId, 'action', 'network.compare', { a: a.id, b: b.id }, true);
      const summary = [
        '# network compare',
        `- outcomeChanged: ${diff.outcomeChanged}`,
        `- sameUrl: ${diff.sameUrl}; sameMethod: ${diff.sameMethod}; statusDelta: ${diff.statusDelta}`,
        `- A ${a.method} ${a.url} -> ${a.status ?? a.error ?? 'n/a'}`,
        `- B ${b.method} ${b.url} -> ${b.status ?? b.error ?? 'n/a'}`,
      ].join('\n');
      return okResult(summary, diff);
    } catch (error) {
      return errResult('E_COMPARE', toMessage(error));
    }
  }

  async verifyFlow(options: VerifyFlowOptions): Promise<ToolResult> {
    const hitlBlocked = await this.hitlGate(options.sessionId); if (hitlBlocked) return hitlBlocked;
    const startedAt = new Date().toISOString();
    const sessionId = options.sessionId;
    const selectors = options.selectors ?? [];
    const evidence: EvidenceRef[] = [];

    // TF-0118: a session that does not exist is an operational error, not a page
    // verdict. Returning `ok: false` here keeps `# verify_flow FAIL` meaning
    // "a page was observed and failed" instead of also covering "nothing was
    // observed at all" — the two were previously identical on the first line.
    if ((await this.sessionExists(sessionId)) === false) {
      return this.noSessionResult(sessionId);
    }

    const selectorResults: VerifySelectorResult[] = [];
    for (const selector of selectors) {
      try {
        await this.api.waitForSelector({ sessionId, selector, timeoutMs: 3000 });
        selectorResults.push({ selector, found: true, visible: true });
      } catch (error) {
        selectorResults.push({ selector, found: false, detail: toMessage(error) });
      }
    }

    const expectationResults: VerifyExpectationResult[] = [];
    for (const expectation of options.expect ?? []) {
      expectationResults.push(await this.checkExpectation(sessionId, expectation));
    }

    // Explicit counts override the navigation watermarks (0 = judge the whole
    // session). Windows carry anchors, so host list eviction cannot empty them.
    const consoleWindow =
      options.baselineConsoleCount !== undefined
        ? { count: options.baselineConsoleCount, allPages: true }
        : (this.consoleBaselines.get(sessionId) ?? { count: 0 });
    const consoleDiff = await this.diffConsole(sessionId, consoleWindow);
    const networkWindow =
      options.baselineNetworkCount !== undefined
        ? { count: options.baselineNetworkCount, allPages: true }
        : (this.networkBaselines.get(sessionId) ?? { count: 0 });
    const networkFailures = await this.networkFailures(sessionId, networkWindow);

    const screenshotPaths: string[] = [];
    if (options.screenshot !== false) {
      const shot = await this.screenshotToDisk(sessionId, { fileName: 'verify.png' });
      const path = (shot.data as { path?: string } | undefined)?.path;
      if (path && shot.evidence?.[0]) {
        screenshotPaths.push(path);
        evidence.push(shot.evidence[0]);
      }
    }

    const collectionNotes: string[] = [];
    if (consoleDiff.collection !== 'ok') {
      collectionNotes.push(
        `console collection ${consoleDiff.collection}${consoleDiff.collectionError ? `: ${consoleDiff.collectionError}` : ''}`,
      );
    }
    if (networkFailures.collection !== 'ok') {
      collectionNotes.push(
        `network collection ${networkFailures.collection}${networkFailures.collectionError ? `: ${networkFailures.collectionError}` : ''}`,
      );
    }
    const consoleExcluded = consoleDiff.baselineCount;
    const networkExcluded = networkFailures.baseline ?? 0;
    if (consoleExcluded > 0 || networkExcluded > 0) {
      collectionNotes.push(
        `verdict scoped to the current page: baseline set at the last navigation ` +
          `(console lines: ${consoleExcluded}, session requests: ${networkExcluded}); ` +
          `earlier session signals are excluded — pass baselineConsoleCount/baselineNetworkCount = 0 to judge the whole session`,
      );
    }
    if (consoleDiff.watermarkMissing) {
      collectionNotes.push(
        'console watermark line was evicted by the host — the whole captured log was judged (never a silent pass)',
      );
    }
    if (networkFailures.baselineMissing) {
      collectionNotes.push(
        'network watermark request was evicted by the host — the whole captured list was judged (never a silent pass)',
      );
    }
    const collectionOverall =
      consoleDiff.collection === 'failed' || networkFailures.collection === 'failed'
        ? 'failed'
        : consoleDiff.collection === 'degraded' || networkFailures.collection === 'degraded'
          ? 'degraded'
          : 'ok';
    const collection = {
      console: consoleDiff.collection,
      network: networkFailures.collection,
      overall: collectionOverall,
      notes: collectionNotes,
    } as const;

    // Missing selectors, failed business assertions, or observed problems are hard failures.
    // Incomplete collection alone is UNKNOWN — never PASS.
    const hardFail =
      !selectorResults.every((item) => item.found) ||
      expectationResults.some((item) => !item.passed) ||
      consoleDiff.newErrors.length > 0 ||
      networkFailures.count > 0;
    const outcome: VerifyOutcome = hardFail
      ? 'fail'
      : collectionOverall === 'ok'
        ? 'pass'
        : 'unknown';
    const ok = outcome === 'pass';

    const report: VerifyReport = redactSecretsInValue({
      schemaVersion: 1,
      ok,
      outcome,
      collection,
      startedAt,
      endedAt: new Date().toISOString(),
      sessionId,
      selectors: selectorResults,
      expectations: expectationResults,
      consoleDiff,
      networkFailures,
      screenshotPaths,
      summaryMarkdown:
        selectors.length === 0 &&
        expectationResults.length === 0 &&
        options.compactHealthSummary !== false
          ? formatVerifyHealthSummary(outcome, consoleDiff, networkFailures, collection)
          : formatVerifySummary(
              outcome,
              selectorResults,
              expectationResults,
              consoleDiff,
              networkFailures,
              screenshotPaths,
              collection,
            ),
      evidence,
    });

    const dir = await this.writeVerifyArtifacts(
      options.evidenceDirName ?? `verify-${randomUUID().slice(0, 8)}`,
      report,
    );

    // Flight Recorder + Trajectory Diagnosis land in the same pack (M6).
    let diagnosisReport: DiagnosisReport | undefined;
    let timelineRecord: TimelineRecord | undefined;
    const activeRecorder = this.recorders.get(sessionId);
    if (activeRecorder) {
      await this.ingestSessionSignals(sessionId);
      timelineRecord = activeRecorder.toRecord();
    } else {
      // Synthesize a timeline from the verify report so diagnose still works offline.
      timelineRecord = {
        schemaVersion: 1,
        startedAt,
        sessionId,
        events: [
          ...networkFailures.failures.map((failure, index) => ({
            seq: index + 1,
            at: startedAt,
            kind: 'network' as const,
            name: `${failure.method} ${failure.url}`,
            ok: false,
            detail: {
              id: failure.id,
              method: failure.method,
              url: failure.url,
              ...(failure.status !== undefined ? { status: failure.status } : {}),
              ...(failure.error ? { error: failure.error } : {}),
              failed: true,
            },
          })),
          ...consoleDiff.newErrors.map((line, index) => ({
            seq: networkFailures.failures.length + index + 1,
            at: startedAt,
            kind: 'console' as const,
            name: line.slice(0, 80),
            ok: false,
            detail: { level: 'error', text: line.slice(0, 500) },
          })),
        ],
      };
    }
    // Persist the same assertions used by the verdict. Offline re-diagnosis
    // must retain business failures, including when recording was not enabled.
    const assertions = [
      ...report.selectors.map((item) => ({ name: `selector ${item.selector}`, ok: item.found, detail: item.detail ?? '' })),
      ...report.expectations.map((item) => ({ name: `expect ${item.label}`, ok: item.passed, detail: item.detail ?? '' })),
    ];
    for (const assertion of assertions) {
      if (activeRecorder) {
        await activeRecorder.action(assertion.name, { detail: assertion.detail }, assertion.ok);
      } else {
        timelineRecord.events.push({ seq: timelineRecord.events.length + 1, at: report.endedAt, kind: 'action', name: assertion.name, ok: assertion.ok, detail: { detail: assertion.detail } });
      }
    }
    if (activeRecorder) timelineRecord = activeRecorder.toRecord();
    diagnosisReport = diagnoseTimeline({ dir, timeline: timelineRecord });
    await writeDiagnosisPack(dir, diagnosisReport);

    const prComment = formatVerifyPrComment(report, {
      packDir: this.refPath(dir),
      diagnosis: diagnosisReport,
    });
    await writeEvidenceText(this.evidenceRoot, join(dir, 'pr-comment.md'), prComment);
    await writeEvidenceJson(this.evidenceRoot, join(dir, 'timeline.json'), timelineRecord);
    const viewer = await writeTrajectoryViewer(dir);

    evidence.push(
      createEvidenceRef({
        kind: 'verify',
        label: 'verify_flow summary',
        path: this.refPath(join(dir, 'summary.md')),
        mimeType: 'text/markdown',
      }),
    );
    evidence.push(
      createEvidenceRef({
        kind: 'summary',
        label: 'diagnosis',
        path: this.refPath(join(dir, 'diagnosis.md')),
        mimeType: 'text/markdown',
      }),
    );
    evidence.push(
      createEvidenceRef({
        kind: 'summary',
        label: 'pr-comment',
        path: this.refPath(join(dir, 'pr-comment.md')),
        mimeType: 'text/markdown',
      }),
    );
    evidence.push(
      createEvidenceRef({
        kind: 'summary',
        label: 'trajectory viewer',
        path: this.refPath(viewer.outPath),
        mimeType: 'text/html',
      }),
    );

    await this.note(sessionId, 'action', 'verify_flow', { ok, selectors: selectors.length }, ok);
    return okResult(
      formatVerifyResult(report, diagnosisReport),
      { ...report, diagnosis: diagnosisReport, prComment },
      evidence,
    );
  }

  async close(sessionId: string): Promise<ToolResult> {
    try {
      if (this.recorders.has(sessionId)) {
        const stopped = await this.recordStop(sessionId);
        if (!stopped.ok) return errResult('E_CLOSE', stopped.error?.message ?? 'recording could not be saved');
      }
      const closed = await this.api.close({ sessionId });
      // A host that reports failure without throwing must not look like success:
      // callers (e.g. the CLI one-shot) report whether the browser really closed.
      if (closed && closed.success === false) {
        return errResult('E_CLOSE', closed.error ?? 'close failed');
      }
      this.replayExecutors.delete(sessionId);
      this.replayContexts.delete(sessionId);
      this.networkBaselines.delete(sessionId);
      this.consoleBaselines.delete(sessionId);
      this.snapshotFacts.delete(sessionId);
      this.ownedSessions.delete(sessionId);
      return okResult(`session ${sessionId} closed`);
    } catch (error) {
      /*
       * C71 语义：**会话不存在**是操作错误，不是「关闭失败」。驱动用 `code: 'E_NO_SESSION'` 抛出时
       * 原样透出，不要混进 E_CLOSE——否则调用方仍然分不清「关掉了一个会话」与「这个 id 从来不存在」。
       */
      const code = (error as { code?: string } | undefined)?.code === 'E_NO_SESSION' ? 'E_NO_SESSION' : 'E_CLOSE';
      return errResult(code, toMessage(error));
    }
  }

  private async writeScreenshot(
    sessionId: string,
    dataUrl: string,
    fileName?: string,
  ): Promise<EvidenceRef> {
    const match = /^data:image\/png;base64,(.+)$/s.exec(dataUrl);
    if (!match) {
      throw new Error('screenshot dataUrl is not PNG base64');
    }
    const buffer = Buffer.from(match[1], 'base64');
    const dir = assertInsideRoot(this.evidenceRoot, join(this.evidenceRoot, 'shots', sanitize(sessionId)), 'screenshot directory');
    await mkdir(dir, { recursive: true });
    // TF-0115: `fileName` is caller-supplied (and a page can steer an agent toward
    // it). `path.join` resolves `..`, so an unsanitised name escaped the evidence
    // root entirely — measured writes reached the repo root and, at 21 levels up,
    // the drive root. Sanitise it the same way `sessionId` already is, then assert
    // containment as a second, helper-independent layer.
    const rawName = sanitize(fileName ?? `${Date.now().toString(36)}.png`);
    const name = rawName.endsWith('.png') ? rawName : `${rawName}.png`;
    const path = join(dir, name);
    assertInsideRoot(this.evidenceRoot, path, 'screenshot path');
    await writeEvidenceBinary(this.evidenceRoot, path, buffer);
    return createEvidenceRef({
      kind: 'screenshot',
      label: `screenshot ${name}`,
      path: this.refPath(path),
      mimeType: 'image/png',
      size: buffer.byteLength,
    });
  }

  private async checkExpectation(
    sessionId: string,
    expectation: VerifyExpectation,
  ): Promise<VerifyExpectationResult> {
    const label =
      expectation.label ??
      (expectation.type === 'url'
        ? `url ${expectation.equals ?? expectation.contains ?? expectation.pattern ?? ''}`.trim()
        : `${expectation.type} ${expectation.selector}`);
    try {
      if (expectation.type === 'url') {
        const result = await this.api.evaluate({
          sessionId,
          expression: 'location.href',
        });
        if (!result?.success) {
          return {
            type: 'url',
            label,
            passed: false,
            detail: result?.error ?? 'evaluate unavailable for url assertion',
          };
        }
        const href = String(result.value ?? '');
        return matchTextExpectation('url', label, href, expectation);
      }

      const probe = await this.api.evaluate({
        sessionId,
        expression: `(() => {
          const el = document.querySelector(${JSON.stringify(expectation.selector)});
          if (!el) return { found: false };
          const value = 'value' in el ? String(el.value ?? '') : undefined;
          const disabled = 'disabled' in el ? Boolean(el.disabled) : undefined;
          return {
            found: true,
            text: el.textContent ?? '',
            value,
            disabled,
          };
        })()`,
      });
      if (!probe?.success) {
        return {
          type: expectation.type,
          label,
          passed: false,
          detail: probe?.error ?? 'evaluate unavailable for element assertion',
        };
      }
      const info = probe.value as
        | { found?: boolean; text?: string; value?: string; disabled?: boolean }
        | undefined;
      if (!info?.found) {
        return {
          type: expectation.type,
          label,
          passed: false,
          detail: `selector not found: ${expectation.selector}`,
        };
      }
      if (expectation.type === 'enabled') {
        const passed = info.disabled === false;
        return {
          type: 'enabled',
          label,
          passed,
          detail: passed ? undefined : `expected enabled, disabled=${String(info.disabled)}`,
        };
      }
      if (expectation.type === 'disabled') {
        const passed = info.disabled === true;
        return {
          type: 'disabled',
          label,
          passed,
          detail: passed ? undefined : `expected disabled, disabled=${String(info.disabled)}`,
        };
      }
      const actual = expectation.type === 'text' ? String(info.text ?? '') : String(info.value ?? '');
      return matchTextExpectation(expectation.type, label, actual, expectation);
    } catch (error) {
      return {
        type: expectation.type,
        label,
        passed: false,
        detail: toMessage(error),
      };
    }
  }

  private async diffConsole(
    sessionId: string,
    window: SignalWindow,
  ): Promise<ConsoleIncrementalDiff> {
    try {
      const result = await this.api.getConsoleMessages({ sessionId });
      if (!result?.success) {
        return {
          baselineCount: window.count,
          newErrors: [],
          newWarnings: [],
          collection: 'failed',
          collectionError: result?.error ?? 'getConsoleMessages reported failure',
        };
      }
      const text = result.content ?? '';
      const lines = text.split('\n').filter(Boolean);
      // Anchor on the last line seen before the navigation. `findIndex` takes the
      // *earliest* match, so a repeated identical line (e.g. the same resource
      // 404 text on the next page) stays inside the window rather than being
      // mistaken for the watermark.
      const resolved = resolveWindow(lines, window, (line) => line, window.allPages ? 0 : result.currentPageStart);
      const newLines = resolved.windowed;
      // TF-0111: classify by the level the driver reported (`[<level>] <text>`),
      // not by words inside the text. The old substring rule put a warning whose
      // text merely contains "error" into `newErrors`, and `newErrors` is a hard
      // failure — so a healthy page whose only output was Chromium's
      // `[warning] Error with Feature-Policy header…` was judged FAIL. Each line
      // lands in at most one bucket now (error wins).
      const newErrors: string[] = [];
      const newWarnings: string[] = [];
      for (const line of newLines) {
        const severity = classifyConsoleLine(line);
        if (severity === 'error') newErrors.push(line);
        else if (severity === 'warning') newWarnings.push(line);
      }
      return {
        baselineCount: resolved.excluded,
        newErrors,
        newWarnings,
        collection: result.collection ?? 'ok',
        ...(result.collectionError?{collectionError:result.collectionError}:{}),
        ...(resolved.anchorMissing ? { watermarkMissing: true } : {}),
      };
    } catch (error) {
      // Collection failure is NOT "no new errors".
      return {
        baselineCount: window.count,
        newErrors: [],
        newWarnings: [],
        collection: 'failed',
        collectionError: toMessage(error),
      };
    }
  }

  private async writeVerifyArtifacts(dirName: string, report: VerifyReport): Promise<string> {
    // TF-0119: same invariant as the other evidence sinks — `dirName` is sanitised,
    // but the containment assert is what makes the jail a property of the write
    // point rather than of one helper.
    const dir = assertInsideRoot(
      this.evidenceRoot,
      join(this.evidenceRoot, 'verify', sanitize(dirName)),
      'verify artifacts dir',
    );
    await mkdir(dir, { recursive: true });
    await writeEvidenceText(this.evidenceRoot, join(dir, 'summary.md'), report.summaryMarkdown);
    await writeEvidenceJson(this.evidenceRoot, join(dir, 'report.json'), report);
    await writeEvidenceJson(this.evidenceRoot, join(dir, 'console.json'), report.consoleDiff);
    await writeEvidenceJson(this.evidenceRoot, join(dir, 'network.json'), report.networkFailures);
    return dir;
  }
}

function matchTextExpectation(
  type: 'text' | 'value' | 'url',
  label: string,
  actual: string,
  expectation: { equals?: string; contains?: string; pattern?: string },
): VerifyExpectationResult {
  if (expectation.equals !== undefined) {
    const passed = actual === expectation.equals;
    return {
      type,
      label,
      passed,
      detail: passed ? undefined : `expected equals ${JSON.stringify(expectation.equals)}, got ${JSON.stringify(actual)}`,
    };
  }
  if (expectation.contains !== undefined) {
    const passed = actual.includes(expectation.contains);
    return {
      type,
      label,
      passed,
      detail: passed ? undefined : `expected contains ${JSON.stringify(expectation.contains)}, got ${JSON.stringify(actual)}`,
    };
  }
  if (expectation.pattern !== undefined) {
    const re = new RegExp(expectation.pattern, 'u');
    const passed = re.test(actual);
    return {
      type,
      label,
      passed,
      detail: passed ? undefined : `expected match /${expectation.pattern}/u, got ${JSON.stringify(actual)}`,
    };
  }
  return {
    type,
    label,
    passed: false,
    detail: 'expectation needs equals, contains, or pattern',
  };
}

/**
 * Compact summary for a health-only verification (no selectors, no business
 * expectations). The agent loop measured 12 of 13 `vb_verify_flow` calls in
 * exactly this shape, each returning a full ~5.8k-char acceptance report while
 * the report itself was already written to disk.
 *
 * Honesty guarantees are preserved verbatim: collection incompleteness is still
 * called out, and the summary still states it is not business success.
 */
function formatVerifyResult(report: VerifyReport, diagnosis: DiagnosisReport): string {
  return diagnosis.ok || report.ok ? report.summaryMarkdown
    : report.summaryMarkdown + inlineMarkdown`\n\n## First failure\n${diagnosis.firstFailure?.summary ?? ''}`;
}

function formatVerifyHealthSummary(
  outcome: VerifyOutcome,
  consoleDiff: ConsoleIncrementalDiff,
  networkFailures: NetworkFailureSummary,
  collection: { console: string; network: string; overall: string; notes: string[] },
): string {
  const label = outcome === 'pass' ? 'PASS' : outcome === 'fail' ? 'FAIL' : 'UNKNOWN';
  const lines: string[] = [
    inlineMarkdown`# verify_flow ${label}`,
    inlineMarkdown`- collection: ${collection.overall} (console=${collection.console}, network=${collection.network})`,
    inlineMarkdown`- console: +${consoleDiff.newErrors.length} errors, +${consoleDiff.newWarnings.length} warnings`,
    inlineMarkdown`- network failures: ${networkFailures.count}`,
    '- (none requested) — health signals only, NOT business success; pass expect[] for outcome checks',
  ];
  for (const note of collection.notes.slice(0, 3)) lines.push(inlineMarkdown`- ! ${note}`);
  if (collection.overall !== 'ok') {
    lines.push(
      inlineMarkdown`- ! collection incomplete (${collection.overall}) — empty lists must not be read as "no errors"`,
    );
  }
  for (const line of consoleDiff.newErrors.slice(0, 3)) {
    lines.push(inlineMarkdown`- ERROR ${line.slice(0, 200)}`);
  }
  if (consoleDiff.newErrors.length > 3) {
    lines.push(inlineMarkdown`- (+${consoleDiff.newErrors.length - 3} more errors; full list in the report)`);
  }
  // TF-0111: the compact summary counted warnings but never showed them, so an
  // agent knew a warning happened yet could not tell a deprecation notice from a
  // real problem — and could not quote it. Symmetric with the errors loop.
  for (const line of consoleDiff.newWarnings.slice(0, 3)) {
    lines.push(inlineMarkdown`- WARN ${line.slice(0, 200)}`);
  }
  if (consoleDiff.newWarnings.length > 3) {
    lines.push(inlineMarkdown`- (+${consoleDiff.newWarnings.length - 3} more warnings; full list in the report)`);
  }
  for (const item of networkFailures.failures.slice(0, 3)) {
    lines.push(inlineMarkdown`- ${item.method} ${item.url} -> ${item.status ?? item.error ?? 'failed'}`);
  }
  lines.push('- full report: summary.md + report.json in the evidence pack (see data)');
  return lines.join('\n');
}

function formatVerifySummary(
  outcome: VerifyOutcome,
  selectors: VerifySelectorResult[],
  expectations: VerifyExpectationResult[],
  consoleDiff: ConsoleIncrementalDiff,
  networkFailures: NetworkFailureSummary,
  screenshotPaths: string[],
  collection: { console: string; network: string; overall: string; notes: string[] },
): string {
  const label = outcome === 'pass' ? 'PASS' : outcome === 'fail' ? 'FAIL' : 'UNKNOWN';
  const lines: string[] = [
    inlineMarkdown`# verify_flow ${label}`,
    '',
    inlineMarkdown`## Collection (${collection.overall})`,
    inlineMarkdown`- console: ${collection.console}`,
    inlineMarkdown`- network: ${collection.network}`,
  ];
  for (const note of collection.notes) lines.push(inlineMarkdown`- ! ${note}`);
  if (collection.notes.length === 0) lines.push('- all signal channels collected');
  if (outcome === 'unknown') {
    lines.push(
      '- result is UNKNOWN because collection was incomplete — empty error lists must not be read as "no errors"',
    );
  }

  lines.push(
    '',
    inlineMarkdown`## Selectors (${selectors.filter((s) => s.found).length}/${selectors.length} found)`,
  );
  for (const item of selectors) {
    const mark = item.found ? '[ok]' : '[miss]';
    lines.push(inlineMarkdown`- ${mark} ${item.selector}${item.detail ? inlineMarkdown` -- ${item.detail}` : ''}`);
  }
  if (selectors.length === 0) lines.push('- (none requested)');

  lines.push(
    '',
    inlineMarkdown`## Business assertions (${expectations.filter((e) => e.passed).length}/${expectations.length} passed)`,
  );
  if (expectations.length === 0) {
    lines.push(
      '- (none requested) — health signals only, NOT business success; add expectText/expectEnabled/expectUrl for outcome checks',
    );
  } else {
    for (const item of expectations) {
      const mark = item.passed ? '[ok]' : '[miss]';
      lines.push(inlineMarkdown`- ${mark} ${item.label}${item.detail ? inlineMarkdown` -- ${item.detail}` : ''}`);
    }
  }
  const consoleState = consoleDiff.collection === 'ok' ? '' : inlineMarkdown` [collection ${consoleDiff.collection}]`;
  lines.push(
    '',
    inlineMarkdown`## Console (baseline ${consoleDiff.baselineCount}, +${consoleDiff.newErrors.length} errors, +${consoleDiff.newWarnings.length} warnings)${consoleState}`,
  );
  if (consoleDiff.collection !== 'ok') {
    lines.push(inlineMarkdown`- ! console collection ${consoleDiff.collection}${consoleDiff.collectionError ? inlineMarkdown`: ${consoleDiff.collectionError}` : ''}`);
  }
  for (const line of consoleDiff.newErrors) lines.push(inlineMarkdown`- ERROR ${line}`);
  for (const line of consoleDiff.newWarnings) lines.push(inlineMarkdown`- WARN ${line}`);
  if (consoleDiff.collection === 'ok' && consoleDiff.newErrors.length + consoleDiff.newWarnings.length === 0) {
    lines.push('- no new console issues');
  } else if (consoleDiff.collection !== 'ok' && consoleDiff.newErrors.length + consoleDiff.newWarnings.length === 0) {
    lines.push('- (not observed — collection incomplete)');
  }

  const networkState = networkFailures.collection === 'ok' ? '' : inlineMarkdown` [collection ${networkFailures.collection}]`;
  lines.push('', inlineMarkdown`## Network failures (${networkFailures.count})${networkState}`);
  if (networkFailures.collection !== 'ok') {
    lines.push(inlineMarkdown`- ! network collection ${networkFailures.collection}${networkFailures.collectionError ? inlineMarkdown`: ${networkFailures.collectionError}` : ''}`);
  }
  for (const item of networkFailures.failures) {
    lines.push(inlineMarkdown`- ${item.method} ${item.url} -> ${item.status ?? item.error ?? 'failed'}`);
  }
  if (networkFailures.collection === 'ok' && networkFailures.count === 0) {
    lines.push('- none');
  } else if (networkFailures.collection !== 'ok' && networkFailures.count === 0) {
    lines.push('- (not observed — collection incomplete)');
  }

  lines.push('', '## Screenshots');
  for (const path of screenshotPaths) lines.push(inlineMarkdown`- ${path}`);
  if (screenshotPaths.length === 0) lines.push('- (skipped)');

  return lines.join('\n');
}

function sanitize(value: string): string {
  return sanitizeSegment(value);
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
