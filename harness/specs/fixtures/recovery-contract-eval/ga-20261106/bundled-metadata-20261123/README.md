# G3 根作用域元数据开发与验收

渠道列表与 ID/别名查找共用原根作用域缓存；登记刷新和 Gateway 退出统一清理相关缓存。配置策略保留原正文并移至既有元数据模块，加载模块924行，低于941行基线。18项回归、完整六项源码门禁、通信检查和源头绑定通过。

源码提交为 `f2cf0be47f63f6f72ec7c43e5109eaff705307ab`，初始缓存提交为 `e2988370e67aaedd16345bc387e9acd9179ed7fe`。WorkBuddy DeepSeek复核无可操作发现；r21原始域外占位条目随原件保留。

同候选故障窗口 30 份、真实模型长会话 50 份。独立legacy复跑待串行窗口；历史15槽投影核对已通过，当前比较状态 PENDING_SERIAL_WINDOW。原比较器SHA256保持71062d7d652a18dcaa3071921b1907554de3499fd37fb8c9cc5e4bf99371b81b，临时hook仅绑定运行路径与候选标签。

| 冻结指标 | 结果 |
|---|---|
| duplicateEffects | 0 |
| lostTasks | 0 |
| terminalCorrectness | 1 |
| unknownClassifiableRate | 0 |
| mustPreserveFidelity | 未测 |
| falseCompletionClaims | 未测 |
| nextActionAccuracy | 未测 |
| recoveryLatencyP50 | 未测 |
| recoveryLatencyP95 | 未测 |

GA为NO_GO，实际未过门禁见report.json.failedGates。完整类型45.578秒，桌面构建69.250秒；原门槛分别45/58秒。打包helper两周期和goal canary十周期通过；新Agent Dev验证产物完整，CI保留三项实测硬耗时失败。

开发执行恢复标准配置，重型步骤串行，临时产物D:。原开发限制与旧候选数据保存为历史；冻结门槛、原始失败和样本均保留。

raw-evidence.json.gz含1365份快照与结算原件和源头字节，每项逐SHA256解压回读，已授权凭据值匹配0。任务图、会话交接与本地历史单独保留。

在该源码候选检出中重算两臂：

```powershell
node scripts/recovery-contract-eval.mjs --bundle <本地原采样bundle> --batch --arm candidate --output D:/tmp/g3-replay/candidate-report.json
node scripts/recovery-contract-eval.mjs --bundle <本地原采样bundle> --batch --arm legacy --output D:/tmp/g3-replay/legacy-report.json
```

完整命令、raw采样bundle、恢复后的原比较器与本批失败在字节归档中；独立legacy复跑和大型任务图导出待串行窗口。全部产物为agent驱动，realHumanEvidence=false。

封存程序的早期日志标注为前缀快照，完整结算回执另保留三份；原归档字节保留于前一证据提交及本地备份。
