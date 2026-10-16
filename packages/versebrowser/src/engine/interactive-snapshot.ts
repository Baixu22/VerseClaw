/**
 * Actionable compact snapshot for thin drivers (playwright / host-agnostic helpers).
 * Interactive elements get stable refs via data-vb-ref so agents can click/type
 * without guessing selectors or reading full HTML.
 */

import { REDACTED } from '../security/redact-secrets.ts';
import type { Locator, Page } from 'playwright';
import type { AgentBrowserActionResult } from '../types/host-api.ts';

/** Start native dragging before target scrolling can move another element under the pointer. */
export async function dragWithNativeStart(page: Page, source: Locator, target: Locator, remaining: () => number) {
  if (await source.count() !== 1 || await target.count() !== 1) throw new Error('E_DRAG_TARGET: source and target must each match exactly one element');
  // Pin both identities; reacquiring a CSS match after a scroll must not select a replacement.
  const start = await source.elementHandle({ timeout: remaining() });
  let end;
  try { end = await target.elementHandle({ timeout: remaining() }); }
  catch (error) { await start?.dispose(); throw error; }
  if (!start || !end) { await start?.dispose(); await end?.dispose(); throw new Error('E_DRAG_TARGET: missing source or target'); }
  let pressed = false;
  try {
    await start.hover({ timeout: remaining() });
    const box = await start.boundingBox();
    if (!box || box.width < 24 || box.height < 4) throw new Error('E_DRAG_TARGET: source has insufficient visible area for a native drag start');
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    const usable = await start.evaluate((element, point) => {
      const root = element.getRootNode() as Document | ShadowRoot;
      return [point.x, point.x + 10].every(x => {
        const hit = root.elementFromPoint(x, point.y);
        return !!hit && (element === hit || element.contains(hit));
      });
    }, { x, y });
    if (!usable) throw new Error('E_DRAG_TARGET: source drag start is clipped or covered');
    remaining();
    await page.mouse.move(x, y);
    await page.mouse.down(); pressed = true;
    await page.mouse.move(x + 10, y, { steps: 5 });
    remaining();
    await end.hover({ timeout: remaining() });
    await page.mouse.up(); pressed = false;
  } finally {
    try { if (pressed) { try { await page.keyboard.press('Escape'); } finally { await page.mouse.up(); } } }
    finally { await start.dispose(); await end.dispose(); }
  }
}

export function readFormFieldDetails(element: Element) {
          if (!element.isConnected) throw new Error('E_STALE_REF: node detached during details read');
          const field = element as HTMLInputElement;
          const validity = field.validity;
          const errorIds = (element.getAttribute('aria-errormessage') ?? '').split(/\s+/).filter(Boolean);
          const root = element.getRootNode() as Document | ShadowRoot;
          const errors = errorIds.slice(0, 8).map(id => {
            const error = root.getElementById(id);
            return error ? { id, text: (error.textContent ?? '').slice(0, 240), source: 'aria-errormessage' } : { id, missing: true, source: 'aria-errormessage' };
          });
          const descriptions = (element.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean).slice(0, 8).map(id => {
            const node = root.getElementById(id);
            return node ? { id, text: (node.textContent ?? '').slice(0, 240), source: 'aria-describedby' } : { id, missing: true, source: 'aria-describedby' };
          });
          return { tag: element.tagName.toLowerCase(), sourceUrl: element.ownerDocument.URL,
            name: element.getAttribute('name')?.slice(0, 200) ?? null, type: element.getAttribute('type')?.slice(0, 200) ?? null,
            label: Array.from(field.labels ?? []).map(label => label.textContent ?? '').join(' ').slice(0, 200),
            form: field.form ? { id: field.form.id || null, name: field.form.getAttribute('name')?.slice(0, 200) ?? null, documentIndex: Array.from(element.ownerDocument.forms).indexOf(field.form) } : null,
            constraints: Object.fromEntries(['min','max','minlength','maxlength','pattern','step'].filter(name=>element.hasAttribute(name)).map(name=>[name,(element.getAttribute(name) ?? '').slice(0,240)])),
            ...(validity ? { validity: Object.fromEntries(['valid','valueMissing','typeMismatch','patternMismatch','tooLong','tooShort','rangeUnderflow','rangeOverflow','stepMismatch','badInput','customError'].map(key=>[key,validity[key as keyof ValidityState]])), validitySource:'browser-native' } : {}),
            errors, descriptions, ariaInvalid: element.getAttribute('aria-invalid'), serverValidation: 'unknown' as const,
            ...('required' in field ? { required: field.required } : {}),
            ...('readOnly' in field ? { readOnly: field.readOnly } : {}),
            ...('disabled' in field ? { disabled: element.matches(':disabled') } : {}) };
}

