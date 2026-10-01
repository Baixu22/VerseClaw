# VerseConf × ClawX 消费者边界决定（TF-0245）

日期：2026-10-01

`actor: codex/root` · `driven_by: agent`

## 决定状态

**决定类型：收缩当前周期并保持冻结（recommendation recorded, implementation authorization = false）。**

TF-0244 已经锁定严格 JSON 研究表契约、夹具、独立字节判据、失败试验设计和宿主 owner 映射。现有证据没有证明受管提交、权限继承、恢复、wasm 消费包或产品 UI 已存在。当前没有一份明确授权允许修改 VerseConf 冻结源码、增加 ClawX 产品范围、启动付费模型实验或公开分发。

因此本周期只保留契约资产和研究证据，**不启动 TF-0246 的真实受管提交实施**。TF-0246 至 TF-0252 继续保持 `proposed`，不能因为本决策节点完成而自动变成实施许可。

这不是发布者对冻结范围的解冻，也不是产品锁、默认值或 Task Forest 父节点状态的修改；它是 agent 对当前证据的范围收缩建议。若要进入实施，必须由后续明确决定单独授权；授权应写清范围、维护责任、资源和回滚，不得从本文件推导。

## 当前保留的候选边界（不是批准记录）

若未来获得明确的消费者专用授权，首个 W1 只能讨论以下窄边界：

- VerseConf 只处理内存中的严格 JSON 文档、声明式候选变更和结构校验。
- ClawX 业务层选择研究表 schema、稳定 artifact/revision 身份和导出映射。
- 现有 runtime mutation owner 继续拥有 workspace、session、run、actor、路径、权限、取消、版本检查、写入、恢复、实际效果和 receipt。
- 现有 SQLite、host-api/Main/Gateway 和工具策略继续作为宿主边界；不新建任务、审批、记忆、权限、提交或 telemetry authority。
- 首个消费者只覆盖三记录研究表、既有记录的非重叠字段批次和显式 Markdown/XLSX 输出请求；不承诺任意 Office 往返、JSONC/TOML/YAML、记录插入删除排序或全格式保真。
- 任何新工具都必须继承当前 run 的真实权限和取消状态；模型不能提供可信 run/workspace/actor、任意路径、schema、`force` 或绕过安全的参数。

上述内容是未来授权的候选边界和审查清单，不是当前已经允许的代码改动。

## 责任和资源建议

| 领域 | 当前责任边界 | 未来 W1 的检查 |
|---|---|---|
| 计算内核 | VerseConf 仅内存计算；当前不改冻结源码 | 明确 Node/wasm 绑定版本、来源、许可证和构建输入 |
| 业务语义 | ClawX 业务插件选择 schema、字段和输出 mapper | 不把领域语义塞入通用 SDK 或文件写入器 |
| 权限与写入 | 现有 runtime mutation owner | 验证 readonly/deny、workspace、取消和版本冲突 |
| 状态与恢复 | 现有 SQLite/journal/receipt owner | 验证 prepared、已发生、recovery_required 和重启对账 |
| UI/传输 | 现有 host-api → Main → Gateway | 只读查询先行；写入优先走真实 agent run |

当前已批准资源：**0 个付费模型调用、0 个新增凭据、0 个发布动作**。探索文档给出的 12–24 个有效工程小时和 4/64/256 KiB 输入档位、冷/热延迟目标等，只是后续估算输入，**不是预算批准**。W1 若需要付费端点、冻结源码维护或公开包，必须另行获得明确决定；没有该决定就保持 proposed。

## 采用、收缩和停止判据

当前选择“收缩/保持冻结”，依据是：契约层已足够窄且可验证，但产品接入层尚无真实运行证据。未来若授权 W1，只有同时满足以下条件才可考虑进入 TF-0246：

1. 实际 run 能把候选绑定到当前 session/workspace/actor，并在提交前重查基线。
2. readonly/deny、基线冲突、取消、导出失败和重启对账都有真实产物；未知效果不自动重放。
3. 写入和恢复复用现有 owner，不产生第二套 journal、receipt、审批或权限权威。
4. 干净候选、脚本化 agent 证据、失败分母和资源计量齐全；不声称真人或付费模型质量。
5. 两轮有界尝试仍需新增通用平台、私有反向桥、权限放宽、无依据撤销或任意路径能力时，立即停止扩张并保留源与输出。

若同一宿主契约下的 TS 薄实现更简单且能满足相同承诺，则应停止 VerseConf 特定投入，保留宿主闭环能力；不维护长期双引擎自动切换。

## 证据边界

TF-0244 的最终候选为 `dee2391c179610d71f33e8fc5273f05a62feaa90`，离线契约检查 `88/88`，报告 `artifacts/verseconf-contract-v1/verification/20261001/contract-check-final.json`。该报告的 `productIntegrationVerdict` 和五类 runtime trial 均为 `not-run`，所以本决定没有把契约检查升级成产品集成或采用通过。

本文件不要求真人操作、真人数据或人工 verdict；后续交互和判定应由 agent/script 驱动并标记 `driven_by: agent`。
