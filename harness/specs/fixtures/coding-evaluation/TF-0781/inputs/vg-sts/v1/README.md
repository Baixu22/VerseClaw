# VG—STS v1 契约

VG 与 STS 之间"一次性候选请求 / 测试计划 / 执行结果 / 无法规划回执"的**唯一权威定义**。
STS 维护本目录，VG（接收方 `VG:TF-0168`）按 `manifest.json` 里的 `digests` 固定版本消费，
**不得两边各写一份同名协议**。

对应任务：`STS:TF-0026`（定义契约与共享正反样例）。协作背景见
`docs/integration/VG-STS-coordination-2026-09-27.md`。

## 协议版本

- 当前 `protocol_version = 1.1`。受支持集合 `{1.0, 1.1}`——**1.1 只做向后兼容的放宽/新增**，
  VG 已固定的 1.0 请求/计划/结果在 1.1 校验器下仍全部合法。
- 1.1 相对 1.0 的差异（均不破坏 1.0）：
  1. `candidate_request.risk.hints[]` 的 `symbol` 由必填改为**可选**（`path` 仍必填）——
     SSI 的 `read_path`/`write_path` 边天然可能无符号；
  2. 新增 `plan_refusal` 对象——STS **无法生成合法计划**时的带内回执；
  3. `candidate` 模式必须给 `candidate_tree_oid` 或 `candidate_commit_oid` 作内容身份，
     且**不携带** `identities.worktree_content_digest`（候选是已物化的树）；
  4. `execution_result`：`completeness=complete` 时 `not_executed` 必须为空（残缺输出）；
  5. `test_plan.risk_decisions[]` 的 `symbol` 改为可选，但 `symbol`/`path` 至少给一个。

## 目录

```
contracts/vg-sts/v1/
  schema/
    candidate_request.schema.json    # VG -> STS 的候选请求
    test_plan.schema.json            # STS 生成的可解释计划
    execution_result.schema.json     # 按计划执行 pytest 的结果
    plan_refusal.schema.json         # STS 无法规划时的带内回执（1.1 新增）
  samples/
    valid/                           # 应通过校验的正样例
    invalid/                         # 应被拒绝的反样例（文件名即拒因）
    pairs/                           # 跨文档绑定夹具（request+plan[+result] 一组）
      valid/matched/                 # 同指一次候选，绑定通过
      invalid/wrong_candidate/       # request 与 plan 张冠李戴，绑定被拒
  manifest.json                      # 契约版本 + 各文件 sha256 摘要 + 入口/退出码/来源提交
  README.md
```

## 四个对象与三个维度

- **candidate_request**：协议/产品版本、请求身份、仓库与候选目录定位、`base/ours/theirs`
  实际 OID、候选额外改动、代码/测试/配置/环境身份、可选风险来源与版本。候选目录只作定位，
  身份以 OID 为准。
- **test_plan**：绑定 request/target 与规则身份；成功收集的**测试全集**、选中/排除集合、
  确定执行顺序、逐项理由、回退原因、风险采用/忽略原因。计划是**数据**，不含让宿主直接执行的
  任意 shell 字符串。
- **execution_result**：绑定 request/plan/target；保留实跑 nodeid、原始 pytest 退出码、逐测试事实。
- **plan_refusal**（1.1 新增）：**无法生成合法计划**时的带内回执。核心安全语义——只有
  `target_confirmable=true` 且 `attempted_collection.succeeded=true`（确实收集到测试全集）时，
  `conservative_full_available` 才可为 `true`；否则必须 `false`（如实报告无法规划，不得在未知
  目标上声称可保守全量）。

**三个维度互不顶替**（契约的核心安全语义）：

| 维度 | 取值 | 含义 |
| --- | --- | --- |
| `selection_scope` | `selected` / `full` | 测了哪些范围 |
| `completeness` | `complete` / `incomplete` | 计划内是否跑完（超时/取消/预算中止=incomplete） |
| `validity` | `valid` / `invalid` | 结果是否对应当前目标版本（目标漂移/计划过期=invalid） |

跑完注册检查 ≠ 仓库全部测试跑完；空选 / 零执行 / 收集失败**不得**报告为完整通过。

## 校验（结构 + 语义两层）

校验器在 `src/smart_sorter/contracts.py`，**纯标准库**（不引入 `jsonschema`）：

1. **结构**：draft-07 JSON Schema 的常用子集（type/required/properties/enum/const/items/
   pattern/minItems/minimum/`$ref`(#/$defs)/oneOf/additionalProperties）。
2. **语义**：schema 表达不了的跨字段不变量，例如：
   - 协议版本必须在受支持集合内（未知版本拒绝，不静默兼容）；
   - candidate 模式必须给全 `base/ours/theirs` OID + 候选目录（两侧变更并集，**禁止只比第一父**），
     并给出 `candidate_tree_oid`/`candidate_commit_oid` 之一、不带 `worktree_content_digest`；
   - plan：`selected/excluded ⊆ collected` 且互斥、`order` 是 `selected` 的排列、`fallback` 非空 ⇒ `full`、`full` ⇒ `selected==collected`；`risk_decisions[]` 至少给 `symbol`/`path` 之一；
   - result：空选/零执行不得标完整通过、`complete` ⇒ `not_executed` 为空、`incomplete`/`invalid` 必带原因、退出码与 outcomes 不得矛盾；
   - refusal：`conservative_full_available=true` 需 `target_confirmable=true` 且 `attempted_collection.succeeded=true`；
   - **绑定**（`validate_binding` / `bind` 子命令）：request/plan/result 的 `request_id`、`plan_id`、
     `target_identity`、`selection_scope`、`protocol_version` 必须一致（**错候选**核对）。

### 命令

```bash
# 校验单个文件（stdout 出机器 JSON {ok,kind,errors}；stderr 出人类日志；退出码 0/2/3）
python -m smart_sorter.contracts validate contracts/vg-sts/v1/samples/valid/request_workspace_norisk.json --as request

# 跨文档绑定核对（错候选）：request/plan[/result] 是否同指一次候选
python -m smart_sorter.contracts bind \
  --request contracts/vg-sts/v1/samples/pairs/valid/matched/request.json \
  --plan    contracts/vg-sts/v1/samples/pairs/valid/matched/plan.json \
  --result  contracts/vg-sts/v1/samples/pairs/valid/matched/result.json

# 全量样例回归（正样例全过、反样例全被拒、manifest 摘要与磁盘一致）
python -m pytest tests/test_contracts.py -q
```

## 版本与防漂移

- `protocol_version` 与产品包版本分离；破坏性字段/语义变化必须**升版本**并更新双方样例。
  本轮 `1.0 → 1.1` 全部是向后兼容放宽/新增，故受支持集合为 `{1.0, 1.1}`，VG 的 1.0 pin 不被破坏。
- `manifest.json` 的 `digests` 覆盖全部 schema、sample、绑定夹具与 **README.md**。消费者按摘要固定内容；
  `tests/test_contracts.py` 会核对磁盘文件与 manifest 摘要一致，任何静默改动都会让测试失败。
  （`manifest.json` 自身无法摘要自己，属常规例外。）
- `source_commit`：本 manifest 置 `null` 并声明 `version_policy: "digests-authoritative"`——
  以 `digests` 为唯一权威内容口径（manifest 无法自引用其所在提交的 hash）。契约由 STS 单独提交
  `contracts/` 目录引入，该提交 oid 作便利指针在交接回信中给出，不作为版本判定依据。