/**
 * Runs in the page; secret values are withheld before crossing the browser boundary.
 *
 * The keyword list carries both families: the credential names (password/secret/token/...)
 * and the network alias names (session/sid/csrf/xsrf) that `isSensitiveNetworkName` also
 * treats as secret. Measured 2026-10-14: without the network names a field named `csrf`,
 * `xsrf`, `sid` or `session` kept its raw value in the snapshot (and, through this same
 * function, in `vb_find` details and the form overview).
 */
export function readFieldState(el: Element, marker: string) {
  const field = el as HTMLInputElement;
  if (!el.isConnected) throw new Error('field is detached');
  const name = [el.getAttribute('aria-label'), el.getAttribute('placeholder'), el.getAttribute('title'), el.getAttribute('name'), el.id,
    field.labels?.[0]?.textContent].filter(Boolean).join(' ') || el.textContent || '';
  const secret = field.type === 'password' || /pass(word|wd)?|secret|token|api[-_]?key|authorization|cookie|credential|private[-_]?key|otp|pin|session|sid|csrf|xsrf/i.test(name);
  const raw = 'value' in field ? String(field.value) : el.hasAttribute('contenteditable') ? el.textContent ?? '' : undefined;
  const selected = el.tagName === 'SELECT' ? Array.from((el as HTMLSelectElement).selectedOptions).map(option => option.value) : undefined;
  const options = el.tagName === 'SELECT' ? Array.from((el as HTMLSelectElement).options) : undefined;
  const valueRedacted = secret && (Boolean(raw) || Boolean(selected?.some(Boolean)));
  const truncated = !valueRedacted && ((raw?.length ?? 0) > 120 || (selected?.length ?? 0) > 80 || !!selected?.some(value => value.length > 120));
  return {
    ...(raw !== undefined ? { value: valueRedacted ? marker : raw.slice(0, 120) } : {}),
    ...(field.type === 'checkbox' || field.type === 'radio' ? { checked: field.checked } : {}),
    ...(selected ? { selectedValues: valueRedacted ? [marker] : selected.slice(0, 80).map(value => value.slice(0, 120)) } : {}),
    ...(options ? { options: options.slice(0, 20).map(option => ({ value: secret ? marker : option.value.slice(0, 120), label: secret ? marker : option.label.slice(0, 120), selected: option.selected, disabled: option.disabled })), optionsTruncated: options.length > 20 || options.some(option=>option.value.length > 120 || option.label.length > 120) } : {}),
    ...(valueRedacted ? { valueRedacted: true } : {}), ...(truncated ? { truncated: true } : {}),
  };
}

/** In-page check immediately before sending keys to an explicitly selected field. */
export function assertFieldFocused(element: Element) {
  if ((element.getRootNode() as Document | ShadowRoot).activeElement !== element) {
    throw new Error('E_FOCUS_CHANGED: requested field did not retain focus; key not sent');
  }
}

/** Validate value-only selection before native exact-value selection runs. */
export function assertSelectValues(el: Element, values: string[]) {
  if (el.tagName !== 'SELECT') throw new Error('E_SELECT_TARGET: expected a native select');
  const select = el as HTMLSelectElement;
  if (!select.multiple && values.length > 1) throw new Error('E_SELECT_TARGET: target does not allow multiple values');
  const options = Array.from(select.options);
  for (const value of values) {
    if (options.filter(option => option.value === value).length !== 1) {
      throw new Error('E_AMBIGUOUS_OPTION: value is missing or duplicated');
    }
  }
}

