# VG—STS 2.0 草案（**非权威、未发布**）

> **这份东西是什么**：`CORRECTION-PLAN.md` §3 要求「由 STS 起草新版内容绑定契约，VG 随后接收」。
> 这里是**草案**——放在 `contracts/vg-sts/v2-draft/`，与权威的 `contracts/vg-sts/v1/` **完全分开**。
>
> **它不是什么**：
> - 不是运行契约。**权威仍是 `contracts/vg-sts/v1/` + 其 `manifest.json` 的 `digests`**；
> - **未发布、未 vendor、未被任何生产路径消费**：`src/` 里没有任何代码读这个目录；
> - `v1/` 一个字节都没改（29 条 digests 继续有效），本目录也**不在** v1 的 manifest 覆盖范围内；
> - 版本号 `2.0` 是**提议**，最终由权威方定稿（见 `CORRECTION-PLAN` §3「最终版本号由权威方定稿」）。

## 1 为什么需要 2.0（而不是在 1.1 里加字段）

1.1 的四个 schema 都是 `additionalProperties: false`，而且：

- `identities.worktree_content_digest` **仅限 workspace 模式**（candidate/commit 携带会被**语义拒绝**）；
- candidate 的内容身份只有 `target_identity` 里的 **7 位短标签**（`candidate@770e8e0`），
  plan/result **拿不到完整 OID**——接收方没有 request 就无法核"计划绑的是哪个版本"；
- 输入清单（配置/数据/被 ignore 的覆盖文件）在协议层**无处可写**；
- 内容身份与环境身份挤在同一组字段里，说不清"内容一致但环境不同"。

⇒ 这些都是**破坏性**变化（新增必填、收紧语义），按本仓硬规矩必须**升版本**，不能在 1.1 内
静默改变字段含义。所以：**2.0 草案**，1.1 保留明确支持范围。

## 2 草案提出的十一条语义规则（可执行）

规则不是散文：`check_draft.py` 把它们实现了一遍，样例逐条对着跑。

| 规则 | 内容 | 为什么 |
| --- | --- | --- |
| `R1-protocol-is-2.0` | 本草案只讨论 2.0 | 其它版本按各自契约校验，不在这里静默兼容 |
| `R2-label-is-not-identity` | `candidate@<7 位>` 只作展示；`content_identity.value` 必须是**完整**身份 | 7 位标签是 1.1 里唯一的身份锚点（28 bit），不该当比较依据 |
| `R3-manifest-covers-config-and-data` | 内容清单必须覆盖会被读到的输入，含 config/data | 只列源码/测试的清单盖不住"改了 pytest.ini / 数据文件" |
| `R4-digest-carries-algorithm` | 每个摘要带算法前缀 | 裸摘要无法判断算法，跨版本不可比 |
| `R5-exclusion-policy-is-versioned` | 排除规则有版本化 id；换行/软链/子模块/不可读文件行为必须显式 | "允许排除什么"本身是有版本的行为；不支持要**明确拒绝**而不是静默按空处理 |
| `R6-full-only-when-content-confirmed` | 只有 `content_confirmed=true` 且确实收集到全集，才允许 `conservative_full_available=true` | 磁盘不对应任何明确版本时，声称"可保守全量"是错的 |
| `R7-unconfirmed-must-be-listed` | 拒绝时逐项列出"没确认到什么" | 说清缺什么，比一句笼统失败有用 |
| `R8-plan-carries-its-own-identity` | plan 自带完整内容身份 + 政策身份；result 自带执行身份 + 前后观察 | 接收方不该为了核身份去回看 request |
| `R9-invalid-or-unconfirmed-cannot-be-valid` | 观察为 `unconfirmed`/`mismatch` ⇒ 不得 `validity=valid`；plan 记了**可选** `expected_execution_identity` 就比 result 的执行身份。**plan 没记则该半句不判——「不判 ≠ 已核对通过」** | 与 1.1「确认不了就不算有效」同精神，只是显式成字段；把"不判"和"核对通过"分成两件事，比删掉那半句诚实 |
| `R10-order-is-permutation-of-selected` | `order` 必须是 `selected` 的排列；`full` 时 `selected` 必须等于 `collected` | 换到新字段上重申 1.1 已有的执行身份不变量 |
| `R11-cross-document-binding` | request/plan/result 必须同指一次候选：`request_id`/`protocol_version`/`target_identity` **以及完整内容身份（kind + value + manifest_digest 三项）**都要一致 | **这是 2.0 想解决的核**：短标签相同而完整身份不同，在 1.1 里根本看不出来 |
| `R12-environment-identity-must-match-plan` | 内容一致 ≠ 环境一致。plan 记了 `expected_environment_identity` 就比 result 同名字段；**没记不判**（不判 ≠ 已核对通过） | 同一份内容在不同解释器/依赖/平台上行为可以不同；1.1 把内容与环境挤在一处，分不出"跑的是不是它以为的那个环境" |

