# Inline/Spill 第四轮页预算适配与收益结果

driven_by: agent

actor: codex-inline-spill-benefit-r4-relay

第四轮 96 次实测、367 次 Responses 调用已完成，结果为 **NO-GO / no-benefit**。B1–B6 全部未通过；B7 由全包 SHA256、凭证扫描与原始记录复算验证。评测执行节点 TF-0859 的工作已完成，TF-0749 保持 in_progress/80，收益缺口见下表。

## 实现与冻结

评测工具要求每次显式传入整数 `max_chars=1..5500`，入口在访问归档前拒绝缺失或超界参数并返回 `invalid_arguments`；说明包含翻页和结束条件。生产 recall 默认值为 12000。源码候选 `8fa33a84ef8c9eeac3086d168264e77d4560e21d`，tree `541a95b34245cf442a4b9ebdd7ea8320b35e63aa`，实测候选 dirty=false。

`freeze.json` 在实测前固定了源码、语料、oracle、四臂、顺序、三次重复、压力与预算摘要。夹具、四臂定义、生产投影、输入装配正文、评分和 B1–B7 阈值与第三轮匹配。provider 为 `http://127.0.0.1:3065/v1/responses`，请求及全部 367 次返回 model 均为 `space-bunny`；temperature=0、max_output_tokens=900、maxTurns=8、最多 768 次请求。

每臂六个证据任务和两个无证据控制，各重复三次，共 24 次。重复数沿用第三轮以维持对照口径。下列区间是每臂全部 24 次的 Wilson 95% 区间；证据任务数为六，功效状态为 insufficient-evidence，证据任务 pass^3 均为 0。

## 实测结果

| 臂 | 证据正确 | 控制有效 null | 合计正确 | Wilson 95% | 平均 total tokens | 运行延迟 p95 |
|---|---:|---:|---:|---|---:|---:|
| `baseline-no-reference` | 0/18 | 6/6 | 6/24 | [0.1200, 0.4490] | 5040.12 | 24.285 s |
| `reference-visible` | 1/18 | 5/6 | 6/24 | [0.1200, 0.4490] | 14628.75 | 28.813 s |
| `recall-stable` | 0/18 | 3/6 | 3/24 | [0.0434, 0.3100] | 22171.08 | 23.987 s |
| `retention-off` | 0/18 | 5/6 | 5/24 | [0.0924, 0.4047] | 21396.29 | 30.980 s |

| 门 | 实际结果 | 判定 |
|---|---|---|
| B1 机制与自主性 | stable 自主 recall 17/18，recall_ok 17/18=94.44%，要求 recall_ok≥95% | fail |
| B2 任务收益 | stable 与 baseline 证据均 0/18；原配对 McNemar p=0.25 | fail |
| B3 保留收益 | 证据配对正向 0、反向 0；控制配对正向 1、反向 3 | fail |
| B4 非劣 | stable 0/18，reference-visible 1/18；差值 −5.56pp，超过 5pp 容限 | fail |
| B5 无证据控制 | stable 3/6 输出有效 null，其余 3 次无有效最终 JSON | fail |
| B6 预算 | 主上下文差值 −430.46 字符，total tokens 相对 reference-visible 增长 51.56%，上限 25% | fail |
| B7 证据 | 全包文件摘要、归档校验、凭证扫描、逐调用输入/输出与统计复算 | 由 `verify-evidence.mjs` 与 `live-verify.json` 回执核对 |

全部用量为 input=1,370,634、output=147,036、total=1,517,670 tokens；367 次调用墙钟合计 1,618.392 s。费用状态为 not-run，端点未提供费率或计费单位。逐臂 p50/p95/总计见 `summary.json`。

## 页适配解决了什么

32 次 deterministic 自测中，baseline 证据 0/6、reference-visible 与 stable 各 6/6、retention-off 2/6；控制全部通过。最大序列化页 5868 字符。

实测 272 次模型 recall 中，264 次页参数有效，8 次缺参数均收到 `invalid_arguments`。最大序列化结果 5944 字符，超过 6000 的调用为 0；四臂工具定义相同。stable 原始回读命中 oracle 1 次，下一请求丢失 0 次；retention-off 命中 1 次并在下一请求丢失。该机制差异尚未转化为有效正确答案。

56 次响应因 `max_output_tokens` 处于 incomplete；其余 311 次为 completed，provider 失败为 0。模型返回的最终内容与评分器原口径保持一致。24 对 stable/off 首轮完整请求相同，baseline oracle 泄漏和原始历史旁路均为 0。

## 执行与验证记录

首次 96 次请求全部 HTTP 401，原因是将本地数据库保存的加密 key 封装误作 bearer；模型用量未产生，记为 authentication-failed，原始 `no-benefit` 诊断保持原样，未计入上述模型实测。随后在进程内解密既有启用 key，空输入预检返回 400 invalid_request_error，通过了认证。`freeze-auth-amendment.json` 在重跑前记录认证修复和不变的实验条件；重跑完整 96 次，无追加样本或挑选结果。

50 项定向单测、node/web/tests 三套无缓存类型、契约、定向 Harness validate/run --dry-run、源码保留检查通过。三套类型按项目串行执行，GOMAXPROCS=2、GOMEMLIMIT=2GiB；原并行检查因 Go runtime 内存分配失败终止，原日志压缩保留。既有依赖与 661 份核对过源码的包构建文件复用；pnpm 报 patchedDependencies 与安装状态不同。

完整 Harness CI 在 59 项前置测试通过后因四份 Agent Dev 历史证据超过 24 小时窗口退出 1，后续 repo:evidence:check 与 repo:test-coverage:check 未执行。首次测试夹具失败及修正后的通过记录均保留。原工作树的最终 Harness 校验因四份历史未跟踪冻结文件被算入 diff 而退出 1；这四份文件保持原样，本轮候选的定向 Harness 已通过，最终提交将从仅含已跟踪文件的独立检出复核。

旧机制、第二轮、第三轮及封存复核包的 105+47+37+102=291 项摘要全部匹配，四份历史未跟踪文件保持原字节。`preservation-after.json` 记录来源与核对结果。Task Forest 当前图及末帧读回见 `validation/task-forest-before.json`；节点更新后的读回作为最终收尾记录追加。

本轮执行路径为评测循环驱动 Responses，再执行模型请求的生产 recall 和投影；产品收益状态由上述 B 门判定，发布和默认开关仍取原值。

## 复算

在本目录执行（无需 provider 凭据）：

```powershell
node verify-evidence.mjs .
node verify-run.mjs deterministic D:/tmp/inline-spill-r4-deterministic-verify.json
node verify-run.mjs live D:/tmp/inline-spill-r4-live-verify.json
node diagnose-run.mjs live D:/tmp/inline-spill-r4-live-diagnostics.json
```

`runs.json` 包含每次请求、原始响应、用量、工具参数、原始结果与生产投影。`archives.jsonl.gz` 保存归档原字节和逐文件 SHA256，验证器同时校验 handle checksum 与 byteLength。

下一项设计依据是 stable 0/18、56 次输出预算耗尽，以及页尺寸已落在 6000 以内。后续评测应先单独冻结输出预算/模型完成行为的适配方案，再运行新的完整对照；保留本轮记录和阈值作为比较基准。