/** Observe the same element before/after a native action; never substitute a replacement node. */
export async function observeFieldAction(locator: Locator, timeoutMs: number, action: () => Promise<unknown>): Promise<NonNullable<AgentBrowserActionResult['fieldChange']>> {
  const handle = await locator.elementHandle({ timeout: timeoutMs });
  if (!handle) throw new Error('field unavailable');
  try {
    const before = await handle.evaluate(readFieldState, REDACTED);
    await action();
    try {
      const after = await handle.evaluate(readFieldState, REDACTED);
      const uncertain = before.valueRedacted || after.valueRedacted || before.truncated || after.truncated;
      return { before, after, changed: uncertain ? 'unknown' : JSON.stringify(before) !== JSON.stringify(after) };
    } catch { return { before, changed: 'unknown', stateUnavailable: true }; }
  } finally { await handle.dispose().catch(() => {}); }
}

export type InteractiveElement = {
  ref: string;
  tag: string;
  role: string;
  name: string;
  value?: string;
  disabled?: boolean;
  readOnly?: boolean;
  checked?: boolean | 'mixed';
  selected?: boolean;
  href?: string;
  /**
   * TF-0107: `aria-expanded` when the element carries it — the disclosure /
   * accordion state an agent needs to tell a collapsed control from an expanded
   * one. Omitted entirely when the attribute is absent, so pages without ARIA
   * state keep a byte-identical snapshot.
   */
  expanded?: boolean;
  /** TF-0107: `aria-controls` — the panel id this control toggles, when present. */
  controls?: string;
  /**
   * True when `value` was withheld because the field looks secret-bearing. The driver
   * reports it so a caller can tell "empty field" from "field we refuse to read".
   */
  valueRedacted?: boolean;
};

export type SnapshotMetrics = {
  title: string;
  url: string;
  htmlBytes: number;
  textChars: number;
};

/**
 * 可点击元素发现规则（TF-0092）。
 *
 * 背景：MiniWoB `click-link` 把「链接」渲染成 `<span class="alink">` + addEventListener，
 * 而默认选择器只覆盖语义元素（`a[href]` / `button` / 表单控件 / ARIA role），
 * 于是 ref 交互够不到目标（官方任务 5/5 seed 失败）。
 *
 * 规则（最小、可解释、有上限、可关闭）：额外收录**计算样式 `cursor: pointer`**、
 * 不含/不属任何已收录交互元素、且带短可见文本（≤80 字符）的叶子式元素，最多补
 * `CLICKABLE_DISCOVERY_LIMIT` 个。默认 **off**，保持既有快照面与已发布读数不变；
 * 需要时用 `VERSEBROWSER_SNAPSHOT_CLICKABLE=pointer` 打开。
 */
export type ClickableDiscovery = 'off' | 'pointer';

export const CLICKABLE_DISCOVERY_LIMIT = 20;
export const CLICKABLE_DISCOVERY_ENV = 'VERSEBROWSER_SNAPSHOT_CLICKABLE';

export function resolveClickableDiscovery(env: Record<string, string | undefined> = process.env): ClickableDiscovery {
  return env[CLICKABLE_DISCOVERY_ENV]?.trim().toLowerCase() === 'pointer' ? 'pointer' : 'off';
}

