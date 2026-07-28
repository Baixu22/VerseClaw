# FP-P2-07 slice 2 evidence - patch/error contract and compatibility policy

| item | value |
|---|---|
| 收账日期 | 2026-07-28 |
| slice | 2 - `GitPatchArtifact/v1`、`RemoteForgeError/v1` 与兼容策略 |
| shared authority | `shared/types/remote-forge.ts` |
| compatibility | exact `/v1` discriminator；v1 additive fields accepted；unknown enums/new schemas fail closed |
| patch scope | 一个 artifact 表示一个 changed-file observation；多文件结果使用有序数组 |
| completeness | `complete` / `truncated` / `unavailable` 严格区分；unknown 不得伪装 complete |
| line/path safety | hunk old/new 行号逐行连续映射；仓库相对 POSIX path，拒绝绝对路径、反斜杠和 traversal 段 |
| error safety | 固定 code、retryability、requestId、可选 HTTP status、bounded single-line safe message |
| focused verification | 1 file / 10 tests；独立 strict TypeScript 通过 |
| baseline verification | contract、i18n、Harness structural validate 通过 |
| runtime scope | 无 consumer 迁移、无 UI/host-api 变化、无远端 read/write；Electron E2E 留给后续 consumer slice |
| task state | `FP-P2-07 in_progress`；下一切片是 parser/adapter |

## Contract result

`GitPatchArtifact/v1` 是单个文件的只读观察，不是 mutation authority。它固定 file/status/path/content/hunk/line/completeness/lineage 语义，并由 strict decoder 锁定：

- writers 必须发 exact schema；readers 允许 v1 additive fields，但拒绝 unknown enums 与其他 schema；
- `unavailable` 不携带 hunk 或 patch body；non-complete 和非文本 observation 必须有解释；
- complete text 必须有 hunk，逐行 old/new ownership 从 declared start 连续推进，且 observed counts 与 declared counts 完全一致；
- truncated prefix 仍需可信的连续行映射，但不得把不完整 counts 修复成 complete；
- binary/metadata 不构造假 hunk；rename/copy 必须有不同的 old/new path；
- `file`、`oldPath`、`newPath` 只接受规范仓库相对 POSIX 路径。

`RemoteForgeError/v1` 固定安全错误 envelope。Decoder 拒绝 unknown code、unsupported schema、非法 HTTP status、空白包围或含控制字符/换行的 message。原始 provider body、credential 和 private-host redaction 继续由 producer 层负责，未在本切片伪造 producer 安全保证。

## Compatibility result

[`REMOTE-FORGE-CONTRACTS.md`](../../../docs/dev/first-product-controlled-preview/REMOTE-FORGE-CONTRACTS.md) 记录现有 producer 到唯一 v1 contract 的迁移矩阵：

- local `GitDiffResult` 必须与可信 status 合并；`tooLarge=true` 只能降级为 unavailable；
- Code Review 的 truncated 状态优先于可解析前缀；零 finding 不代表完整；
- diff extension 的 parser success 不覆盖 producer completeness；
- DCS edit/write 必须复用同一 request/mutation/journal lineage，write precheck 不能冒充真实 diff；
- Remote Forge 分页失败、缺 head SHA、stale state 和 unknown provider field 一律 fail closed。

本地 Git authority 仍是 `electron/services/git-api.ts`；文件 mutation、snapshot、recovery、undo 仍归 Coding write journal。没有新增第二 local Git service、patch schema 或 write journal。

## Gate interpretation

- G1 dev：**partial**。shared contract/decoder 和兼容矩阵已完成；parser/adapter、consumer、rich diff、producer redaction 尚未完成。
- G2 test：focused 10 tests、standalone strict TypeScript、contract、i18n、Harness structural validate 通过。完整命令与 blocker 见 [`slice-2-gates.log`](./slice-2-gates.log)。
- G3 runtime：n/a for slice 2；无 runtime consumer 或 UI 行为变化。
- G4 human：n/a；这是 pre-canary engineering，不是 controlled canary。
- G5 accept：未满足；`FP-P2-07` slices 3-6 仍待完成。

## Residuals

- Slice 3 实现标准化 parser/adapter，覆盖 bare/malformed hunk、CRLF、binary、metadata、rename、truncated/unavailable 和 bounded fallback。
- Exact MergeBeacon parent SHA 与该 commit 的 NOTICE 状态仍未解析；`directSourceCopyAllowed=false` 保持不变。
- 主工作树 canonical Harness 仍会纳入数百个无关脏文件；未扩大 `touchedAreas` 伪造通过。
- 全仓 lint 的两个既有 BOM 和根依赖命令链接缺失不在本切片授权范围；未修改无关文件或依赖清单。
- 本目录 artifact 继续被 `artifacts/*` 忽略且未跟踪；正式 change set 前必须显式纳入并复核可交付性。
