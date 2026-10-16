/**
 * Local read-only HTML trajectory viewer for Evidence Packs (TF-0050).
 * Self-contained offline page: timeline + diagnosis + screenshots + pack index.
 * Never inlines HAR/payloads; screenshots stay as relative paths under shots/.
 */
import { mkdir, readFile } from 'node:fs/promises';
import { writeEvidenceText, writeEvidenceJson } from './output.ts';
import { redactSecretsInValue } from '../security/redact-secrets.ts';
import { assertInsideRoot, EvidencePathError } from './path-guard.ts';
import { basename, dirname, join, relative } from 'node:path';
import type { TimelineEvent } from '../contracts/index.ts';
import type { EvidencePackContents } from './schema.ts';
import { EVIDENCE_PACK_SCHEMA_VERSION, PACK_FILES } from './schema.ts';

export type TrajectoryViewerInput = {
  pack: EvidencePackContents;
  /** Absolute pack directory (for path display only). */
  packDir?: string;
};

export type WriteTrajectoryViewerOptions = {
  /** Reuse a just-read pack instead of re-reading from disk. */
  pack?: EvidencePackContents;
  /** Output path; default `<packDir>/viewer.html`. */
  outFile?: string;
};

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeJson(value: unknown): string {
  try {
    return escapeHtml(JSON.stringify(value, null, 2));
  } catch {
    return escapeHtml(String(value));
  }
}

function toRelativeShotPath(absoluteOrRelative: string, packDir?: string): string {
  if (!packDir) {
    return absoluteOrRelative.replaceAll('\\', '/');
  }
  const rel = relative(packDir, absoluteOrRelative).replaceAll('\\', '/');
  return rel.startsWith('..') ? absoluteOrRelative.replaceAll('\\', '/') : rel;
}

function eventIsFailure(event: TimelineEvent, failureSeqs: Set<number>): boolean {
  if (failureSeqs.has(event.seq)) return true;
  if (event.ok === false) return true;
  if (event.kind === 'network') {
    const status = typeof event.detail?.status === 'number' ? event.detail.status : undefined;
    if (status !== undefined && status >= 400) return true;
    if (event.detail?.failed === true) return true;
  }
  if (event.kind === 'console') {
    const level = String(event.detail?.level ?? event.name ?? '').toLowerCase();
    if (level === 'error' || event.name === 'error') return true;
  }
  return false;
}

function statusBadge(pack: EvidencePackContents): { label: string; className: string } {
  if (pack.diagnosis && !pack.diagnosis.ok) return { label: 'FAIL', className: 'badge-fail' };
  if (pack.verify && !pack.verify.ok) return { label: 'FAIL', className: 'badge-fail' };
  if (pack.diagnosis?.ok || pack.verify?.ok) return { label: 'CLEAN', className: 'badge-pass' };
  return { label: 'PACK', className: 'badge-neutral' };
}

/**
 * Render a self-contained, read-only HTML trajectory viewer from an Evidence Pack.
 * Output is pure HTML/CSS/JS — no network, no external assets, no write actions.
 */