/** page.evaluate expression: tag interactive DOM nodes and return their descriptors. */
export function buildCollectInteractiveExpression(
  options: { clickable?: ClickableDiscovery; clickableLimit?: number } = {},
): string {
  const clickable = options.clickable ?? 'off';
  const limit = options.clickableLimit ?? CLICKABLE_DISCOVERY_LIMIT;
  // 关闭时**不生成**这段代码：默认表达式与既有版本一致（既有快照面与已发布读数不受影响）。
  const clickableBlock =
    clickable === 'pointer'
      ? `
  {
    const extras = [];
    for (const el of Array.from(document.querySelectorAll('*'))) {
      if (extras.length >= LIMIT_MARK || items.length >= 80) break;
      if (el.hasAttribute('data-vb-ref')) continue;
      if (el.tagName === 'HTML' || el.tagName === 'BODY' || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
      if (el.closest('[data-vb-ref]')) continue;
      if (el.querySelector(SELECTOR)) continue;
      if (el.hidden || el.getAttribute('aria-hidden') === 'true') continue;
      const style = window.getComputedStyle(el);
      if (style.cursor !== 'pointer') continue;
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
      if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) continue;
      const text = String(el.textContent || '').replace(/\\s+/g, ' ').trim();
      if (!text || text.length > 80) continue;
      const ref = 'e' + (++n);
      el.setAttribute('data-vb-ref', ref);
      items.push({ ref, tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || 'clickable', name: text });
      extras.push(ref);
    }
  }`.replace('LIMIT_MARK', String(limit))
      : '';
  return `(() => {
  const SELECTOR = 'a[href], button, input, select, textarea, summary, [role="button"], [role="link"], [role="textbox"], [role="checkbox"], [role="radio"], [role="combobox"], [contenteditable="true"]';
  // The single product-wide redaction marker, inlined as a literal: this code runs in the
  // page, so it cannot import. Keeping one source of truth for the marker is the point.
  const REDACTED_MARK = ${JSON.stringify(REDACTED)};
  const readFieldState = ${readFieldState.toString()};
  const nodes = Array.from(document.querySelectorAll(SELECTOR));
  for (const el of document.querySelectorAll('[data-vb-ref]')) el.removeAttribute('data-vb-ref');
  const items = [];
  let n = 0;
  for (const el of nodes) {
    if (el.hidden || el.getAttribute('aria-hidden') === 'true') continue;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) continue;
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    let role = el.getAttribute('role') || '';
    if (!role) {
      if (tag === 'a') role = 'link';
      else if (tag === 'summary') role = 'button';
      else if (tag === 'button' || (tag === 'input' && (type === 'button' || type === 'submit' || type === 'reset'))) role = 'button';
      else if (tag === 'select') role = 'combobox';
      else if (tag === 'textarea') role = 'textbox';
      else if (tag === 'input' && type === 'checkbox') role = 'checkbox';
      else if (tag === 'input' && type === 'radio') role = 'radio';
      else if (tag === 'input') role = 'textbox';
      else role = tag;
    }
    const labelled = el.getAttribute('aria-label')
      || el.getAttribute('placeholder')
      || el.getAttribute('title')
      || el.getAttribute('name')
      || (el.labels && el.labels[0] && el.labels[0].textContent)
      || (el.textContent || '').trim().slice(0, 80)
      || '';
    const name = String(labelled).replace(/\\s+/g, ' ').trim().slice(0, 80);
    // Never surface a secret-bearing field's value.
    //
    // Measured (real Chromium, 2026-10-04): a filled password input came back as
    //   - [e2] textbox | "password" | value="SuperSecret-Passw0rd!"
    // and the value survived every downstream layer — the facade payload, includeText,
    // diagnose_page and the MCP envelope (whose redactor only matches "key=value" /
    // "key: value", not this "name | value=" shape). That contradicted the product's own
    // promise that credentials are redacted. page_text was never affected (it reads no
    // values). Password inputs and fields whose name/id/label looks secret-bearing
    // (api_key, token, …) keep their name and a marker, so the agent still knows the field
    // exists and whether it currently holds something, but the value never leaves the page.
    // Non-secret values are byte-identical to before.
    // A password field keeps a placeholder value so the agent can still tell that the
    // field currently holds something (it needs that to decide whether to re-type), while
    // the shared marker — never the secret — is what reaches the model.
    const fieldState = readFieldState(el, REDACTED_MARK);
    const value = fieldState.value;
    const valueRedacted = fieldState.valueRedacted;
    const disabled = 'disabled' in el ? Boolean(el.disabled) : el.getAttribute('aria-disabled') === 'true';
    const readOnly = 'readOnly' in el ? Boolean(el.readOnly) : el.hasAttribute('aria-readonly') ? el.getAttribute('aria-readonly') === 'true' : undefined;
    const ariaChecked = el.getAttribute('aria-checked');
    const checked = tag === 'input' && (type === 'checkbox' || type === 'radio')
      ? (el.indeterminate ? 'mixed' : Boolean(el.checked))
      : ariaChecked === 'mixed' ? 'mixed' : ariaChecked !== null ? ariaChecked === 'true' : undefined;
    const selected = el.hasAttribute('aria-selected') ? el.getAttribute('aria-selected') === 'true' : undefined;
    // TF-0112: resolve the href against the page so an observed value is directly
    // usable with vb_nav — which requires an absolute URL and otherwise rejects
    // the relative form the snapshot used to print with E_NAV Malformed URL.
    const rawHref = tag === 'a' ? el.getAttribute('href') || undefined : undefined;
    let href = rawHref;
    if (rawHref) {
      try {
        href = new URL(rawHref, document.baseURI).href;
      } catch {
        href = rawHref;
      }
    }
    // TF-0107 / TF-0112: disclosure state. aria-expanded wins when present;
    // native DETAILS (which has no such attribute) derives from the open attribute.
    const expandedAttr = el.getAttribute('aria-expanded');
    const detailsParent = tag === 'summary' ? el.parentElement : null;
    const nativeExpanded = detailsParent && detailsParent.tagName === 'DETAILS' ? detailsParent.hasAttribute('open') : undefined;
    const expanded = expandedAttr !== null ? expandedAttr === 'true' : nativeExpanded;
    const controls = el.getAttribute('aria-controls') || undefined;
    const ref = 'e' + (++n);
    el.setAttribute('data-vb-ref', ref);
    items.push({
      ref,
      tag,
      role,
      name,
      ...(value !== undefined ? { value: value.slice(0, 120) } : {}),
      ...(valueRedacted ? { valueRedacted: true } : {}),
      disabled,
      ...(readOnly !== undefined ? { readOnly } : {}),
      ...(checked !== undefined ? { checked } : {}),
      ...(selected !== undefined ? { selected } : {}),
      ...(href ? { href: href.slice(0, 300) } : {}),
      ...(expanded !== undefined ? { expanded } : {}),
      ...(controls ? { controls: controls.slice(0, 80) } : {}),
    });
    if (items.length >= 80) break;
  }${clickableBlock}
  return items;
})()`;
}

