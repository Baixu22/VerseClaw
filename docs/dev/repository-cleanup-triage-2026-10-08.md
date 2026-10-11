# 仓库非结果产物与结构治理审计（2026-10-08）

审计对象：`Baixu22/VerseClaw` 当前分支 `codex/stepfun-basic-evidence-20261008`
口径：**只统计 git 已跟踪文件**（这些才会出现在云端）。未跟踪的外部项目不在范围内。

## 结论先看

| 指标 | 数值 |
|---|---|
| 云端已跟踪文件 | **19,024 个 / 279.5 MiB** |
| 其中「产品源码」(src / electron / shared / openclaw_runtime / tests / scripts / 构建配置) | 约 14,400 个 / 145 MiB |
| 其中「文档 · 产物 · 资源」 | **4,563 个 / 约 134 MiB（占体积 48%）** |
| 其中「纯阶段性过程留档」(docs + artifacts + reports + plans + team + .design-staging) | **3,496 个 / 约 69.7 MiB（占体积 25%）** |

**你的直觉是对的，而且比想象中更严重**：云端每 4 个字节就有 1 个不是代码，而是过程留档。

但有一个必须先说的事实：**仓库已经有一套产物治理政策**（`scripts/repository-artifacts.json`
+ `scripts/check-repository-artifacts.mjs` + `docs/dev/repository-artifact-retention.md`），
并且 `node scripts/check-repository-artifacts.mjs` 当前是 **通过** 的。
问题不在「没管」，而在**政策的覆盖面太窄**——它只管自己列的那 17 个目录 + 21 个文件，
清单之外的过程文档从来没有被判定过。

---

## 一、分片 listing

### 第 1 档：高置信，可直接取消跟踪（零引用 + 长期未动）

判据：既没有被产品代码/CI/任何脚本引用，也没有被其他文档引用（已排除同目录 README 自引用），
且最后一次改动距今 > 60 天。

| 区域 | 文件数 | 体积 | 零引用数 | 中位年龄 | 处置建议 |
|---|---|---|---|---|---|
| `.design-staging/` | 28 | 0.6 MiB | **27** | 61 天 | 整目录移出。政策已把 `verse-hero/` 列为本地专用，剩下 27 份是同一批 UI 设计稿，性质完全相同 |
| `team/` | 55 | 0.8 MiB | **50** | 88 天 | 保留 `role-architecture-design/area-4-role-memory-completion.md`（唯一被代码真引用的），其余移出 |
| `reports/`（非 localOnly 部分） | 117 | 4.0 MiB | **105** | 26 天 | 保留 9 个被硬引用的 ground-truth / holdout manifest（DCS 评测输入），其余移出 |
| `docs/` | 458 | 14.3 MiB | **421** | 54 天 | 分批：`docs/superpowers/plans/`（历史计划）和一次性审计报告优先 |
| `artifacts/` | 1,820 | 49.8 MiB | **1,189** | 81 天 | 见第 2 档，体积最大的一块 |

`team/` 的具体情况（你点名的那个）：

- 55 个文件里，**只有 1 个**真正被产品侧引用
  （`team/role-architecture-design/area-4-role-memory-completion.md`）。
- 另外 4 个「被引用」是 `README.md` / `STATUS.md` 这类通用名造成的**假阳性**——
  它们出现在代码里是因为别处也有同名文件，不是引用了 team 这一份。
- `team/dcs/dcs-v1.0 → v1.6.1` 共 8 版 spec + review（产物共 ~1.2 万行），是版本迭代的历史层。
  政策文件明确写「`team/dcs/` 的**当前规范**仍保留」——也就是说 v1.0~v1.5 这批旧版本属于应当归档的部分。
- `team/claude/ke-program/`、`team/fable5-*.md`、`team/codegraph-role-architecture.md`
  是零引用的规划稿，可以直接归档。

### 第 2 档：体积大，但必须逐批确认

`artifacts/` 19024 个文件里它占 1,820 个 / 49.8 MiB，是当前最大的过程证据区。
**不能整目录处理**，原因有三：

1. `scripts/repository-artifacts.json` 的 `requiredInputs` 明确保护了其中一批
   （RC-01 baseline、RC-10 最终验收、能力声明表、runtime-test-integrity 等）；
