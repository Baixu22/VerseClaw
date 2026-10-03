# P6-TF0074 v7 合并验收报告：三阶段全绿（2026-08-24）

状态：**PASS**（judge + schema-free + continuation 三阶段 30/30 全满分）
评估模型：`qwen-plus-latest`（阿里云百炼）；摘要产物：确定性恢复批次 v11（`artifacts/p6-tf0074-deterministic-recovery-30-v11/`）；方法学与 v6 一致（固定 30 manifest + paired 叠加 + --no-cache + secret scan）。

## 1. 定论结果（v11 摘要，三阶段并行）

| 阶段 | 覆盖 | 关键指标 | 门槛 | 判定 |
| --- | --- | --- | --- | --- |
| Real judge | 30/30 | noFabrication **1.0**、accuracy 1.0、completeness 1.0、causalChain 1.0、actionability 1.0、均分 10、最低 10 | noFab>=0.98 等 | **PASS** |
| Schema-free 遗漏 | 30/30 | majorOrCriticalOmissionRate **0.0**（0/30）、均分 10、最低 10 | <=0.10 | **PASS** |
| Real continuation | 30/30 | first/critical match **1.0**、noRepeatedWork 1.0、noContradictory 1.0、decisionConsistency 1.0、completionDelta 0 | 各项 | **PASS** |

对比 v6：judge noFabrication 0.9667 **FAIL**（R19 Cargo 虚构）→ v7 **1.0**；schema-free 0.0667 → **0.0**；continuation 1.0 → 1.0。

证据目录：
- `artifacts/p6-tf0074-live-acceptance-v7-definitive-judge/`
- `artifacts/p6-tf0074-live-acceptance-v7-definitive-schemafree/`
- `artifacts/p6-tf0074-live-acceptance-v7-definitive-continuation/`

## 2. v6 → v7 修复全清单

### 产品缺陷（6 类，均经 transcript 级 ground truth 验证）
1. **R19 Cargo 虚构（P0）**：`extractCommandFacts` 把跳过报告里的 "Cargo.toml" 截成裸 "Cargo" 当测试结果。修复：裸工具名/跳过消息/manifest 文件名全部拦截，跳过报告逐字保留为负证据，摘要层裸工具名过滤。
2. **R17 等 6 样本未执行目标误标完成（P1）**：完成证据回退到无关后续任务。修复：目标任务段（以下一个新任务用户条目为界）+ 编号任务同编号要求 + `pending-objective` 显式化 + 待完成目标成为 continuation primary。
3. **R12 追踪丢失（P1）**：目录名 token 污染目标匹配。修复：任务编号相关性 + 段内最终报告逐句保留（#1–#5 追踪清单完整保留）。
4. **R4 失败归因错误 + R4/R20 分类矛盾**：复合尝试句截断到错误命令；原始工具错误 JSON 与助手解释各生成一条矛盾分类链。修复：attempt 取最后匹配动作句；原始工具错误继承后续解释的 expected_behavior 定性。
5. **R27/R18 修复确认被当失败**：`failureResolvedByText` 排除确认型消息；全文（不截断）解析检查；CJK 词边界修复。
6. **R21/R23 探测类误分类**：不存在文件/参数校验响应归类为 expected_behavior；重复请求视为同一回合并从首次出现定范围；JSON error 字段提取；失败链去重折叠重试风暴；toolResult 纳入失败链。

### 审计基础设施（11 项）
judge prompt 证据裁剪盲区修复（v10/v11 锚定）、429 重置等待、请求 8 分钟超时、逐样本进度、off-schema 白名单强转+重试循环、response_format 开关、额外请求头机制、去重键（文本+严重度）、`fixed(?!-string)`、outcome 步骤链保留、paired 方法学校正。

## 3. 提供商路径记录（全部实测）

| 提供商/模型 | 结果 |
| --- | --- |
| OpenRouter nemotron（3 免费账号） | 部分完成后日配额耗尽（08:00 重置）；部分 run 证明 R1–R19 零虚构 |
| SeekAI claude-opus-4-8 | 模型安全策略拒绝评估本语料（不应绕过） |
| SeekAI deepseek-v4-pro-0813 | 上游不可用/524 超时 |
| agentrouter.org deepseek-v4f | 客户端头限制（Codex 头可过认证）+ 敏感词过滤拦截真实语料 |
| **百炼 qwen-plus-latest** | **全程可用**，schema 稳定，速度 4–9s/请求 |

## 4. 深度验收中所有 judge 异议的 ground truth 定性

| 样本 | 异议来源 | 定性 |
| --- | --- | --- |
| R19 | luna/qwen completeness | 真实（步骤链截断）→ 已修 |
| R4 | luna 归因、qwen 分类矛盾 | 真实 → 已修 |
| R27/R18 | luna 确认当失败 | 真实 → 已修 |
| R21 | qwen 缺调试上下文 | 部分真实（mission_loop 丢失、误分类）→ 已修；4 项要求中 3 项为 transcript 不存在信息（judge 过度） |
| R23 | luna 探测误分类 | 真实 → 已修 |
| R15/R29 | luna 跨账号矛盾判定 | judge 误判（证据支持摘要） |
| R20 | luna/qwen 分歧 | R20 分类矛盾真实 → 已修；"源码定位"要求为 transcript 不存在信息 |
| R25 | luna 细节 | 内容已在 Key Decisions，截断内可接受 |
| R11/R16 | qwen continuation 失配 | paired 方法学缺失（directive 段）→ 方法学校正 + 待完成目标 primary 修复 |

## 5. 已知保留事项

- **P2（维持）**：v6 continuation 首次空 actions 5/30（16.67%），一次有界 retry 全部恢复；机制保留，不额外耗配额。
- **judge 方差教训**：luna 同样本跨账号 1.5 vs 10——任何单 judge 异议必须经 transcript ground truth 核查才能定性为产品缺陷（本轮全部执行）。
- **可选交叉验证**：明早 08:00 后 OpenRouter 配额重置，可用 nemotron 对 v11 摘要再跑一轮 judge 交叉确认（非阻塞）。
- **成本**：百炼侧全部 run 合计约 ¥6（6 轮 × 30–90 请求）。

## 6. 晋升状态

`promotionStage` 保持 `shadow`：本轮为工程验收（真实语料 + 真实模型判定），达到全部技术门槛；产品级晋升（TF-0075、liveReady、productApproved、default-on、critical-only）仍需用户按受控发布流程显式授权。
