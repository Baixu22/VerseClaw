# 分支与工作树地图 (BRANCH-MAP)

> 生成于 2026-07-09。用途:在多分支/多工作树并行开发下，固定「主线在哪、UI 以谁为准、各分支关系」，避免迷失与误删。
> 这是一份**诊断快照**，不是自动更新文档。结构变动后请手工刷新。

## TL;DR

- `main` 停在 2026-06-20，**所有分支都从它分叉、无一回流** → main 名存实亡，真正的主线不叫 main。
- 运行时侧是一条**线性脊柱**（层层包含、零重复）。
- UI 侧 **`knowledge-ux-polish` 是绝对主干**（58 个 UI 文件、Knowledge 页近乎重写）；其它分支只是零星碰 UI。
- 两条主干从 2026-06-26 后各跑各的，**直接 merge 会炸出 42 个冲突** → 收口必须挑拣，不能盲合。

## 运行时脊柱（线性包含，可安全推进）

从 `main` 分叉后，运行时分支构成一条干净的包含链，箭头表示「⊆ 被包含于」：

```
main (8103206de, 2026-06-20)  ← 假主线，停滞
  └─ codex/context-engineering (253493a29, 06-26)   ← 所有分支的公共基础
       ├─ codex/runtime-intensity-v1
       │    └─ codex/runtime-token-savings-v2
       └─ role-first-p0-verify (3d9f110a2)
            └─ codex/sekb-runtime-knowledge (bfa70b1d5)   ← 运行时脊柱顶端
```

- `codex/sekb-runtime-knowledge` 曾与 `codex/runtime-substrate-lifecycle` 内容等价（互为祖先）。
- **注意**：`runtime-substrate-lifecycle` 工作树里原有 ~1100 行未提交的新工作（runtime-spine 子系统），
  已于 2026-07-09 落袋到新分支 **`codex/runtime-family-unification-v1`** (f2feb63d1)。该工作树现指向此新分支。
- `role-first-p0-main` / `role-first-p0-verify` 是 role-first 的两条并行线，均 ⊇ context-engineering。

### 工作树对照

| 工作树目录 | 分支 | 角色 |
|---|---|---|
| `ClawX` | codex/sekb-runtime-knowledge | 运行时脊柱顶端（主工作树） |
| `ClawX-context-engineering` | codex/context-engineering | 公共基础 |
| `ClawX-knowledge-ux-polish` | knowledge-ux-polish | **UI 主干** |
| `ClawX-p0-main` | role-first-p0-main | role-first 主线 |
| `ClawX-p0-verify` | role-first-p0-verify | role-first 验证线 |
| `ClawX-phase16-verify` | codex/phase16-verify | phase16 验证 |
| `ClawX-runtime-substrate-lifecycle` | codex/runtime-family-unification-v1 | runtime-spine 新工作（已落袋） |

## UI 主线判定（关键）

两条 UI 线共同祖先 = `context-engineering` (253493a29, 06-26)。此后各自改动：

| 文件 | knowledge-ux-polish (A) | sekb-runtime-knowledge (B) | 主力 |
|---|---|---|---|
| `src/pages/Chat/index.tsx` | +619 / -101 | +124 / -51 | A 大改，B 注入运行时 |
| `src/pages/Knowledge/index.tsx` | +2149 / -103 | +179 / -5 | A 近乎重写 |
| `src/stores/chat.ts` | +177 | 未改 | 仅 A |
| `src/pages/Skills/index.tsx` | +655 | 未改 | 仅 A |
| `src/pages/Settings/index.tsx` | +142 / -66 | 未改 | 仅 A |
| `src/pages/Observability/index.tsx` | +171 / -35 | 未改 | 仅 A |
| `src/stores/update.ts` | 删除 (-192) | 未改 | 仅 A |

**结论：UI 最新正确策略 = `knowledge-ux-polish`。** 它是 UI 唯一主干；sekb 只在 Chat / Knowledge
两个文件注入了运行时相关的少量改动。收口时以 A 为 UI 基准，只把 B 在这两个文件里的运行时片段挑进来。


## 亡羊补牢三步计划

### 第一步 · 止血（已完成 2026-07-09）
- [x] 抢救 substrate-lifecycle 工作树里 ~1100 行未提交工作 → `codex/runtime-family-unification-v1`
- [x] 生成本地图文档
- 结论：无重复工作树需删除（原以为重复的那个其实藏着新工作）

### 第二步 · 重建主线（待批准，需动 main）
- 将运行时脊柱线性合入 main：`main ← context-engineering ← … ← sekb-runtime-knowledge`
- 该链线性包含，**预期零冲突**。合并后 main 重新成为真主线，追平运行时最新。
- 不碰 UI，安全。

### 第三步 · 收口 UI（待批准，需专注）
- 以 `knowledge-ux-polish` 为 UI 基准，**禁止整体 merge sekb**（实测 42 冲突）。
- 仅将 sekb 在 `Chat/index.tsx`、`Knowledge/index.tsx` 的运行时片段 cherry-pick / 手工挑入。
- 待第二步 main 前移后，让 `knowledge-ux-polish` rebase 新 main，剩余冲突将因共同基础前移而收敛。

## 验证方法备忘（复现本诊断）

```bash
# 每个分支相对 main 的分叉点
for b in <branch>; do git merge-base main $b; done
# 分支包含关系
git merge-base --is-ancestor A B && echo "A ⊆ B"
# 干跑合并预演冲突（临时分支，零副作用）
git branch -f _t knowledge-ux-polish && git worktree add /tmp/t _t
cd /tmp/t && git merge --no-commit --no-ff sekb; git diff --name-only --diff-filter=U
git merge --abort; cd -; git worktree remove /tmp/t --force; git branch -D _t
```

