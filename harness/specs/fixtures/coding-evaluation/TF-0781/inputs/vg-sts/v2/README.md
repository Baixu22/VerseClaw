# VG—STS 2.0 草案（**非权威、未发布**）

> **这份东西是什么**：`CORRECTION-PLAN.md` §3 要求「由 STS 起草新版内容绑定契约，VG 随后接收」。
> 这里是**草案**——放在 `contracts/vg-sts/v2/`，与权威的 `contracts/vg-sts/v1/` **完全分开**。
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
| `R8-plan-carries-its-own-identity` | plan 自带完整内容身份（含**必填**的 `observed_at`）与政策身份；result 自带执行身份 + 前后观察 | 接收方不该为了核身份去回看 request |
| `R9-invalid-or-unconfirmed-cannot-be-valid` | 观察为 `unconfirmed`/`mismatch` ⇒ 不得 `validity=valid`；plan 记了**可选** `expected_execution_identity` 就比 result 的执行身份。**plan 没记则该半句不判——「不判 ≠ 已核对通过」** | 与 1.1「确认不了就不算有效」同精神，只是显式成字段；把"不判"和"核对通过"分成两件事，比删掉那半句诚实 |
| `R10-order-is-permutation-of-selected` | `order` 必须是 `selected` 的排列；`full` 时 `selected` 必须等于 `collected` | 换到新字段上重申 1.1 已有的执行身份不变量 |
| `R11-cross-document-binding` | request/plan/result 必须同指一次候选：`request_id`/`protocol_version`/`target_identity` **以及完整内容身份（kind + value + manifest_digest 三项）**都要一致 | **这是 2.0 想解决的核**：短标签相同而完整身份不同，在 1.1 里根本看不出来 |
| `R12-environment-identity-must-match-plan` | 内容一致 ≠ 环境一致。plan 记了 `expected_environment_identity` 就比 result 同名字段；**没记不判**（不判 ≠ 已核对通过） | 同一份内容在不同解释器/依赖/平台上行为可以不同；1.1 把内容与环境挤在一处，分不出"跑的是不是它以为的那个环境" |

## 3 相对 1.1 的字段级变化

| 对象 | 变化 |
| --- | --- |
| `candidate_request` | **新增必填** `content_manifest`（内容清单：entries/algorithm/exclusion_policy_id/line_endings/symlinks/submodules/unreadable_files）；`identities` 拆成 `content_identity`（完整值 + 展示 label）与 `environment_identity`（解释器/依赖/插件/配置/外部服务隔离声明） |
| `test_plan` | **新增必填** `content_identity`（含 `manifest_digest`、`observed_at.before_build/after_build`）与 `policy_identity`（rules_id + policy_version）；新增**可选** `full_comparison`、`expected_execution_identity`（R9 可判形式），**`supported_run_modes` 改必填**（2026-10-03，见 §7 裁定②）；`target_identity` 降级为**仅展示** |
| `execution_result` | **新增必填** `content_identity` 与 `execution_identity`；新增 `environment_identity`（R12 比对用）、`observations.before_execution/after_execution`、`isolated_process` |
| `plan_refusal` | `refusal_code`（封闭枚举）→ **`refusal_kind`** 六类可分辨原因；**新增必填** `content_confirmed`；新增 `unconfirmed[]` 逐项说明；`refusal_code` 作为兼容字段保留 |

**1.1 兼容字段**：`target_identity`、`rules_id`、`refusal_code` 都留在草案里，标注为兼容/展示用途——
这样 1.1 的消费方在过渡期能读出自己认识的字段，但**新语义一律走新字段**。

## 4 正反样例与可复算

python contracts/vg-sts/tools/v2/check_draft.py --verbose     # 退出码 0/1
python contracts/vg-sts/tools/v2/make_manifest.py --check      # 摘要与磁盘一致性
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
| **合成夹具矩阵**（五种形态） | 配对判定**公式**本身 | `test_pair_verdict_formula_is_correct_on_synthetic_cases` |

