"""Verify disk artifacts and prepare the one-node development proposal."""
import hashlib
import json
from pathlib import Path
import re
import subprocess

root = Path(__file__).resolve().parents[2]
out = Path(__file__).resolve().parent
tf = Path.home() / '.codex/skills/task-forest/scripts/task_forest.py'
def read(name):
    return json.loads((out / name).read_text(encoding='utf8'))
def write(name, data):
    (out / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
def command(args):
    return subprocess.check_output(args, cwd=root, encoding='utf8').strip()

report = read('verification.json')
rows = {g['gate']: g for g in read('scope-gates.json')['gates']}
rows.update({g['gate']: g for g in report['gates']})
build_log = (out / 'runtime-build.log').read_text(encoding='utf8')
build_seconds = float(re.findall(r'phase timings: total ([0-9.]+)s', build_log)[-1])
rows['build'] = {'gate': 'build', 'command': ['node', 'scripts/build-all.mjs', 'gatewayWatch'], 'cwd': str(root / 'openclaw_runtime'), 'exitCode': 0, 'seconds': build_seconds, 'log': 'runtime-build.log', 'recordedFrom': 'completed exec session 7552, exit 0; build phase summary read from disk'}
assert len(rows) == 12 and all(g['exitCode'] == 0 for g in rows.values())
report['gates'] = list(rows.values())
write('verification.json', report)
native = read('native-report.json')
assert native['pass'] and len(native['scenarios']) == 7
assert all(s['pass'] and s['requests'] == 1 for s in native['scenarios'])
assert len(read('provider-requests.json')) == 7
unit_count = int(re.findall(r'Tests\s+(\d+) passed', (out / 'native-sdk.log').read_text(encoding='utf8'))[-1])
assert unit_count == 10
for name in ['autoreview.json', 'autoreview-plugin.json']:
    assert not read(name)['findings']
baseline = read('plugin-types-baseline.json')
assert baseline['sameDiagnostics'] and len(baseline['currentErrors']) == 8
sources = [
    'openclaw_runtime/src/agents/harness/context-engine-lifecycle.ts',
    'openclaw_runtime/src/agents/harness/selection.ts',
    'openclaw_runtime/src/agents/harness/selection.compass.test.ts',
    'openclaw_runtime/src/context-engine/context-candidate.ts',
    'openclaw_runtime/src/context-engine/context-orchestrator.ts',
    'openclaw_runtime/src/context-engine/turn-injection-budget.ts',
    'openclaw_runtime/src/plugin-sdk/agent-harness-runtime.ts',
    'openclaw_runtime/extensions/codex/src/app-server/run-attempt.ts',
    'openclaw_runtime/extensions/codex/src/app-server/context-engine-projection.ts',
    'openclaw_runtime/extensions/codex/src/app-server/thread-lifecycle.ts',
    'harness/specs/tasks/uas-02-context-orchestrator-authority-closure.md',
]
dist = root / 'openclaw_runtime/dist'
built = [dist / 'extensions/codex/index.js', dist / 'plugin-sdk/agent-harness-runtime.js', *dist.glob('context-engine-lifecycle-*.js'), *dist.glob('run-attempt-*.js')]
write('source-hashes.json', {'recording': 'post-run working source and consumed build identity, not a clean candidate assertion', 'files': {str(p.relative_to(root)).replace('\\', '/'): hashlib.sha256(p.read_bytes()).hexdigest() for p in [*[root / s for s in sources], *built]}})
write('evidence.json', {
    'actor': 'codex/root', 'driven_by': 'agent', 'scope': 'development-only',
    'head': command(['git', 'rev-parse', 'HEAD']), 'dirty': True,
    'nativeSdkTestsPassed': unit_count, 'nativeProviderRequestsPassed': 7,
    'developmentGatesPassed': 12, 'packageTypecheck': baseline,
    'codexDependency': {'version': '0.137.0', 'sourceCommit': 'f221438b691b8f749d98f22077c93ebe01923fbe'},
    'limitations': ['Not clean candidate acceptance, Electron, full package installation, paid model quality or full RC.', 'Eight unchanged package type diagnostics reproduced with HEAD plugin/current SDK.', 'Context-overflow-specific retry not driven.', 'Source and built modules have separate private getters: owner cleanup is proved by SDK regression, not the wire driver.', 'Existing dirty work and concurrent VerseConf planning preserved; no branch commit or push.'],
})
node = json.loads(command(['py', '-3', '-X', 'utf8', str(tf), 'show', 'TF-0013', '--json']))
write('node-before.json', node)
evidence = list(node['evidence'])
for p in ['docs/dev/tf0013-native-wire-20261001.md', *['artifacts/tf0013-native-wire-20260930/' + n for n in ['evidence.json', 'verification.json', 'native-report.json', 'rpc.jsonl', 'source-hashes.json', 'autoreview.json', 'autoreview-plugin.json', 'plugin-types-baseline.json']]]:
    if p not in evidence:
        evidence.append(p)
hints = list(node['execution_hints'])
hints.append('2026-10-01 已完成真实 Codex app-server、本地 scripted provider 的预算和 bootstrap/stale resume 验证；actor=codex/root、driven_by=agent。历史 fixture 局限由本增量补充，不代表付费模型质量、全新安装包或 RC 验收。')
write('proposal-input.json', {
    'proposal_id': 'TFP-tf0013-native-wire-development-20261001',
    'session_id': 'tf0013-native-wire-20261001',
    'rationale': '接力完成真实加载/原生请求与 stale thread 恢复开发增量，保留8条插件类型基线和干净候选四项验收边界；不改其他节点、状态进度或产品锁。',
    'changes': [{'action': 'update_node', 'id': 'TF-0013', 'fields': {
        'evidence': evidence, 'execution_hints': hints,
        'summary': '共享预算跨 source/built SDK 模块实例已修复；真实 Codex 0.137.0 与 agent 本地 provider 完成7次请求，覆盖超额、耗尽、kill、bootstrap复用及stale resume恢复；10项SDK回归和两轮autoreview通过。当前干净候选四项验收尚未完成；插件8条类型诊断有HEAD同依赖对照。',
        'next_action': '在 TF-0013 内固定当前源码候选，处理或明确同依赖HEAD亦存在的8条Codex插件类型基线；在干净候选完整核验四项acceptance和证据链后自动收口。原生请求/加载/过期线程恢复已有本轮真实进程证据，不重复用fixture替代；沿用UAS-02，不解除D7、产品锁或发布边界。',
    }}],
})
print(json.dumps({'gatesPassed': len(rows), 'sdkTests': unit_count, 'nativeRequests': 7, 'pluginTypeBaselineErrors': 8}))
