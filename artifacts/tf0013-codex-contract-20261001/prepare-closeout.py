"""Audit final disk evidence and prepare TF-0013 closure through the canonical CLI."""
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
def write(name, value):
    (out / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf8', newline='\n')
meta = read('candidate.json')
candidate = Path(meta['candidate'])
report = read('candidate-verification.json')
assert report['commit'] == meta['commit'] and report['tree'] == meta['tree']
assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=candidate, text=True).strip() == meta['commit']
assert not subprocess.check_output(['git', 'status', '--porcelain'], cwd=candidate, text=True).strip()
latest = {row['gate']: row for row in report['runs']}
assert len(latest) == 18
assert all(row['exitCode'] == 0 and not row['dirtyBefore'] and not row['dirtyAfter'] for row in latest.values())
test_counts = {}
for name, row in latest.items():
    log = (out / row['log']).read_text(encoding='utf8')
    counts = re.findall(r'Tests\s+(\d+) passed', log)
    if counts:
        test_counts[name] = sum(map(int, counts))
assert sum(test_counts.values()) == 233, test_counts
assert not read('autoreview.json')['findings']
native = read('candidate-native/native-report.json')
assert native['pass'] and len(native['scenarios']) == 7
assert all(case['pass'] and case['requests'] == 1 and not case['timedOut'] and not case['promptError'] for case in native['scenarios'])
assert native['scenarios'][2]['assemblies'] == 0
requests = read('candidate-native/provider-requests.json')
assert len(requests) == 7
for index in [0, 1, 2]:
    assert 'NEW_' not in json.dumps(requests[index])
assert 'ENGINE_' not in json.dumps(requests[1])
assert 'COMPASS_' not in json.dumps(requests[2])
assert json.dumps(requests[4]).count('NEW_') == 1
assert 'HISTORY_' in json.dumps(requests[6]) and 'NEW_' in json.dumps(requests[6])
first_binding = read('candidate-native/bootstrap-0-binding.json')
second_binding = read('candidate-native/bootstrap-1-binding.json')
assert first_binding['threadId'] == second_binding['threadId']
assert {'thread/resume', 'thread/start'} <= set(native['scenarios'][-1]['rpcMethods'])
deep = json.loads((candidate / 'artifacts/agent-dev-deep-test/report.json').read_text())
assert deep['success'] and deep['decision']['fullGateComplete'] and not deep['decision']['requiredFullGates']
refresh_log = (out / 'agent-dev-refresh.log').read_text(encoding='utf8')
assert re.search(r'Tests\s+87 passed', refresh_log) and re.search(r'4 passed \(', refresh_log)
product_sources = {name: digest for name, digest in meta['sourceHashes'].items() if name.startswith('openclaw_runtime/')}
for name, digest in product_sources.items():
    assert hashlib.sha256((candidate / name).read_bytes()).hexdigest() == digest, name
    assert hashlib.sha256((root / name).read_bytes()).hexdigest() == digest, name
write('source-hashes.json', {'candidateCommit':meta['commit'],'candidateTree':meta['tree'],'productSourceMatchesMainWorkingTree':True,'files':product_sources})
node = json.loads(subprocess.check_output(['py','-3','-X','utf8',str(tf),'show','TF-0013','--json'],cwd=root,encoding='utf8'))
write('node-before-closeout.json', node)
criteria = [
    {'criterion': node['acceptance_criteria'][0], 'verified': True, 'proof': ['entry-scan: 6 passed', 'production entry scan restricts projectContextCandidates to the candidate/orchestrator owner; native SDK calls that existing owner']},
    {'criterion': node['acceptance_criteria'][1], 'verified': True, 'proof': ['budget-combination: 115 passed', 'native-sdk: 10 passed', '7 actual Codex process/provider requests; atomic drop and shared exhaustion independently reread']},
    {'criterion': node['acceptance_criteria'][2], 'verified': True, 'proof': ['embedded: 48 passed', 'budget-combination: knowledge/working_memory/tool_registry/CVK/VToken/memory candidate order, dedup, accounting and lineage']},
    {'criterion': node['acceptance_criteria'][3], 'verified': True, 'proof': ['candidate/source flag and kill matrices', 'native kill: engine assembly count 0 and no injected markers in actual request']},
]
assert len(node['acceptance_criteria']) == 4
write('acceptance.json', {
    'actor':'codex/root','driven_by':'agent','node':'TF-0013','verdict':'pass',
    'candidate':{'commit':meta['commit'],'tree':meta['tree'],'dirty':False,'path':str(candidate)},
    'criteria':criteria,'gatesPassed':18,'testCounts':test_counts,'testsPassed':233,'nativeRequestsPassed':7,
    'agentDevRefresh':{'unitTestsPassed':87,'electronTestsPassed':4,'fullGateComplete':True,'requiredFullGates':[]},
    'review':{'file':'autoreview.json','findings':[]},
    'limits':['Node-level authority/budget acceptance; not a new full RC-09/10 or GA verdict.',
              'Provider output and engine scenarios are explicitly agent-scripted; the Codex binary, plugin loader, SDK, RPC and provider HTTP requests are real.',
              'Some embedded tests report quarantine of the ambient external context-runtime-kit on an invalid resource id; positive CVK admission cases use controlled engines. This does not certify that external plugin.',
              'Initial unsealed gate logs were overwritten by the final run; only final-candidate logs support this acceptance. See historical-artifact-limits.json.',
              'Products remain opt-in; no frozen defaults, product locks, public release or paid model-quality claims are changed.'],
})
evidence = list(node['evidence'])
for name in ['docs/dev/tf0013-authority-closeout-20261001.md', *['artifacts/tf0013-codex-contract-20261001/'+p for p in ['acceptance.json','candidate-verification.json','source-hashes.json','autoreview.json','candidate-native/rpc.jsonl','candidate-native/provider-requests.json','SHA256SUMS']]]:
    if name not in evidence: evidence.append(name)
write('closeout-proposal.json', {
    'proposal_id':'TFP-tf0013-authority-closeout-20261001','session_id':'tf0013-authority-closeout-20261001',
    'rationale':'干净候选完整通过节点四项验收和18个门禁；按仓库所有者的自动收口政策更新TF-0013，不改变任何其他节点或产品锁。',
    'changes':[{'action':'update_node','id':'TF-0013','fields':{
        'status':'done','progress':100,'progress_source':'manual','confidence':0.99,'evidence':evidence,
        'summary':'UAS-02 residual已完成干净候选验收：统一候选仲裁/预算覆盖embedded、COMPASS与原生SDK；跨模块共享owner、bootstrap恢复、诊断契约已修复。18门通过、233测试、7次真实native请求；Agent Dev证据刷新87单测/4 Electron通过。非新的全量RC、发布或GA。',
        'next_action':'本节点已按证据自动收口；继续用户全部剩余节点目标，核对TF-0010/TF-0028与既有RC归档，再推进其余就绪节点。产品默认值、D7范围裁决与发布权限保持独立。',
    }}],
})
print(json.dumps({'candidate':meta['commit'],'criteria':4,'gates':18,'tests':233,'nativeRequests':7,'proposalReady':True}))
