> 2026-10-04：本目录已转为历史夹具。当前唯一权威为 `extensions/sts/contracts/vg-sts/`；下文是原接收历史，不代表当前能力或版本。

# vendor/sts-vg-contract —— STS↔VG 契约的**逐字节副本**

这个目录**不是 VG 写的协议**。权威定义由 STS 维护在它自己仓的 `contracts/vg-sts/`
（接收方 `VG:TF-0168`）。这里只是把交付物原样搬进 VG，好让"VG 解析的是同一批正反样例"
这件事在 CI 里也能复算——VG 侧不另写一份同名协议。

**唯一被信任的东西是 `manifest.json` 里的 sha256 摘要。** 副本被改一个字节，接收就会
失败；**目录里多一个没被摘要覆盖的文件同样会被拒绝**（TF-0188 补的判据：摘要只证明
"点名的没被改"，证明不了"没多出东西"）。

## 两个子目录

| 目录 | 是什么 | 权威？ | VG 的处置 |
| --- | --- | --- | --- |
| `v1/` | 现行**权威**契约（协议 `1.1`，受支持集合 `{1.0, 1.1}`） | **是** | 消费路径唯一入口；pin 为 **29 条摘要** |
| `v2-draft/` | STS 起草的 **2.0 草案**（`manifest.status="draft"`） | **不是** | 仅 vendor + 独立复核；**显式拒绝消费** |

### `v1/`（权威）

| 项 | 值 |
| --- | --- |
| 来源路径 | `STS:contracts/vg-sts/v1/` |
| 协议版本 | `1.1`（受支持集合 `{1.0, 1.1}`；1.1 只做向后兼容的放宽/新增） |
| 文件数 | 30（29 条摘要 + `manifest.json` 自身） |
| 版本口径 | `version_policy: "digests-authoritative"` —— 以 **digests** 为唯一权威内容口径 |
| `source_commit` | `null`（manifest 无法自引用它所在提交的 hash） |
| 引入提交（便利指针，**不作判定依据**） | `c51b8cf`（父 `9f92bc9`），只提交了 `contracts/` 目录 |
| 复制时间 | 2026-09-28 |
| 复制方式 | 逐字节复制，复制后 30 个文件全部哈希一致 |

### `v2/`（**权威**：STS 契约 2.0，2026-10-03 定稿）

| 项 | 值 |
| --- | --- |
| 来源路径 | `STS:contracts/vg-sts/v2/`（生产方 `STS:TF-0040`；`status: authoritative`、`supersedes: 1.1`） |
| 来源提交 | **`3c44a88`**（对端当时 HEAD `94f6b62`、**工作树干净**） |
| manifest sha256 | `10423dd31a16e4cacc387b2fbbc07a8f330e83e1f72f4e590e173e96640edd87` |
| 文件数 | **31**（30 条摘要 + `manifest.json`） |
| 复制方式 | 逐字节复制；**31 个文件与来源提交的 blob 逐一相同**；**未登记文件 0**（除 `manifest.json` 外全在摘要内） |
| VG 侧读数 | 摘要 **30/30**、正样例 **4/4**、反样例 **7/7**、配对正例 **1/1**、配对反例 **4/4**（由 `sts_contract_v2` 判读） |
| 接收结论 | `vg sts contract --dir vendor/sts-vg-contract/v2` 退 **0** |

**边界（照实记）**：`contracts/vg-sts/tools/v2/` 下的生成脚本**不在树内、也不在任何摘要覆盖内**
（对端选了 `from-vg/0034` §二 的方案 (a)）⇒ 该树的 pin **覆盖不到规则清单的生成过程**，
`manifest.semantic_rules.list` 无法再从 pin 住的字节里与检查器实现对照。详见接收记录 §12.2。

**与生产路径的关系**：2.0 是**权威契约**，但 VG 的**文档生产/消费路径仍只走 1.1**
（`IMPLEMENTED_PROTOCOL_VERSIONS` 未动；`INTAKE_PROTOCOL_VERSIONS` 才含 2.0）。见接收记录 §12.1。