## 3 相对 1.1 的字段级变化

| 对象 | 变化 |
| --- | --- |
| `candidate_request` | **新增必填** `content_manifest`（内容清单：entries/algorithm/exclusion_policy_id/line_endings/symlinks/submodules/unreadable_files）；`identities` 拆成 `content_identity`（完整值 + 展示 label）与 `environment_identity`（解释器/依赖/插件/配置/外部服务隔离声明） |
| `test_plan` | **新增必填** `content_identity`（含 `manifest_digest`、`observed_at.before_build/after_build`）与 `policy_identity`（rules_id + policy_version）；新增**可选** `full_comparison`（独立全量对照的绑定）、`expected_execution_identity`（R9 可判形式）、`expected_environment_identity`（R12 可判形式）；`target_identity` 降级为**仅展示** |
| `execution_result` | **新增必填** `content_identity` 与 `execution_identity`；新增 `environment_identity`（R12 比对用）、`observations.before_execution/after_execution`、`isolated_process` |
| `plan_refusal` | `refusal_code`（封闭枚举）→ **`refusal_kind`** 六类可分辨原因；**新增必填** `content_confirmed`；新增 `unconfirmed[]` 逐项说明；`refusal_code` 作为兼容字段保留 |

**1.1 兼容字段**：`target_identity`、`rules_id`、`refusal_code` 都留在草案里，标注为兼容/展示用途——
这样 1.1 的消费方在过渡期能读出自己认识的字段，但**新语义一律走新字段**。

## 4 正反样例与可复算