> 第五行是 2026-10-03 按 `from-vg/0030` §三 的教训加的：VG 在**自己**的判据里抓到两处
> 假绿/假红（`ok = !errs.is_empty() != expect_bound` 会把"反例被正确拒掉"判成不符预期；
> 把**逐份错误**算进 invalid 组会把"绑定层没拒"算成被拒）。**真实数据会掩盖这类 bug**——
> VG 那边的旧修订里"正例缺 R5 字段"恰好让错误公式算对。所以用合成夹具逐形态对拍。

## 5 树形与接收（2026-10-03 定稿；同日按 VG 0034 改 (b)）

**本树 `contracts/vg-sts/v2/`**：`schema/` `samples/` **两个生成脚本** `README.md` `manifest.json`。

| 字节 | 是不是契约内容 | 说明 |
| --- | --- | --- |
| `schema/**`、`samples/**`、`README.md` | ✅ 是 | 逐条在 `digests` 覆盖内（35 条） |
| **`check_draft.py`、`make_manifest.py`** | ✅ **是** | **在树内且纳入摘要**（方案 **(b)**，按 VG 0034 §二）——见下 |
| `manifest.json` | ❌ 否 | 无法自摘要（与 1.1 同一例外） |

### 为什么生成脚本在树内（这是 VG 说服我的地方）

我方 0033 §五 曾担心「脚本不在树里，对方怎么独立复算这 30 条摘要」——
**VG 纠正了这一点**：消费者复算摘要**不需要**生成脚本，摘要就是逐文件 `sha256`，直接算。

(b) 真正解决的是**另一件事**：`manifest.semantic_rules.list` 是**从检查器生成**的。
若检查器不在被 pin 的字节里，接收方**核不了**「manifest 声明的规则 == 检查器实现的规则」——
**我方那道守卫住在我们自己的测试套件里，接收方跑不了** ⇒ 那一层保证只剩自述。
而 R12 漏登记那一类问题，**正是从那道对照里抓出来的**。

⇒ (b) 让这道对照**在消费者侧可复算**，且**不需要 VG 放宽任何判据**。

**复算办法**：

```bash
python -B contracts/vg-sts/v2/make_manifest.py --check   # 摘要与磁盘一致性（35 条）
python -B contracts/vg-sts/v2/check_draft.py               # 12 条规则 + 五道守卫
```

**1.1 仍然受支持**：本树**没有**动 `contracts/vg-sts/v1/` 的任何文件，v1 的 29 条 digests 继续有效。
消费方按文档里的 `protocol_version` 选对应那棵树的 schema；**旧文档缺的新字段不得默认补成
"有效"**——不支持就显式拒绝。

`plan_request`、`run_plan`、`shadow` 按输入文档版本路由。VG 的宿主入口通过显式协议选项
选择 2.0，默认仍是 1.1。契约接收通过只证明契约字节和判据可用，运行验收另行记录。

运行环境由受信任解释器采集：Python 完整版本、平台、已安装分发的名称和版本摘要。
摘要按名称小写的唯一 `name==version` 行排序，以 LF 连接后计算 SHA-256，不含末尾换行。
同一分发经多个路径别名可见时只计一次，避免把路径重复误判为依赖变化。
它描述安装清单，不证明每个依赖文件的内容相同。R12 对计划声明的
`python`、`platform`、`dependencies_digest` 逐项比对，结果缺项或不一致均拒绝。
`samples/pairs/invalid/dependencies_identity_drift/` 专门覆盖仅依赖摘要变化的反例。

VG 生成并复核完整候选清单；STS 在规划和执行前后核对清单声明的源码、配置和数据字节。
文件集合或已声明内容变化均不得当作同一候选通过。内置 2.0 宿主使用 `--output-only`
从文件消费计划和结果，避免大计划在 stdout 重复传输；诊断输出上限仍保留，拒绝回执仍输出。

## 6 两条待决口径的决议（VG 0034 §三，`from-vg/0024` §四 遗留）

