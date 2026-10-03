"""Seal this completed development slice without claiming full node closure."""
import hashlib
import json
from pathlib import Path
import re

root = Path(__file__).resolve().parents[2]
out = Path(__file__).resolve().parent
def read(path):
    return json.loads(path.read_text(encoding='utf8'))
node = read(out / 'node-after.json')
proposal = read(root / '.agent-workbench/task-forest/proposals/TFP-tf0013-native-wire-development-20261001.json')
landing = read(out / 'landing.json')
assert proposal.get('applied_at') and node['status'] == 'in_progress'
assert 'stale resume' in node['next_action'] or '过期线程' in node['next_action']
checks = {'actor': 'codex/root', 'driven_by': 'agent', 'proposalApplied': True,
          'validateExitCode': 0, 'exportExitCode': 0, 'checkLandingExitCode': 1,
          'landingProblemCount': landing['problem_count'],
          'nodeStatus': node['status'], 'nodeProgress': node['progress'],
          'recordedFrom': 'exec sessions 99494, 92277 and 28582 completed; applied proposal and node reread from disk'}
(out / 'task-forest-verification.json').write_text(json.dumps(checks, indent=2) + '\n')
handoff = root / 'docs/dev/handoffs/LATEST.md'
heading = '# 2026-10-01：TF-0013 原生请求与恢复开发增量完成；总目标扩展为全部剩余节点'
if not handoff.read_text(encoding='utf8').startswith(heading):
    addition = f'''{heading}

- 修复源码宿主/构建 SDK 跨模块预算作用域丢失，以及 stale resume 后新线程遗漏已准入 bootstrap。真实 Codex 0.137.0 + agent 本地 scripted Responses provider，5 场景/7 次请求通过；10 项 SDK 回归、12 个开发门禁通过；两轮 autoreview 均无 actionable findings。
- 证据：`artifacts/tf0013-native-wire-20260930/`；说明：`docs/dev/tf0013-native-wire-20261001.md`。保留 fresh-build 预算泄漏与 stale resume 丢历史的修复前反例、RPC、实际最终请求、事件、binding、类型对照和复审。不是 Electron、付费模型质量、全新安装包或完整 RC 验收。
- 插件 package 类型检查 exit 2，共 8 条既有诊断；HEAD 插件配相同 SDK 也同样 8 条。接下来处理此工程缺口并形成干净 TF-0013 候选，完整核验四项 acceptance，再按证据自动收口。当前 in_progress/{node['progress']:g}%，不等待真人；没有声称节点 done。
- 提案 `TFP-tf0013-native-wire-development-20261001` 已应用，validate/export exit 0；刷新 origin 后 check-landing {landing['problem_count']} 项 / exit 1，保留仓库历史整合问题。原有与并发 VerseConf 改动全部保留；未创建分支提交、未推送。
- 用户已把长期目标扩展为“完成剩余的所有节点，避免阻塞”。当前目标 active；继续按依赖串行推进，不把本开发增量视为总体完成。TF-0244 正有另一任务推进，避免写入其文件；D7 冻结、产品默认值与发布决定依然按明确授权边界处理，不因 all-nodes 口号篡改证据或默认值。

---

'''
    handoff.write_text(addition + handoff.read_text(encoding='utf8'), encoding='utf8')
patterns = [rb'(?<![A-Za-z0-9_-])sk-(?:or-v1-)?[A-Za-z0-9_-]{24,}', rb'gh[pousr]_[A-Za-z0-9]{30,}', rb'AKIA[0-9A-Z]{16}']
# Normalize text line endings before sealing, without changing JSON payload
# escapes or observed values. This repository treats CRLF as diff whitespace.
for path in [handoff, *[p for p in out.iterdir() if p.is_file()]]:
    content = path.read_bytes()
    content = content.replace(b'\r\n', b'\n')
    if path.suffix == '.log' and content:
        content = content.rstrip(b'\n') + b'\n'
    path.write_bytes(content)
files = [p for p in out.iterdir() if p.is_file() and p.name not in ('SHA256SUMS', 'credential-scan.json')]
hits = sum(len(re.findall(pattern, p.read_bytes())) for p in files for pattern in patterns)
assert hits == 0
(out / 'credential-scan.json').write_text(json.dumps({'actor':'codex/root','driven_by':'agent','credentialScanHits':hits,'filesScanned':len(files),'method':'API key, GitHub token and AWS key id patterns; not an exhaustive secret detector','fixtureCredential':'Only the explicit non-secret agent-fixture-not-a-credential is used by the driver.'}, indent=2) + '\n')
scan = out / 'credential-scan.json'
scan.write_bytes(scan.read_bytes().replace(b'\r\n', b'\n'))
files = sorted(p for p in out.iterdir() if p.is_file() and p.name != 'SHA256SUMS')
(out / 'SHA256SUMS').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest() + '  ' + p.name + '\n' for p in files), newline='\n')
for line in (out / 'SHA256SUMS').read_text().splitlines():
    digest, name = line.split('  ', 1)
    assert hashlib.sha256((out / name).read_bytes()).hexdigest() == digest
print(json.dumps({'sealedFiles':len(files),'credentialScanHits':hits,'node':node['status'],'landingProblems':landing['problem_count']}))
