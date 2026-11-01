# B1 决策：会话索引与能力预设是否立项

> 节点：TF-0647 · 日期：2026-11-02 · 类型：**决策记录，不是实现**
> 本文件是唯一产出；没有新增索引、store、adapter 或 preset 代码。

## 1. 决定摘要

| 能力 | 决定 | 理由 |
|---|---|---|
| 可重建会话索引 | **NO-GO（当前不立项）** | 现有两个只读模型已覆盖本线诊断需求；没有实测延迟/会话量压力，也没有消费需求证据 |
| 会话能力预设 | **NO-GO（当前不立项）** | 没有真实需求语料；SessionEffectivePolicy 语义已承载现有能力选择，再开一层是第二写入面 |

这两个 NO-GO 是"证据不足"的判定，不是"永久否决"。满足第 5 节任一重开条件即可重新裁定。

## 2. 需求证据

| 证据类型 | 当前状态 | 结论 |
|---|---|---|
| 真实语料上的跨会话查询延迟 | **未测量** | 无法证明现有读模型不够快 |
| 会话数量/规模压力 | **未测量** | 无法证明规模会迫使索引 |
| 用户/agent 对跨会话检索的请求 | **无请求语料** | 无消费方 |
| 对能力预设的请求 | **无请求语料** | 无消费方 |
| 现有读模型 | `session.activitySnapshot`（stage/derivation/goal/process）与 derivation lineage 已实现 | 本线所需诊断已可回答 |

## 3. 若立项：写集与 owner

### 3.1 可重建会话索引（仅在未来 GO 时）

- 写集：一个新的 derived index module + 其 rebuild CLI/test；**不**改 SessionStore 写路径。
- owner：session-lifecycle control plane（本线）。
- 必须满足：索引只从 session files 重建；删除索引目录不丢任何真相；查询结果带来源引用。

### 3.2 会话能力预设（仅在未来 GO 时）

- 写集：preset schema + 应用点（session start）+ 测试；**不**改 SessionEffectivePolicy 语义。
- owner：session lifecycle 与配置 owner 共同署名。
- 必须满足：预设只展开为现有 capability 字段；不新增第二份生效策略。

## 4. 冻结面（无论 GO 与否都不碰）

- 不改 `SessionEffectivePolicy` 语义。
- 不建多机 SessionStore 适配器。
- 不把索引变成第二写入权威。
- 不复活 TF-0129 的自动再注入范围。

## 5. 重开条件（满足任一）

1. 在真实语料上测得一个现有读模型答不了的查询，记录延迟与会话数。
2. 出现具体消费方（UI 或 agent tool），其验收测试在无索引/预设时失败。
3. 有明确的写集 owner，且能证明索引可从 session files 完整重建。

## 6. 判定

**当前：两项均 NO-GO，不实施。** 保留为决策记录；实现留给满足重开条件之后的新节点。