| 条目 | 决议 | 落地 |
| --- | --- | --- |
| **`expected_environment_identity` 是否必填** | **必填**（采纳 VG 立场） | `test_plan.required` 含它；且要求 `python` + `platform` 都在。理由：计划本来就是"针对某个环境"做的，产出时就知道；plan 里已有一个近乎同形的 `environment_identity`——**两个都可选会让接收方分不出"没核对"与"核对通过"**。`expected_execution_identity` 保持**可选**（计划时不知道执行 id），但出现时 `interpreter` 应当必填 |
| **"未声明期望"能否显式表达** | **能**，加 `not_applicable` | `observations.before_execution/after_execution` 的枚举加 `not_applicable`：**显式写出来，而不是省略**——这样"没有报错"永远不会被读成"核对通过"（1.1 的同款口径：`code_oid` 必填且缺失不得当作"无变化"） |

**R12 因此收紧**：plan 填了期望、result **没带** `environment_identity` ⇒ 记 **mismatch**，
**不是放过**。配对夹具 `invalid/environment_not_reported` 专测这一条
（result 缺环境却声称 `validity=valid` ⇒ 必须被拒）。

### R12 能抓什么、抓不到什么（2026-10-04 分析，写下来免得下一个人重新推一遍）

`experiments/plan_v2_production/analyze_env_verifiability.py` 的结论：

| | |
| --- | --- |
| **能抓** | **跨进程 / 跨主机**的环境漂移：宿主在环境 A 上出计划、在环境 B 上执行 ⇒ 两次 `environment_identity_now()` 取值不同 ⇒ R12 报 mismatch |
| **抓不到** | **声明本身是假的**：对方在 request 里写 `--env-python 9.9.9`，我们照单全收（那是**对方声明的环境**） |
| **同进程内无意义** | `plan_request` 与 `run_plan` 本就是**两个入口、两个进程**；若在**同一进程**里连查两次取值必然一致 ⇒ R12 在那种场景下什么也抓不到 |

⇒ **「环境身份可证明」不是本轮能做完的任务**：它需要**协议层的新东西**——
一个**双方都跑的采集动作**，加上它的结果**进摘要**。
在 VG 0042 §四 的反证（假环境照单全收仍 `ok=true`）面前，
**我们明确不写「顺手换算」规则**：版本串 ↔ 路径没有可跨机验证的映射，
写一条猜出来的规则，正好落进「声明不是证明」的那个坑里。
**这一格留给下一轮议程；本轮只把判断写下来。**


## 7 对 VG 交回问题的裁定（2026-10-03，`from-vg/0037` / `0039`）

| # | 问题 | 裁定 | 理由 |
| --- | --- | --- | --- |
| ① | `content_identity.observed_at` 在 schema 里**可选**、README 的 R8 写**必填** | **schema 改必填** | **那是我们文档的内部矛盾**，不是 VG 读错。字段描述说「缺观察 ⇒ 未确认」而 README 说必填——两套判据都按必填实现。统一为必填后 R8 才在机器层成立 |
| ② | `supported_run_modes` 可选 ⇒ **合法但不可执行** | **2.0 改必填**（`minItems: 1`） | 52 个样例里 46 个不带它。**1.1 不动**（29 摘要已 pin、已逐字节 vendor）——这是 2.0 相对 1.1 的一处**有意收紧** |
| ③ | `checks_digest`（注册检查表指纹）在 2.0 无落点 | **给 `content_manifest` 加一个专门字段**，**不塞进 `environment_identity`** | 它是「跑哪些检查」的指纹，语义上**不是环境配置**；塞进去会让接收方分不清「环境变了」与「检查表变了」 |
| ④ | R3：树里**真没有** config/data 时怎么办 | **规则补一支**：`"config_data_absent": true` 显式声明 | 此前规则只写「必须覆盖」，VG 按字面执行会**拒掉合法的纯源码仓库**。但放宽成「没有就不要求」会让「漏列了」与「真没有」**无法分辨**——那正是 R3 要防的事。⇒ 显式声明，并规定**声明了却有** ⇒ 必拒 |
| ⑤ | 两条未决口径（环境身份显式给出 / `includes_candidate_extra_changes` 不省略） | 采纳 VG 的**严格侧** | 他们的实现已在跑、读数已固定。改我们这边比改他们那边便宜，且严格侧是**更安全**的一侧 |

**变更影响**：`manifest` 摘要 **35 → 37 条**（新增一对 R3 样例）；
`manifest.status` 仍是 `authoritative`、`supersedes` 仍是 `1.1`，**1.1 一字未动**。