2. 一批 `scripts/*.mjs` 会**按硬编码路径读写**它，例如
   `scripts/agent-dev-audit.mjs` 读 `artifacts/agent-dev-*/report.json`、
   `scripts/build-showcase-package.mjs` 写 `artifacts/showcase-<date>/`；
3. 部分目录已在 `localOnlyDirectories` 中（虽有 git 记录，但已在政策内）。

建议按**任务批次**处理：以 `artifacts/<任务名>/` 为最小粒度，任务已收口且无 `requiredInputs`
命中的批次整体移出。已完成的批次可直接识别，例如 `windows-alpha-closeout-20261008`、
`coding-prod-*` 系列、`tf0013-*` 系列。

### 第 3 档：不建议删除，属于结构问题

| 区域 | 文件数 | 体积 | 说明 |
|---|---|---|---|
| `resources/` | 421 | 57.2 MiB | 品牌与图标资源。但 `resources/icons/clawx-logo-kit/` 里 5 份 PNG 均为 **1,774 KiB**、2 份 `.icns` 均为 **2,803 KiB** —— 同一张图的重复导出，约 14 MiB 纯冗余，值得做去重而非删除 |
| `public/lobe-icons` | 910 | 0.9 MiB | 第三方图标集，被前端引用，正常 |
| `harness/specs/` | 542 | 3.2 MiB | **见下方诚实标注** |
| 4 份 README（en/ja/ru/zh） | 4 | 0.1 MiB | 本地化产物，保留 |

**诚实标注 —— 关于 `harness/specs/` 的 388 个零引用**：
`AGENTS.md` 声明 `harness/specs/**` 是持久化治理真源，而 `harness/src/cli.mjs` 是
**显式 `--spec <path>` 驱动**（不是 glob 发现），所以「零引用」确实成立。
但这些 spec 很可能对应**已完成或已废弃的任务节点**，而不是垃圾。
在没逐个核对任务收口状态之前，**不建议动这一批**——删掉历史任务的验收规范会破坏可追溯性。

---

## 二、「过时测试」这条结论被证伪了，需要更正

我按你的要求去查了过时测试，结果和预期相反，必须如实报告：

- 项目记忆里原本写着「至少三个测试文件没有被任何脚本引用」
  （`context-engine/memory-injection-receipt.read.test.ts`、`context-candidate.test.ts`、
  `context-orchestrator.test.ts`）。
- **这条记录是错的**。实测 `node scripts/run-vitest.mjs list --config test/vitest/vitest.unit.config.ts`
  输出 114 个文件，**这三个全在 `[unit]` 选中列表里**，CI 的 `pnpm test:unit` 会跑到它们。
- 原因：`vitest.unit.config.ts` 的 include 是 glob（`src/**/*.test.ts` 等），
  exclude 有 29 条。这三个不在任何 exclude 里，因此一直是被执行的。
- 进一步全量核算：openclaw_runtime 共 **396** 个测试文件，`test:unit` 覆盖 186 个
  （114 + unit-fast 72），其余 **210 个由 `pnpm test` 的 project 矩阵覆盖**
  （`test-projects.mjs` 走 `vitest.config.ts` 的全量 project 列表）。**没有发现孤儿测试。**

也就是说：**测试层面的真问题是「跑得慢/分片多」，不是「有死测试」。**
（396 个测试散在 130+ 个 vitest config 里，`test:unit` 又用显式 exclude 把 282 个划给了别的 shard——
这套分片机制本身是结构债，但不是删除债。）

唯一值得确认的例外：`tests/e2e/` 154 个 spec 只在 PR/push 到 `main` 时由
`electron-e2e.yml` 执行（单批约 51 分钟、超时上限 90 分钟），`check.yml` 不跑。
这是覆盖缺口，但这属于 CI 策略，不是文件该不该留的问题。

---

## 三、结构为什么乱

### 3.1 证据

1. **根目录摊得过平**：36 个根文件 + 26 个可见顶层目录 + 19 个隐藏目录。
   根上散着 `send-button-states-design.md`、`clawx-extensions.json`、
   `vitest.runtime-effectiveness.config.ts` 这类本该归类存放的东西。
2. **五种以上 AI 工具各留私域**：
   `.claude/` `.codex-tools/` `.trae/` `.zcode/` `.ae/` `.reasonix/` `.parity-audit/`
   `.design-staging/` `.workbuddy/` —— 其中 `.design-staging/`（28 个文件）**已经进 git 了**。