export function renderTrajectoryViewer(input: TrajectoryViewerInput): string {
  const { pack, packDir } = redactSecretsInValue(input);
  const { manifest, timeline, diagnosis } = pack;
  const badge = statusBadge(pack);
  const events: TimelineEvent[] = [...(timeline?.events ?? [])].sort((a, b) => a.seq - b.seq);
  const failureSeqs = new Set<number>();
  for (const failure of diagnosis?.failures ?? []) {
    if (Number.isFinite(failure.index) && failure.index < Number.MAX_SAFE_INTEGER) {
      failureSeqs.add(failure.index);
    }
  }
  const firstFailureSeq = diagnosis?.firstFailure?.index;
  const shots = pack.screenshots.map((path) => toRelativeShotPath(path, packDir));
  const kindCounts = new Map<string, number>();
  for (const event of events) {
    kindCounts.set(event.kind, (kindCounts.get(event.kind) ?? 0) + 1);
  }

  const eventRows = events
    .map((event) => {
      const fail = eventIsFailure(event, failureSeqs);
      const isFirst = firstFailureSeq !== undefined && event.seq === firstFailureSeq;
      const detailHtml = event.detail
        ? `<pre class="detail">${safeJson(event.detail)}</pre>`
        : '';
      const okChip =
        event.ok === false
          ? '<span class="chip chip-fail">FAIL</span>'
          : event.ok === true
            ? '<span class="chip chip-ok">ok</span>'
            : '';
      return `
<article class="event${fail ? ' is-fail' : ''}${isFirst ? ' is-first' : ''}" data-kind="${escapeHtml(event.kind)}" data-fail="${fail ? '1' : '0'}" data-seq="${escapeHtml(event.seq)}">
  <header>
    <span class="seq">#${escapeHtml(event.seq)}</span>
    <span class="kind kind-${escapeHtml(event.kind)}">${escapeHtml(event.kind)}</span>
    <span class="name">${escapeHtml(event.name)}</span>
    ${okChip}
    ${isFirst ? '<span class="chip chip-first">first failure</span>' : ''}
    <time>${escapeHtml(event.at)}</time>
  </header>
  ${detailHtml}
</article>`;
    })
    .join('\n');

  const shotRows = shots
    .map(
      (rel) => `
<figure class="shot">
  <img src="${escapeHtml(rel)}" alt="${escapeHtml(rel)}" loading="lazy" />
  <figcaption>${escapeHtml(rel)}</figcaption>
</figure>`,
    )
    .join('\n');

  const fileRows = manifest.files
    .map(
      (file) => `
<li><code>${escapeHtml(file.path)}</code><span class="muted">${escapeHtml(file.kind)}</span></li>`,
    )
    .join('\n');

  const kindFilters = ['action', 'network', 'console', 'snapshot', 'mode']
    .map(
      (kind) =>
        `<label class="filter"><input type="checkbox" data-kind-filter="${kind}" checked /> ${kind} <span class="muted">${kindCounts.get(kind) ?? 0}</span></label>`,
    )
    .join('');

  const firstFailureBlock = diagnosis?.firstFailure
    ? `
<section class="card callout-fail">
  <h2>First failure</h2>
  <p class="lead"><strong>#${escapeHtml(diagnosis.firstFailure.index)}</strong>
    <span class="kind kind-${escapeHtml(diagnosis.firstFailure.kind)}">${escapeHtml(diagnosis.firstFailure.kind)}</span>
    ${escapeHtml(diagnosis.firstFailure.name)}</p>
  <p>${escapeHtml(diagnosis.firstFailure.summary)}</p>
  <p class="muted">${escapeHtml(diagnosis.firstFailure.at)}</p>
</section>`
    : diagnosis
      ? `
<section class="card callout-pass">
  <h2>First failure</h2>
  <p class="lead">No failure points in recorded timeline.</p>
</section>`
      : '';

  const metaLines = [
    manifest.sessionId ? `session <code>${escapeHtml(manifest.sessionId)}</code>` : '',
    timeline?.startedAt ? `started ${escapeHtml(timeline.startedAt)}` : '',
    timeline?.endedAt ? `ended ${escapeHtml(timeline.endedAt)}` : '',
    diagnosis ? `failures ${escapeHtml(diagnosis.failureCount)}` : '',
    `events ${escapeHtml(events.length)}`,
    `shots ${escapeHtml(shots.length)}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>trajectory viewer — ${escapeHtml(manifest.packId)}</title>
<style>
  :root {
    --bg: #f6f7f9;
    --panel: #ffffff;
    --ink: #1c2430;
    --muted: #667085;
    --line: #e4e7ec;
    --ok: #027a48;
    --ok-bg: #ecfdf3;
    --fail: #b42318;
    --fail-bg: #fef3f2;
    --first: #b54708;
    --first-bg: #fffaeb;
    --action: #175cd3;
    --network: #6941c6;
    --console: #c4320a;
    --snapshot: #0e7490;
    --mode: #344054;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font: 14px/1.5 -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    color: var(--ink);
    background: var(--bg);
  }
  header.top {
    position: sticky; top: 0; z-index: 2;
    display: flex; flex-wrap: wrap; gap: 12px; align-items: center;
    padding: 14px 20px;
    background: #111827; color: #f9fafb;
  }
  header.top h1 { font-size: 16px; margin: 0; font-weight: 600; }
  header.top .meta { color: #d0d5dd; font-size: 12px; }
  .badge {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 2px 10px; border-radius: 999px; font-weight: 700; font-size: 12px;
  }
  .badge-pass { background: var(--ok-bg); color: var(--ok); }
  .badge-fail { background: var(--fail-bg); color: var(--fail); }
  .badge-neutral { background: #eef2ff; color: #3538cd; }
  main { max-width: 1080px; margin: 0 auto; padding: 20px; display: grid; gap: 16px; }
  .card {
    background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px;
  }
  .card h2 { margin: 0 0 10px; font-size: 14px; letter-spacing: .02em; text-transform: uppercase; color: var(--muted); }
  .lead { margin: 0 0 6px; font-size: 15px; }
  .muted { color: var(--muted); }
  .callout-fail { border-left: 4px solid var(--fail); background: linear-gradient(0deg, var(--fail-bg), var(--fail-bg)), var(--panel); }
  .callout-pass { border-left: 4px solid var(--ok); background: linear-gradient(0deg, var(--ok-bg), var(--ok-bg)), var(--panel); }
  .controls {
    display: flex; flex-wrap: wrap; gap: 12px 18px; align-items: center;
    padding: 12px 14px; background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
  }
  .controls input[type="search"] {
    flex: 1 1 220px; min-width: 180px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; font: inherit;
  }
  .filter { display: inline-flex; align-items: center; gap: 6px; color: var(--ink); user-select: none; }
  .timeline { display: grid; gap: 10px; }
  .event {
    background: var(--panel); border: 1px solid var(--line); border-left: 4px solid transparent; border-radius: 10px; padding: 10px 12px;
  }
  .event.is-fail { border-left-color: var(--fail); }
  .event.is-first { border-left-color: var(--first); box-shadow: inset 0 0 0 1px var(--first-bg); }
  .event header { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .event .seq { font-variant-numeric: tabular-nums; color: var(--muted); min-width: 2.5rem; }
  .event .name { font-weight: 600; flex: 1 1 180px; word-break: break-word; }
  .event time { color: var(--muted); font-size: 12px; }
  .event .detail {
    margin: 8px 0 0; padding: 10px; background: #0f172a; color: #e2e8f0; border-radius: 8px;
    overflow: auto; max-height: 220px; font: 12px/1.45 ui-monospace, Consolas, monospace;
  }
  .kind {
    display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; text-transform: uppercase;
    background: #eef2ff; color: var(--mode);
  }
  .kind-action { background: #eff8ff; color: var(--action); }
  .kind-network { background: #f4f3ff; color: var(--network); }
  .kind-console { background: #fff6ed; color: var(--console); }
  .kind-snapshot { background: #ecfdff; color: var(--snapshot); }
  .kind-mode, .kind-assertion { background: #f2f4f7; color: var(--mode); }
  .chip {
    display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 700;
  }
  .chip-ok { background: var(--ok-bg); color: var(--ok); }
  .chip-fail { background: var(--fail-bg); color: var(--fail); }
  .chip-first { background: var(--first-bg); color: var(--first); }
  .shots { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
  .shot { margin: 0; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
  .shot img { display: block; width: 100%; height: 140px; object-fit: cover; background: #f2f4f7; }
  .shot figcaption { padding: 8px 10px; font-size: 12px; color: var(--muted); word-break: break-all; }
  .files { margin: 0; padding-left: 18px; display: grid; gap: 4px; }
  .files li { display: flex; gap: 10px; justify-content: space-between; }
  .empty {
    padding: 18px; border: 1px dashed var(--line); border-radius: 10px; color: var(--muted); background: var(--panel);
  }
  footer {
    max-width: 1080px; margin: 0 auto 28px; padding: 0 20px; color: var(--muted); font-size: 12px;
  }
  code { font: 12px/1.4 ui-monospace, Consolas, monospace; }
</style>
</head>
<body>
<header class="top">
  <span class="badge ${badge.className}">${escapeHtml(badge.label)}</span>
  <h1>${escapeHtml(manifest.label)}</h1>
  <div class="meta">
    pack <code>${escapeHtml(manifest.packId)}</code>
    · ${metaLines}
  </div>
</header>
<main>
  ${firstFailureBlock}
  <section class="card">
    <h2>Pack</h2>
    <p class="lead">${escapeHtml(manifest.notes ?? 'Local read-only trajectory view of an Evidence Pack.')}</p>
    <p class="muted">created ${escapeHtml(manifest.createdAt)} · schema v${escapeHtml(manifest.schemaVersion)}</p>
  </section>

  <section class="controls" aria-label="timeline filters">
    ${kindFilters}
    <label class="filter"><input type="checkbox" id="failOnly" /> failures only</label>
    <input type="search" id="q" placeholder="filter name / detail…" />
  </section>

  <section>
    <h2 class="card" style="margin:0 0 10px">Timeline <span class="muted">(${escapeHtml(events.length)} events, seq order)</span></h2>
    <div class="timeline" id="timeline">
      ${eventRows || '<div class="empty">No timeline.json events in this pack.</div>'}
    </div>
  </section>

  <section class="card">
    <h2>Screenshots <span class="muted">on disk, not base64</span></h2>
    ${shots.length ? `<div class="shots">${shotRows}</div>` : '<div class="empty">No screenshots under shots/.</div>'}
  </section>

  <section class="card">
    <h2>Pack files</h2>
    <ul class="files">${fileRows || '<li class="muted">empty</li>'}</ul>
  </section>
</main>
<footer>
  versebrowser trajectory viewer · read-only local HTML · generated from Evidence Pack · page content is untrusted data
</footer>
<script>
(function () {
  var q = document.getElementById('q');
  var failOnly = document.getElementById('failOnly');
  var kindBoxes = Array.prototype.slice.call(document.querySelectorAll('[data-kind-filter]'));
  var events = Array.prototype.slice.call(document.querySelectorAll('#timeline .event'));

  function apply() {
    var text = (q && q.value || '').toLowerCase().trim();
    var onlyFail = !!(failOnly && failOnly.checked);
    var allowed = {};
    kindBoxes.forEach(function (box) {
      allowed[box.getAttribute('data-kind-filter')] = box.checked;
    });
    events.forEach(function (el) {
      var kind = el.getAttribute('data-kind') || '';
      var isFail = el.getAttribute('data-fail') === '1';
      var hay = el.textContent.toLowerCase();
      var ok = allowed[kind] !== false;
      if (onlyFail && !isFail) ok = false;
      if (text && hay.indexOf(text) === -1) ok = false;
      el.style.display = ok ? '' : 'none';
    });
  }

  if (q) q.addEventListener('input', apply);
  if (failOnly) failOnly.addEventListener('change', apply);
  kindBoxes.forEach(function (box) { box.addEventListener('change', apply); });
})();
</script>
</body>
</html>
`;
}

/**
 * Write `viewer.html` into an Evidence Pack directory (offline, read-only page).
 * Optionally refreshes manifest.json so the viewer is listed in the pack index.
 */
export async function writeTrajectoryViewer(
  packDir: string,
  options: WriteTrajectoryViewerOptions = {},
): Promise<{ outPath: string; html: string }> {
  const pack =
    options.pack ??
    (await (async () => {
      const { readEvidencePack } = await import('./reader.ts');
      try {
        return await readEvidencePack(packDir);
      } catch (error) {
        if (error instanceof EvidencePathError) throw error;
        // Session / diagnose dirs may only have timeline.json — synthesize a minimal pack.
        const timeline = await (async () => {
          const { readTimeline } = await import('./timeline.ts');
          return readTimeline(packDir);
        })();
        return {
          manifest: {
            schemaVersion: EVIDENCE_PACK_SCHEMA_VERSION,
            createdAt: new Date().toISOString(),
            packId: basename(packDir),
            label: basename(packDir),
            ...(timeline?.sessionId ? { sessionId: timeline.sessionId } : {}),
            files: [{ path: PACK_FILES.timeline, kind: 'timeline' as const, mimeType: 'application/json' }],
          },
          screenshots: [],
          ...(timeline ? { timeline } : {}),
        } satisfies EvidencePackContents;
      }
    })());

  const rendered = renderTrajectoryViewer({ pack, packDir });
  const outPath = options.outFile ?? join(packDir, PACK_FILES.viewer);
  if (!options.outFile) assertInsideRoot(packDir, outPath, 'viewer');
  await mkdir(dirname(outPath), { recursive: true });
  // An explicit outFile is a CLI-owned export location; otherwise stay in the pack.
  const html = await writeEvidenceText(options.outFile ? dirname(outPath) : packDir, outPath, rendered);

  // Keep manifest honest only when the viewer lands inside the pack directory.
  const relOut = relative(packDir, outPath).replaceAll('\\', '/');
  const insidePack = relOut && !relOut.startsWith('..') && !relOut.startsWith('/');
  if (insidePack) {
    try {
      const manifestPath = assertInsideRoot(packDir, join(packDir, PACK_FILES.manifest), 'manifest');
      const raw = JSON.parse(await readFile(manifestPath, 'utf8')) as {
        schemaVersion: number;
        files: Array<{ path: string; kind: string; mimeType?: string; size?: number }>;
      };
      if (raw.schemaVersion === EVIDENCE_PACK_SCHEMA_VERSION) {
        const existing = raw.files.find((file) => file.path === relOut);
        const entry = {
          path: relOut,
          kind: 'summary' as const,
          mimeType: 'text/html',
          size: Buffer.byteLength(html, 'utf8'),
        };
        if (existing) {
          Object.assign(existing, entry);
        } else {
          raw.files.push(entry);
        }
        await writeEvidenceJson(packDir, manifestPath, raw);
      }
    } catch (error) {
      if (error instanceof EvidencePathError) throw error;
      // no manifest — still write the viewer; packs without manifests remain readable
    }
  }

  return { outPath, html };
}
