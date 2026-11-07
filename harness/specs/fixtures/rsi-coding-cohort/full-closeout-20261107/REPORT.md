# RSI 冻结 216 槽调度与独立回放记录

2026-11-07 · driven_by: agent · actor: codex/rsi-final-independent-verifier · TF-0809

**216 个计划槽位均已记录一次调度尝试，最终判定为 NO_GO / eliminate。** 独立回放得到 17 次 oracle 通过、128 次模型失败、71 次 incomplete；完整配对只有 11 个，低于预登记的 20 个门槛，推断效应与 95% 区间均为空。

| 记录项 | 实际结果 |
|---|---:|
| 计划 / 已记录 / 未调度槽位 | 216 / 216 / 0 |
| 已捕获 provider 终态响应 | 148 |
| oracle 通过 | 17 |
| oracle 模型失败 / JSON 格式失败 / 输出上限失败 | 113 / 8 / 7 |
| provider 终态或用量未知 / oracle 基础设施失败 | 68 / 3 |
| 已知响应 tokens | 1,624,210 |
| 总用量 / 实际费用 | unknown / unknown |
| 已知用量加未知请求上界预留 | 3,439,083 tokens |
| 冻结全轮上限 | 12,000,000 tokens |
| 隐藏 provider 重试 | 0 |

预留值用于继续执行前的预算检查。末段 61 次尝试连续记录网络错误，保留在 provider/infrastructure 分类中。它们没有被计为模型失败，也没有补写终态或用量。完整性检查仍退出 1，原始错误为 `incomplete-slots: 71 !== 0`。

冻结 runId 为 `2bb4141c-a536-443a-8b89-0fbfd0082edf`；评估器 commit 为 `97747a8c833486b4d5c6014df5e7d25d71f8ceb2`，tree 为 `d350a68f5e0e4ac4dd10aec5b9364a27ba1b83f6`。协议为 RsiCodingCollector/v2：24 任务、三臂、k=3、low reasoning、16000 输出 tokens、240 秒请求超时、300 秒单条 oracle 超时、每槽一次 provider 尝试。5pp 改善门槛、95% 配对区间、10% 成本上限和安全锚点保持原值。

V8 准入的 24 个任务及 96 个文件已校验；markdown-it 使用精确 14.2.0。S03/L01/L03 明确采用实现重建起点，原任务身份、历史 reference 与 oracle 字节保留。独立 SEKB 候选来自两项 agent 编写、本地 Node 执行的训练练习，采集期间没有更新。

恢复过程保留两次事件：第 135 槽使用已保存的真实 provider 响应，在新工作区执行两条原 oracle 后写入回执；第 138 槽导入此前已保存的完整回执。两次恢复均产生 0 次 provider 重调度。第 135 槽的 wall-clock 包含中断与恢复时间。

独立回放逐项比对 216 个槽位的原始响应、最终 oracle 结果、终态 ID、已知用量、未知用量预留和安全锚点；462 个测量文件哈希全部一致。原始调度、响应、oracle 日志与恢复控制另存私有归档，1,431 个文件恢复校验一致，凭据模式命中 0。归档位置、SHA256 与重建方法见 `raw-archive.v3.json`。此前中断的 v2 原始批次见 `previous-v2-archive.json`；原 v1 的 15 回执、1 incomplete 和 201 缺失槽位在冻结 feca048d7 上回放一致，60 个文件哈希匹配。

验证记录包含 18 文件 / 199 项 RSI 测试、完整 node/web/test 类型检查，以及导航修复后的 4/4 Electron Agent Dev 质量测试。Electron fixture 现在等非空白启动页面完成 load 后才交给场景导航；原 `DOMContentLoaded` 与启动 `loadFile` 的竞态曾触发 `ERR_ABORTED` 和原生错误对话框，失败 trace 已保留。

整仓 Agent Dev 性能门仍有实测超限。首次 fresh-build 诊断的 typecheck 为 154206ms、Agent Dev unit 为 167195ms、contract 为 4033ms；对应限额为 45000ms、21000ms、3000ms。构建与 Electron 阶段的耗时也保留在诊断报告中。相关报告与退出状态见 `verification/`，性能限额没有调整。

从主仓读取保留测量时，使用其冻结评估器检出。以下命令只回放数据：

```powershell
git worktree add --detach D:/tmp/rsi-frozen-readback-20261107 97747a8c833486b4d5c6014df5e7d25d71f8ceb2
node scripts/rsi-coding-independent-replay.mjs --root D:/tmp/rsi-frozen-readback-20261107 --run-dir harness/specs/fixtures/rsi-benefit-eval/coding-complete-20261106-v2/measurement --out D:/tmp/rsi-readback-new.json
```

预期回放核对文件与逐槽结果后保留 incomplete 完整性门的退出 1。新的输出路径必须尚不存在。旧批次按原冻结版本解释；本次证据没有 RSI 收益或晋级结论。