### `v2-draft/`（**草案，非权威**）

| 项 | 值 |
| --- | --- |
| 来源路径 | `STS:contracts/vg-sts/v2-draft/`（生产方 `STS:TF-0040`） |
| 协议版本 | `2.0`（**提议**，最终由权威方定稿） |
| `manifest.status` | **`draft`** |
| 文件数 | 33（30 条摘要 + `manifest.json` + `check_draft.py` + `make_manifest.py`） |
| manifest sha256 | `072812e68dcd1ea7b1059e6e1d3a9cb395ea8a6c1e85423ea6c7e9f052e4c30c` |
| 来源提交 | **`15832e3`**（`feat(tf0040): 可达性守卫（实现 ↔ schema）+ 修正一处登记不实`；其前置 `086bf26` 补了配对夹具的 R5 字段）。对端当时 HEAD `ca3d0b5`、**工作树干净** |
| 复制时间 | 2026-10-03（**第 4 修订**；第 1/2/3 修订 `389497146d81…` / `8ae970ff…` / `dfdf71bb…` 均已被对端替换） |
| 复制方式 | 逐字节复制，复制后 33 个文件哈希一致（含 3 个非摘要文件）；**盘上 33 文件与来源提交的 blob 逐一相同** |

**修订史（为什么是第 3 修订）**：对端 `from-sts/0024` 给的锚点是 `881d76180dfd…`（27 摘要），
但那份内容在 VG 取到时**已经不存在了**——对端在写完那封信之后又改了两轮
（实测依次见到 `881d7618…` → `0f3d5753…` → `8ae970ff…`），其中 `0f3d5753…` 那一版
**自己不自洽**（`README.md` 的摘要与磁盘对不上，是一段编辑中的窗口）。

VG 因此提出：**停手并提交，然后按 commit + manifest 摘要给锚点**。对端照做了，
**2026-10-03 提交 `440c01f`（工作树干净）**，VG 据此 pin 了冻结版 `dfdf71bb…`——
这次锚点是**提交 + 摘要**，不再依赖"写信那一刻的摘要"。完整时间线见接收记录 §1.1。

**为什么草案也在仓内**：`CORRECTION-PLAN` §三 的接收步骤要求 VG **独立核验**对端交付，
而"独立"意味着不能用对方仓里的脚本（`check_draft.py` `import smart_sorter`，在 VG 侧
`ModuleNotFoundError`）——核验对象必须在 VG 自己的树里可复算。

**`v2-draft/check_draft.py` 与 `make_manifest.py` 是对方仓的脚本，VG 不调用**：
它们是"产出方怎么自证"的记录，只作 vendor 的完整性一部分。VG 的复核实现在
`scripts/review-sts-v2-draft.py`（自实现，不 import 对方任何代码）。这两个文件名由 VG
在代码里显式列为"非契约内容"（`sts_contract.rs::DRAFT_PRODUCER_TOOLING`），
且**只在 `status=draft` 时**生效——非草案树没有任何额外豁免。

## 复算

```bash
vg sts contract --dir vendor/sts-vg-contract/v1 --json            # 权威接收，退 0
vg sts contract --dir vendor/sts-vg-contract/v2-draft --json      # 草案：**退 3**（拒绝消费）
vg sts contract --dir vendor/sts-vg-contract/v2-draft --review --json  # 草案复核，退 0
python -X utf8 -B scripts/review-sts-v2-draft.py                  # VG 侧独立语义复核
python -X utf8 -B scripts/review-sts-v2-draft.py --self-test      # 12 条反向对照
cargo test -p vg-cli --test sts_contract                          # 摘要 / 正反样例 / 配对绑定 / 草案拒绝
cargo test -p vg-cli --lib sts_contract                           # 各条语义不变量 + 未登记文件
```
