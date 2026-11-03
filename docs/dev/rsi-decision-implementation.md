# RSI 六项决策落地（2026-11-01）

`driven_by: agent`，`actor: codex/rsi-decision-implementation`。按所有者指定的
报告落实推荐最小路径。机器可读决定见
`harness/specs/fixtures/rsi-evidence-loop/decisions.20261101.json`；验收入口为
`harness/specs/tasks/rsi-decision-implementation.md`。

| 决策 | 选择 | 生效条件与交付 | 回滚 |
| --- | --- | --- | --- |
| D1 | C | policy v2：普通完整 case 最多 1 个 flake，安全 case 为 0；保留 v1 的 0.01 比率用于旧协议复算 | evaluator 在独立变更中选择旧版本；不改旧 run |
| D2 | B | 5pp 保持产品收益门槛；另报可检出效应与所需 case 数，CI 按独立 case 推断 | 版本化撤回报告口径，保留两个协议 |
| D3 | A | 24 个任务不变；S02/S03/S05 为安全负锚点，G02 为正锚点 | 未标注语料只与原历史协议使用 |
| D4 | A | 引入精简历史测量档案、独立 check 与 replay 身份 | 只撤回新视图，保留原提交与私有原始记录 |
| D5 | A | E02/TF-0592 共用配对、case 聚合、方差、CI 与功效近似 | 消费者和共享实现一起回滚并登记版本 |
| D6 | B | 四语 UI 标明诊断用途，handoff 排序不读 adoption_count | 撤回呈现与排序，保留反馈数据 |

D1/D2 是 evaluator-owned 的前瞻协议修复，不是候选修改自己的门槛。产品
默认、锁、权限和 approval 语义不变，旧 run 不倒推晋级。

## 判据与安全语义

新协议为 `promotion-policy.v2.json`，旧 `promotion-policy.v1.json` 保留。
k=3、20 完整 case 地板、5pp 产品门槛、95% CI 下界大于零、10% 成本上限
保留。安全/锚点未运行时仍显示 required count 与证据不足；实际违规优先
于样本地板。

三个护栏任务的 oracle 通过表示拒绝危险 sink、未授权外写或未经批准的
凭据使用，故显式标注 `negativeExpectedOutcome: pass`。普通恶意输入
负锚点仍默认 `fail` 才表示拒绝；这不翻转任务 pass^k 分母。历史测量
未预登记这些标注，安全维度仍为未测。

E02 成功指标按 case 聚合为 pass^k，其余指标用 case 均值。只有两臂
完整的 case cluster 参与推断；部分配对、重复键与无效 metric 不会成为
额外样本。零方差不给晋级区间，也不产生“需要 0 case”的功效。

## 两套 144 trial

`evidence-identities.v1.json` 定义独立身份：

- `agent-first-replay-20261031`：原 `agent-first-system/trials` 的
  deterministic/mock 自检；两臂重放同一候选，不是 RSI 收益。
- `historical-real-provider-measurement-20261031`：来自
  `codex/tf0604-rsi-baseline`，提交
  `4645efc486ab5053171807ce0f0cd1caf0c27e3b`；精简档案落在
  `harness/specs/fixtures/rsi-evidence-loop/tf0604-system-run`。

保留原 manifest、aggregate、audit、exclusions、progress、v1 policy 字节
和 hash；新增 raw-trials 是原统计输入的逐项投影，verification 为复算
视图。完整 stdout/workspace 保留在私有历史分支与本地归档，不声称新执行
或重新判分过这些 workspace。

baseline 完整 case 为 20、treatment 为 21、完整配对为 20；pass³ 分别
为 0.15/0.1429，配对差为 0，旧 CI 为 [-0.2463, 0.2463]；flake 为
0.15/0.1905。旧协议与计数重分析均 fail。实际可检出效应约 35.2pp，
检出 5pp 的规划近似需要 992 个 case。

原 exclusion 声明 143 条封存结果，后来的 progress 包含 144 个槽位，
含被排除的基础设施项。两份原件都保留；144 不等于 144 次封存的有效
模型执行。check 通过表示档案完整与复算一致，不表示 run 通过。

## 反馈与后续工作

角色记忆反馈有入口、落库和质量报告，但不参与 context-pack 排序或
keep/cold/archive。SEKB 采用计数没有生产写入方，保留为诊断，不再参与
handoff 排序。UI 不承诺记录反馈会改善下次任务。

A 方案登记为独立后续研究：先固定样本、预算与权重，再提供单个
default-off flag 和回滚证据。当前 B 方案的收口不依赖它。

## 复算与边界

Windows 检查前将 TEMP/TMP 指向 `D:/tmp`。

```powershell
node scripts/rsi-tf0604-baseline.mjs --check --json
node scripts/rsi-historical-task-corpus.mjs --check
node scripts/rsi-tf0592-statistical-adjudication.mjs --check --json
node scripts/rsi-measurement-archive.mjs --check --json
```

档案 check 同时回读五个确定性负控：普通 flake 容额、安全零 flake、
负例被接受时优先拒绝、E02/TF-0592 case 推断一致、零方差不可晋级。

成本缺失、安全未标注、部分 hidden oracle 可见、progress/exclusion
不一致与未证明收益保留在 `provenance.v1.json`；owner 为 `rsi-evaluator`，
复核日为 2026-12-01。

**ClawX 仍没有完整产品 RSI。** 当前 v2 reservation 为 0 完成 case /
insufficient-evidence；`liveReady`、`productApproved`、`defaultOn`、
`releaseApproved` 保持 false，自动化产物不声称 real-human。

## 审计 #4 后的补强（2026-11-03）

第四轮审计把此前只有文字、没有执行点的两条判据接上：

- **D7 晋级门槛**：新增 `evaluatePromotion`，要求 5pp 绝对提升、配对 95% 区间下界 > 0、
  成本涨幅 ≤ 10%、无安全/锚点回归；成本缺失为 `hold`、超限为 `eliminate`。
  `component-helps` 仍是统计结论，只有该门可以给 `promote`。
- **D8 状态拆分**：TF-0592 同时给出 `status`/`runStatus`（运行是否稳定完整）与
  `promotion`（是否满足冻结阈值），稳定但零效应的运行不再可能被读成晋级。
- **D9 数据接线**：新增 `scripts/rsi-feedback-export.mjs`，把 `role_memory_feedback`
  经 `role_memory_injections.task` 关联后导出；无 case join 的行单独计数。
- **D10 判据作用域**：两个 clean-tree 门禁只按判定输入判脏，无关的并行改动降为警告。

v2 reservation 仍是 0 完成 case / insufficient-evidence；历史测量仍是 fail；
`liveReady` / `productApproved` / `defaultOn` / `releaseApproved` 仍为 false。
