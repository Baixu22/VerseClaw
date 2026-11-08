# TF-0749 封存收益证据复核（2026-11-08）

driven_by: agent

actor: codex-inline-spill-closeout-01a1b90a

本轮收口判定为 **NO-GO**。第三轮原始 `decision.status=mechanism-only`，B2/B4/B5/B6 失败；B3 的原始 true 来自一个无证据控制任务，18 个证据任务配对没有保留收益。TF-0749 保持 `in_progress/80`。

本轮新增 provider 调用 **0**。第二轮、第三轮的原始运行与评分全部保留；本目录保存 2026-11-08 从磁盘重放得到的结果和源码绑定。

## 判据与证据

| 判据 | 第三轮复算结果 | 对收口的影响 |
|---|---|---|
| B1 机制与自主性 | stable 证据任务自主 recall 发起 18/18，成功回读 18/18 | 通过 |
| B2 任务收益 | stable 0/18，baseline 0/18；差 0 个百分点，McNemar p=1 | 缺少规定的至少 30 个百分点提升 |
| B3 保留收益 | 原 flag=true；唯一正向差异为 `control-absent-2`、repetition=2，证据任务正向/反向差异均 0 | 无证据任务返回 null 的差异不能证明证据回读收益 |
| B4 非劣 | stable 0%，reference-visible 5.5556%；允许差 5 个百分点 | 低于非劣下界 0.5556 个百分点 |
| B5 控制任务 | stable 5/6；剩余 1 次 `schema_invalid` | 缺少完整有效的 null 答案；该失败未被分类为臆造私有值 |
| B6 预算 | stable/off 平均输入字符差 2492.1667 ≤16000；stable 总 token 相对 reference-visible 增长 59.6138% >25% | 字符子项通过，token 子项失败 |
| B7 证据 | 第二轮 47/47、第三轮 37/37 哈希匹配；1605 个归档 checksum/byteLength 通过，凭证扫描 0 命中 | 原始证据完整，数据缺口无法靠补签或改摘要消除 |

`summary.json` 保存两轮的原始判据复算和本轮结论；`replay/` 保存每次命令的输出与回执。B3 的原评分器及原始 flag 未修改，解释依据来自同 fixture/repetition 的原始 `runs.json`。

第二轮复算仍为 B1/B2/B5 通过、B3/B4/B6 失败，token 增长 38.6166%。第二轮 live 有 96 次运行、358 次请求，存在原始工具历史旁路和初始输入身份差异；其观察到的 11/18 正确率不能替代第三轮的投影对照结果。

## 模型表现与成本

第三轮使用 `space-bunny`，端点 origin `http://127.0.0.1:3065`，Responses function calling；4 臂 × 8 任务 × 3 次，共 96 次运行、360 次请求。语料由 6 个带唯一 oracle 的证据任务和 2 个无证据控制任务组成。

| 臂 | 证据成功 | 控制成功 | 总体 Wilson 95% 区间（24 次/臂） | 平均 input/output/total token | 每运行 p50/p95 延迟 ms |
|---|---:|---:|---|---|---|
| baseline-no-reference | 0/18 | 5/6 | 9.24%–40.47% | 3293.083 / 1134.292 / 4427.375 | 17331.325 / 26755.375 |
| reference-visible | 1/18 | 6/6 | 14.91%–49.17% | 12136.667 / 1426.333 / 13563.000 | 22138.403 / 31033.832 |
| recall-stable | 0/18 | 5/6 | 9.24%–40.47% | 19906.042 / 1742.375 / 21648.417 | 24056.561 / 36808.552 |
| retention-off | 0/18 | 4/6 | 6.68%–35.85% | 18316.208 / 1587.917 / 19904.125 | 18658.105 / 32598.019 |

Wilson 区间沿用冻结评分器，计算的是每臂 24 次总体通过率，包含控制任务。六个证据任务的三次重复全过率 `pass^3` 四臂均为 0。延迟为每次运行的 provider 调用延迟之和。

第三轮已知 usage 总计 input **1287648**、output **141382**、total **1429030** token。费用 `not-run`：provider 费率与计费单位没有记录。成本结论采用实际 usage，未换算货币。

## 两个失败环节

