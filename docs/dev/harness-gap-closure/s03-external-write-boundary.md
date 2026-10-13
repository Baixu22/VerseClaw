# S03：工作区外写入的来源与路径边界（核验）

日期：2026-10-13（Asia/Shanghai）。包码：S03（TF-0278）。真实 provider 调用：无。

## 链路（source → policy → effect）

- 生产接线：`openclaw_runtime/src/agents/agent-tools.ts` 为 write / edit / apply_patch 统一包一层 `wrapToolWithWorkspaceExternalWriteProvenance`。
- 策略：`openclaw_runtime/src/agents/workspace-external-write-provenance-policy.ts`（`resolveWorkspaceExternalWritePolicy`）——external/derived-untrusted/missing/invalid 来源对**解析后在工作区外**的目标拒绝；in-workspace 学习写不受影响；trusted system / direct operator 保留既有外写语义。
- 别名/路径：复用既有 `infra/fs-safe` 与 `sandbox-paths`，对已存在祖先做 canonical 解析（symlink / junction / hardlink 逃逸按外部目标处理）。

## 覆盖矩阵（真实文件系统）

| 形式 | 来源 | 期望 | 断言的证据 |
|---|---|---|---|
| 工作区外绝对路径 | external/derived/invalid/missing | 拒绝 | 抛 `external or unknown provenance`；文件仍为 `original\n` |
| 父目录逃逸 `..` | external | 拒绝 | 同上 |
| win32 大小写变体 | external | 拒绝 | 同上 |
| 已存在别名 symlink/junction | external | 拒绝 | 同上 |
| in-workspace 硬链接别名 | external | 拒绝 | 同上 |
| 工作区外绝对路径 | trusted system / direct operator | 允许 | 写入成功、内容精确一致 |
| in-workspace 写 | external/missing | 允许 | 既有学习写语义不变 |

write / edit / apply_patch 三种动作都覆盖（`it.each(["write","edit","apply_patch"])`）。

## 残余（显式记录，不冒充已覆盖）

- **UNC / device-namespace 路径**（如 `\\server\share\...`）：本机无法确定性触发真实写入，未作为断言覆盖；策略层按“非工作区内”仍会拒绝，但**未实测**，记为 residual。
- 本包**不**新增 EffectReceipt 断言；合法的受控外写沿用既有 journal/recovery 语义（本包不改写/编辑/补丁的执行路径）。
- 不是“全网强制”：仅覆盖 runtime 编码类 write/edit/apply_patch 出口。

## 边界与不做项

- 不新建第二套 external-write 策略或动态 taint 引擎；不改 in-workspace 写语义、sandbox、journal、回滚。
- 不改产品默认值/锁/approval；非真人证据。
