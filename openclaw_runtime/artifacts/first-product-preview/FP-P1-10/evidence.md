# FP-P1-10 evidence — 逐 flag configSource 归因

| item | value |
|---|---|
| 收口日期 | 2026-07-27 |
| 单测 | `runtime-flag-attribution.test.ts` **8 passed**；既有 `runtime-flag-ack.test.ts` **17 passed** 零修改 |
| E2E | 复用 `dcs-preview-optin-fp-p1-03.spec.ts`（真 Settings DOM + 真 child）**1 passed (1.2m)** |
| lint:dcs | exit 0 |

## 问题（源自 FP-P0-04 残留）

`configSource` 只回答「这个 child 读了哪份配置文件」（path / exists / origin），
**没有 flag 维度**。后果是三种运行状况在 ack 里长得一模一样：

- 某 flag 是 `false`，因为**运维显式写了 false**
- 某 flag 是 `false`，因为**根本没人设过**（吃默认）
- 某 flag 是 `false`，因为**kill switch 强制压平**（运维明明写了 true）

第三种最要命：用户打开了预览开关却不生效，ack 只显示一个裸 `false`，无从判断。

## 实现

`resolveEffectiveRuntimeFlagsWithSources()` 与 flags 同源产出 `attribution`，
四种 origin：`env` / `config` / `default` / `kill`，并给出决定该值的 env 变量名或 config 路径。

`resolveEffectiveRuntimeFlags()` 保留为薄封装，既有调用点零改动。
`flagAttribution` 作为**新增字段**进 ack payload，**未**加入 `RUNTIME_FLAG_ACK_REQUIRED_FIELDS`
—— 不改动 FP-P0-04 的七字段 applied 契约（旧 child 不会因缺该字段被判 rejected）。

关键实现点：`readContextBlockFlagConfigured` 返回 `boolean | undefined`，
把「配置里写了 false」与「配置里没有」区分开 —— 原 `readContextBlockFlag` 直接
fallback 到默认值，这个信息在返回时就被丢掉了。

## 真 child 输出（E2E，预览开关关闭后）

```
[fp-p1-10-attribution]
 "runtime.contextBlock.compass.enabled":      {"value":false,"origin":"default"}
 "runtime.contextBlock.role_memory.enabled":  {"value":false,"origin":"default"}
 "runtime.contextBlock.working_memory.enabled":
     {"value":false,"origin":"config","key":"runtime.contextBlock.working-memory.enabled"}
 "runtime.contextBlock.tool_registry.enabled":
     {"value":false,"origin":"config","key":"runtime.contextBlock.tool-registry.enabled"}
 ...
```

**同为 `false`，来源不同** —— compass 是没人设过，working_memory 是预览开关显式写的 false。
这正是 `configSource` 永远答不了的问题。

## 断言不是「回显 value」的证明

E2E 除了逐 flag 校验 `attribution[name].value === effectiveFlags[name]` 与
origin ∈ 四类之外，还断言**具体来源**：

```ts
expect(attribution?.['runtime.contextBlock.working_memory.enabled']?.origin).toBe('config');
expect(attribution?.['runtime.coding.staleWriteGuard.enabled']?.origin).toBe('config');
```

若归因退化为「照抄 value」，这两条会失败（它们会变成 `default`）。

单测另覆盖：kill 覆盖 ON flag → `origin:"kill"`（非裸 false）；
env 面 → `origin:"env"` 且带变量名；kill switch 自身区分 env 与 config 来源；
以及「每个 effective flag 都必须有归因」的全覆盖守卫。

## 门禁判定

- G1 dev：纯增量读侧字段；未改任何 flag 的解析结果（旧函数为薄封装）；未进 REQUIRED_FIELDS 故不破 ack 契约；lint:dcs 过。
- G2 test：8 新单测（四种 origin + 全覆盖守卫）+ 既有 17 单测零修改全绿 + 真 child E2E。
- G3 runtime：真 gateway child 返回逐 flag 归因，且 default/config 区分度实证。
- G4 human：n/a，真人观感并入 FP-P1-03。
- G5 accept：self-accept；AC 逐条有指针。