1. **回读页被投影再次截断。** 三个有引用臂合计 120 次原始回读结果大于 6000 字符投影预算；stable 原始结果 14 次含 oracle，下一请求中 14 次均已从对应投影消失。模型 62 次省略 `max_chars`，采用生产默认 12000；另有大量请求超过预算。第三轮没有历史旁路、baseline oracle 泄漏或 provider 错误；24 对首轮请求逐字节相同。
2. **输出预算耗尽。** 360 个响应中 307 completed、53 incomplete，全部 incomplete reason 为 `max_output_tokens`；实际请求预算均为 900。失败分类为 `schema_invalid=52`、`recalled_text_evicted=8`、`answer_mismatch=15`。适配器漏读 completed 消息文本的次数为 0。

同一封存 deterministic 自测显式请求 `max_chars=5500`，成功回读的序列化结果为 5847–5868 字符；证据任务分别 0/6、6/6、6/6、2/6。这给出页适配实验的可行起点，模型自主选择与 token 收益仍需新的冻结 live 数据。

## 候选与恢复索引

| 目录 | 当前 HEAD | 当前状态 | 归档未跟踪文件 |
|---|---|---|---:|
| `C:/Users/27933/.codex/worktrees/context-inline-spill/ClawX` | `8ad73dd4b552c2fd2465034eb2b06d51dc7a4388` | `codex/context-inline-spill`，四个未跟踪冻结文件 | 4 |
| `D:/tmp/inline-spill-benefit-r3/candidate` | `491a957ad93e0c9f81d580e693de147d4e2cd49d` | detached，文档修改与第三轮证据未跟踪 | 38 |
| `D:/tmp/inline-spill-benefit-r2/validation-candidate` | `ddd66ced9f3d389bd03a476fcbdccfc2de759f33` | detached，文档修改与第二轮评测材料未跟踪 | 53 |

表中“当前”指本轮归档前的读回。第三轮历史运行候选为 `491a957ad...`、tree `ef66954e73faacc5277186f54f0ea2cc0eee04ef`、dirty=false；第二轮历史候选的 dirty=true 原样保留。

95 个未跟踪文件已复制到 `D:/tmp/inline-spill-closeout-20261108-01a1b90a/source-snapshots/` 下的三个 `untracked.zip`。压缩包回读与来源再次哈希均一致；逐文件摘要、压缩包摘要和 tracked diff 摘要见 `source-snapshot.json`。候选目录及原工作树的四个文件继续保留。

`source-bindings.json` 记录第二轮 6 项、第三轮 7 项评测源码匹配；第三轮 7 项也与原候选 commit 的 Git blob 匹配。四个冻结未跟踪文件及旧清单摘要保持一致。原会话「收口 TF-0749 Inline Spill收益闭环」为 systemError，原收益会话为 notLoaded，本轮没有发现匹配该评测的运行进程。

## 复算入口

以下命令在仓库根目录执行，输出只写入 D:。输出路径使用新的空目录以保留每次回执。

```powershell
$env:TEMP = 'D:\tmp'
$env:TMP = 'D:\tmp'
$out = 'D:/tmp/inline-spill-offline-replay'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$r2 = 'harness/specs/fixtures/context-inline-spill-benefit'
$r3 = 'harness/specs/fixtures/context-inline-spill-benefit-round3'
node "$r2/verify-evidence.mjs" $r2
node "$r3/verify-evidence.mjs" $r3
node "$r2/recompute.mjs" "$r2/deterministic" - "$out/round2-deterministic.json"
node "$r2/recompute.mjs" "$r2/live" "$r2/live/provider-wire.jsonl.gz" "$out/round2-live.json"
node "$r3/verify-run.mjs" "$r3/deterministic" "$out/round3-deterministic.json"
node "$r3/verify-run.mjs" "$r3/live" "$out/round3-live.json"
node "$r3/diagnose-run.mjs" "$r3/live" "$out/round3-diagnostics.json"
```

下一轮最小实验见 [NEXT-EXPERIMENT.md](NEXT-EXPERIMENT.md)。本轮完成原始证据复算和候选归档；相关单测、类型及 Harness 门禁将在本次冻结候选中执行并在交付前写入本报告。