python contracts/vg-sts/v2-draft/check_draft.py --verbose     # 退出码 0/1
python contracts/vg-sts/v2-draft/make_manifest.py --check      # 摘要与磁盘一致性
python -m pytest tests/test_contract_v2_draft.py -q            # 15 passed
```

当前读数（本机真跑，**2026-10-02 按 VG 0022 的 5 条复现修过**、**2026-10-03 按 VG 0028/0029 再修两处**）：

- **正样例 4 条全部通过**：带完整内容身份的 request / plan / result，以及一条
  `content-unbound` 的 refusal；
- **反样例 7 条全部被拒**，且**每条只因它指名的那一条**被拒
  （`test_each_invalid_sample_fails_only_for_its_named_reason` 钉住——反例若顺带触发别的规则，
  『这个反例证明了 R4』这句话就不成立了）；
- **配对夹具 5 组符合预期**：`valid/matched` 通过；`same_label_different_content`（短标签同、
  完整身份异——**1.1 的绑定核对看不出这种漂移**）、`same_value_different_kind`、
  `execution_identity_drift`（R9 可判形式）、`environment_identity_drift`（R12）**均被拒**。
  **注意 `pairs/valid/*` 的含义**（2026-10-03 按 VG 0028 更正）：它是『这组**每一份都合法**、
  **而且**能绑定』，**不是**『只验绑定』——原先 `check_pairs()` 只调 `binding_errors()`，
  于是 `pairs/valid/matched/request.json` 缺 R5 三字段（违反草案自己的 R5）却照样显示『通过』，
  **『这组合法』那半句没人验**。
- **可达性守卫**：见下。

**结构校验复用 v1 的 schema 引擎**（`contracts.validate_schema(doc, kind, root=...)` 的旁路参数），
所以草案不需要第二套校验器实现——那份引擎的行为对 v1 一字未变。

**摘要清单**（`manifest.json`，`status: "draft"`）：**30 条** = README 1 + schema 4 + valid 4 +
invalid 7 + pairs 14。摘要由 `make_manifest.py` **现算**而不是手写（手写必然漂移）；
`semantic_rules` 清单**从检查器实现生成**（登记 ↔ 实现不会分叉）；
manifest 自身不在覆盖内（无法自摘要），与 v1 同一例外。

### 可达性守卫（2026-10-03，判据来自 VG 0029 §二 ㈡）

> 检查器从文档上读的**顶层**字段，必须在**对应那份** schema 的 `properties` 里声明得下。
> **逐文档映射、不能取并集**——并集会让『这条字段在别的文档里有』变成通行证，而实际是
> 『在**这份**文档里根本进不来』 ⇒ 规则**不可达**（加了反例、写了规则表、登记了 count，全部空转）。

根 schema 全是 `additionalProperties:false`，所以这不是形式主义：VG 那边就栽过一次——
在**中间态**读到 `test_plan.schema.json` 还没声明 `expected_environment_identity`，
于是『带这个字段的 plan 会在结构层被拒 ⇒ R12 永远不触发』。他们据此把它改成机械守卫，我们照做。

`RULE_DOCUMENT_FIELDS` 把『哪条规则从哪种文档读哪些顶层字段』**显式摆出来**（人工登记，不是
解析代码路径），`schema_reachability_problems()` 逐条比对，检查器**每次运行**都报。
**它上线当场就抓到我们一处登记不实**：R11 曾把 `target_identity` 登记成 request 的字段——
request 根本没有它（它用 `target`）。

配合另外三道守卫，**四道合起来覆盖『实现 ↔ 登记 ↔ schema ↔ 样例』**：

| 守卫 | 覆盖 | 守住它的测试 |
| --- | --- | --- |
| `manifest.semantic_rules` 从检查器生成 | 实现 ↔ 登记 | `test_manifest_rule_list_matches_the_checker_implementation` |
| `RULE_DOCUMENT_FIELDS` + 可达性检查 | 实现 ↔ schema | `test_every_rule_is_reachable_in_its_schema`、`test_reachability_guard_rejects_a_phantom_field`（反向对照） |
| `check_pairs()` 逐份校验 | 夹具 ↔ 规则 | `test_pair_fixtures_are_each_document_valid`、`test_checker_rejects_a_pair_whose_document_is_invalid` |
| 反样例只因指名原因被拒 | 反例 ↔ 规则 | `test_each_invalid_sample_fails_only_for_its_named_reason` |


## 5 给 VG 的接收步骤（对应 `CORRECTION-PLAN` §3「接收步骤」）

1. 本文**现在就可以看**：重点是 §2 的十二条规则与 §3 的字段级变化，判断口径是否要调整；
2. VG 用**自己的**解析器复核同一批样例（不要采信本仓的 `check_draft.py`）——
   这正是「样例是契约的一部分、必须能被独立判读」的用法；
3. 双方对口径后再定稿：STS 提交正式 schema + 语义规则 + manifest 完整摘要（届时才进
   `contracts/vg-sts/v2/` 并成为权威）；VG 逐字节 vendor，**不修改 STS 源文件、不做局部摘要匹配**；
4. 原 1.1 保留明确支持范围；**旧文档缺的新字段不得默认补成"有效"**，不支持就显式拒绝；
5. 总线只引用提交与摘要，**不放契约副本**。

**诚实边界**：本草案**没有**实现对应的生产代码——`plan_request` / `run_plan` / `shadow` 仍然
只产出 **1.1** 文档。草案是"把口径说清、让它可对拍"，不是"已经支持 2.0"。