3. **六套并行文档体系，职责重叠**：

   | 目录 | 宣称职责 | 实际内容 |
   |---|---|---|
   | `docs/` | 产品文档 | 458 个，其中 `docs/dev/` 330 个全是过程沉淀 |
   | `harness/specs/` | 持久治理真源 | 542 个，含大量已完成任务的历史 spec |
   | `plans/` | 规划 | 118 个任务状态 + 门禁配置混在一起 |
   | `team/` | 团队协作 | 55 个纯规划稿 |
   | `reports/` | 报告 | 117 个，评测数据与一次性审计混在一起 |
   | `artifacts/` | 运行证据 | 1,820 个，21 个任务批次的全部中间产物 |

   同一个东西可能有四份：`team/dcs/dcs-v1.6-spec.md`（规格）、
   `harness/specs/tasks/dcs-stage3-tool-registry.md`（任务）、
   `artifacts/system-maturity/P6-005/…`（证据）、`docs/dev/dcs-visible-production/STATUS.md`（状态）。
4. **产物落点不统一**：`artifacts/` `reports/` `jobs/` `output/` `test-results/`
   `playwright-report/` `tmp/` `.tmp/` `_tmp_<hash>` `%SystemDrive%/` 九处。
   好消息：只有前四个进了 git，后面几个已被 gitignore。
   （`%SystemDrive%/` 是个彩蛋：某脚本把 Windows 环境变量当字面路径建了目录，没入库。）
5. **分支未收口**：本地 83 个分支、远端 17 个分支，绝大多数是 `codex/*` 单任务分支。

### 3.2 建议的目标结构

不要一次性重写目录（代价高、风险大），建议**只做归口 + 入口隔离**：

```
src/  electron/  shared/           产品源码，不变
openclaw_runtime/                  运行时子项目（有自己的 package.json），不变
harness/specs/                     唯一的持久规则真源（rules/ layers/ scenarios/ 保留，
                                   已完成任务 spec 移入 harness/specs/tasks/archive/）
docs/                              对外生效文档；docs/dev/ 只留当前仍被引用的设计文档，
                                   其余移入 archive-evidence/
evidence/                          【新增，gitignored】统一承接 artifacts/ reports/ jobs/ output/
plans/  team/                      移出仓库或归入 evidence/
```

关键动作是把 `evidence/` 做成**唯一**的产物落点并加进 `.gitignore`，
而不是每次清理时再去逐个目录判生死。当前做法是「清理一次、往名单里加一批」，
边界只会越拖越长，下一轮还得重新判断一遍。

---

## 四、可执行的处置命令（未执行，等你确认）

仓库 2026-10-03 已经做过一次同类清理，留下了可直接复用的模式：
**外部备份 → `git rm --cached` 取消跟踪 → 更新 `scripts/repository-artifacts.json`**。
取消跟踪**不会删除本机文件**，也不会抹掉 git 历史。

推荐顺序：

```sh
# 0. 先确认基线是干净的
node scripts/check-repository-artifacts.mjs

# 1. 备份到仓库外部（与既有 ../repository-artifact-cleanup-20261003/ 同级）
#    本机副本不丢，这是安全前提

# 2. 第 1 档：取消跟踪（示例，逐目录做，不要一次全跑）
git rm -r --cached .design-staging
git rm -r --cached team/claude
git rm -r --cached reports/context-compression
git rm -r --cached docs/superpowers/plans

# 3. 把同类路径写进 .gitignore 和 scripts/repository-artifacts.json 的
#    localOnlyDirectories，让 check 脚本能守住新边界

# 4. 复跑门禁
node scripts/check-repository-artifacts.mjs
```

**我没有执行以上任何删除/取消跟踪动作**，本次只做定位与清单。

---

## 五、本次审计产出的机器可读清单

| 文件 | 内容 |
|---|---|
| `.audit/tracked-files.csv` | 19,024 个已跟踪文件的体积 + 最后被改的 commit |
| `.audit/orphans3.json` | 各区域 hard/cross/orphan 引用分类明细 |
| `.audit/runtime-tests-not-run.txt` | openclaw_runtime 中被 unit exclude 的 282 个测试（**仅供参考，非死测试**） |

这些是本机分析产物，未入库。如需保持工作区干净，把 `.audit/` 加进 `.gitignore` 即可。