/** 默认（clickable=off）表达式：既有调用方与测试的兼容入口。 */
export const COLLECT_INTERACTIVE_EXPRESSION = buildCollectInteractiveExpression();

export function formatActionableSnapshot(
  metrics: SnapshotMetrics,
  items: InteractiveElement[],
  actionHint = 'vb_click / vb_type (or clickByUid/fillByUid)',
): string {
  const lines: string[] = [
    '# snapshot',
    `- title: ${metrics.title}`,
    `- url: ${metrics.url}`,
    '',
    `## Interactive (${items.length})`,
    `- use selector \`[data-vb-ref="ref"]\` with ${actionHint}`,
  ];
  if (items.length === 0) {
    lines.push('- (no interactive elements observed)');
  }
  for (const item of items) {
    const bits: string[] = [item.role || item.tag];
    if (item.name) bits.push(JSON.stringify(item.name));
    if (item.value !== undefined && item.value !== '') bits.push(`value=${JSON.stringify(item.value)}`);
    // Say *why* a value is a marker, so "we refused to read it" is distinguishable
    // from "the field really contains the literal string".
    if (item.valueRedacted) bits.push('value_redacted');
    if (item.disabled) bits.push('disabled');
    if (item.readOnly) bits.push('readonly');
    if (item.checked !== undefined) bits.push(`checked=${item.checked}`);
    if (item.selected !== undefined) bits.push(`selected=${item.selected}`);
    // TF-0107: rendered only when observed, so ARIA-free pages stay byte-identical.
    if (item.expanded !== undefined) bits.push(`expanded=${item.expanded}`);
    if (item.controls) bits.push(`controls=${item.controls}`);
    if (item.href) bits.push(`href=${item.href}`);
    lines.push(`- [${item.ref}] ${bits.join(' | ')} | sel=[data-vb-ref="${item.ref}"]`);
  }
  lines.push('', '## Metrics');
  lines.push(`- html_bytes: ${metrics.htmlBytes}`);
  lines.push(`- text_chars: ${metrics.textChars}`);
  return lines.join('\n');
}

export function resolveRefSelector(uid: string): string {
  const ref = uid.includes('=') ? uid : uid.trim();
  const bare = ref.replace(/^\[data-vb-ref="([^"]+)"\]$/, '$1');
  return `[data-vb-ref="${bare.replace(/"/g, '')}"]`;
}
