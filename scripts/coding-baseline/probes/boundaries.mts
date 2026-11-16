import { repoRoot, outRoot, sourceUrl } from '../support.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const out = outRoot;
const area = fs.mkdtempSync(path.join(out, 'boundaries-'));
const workspace = path.join(area, 'workspace');
const outside = path.join(area, 'outside');
for (const dir of [workspace, outside, path.join(area, 'state'), path.join(area, 'home')]) fs.mkdirSync(dir);
process.env.OPENCLAW_HOME = path.join(area, 'home');
process.env.OPENCLAW_STATE_DIR = path.join(area, 'state');
process.env.OPENCLAW_CONFIG_PATH = path.join(area, 'state', 'openclaw.json');
fs.writeFileSync(process.env.OPENCLAW_CONFIG_PATH, '{}');
const rows: Array<Record<string, unknown>> = [];
let stage = 'module loading';
try {
  const { createOpenClawCodingTools } = await import(sourceUrl('openclaw_runtime/src/agents/agent-tools.ts'));
  const { createTrustedProvenance, createExternalProvenance } = await import(sourceUrl('shared/security/content-provenance.ts'));
  const { journalDirFor } = await import(sourceUrl('openclaw_runtime/src/agents/tools/write-journal-core.ts'));
  const trusted = createTrustedProvenance({ sourceKind: 'user-direct', sourceId: 'audit:fixture', receivedAt: new Date().toISOString() });
  const external = createExternalProvenance({ sourceKind: 'web', sourceId: 'audit:fixture', receivedAt: new Date().toISOString() });
  const getTools = (sessionId: string, provenance: unknown) => {
    const all = createOpenClawCodingTools({ cwd: workspace, workspaceDir: workspace, sessionId, contentProvenance: provenance,
      config: { tools: { fs: { workspaceOnly: true } }, runtime: { coding: { autoVerify: { enabled: false } } } },
      toolConstructionPlan: { includeBaseCodingTools: true, includeShellTools: false, includeChannelTools: false, includeOpenClawTools: false, includePluginTools: false } });
    return (name: string) => { const t = all.find(t => t.name === name); if (!t) throw new Error('missing tool: '+name); return t; };
  };
  const marker = 'generated-outer-fixture-only';
  const target = path.join(outside, 'marker.txt');
  fs.writeFileSync(target, marker);
  for (const [label, provenance] of [['trusted', trusted], ['external', external]] as const) {
    stage = 'snapshot side effects: ' + label;
    const sid = 'snapshot-' + label;
    const tool = getTools(sid, provenance);
    let directReadDenied = false;
    try { await tool('read').execute('try-outside-read', { path: target }); } catch { directReadDenied = true; }
    let refused: string | null = null;
    try { await tool('write').execute('rejected-call', { path: target, content: 'attempt' }); } catch (err) { refused = String(err); }
    const dir = journalDirFor(workspace, sid);
    const snapshots = fs.existsSync(dir) ? fs.readdirSync(dir).filter(s => s.endsWith('.pre')) : [];
    let copied = false, readableByReadTool = false;
    for (const snap of snapshots) {
      const p = path.join(dir, snap);
      if (fs.readFileSync(p, 'utf8') === marker) copied = true;
      try { readableByReadTool ||= JSON.stringify((await tool('read').execute('read-snapshot', { path: p })).content).includes(marker); } catch { /* report actual observable state */ }
    }
    rows.push({ id: 'denied-write-journal-' + label, expected: 'denied; no copied data', actual: { directReadDenied, refused, outsideUnchanged: fs.readFileSync(target,'utf8') === marker, snapshots, copied, readableByReadTool }, reproduced: copied && readableByReadTool && !!refused });
  }
  stage = 'restricted undo across directory junction';
  const tool = getTools('undo-alias', trusted);
  const localSub = path.join(workspace, 'sub');
  fs.mkdirSync(localSub);
  fs.writeFileSync(path.join(localSub, 'marker.txt'), 'before-local-edit');
  await tool('write').execute('local-write', { path: 'sub/marker.txt', content: 'local-edit' });
  const detached = path.join(workspace, 'sub-original');
  if (path.dirname(detached) !== workspace || path.dirname(localSub) !== workspace) throw new Error('fixture boundary');
  fs.renameSync(localSub, detached);
  fs.symlinkSync(outside, localSub, 'junction');
  const undo = await tool('undo_write').execute('restricted-undo', { steps: 1 });
  const afterUndo = fs.readFileSync(target, 'utf8');
  rows.push({ id: 'undo-via-junction-workspaceOnly', expected: 'reject; outside marker unchanged', actual: { outsideContents: afterUndo, undo: undo.details }, reproduced: afterUndo === 'before-local-edit' });
} catch (err) { rows.push({ id: 'probe-error', stage, error: String(err) }); }
const report = { driven_by: 'agent', actor: 'codex-coding-audit', realHumanEvidence: false, candidate: execFileSync('git',['rev-parse','HEAD'],{ cwd:repoRoot, encoding:'utf8' }).trim(), area, rows };
fs.writeFileSync(path.join(out,'boundary-results.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
process.exitCode = rows.some(r => 'error' in r) ? 2 : 0;
