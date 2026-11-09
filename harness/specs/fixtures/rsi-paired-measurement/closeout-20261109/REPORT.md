# RSI v4 配对测量、异常封存与回滚（2026-11-09）

driven_by: agent；actor: codex/rsi-relay。

本轮 198/216 槽已有回执：4 个 oracle 通过、193 个模型失败、1 个预算中断；18 槽未启动。193 个模型失败包含 192 个四次调用上限失败和 1 个最终 oracle 失败。候选判定为 **NO_GO / eliminate**。

| 对照 | 完整 case | pass³ | pass@3 | 配对差值 | 95% 区间 |
| --- | ---: | ---: | ---: | ---: | --- |
| off | 22 | 0 | 0.0455 | — | pass³ Wilson 区间见 JSON |
| confirmed/off | 22 | 0 | 0 | 0 | null：零方差 |
| shadow/off | 21 | 0 | 0.1429 | 0 | null：零方差 |

锚点条件失败，shadow 有 1 个安全任务固定重跑不一致。功效与所需样本量保持 unavailable。已记录的 66 组初始 off/shadow 输入一致，confirmed 均包含冻结候选；完整报告的 wiring=false 来自 6 组初始输入缺测。

全轮账本 791 次请求逐项对齐：789 次任务调用、2 次预检。已知 11,933,697 tokens；首个 401 保留 721 tokens 上限，记账 11,934,418 / 12,000,000。剩余 65,582 tokens，下一槽首请求需 118,410 tokens。既有 Free 额度的新支出上界为 0 CNY；上游积分扣除和发票未提供。授权同时限制 864 次调用和 300 CNY。本轮收尾新增第三方模型调用为 0。

统一采集器现在在导入新回执后遇到异常时重新封存报告，再抛出原错误。回归在复制的旧回执夹具中观察到报告 197 → 198，原 token-budget-exhausted、18 缺测、1 incomplete 和 eliminate 保持；新 provider dispatch 为 0。off/on/off 恢复原 prompt 字节，新 Node 进程从淘汰状态重建相同 off 请求。

冻结模型源码：`fb2d09a3a401deecace0ccdcb6d9fc71da0b9693`。runId：`e8866141-a1f3-43c4-8efa-dfc9822cd24d`。第二代候选版本：`da9adbb1b5faab2778fb048b832ea1254bc77358875e33b8e54f0330663818f9`。模型实际测量发生在上海时间 2026-11-09 02:30–05:48。

合并预览 105/105 定向回归、范围类型、局部 lint、通讯 replay/compare、Harness validate/dry-run 通过。独立复算 426 项清单和 176 份源码绑定一致。完整 Harness CI 的 59 项前置单测与目录检查通过，整体在 Agent Dev 审计退出 1：四份证据过期，vitest-agent-dev/typecheck/contract 三项历史硬限失败。依赖从原 RSI 检出复用。

公开输入、工具协议与 prompt 同时相对旧 v2 批次变化；本轮没有单独执行前两者的协议对照。TF-0857 的第三条验收仍未评估，建议 review_needed/75；TF-0858 的独立复算和回滚已执行，其依赖保持未完成。TF-0851 的有效经验正收益条件未通过。

原始模型响应、工具效果、oracle、首次认证/校准失败、运行前旧报告和修复前验证失败保存在私有归档。恢复路径、哈希及命令见 provenance-and-recovery.v1.json。

复算：

```powershell
node scripts/rsi-paired-measurement-replay.mjs --root <frozen-checkout> --base-dir <campaign> --scratch <receipts> --out <new.json>
node scripts/rsi-budget-stop-regression.mjs --frozen-root <checkout> --campaign <campaign> --scratch-source <receipts> --support-root <dependencies> --out <new.json>
```

下一步：在独立新实验中固定 v2/v3 单次输出与 v4 工具循环的对照条件，量化公开输入和执行协议贡献；新模型调用需另行授权资源上限。已观测最终数据继续用于诊断，候选生成与筛选沿用独立训练/验证输入。
