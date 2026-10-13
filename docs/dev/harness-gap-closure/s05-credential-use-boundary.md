# S05：模型/provider 覆盖选择的凭据使用约束（台账）

日期：2026-10-13（Asia/Shanghai）。包码：S05（TF-0280）。真实 provider 调用：无。

## 链路（source → policy → effect）

- 调用点：`openclaw_runtime/src/agents/tools/image-generate-tool.ts` —— **仅**在“显式 model/provider override”分支调用 `resolveProviderCredentialUsePolicy`（调用处 `hasExplicitModelOverride: true`）。
- 策略：`openclaw_runtime/src/agents/tools/provider-credential-use-policy.ts`（`resolveProviderCredentialUsePolicy`）。
- 语义：external / derived-untrusted / missing / invalid 来源 + 显式 override 时，请求的 provider 必须落在 **host 已配置/绑定的 image 生成 provider 范围**内；否则拒绝。策略输入里**没有**凭据值，凭据从不是该判定的输入。

## 覆盖矩阵

| 来源 | 显式 override | 请求 provider | 期望 |
|---|---|---|---|
| trusted system / direct operator | 任意 | 任意 | 允许（既有语义不变） |
| external/unknown | 无 | — | 允许（未显式 override，走默认/fallback，不经该闸门） |
| external/unknown | 有 | 绑定范围内 | 允许 |
| external/unknown | 有 | 绑定范围外 | **拒绝** |
| external/unknown | 有 | 缺失 / 非法 | **拒绝** |

拒绝发生在读取任何 provider 凭据之前；拒绝原因与凭据无关（只含 provider 范围说明）。

## 残余（residual，显式记录，不冒充已覆盖）

- 该闸门**只**接在 `image-generate-tool.ts` 的显式 override 分支；其它凭据使用路径（例如聊天模型 override、其它 provider 凭据消费方）**未**由本策略覆盖。
- 调用处把 `hasExplicitModelOverride` 写死为 `true`（该分支本身就是显式 override），因此策略的“无 override 放行”分支在 image-generate 侧不由生产调用点触发，仅在单测覆盖。
- 本台账只覆盖 image 生成的 provider override 选择；不覆盖密钥存储/轮换/泄露面。

## 边界与不做项

- 不新建第二套凭据策略；不改默认 provider、fallback 或凭据存储；不改产品默认值/锁/approval。
- 非真人证据；无真实 provider 调用。
