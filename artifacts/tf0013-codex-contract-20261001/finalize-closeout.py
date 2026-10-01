import hashlib
import json
from pathlib import Path
import shutil
import subprocess

root=Path(__file__).resolve().parents[2]
out=Path(__file__).resolve().parent
tf=Path.home()/'.codex/skills/task-forest/scripts/task_forest.py'
meta=json.loads((out/'candidate.json').read_text())
node=json.loads(subprocess.check_output(['py','-3','-X','utf8',str(tf),'show','TF-0013','--json'],cwd=root,encoding='utf8'))
assert node['status']=='done' and node['progress']==100
(out/'node-after-closeout.json').write_text(json.dumps(node,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
proposal=root/'.agent-workbench/task-forest/proposals/TFP-tf0013-authority-closeout-20261001.json'
assert json.loads(proposal.read_text())['applied_at']
(out/'task-forest-verification.json').write_text(json.dumps({'actor':'codex/root','driven_by':'agent','proposal':'TFP-tf0013-authority-closeout-20261001','applied':True,'nodeStatus':'done','progress':100,'validateExitCode':0,'exportExitCode':0,'recordedFrom':'CLI apply session 84417 and validate/export session 30568; applied proposal and node reread from disk'},indent=2)+'\n',newline='\n')
heading='# 2026-10-01：TF-0013 完成干净候选验收并自动收口'
handoff=root/'docs/dev/handoffs/LATEST.md'
current=handoff.read_text(encoding='utf8')
if not current.startswith(heading):
    text=f'''{heading}

- TF-0013 已 done/100：候选 `{meta['commit']}`，18门 exit 0、233项测试、7次真实native请求通过，逐门源码dirty=false。另有真实Agent Dev刷新87单测/4 Electron通过。未执行新全量RC或改产品锁。
- Codex package 8条错误清零；工具诊断host requestId/trace跨start/terminal稳定，native/side-question/隔离拒绝路径有回归，已有统计契约补齐。结构化autoreview无actionable findings。
- 收口证据 `artifacts/tf0013-codex-contract-20261001/acceptance.json`、`candidate-verification.json`、`SHA256SUMS`；说明 `docs/dev/tf0013-authority-closeout-20261001.md`。initial未封存日志被最终轮复用覆盖的局限已记录，只以最终候选日志作验收。
- 提案 `TFP-tf0013-authority-closeout-20261001` 已应用，validate/export通过；使用agent驱动输入与本地scripted provider，不能声称真人或付费模型质量。
- 总目标仍为“完成全部剩余节点，避免阻塞”。下一步核读TF-0010/TF-0028与现有RC最终归档，处理旧状态和未完成条件；其余按依赖推进。TF-0244仍由并发任务处理，不能覆盖其工作。D7产品范围、冻结默认值和发布权限仍需对应明确裁决。

---

'''
    handoff.write_text(text+current,encoding='utf8',newline='\n')
for name,title in [('docs/dev/first-product-controlled-preview/STATUS.md','# First Product · Controlled Preview — STATUS（仅元数据 + 开发日志）'),('docs/dev/unified-agent-system/DEVELOPMENT-LOG.zh-CN.md','# 统一 Agent 系统开发日志')]:
    path=root/name
    current=path.read_text(encoding='utf8')
    note='> 2026-10-01 TF-0013 已完成节点级干净候选验收并自动收口（done/100）：18门、233测试、7次native请求通过，Codex package类型错误清零。见 `docs/dev/tf0013-authority-closeout-20261001.md`。不是新的全量RC、发布或GA，产品锁和默认值不变。'
    if note not in current:
        path.write_text(current.replace(title,title+'\n\n'+note,1),encoding='utf8',newline='\n')
for name in meta['evidenceRefreshPaths']:
    subprocess.run(['git','diff','--exit-code','--',name],cwd=root,check=True,stdout=subprocess.DEVNULL)
    shutil.copyfile(Path(meta['candidate'])/name,root/name)
print('TF-0013 done/100 reread; handoff and refreshed evidence synchronized.')
