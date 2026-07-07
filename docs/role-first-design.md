# Role-First 实际设计体现

> 本文档基于本地代码实现撰写,所有结构、字段、流程均可在仓库中溯源。文末附"边界自检"章节,列出可交付给 agent 用于判定设计边界的关键代码锚点。
>
> 范围:角色定义、设计层面、角色记忆层级、多 agent 协作中的角色定位、交互层面。

---

## 1. 总览:什么是 Role-First

ClawX 的 role-first runtime 让用户不再只是"选一个模型",而是**组合并编排一支由角色驱动的 agent 团队**。这里的"角色"不是 persona(不是"你是 20 年经验的专家"),而是一份**任务契约(RoleContract)**:它规定角色的职责边界、可用工具、权限、努力等级、输出格式、交接对象。

整个 role-first 体系由六个互相独立但协作的子系统组成:

| 子系统 | 代码锚点 | 职责 |
|---|---|---|
| 角色契约 | `openclaw_runtime/src/agents/role-contract.ts` | 定义、校验、编译角色 |
| 角色注册表 | `openclaw_runtime/src/agents/role-registry.ts` | 内置 + 配置角色合并 |
| 角色派生 | `openclaw_runtime/src/agents/role-spawn.ts` | 契约 → 真实 subagent 运行 |
| 角色记忆 | `openclaw_runtime/src/memory/*.ts` | 角色作用域的记忆控制平面 |
| 编排协议 | `openclaw_runtime/src/agents/orchestrator*.ts` | 多角色协作的规划与执行 |
| 交互面板 | `src/components/agents/RolesOrchestrationPanel.tsx` | 用户操作入口 |

---

## 2. 角色的定义(Role Contract)

### 2.1 契约字段

角色定义在 [role-contract.ts](file:///c:/Users/27933/Desktop/clawx/ClawX/openclaw_runtime/src/agents/role-contract.ts) 中,`RoleContract` 是唯一的角色真相源:

```typescript
export type RoleContract = {
  name: string;              // kebab-case 标识符
  displayName: string;
  description?: string;
  rolePrompt: string;        // 职责描述,非 persona
  tools: string[];           // 硬白名单
  capabilities?: string[];   // 角色能力声明
  toolRequirements?: string[];// 运行所需工具
  riskProfile?: "low" | "medium" | "high" | "critical";
  canModifyScope?: boolean;
  permissions: RolePermissions;
  model: RoleModelBinding;
  effort: RoleContractEffort;
  outputSchema: RoleOutputSchema;
  handoff: RoleHandoffRules;
  version?: string;
  tags?: string[];
};
```

关键设计取舍:

- **`rolePrompt` 是契约不是人设**:它定义"做什么、不做什么、输出什么形状",不定义"你是谁"。
- **`tools[]` 是真白名单**:非空时,任何未列出的工具都被拒绝(详见 §3.2)。
- **`handoff` 显式声明交接对象**:`to` / `from` 数组 + `requiresReview` 标志,构成角色间的合法流转图。
- **`outputSchema` 约束输出形状**:`format` (markdown/json/text) + `sections[]`,被编译进 SOUL。

### 2.2 八个内置角色

[BUILT_IN_ROLE_CONTRACTS](file:///c:/Users/27933/Desktop/clawx/ClawX/openclaw_runtime/src/agents/role-contract.ts#L230-L359) 定义了 8 个内置角色,每个都是一个完整的契约实例:

| 角色 | effort | 文件系统 | 网络 | 工具 | 交接给 | 接收自 |
|---|---|---|---|---|---|---|
| `planner` | high | read | none | read, glob, grep | architect, implementer | — |
| `architect` | high | read | none | read, glob, grep | implementer, reviewer | planner |
| `implementer` | medium | write | none | read, write, edit, bash | tester, reviewer | planner, architect |
| `tester` | medium | read | none | read, bash | reviewer, skeptic | implementer |
| `reviewer` | high | read | none | read, glob, grep | implementer, skeptic | tester |
| `security-reviewer` | xhigh | read | none | read, glob, grep | skeptic, implementer | planner, reviewer (requiresReview) |
| `docs-writer` | medium | write | none | read, write, edit | reviewer | implementer |
| `skeptic` | high | read | none | read, glob, grep, bash | implementer, reviewer | tester, security-reviewer (requiresReview) |

观察:`security-reviewer` 和 `skeptic` 的 `handoff.requiresReview = true`,意味着它们的交接必须经过评审,不能直接闭环。

### 2.3 SOUL 编译

[compileRoleContractToSoul()](file:///c:/Users/27933/Desktop/clawx/ClawX/openclaw_runtime/src/agents/role-contract.ts#L207-L226) 把契约编译成一段 SOUL 风格的系统提示:

```
# Planner

Plan the work, identify dependencies, split tasks, and define acceptance criteria before execution.

Role contract: planner
Tools: read, glob, grep
Capabilities: task-analysis, planning, multi-file-coordination
Risk profile: medium
Filesystem: read; Network: none
Effort: high
Output: markdown
Output sections: Goal, Plan, Risks, Acceptance
```

这份编译产物在派生时被注入到 subagent 的 `roleSystemPrompt`,同时也是 UI 上 "View contract" 按钮返回的内容(`roles.get` RPC)。

### 2.4 自定义角色

自定义角色通过配置 `cfg.agents.roles[]` 注入,[role-registry.ts](file:///c:/Users/27933/Desktop/clawx/ClawX/openclaw_runtime/src/agents/role-registry.ts) 处理合并:

- 解析顺序:内置 → 配置(配置同名时覆盖)
- 配置项接受 snake_case 或 camelCase(`normalizeRoleContract` 双向兼容)
- 无效配置项被跳过并记入 `issues`,不抛错——一个坏角色不会阻塞整个注册表
- `validateRoleContract` 强制 `name` 必须是 kebab-case、`rolePrompt` 至少 12 字符、工具名必须是合法标识符

---

## 3. 设计层面:Contract-First 的硬约束

### 3.1 契约优先的设计哲学

role-first 的核心设计选择是**契约即边界,边界即硬约束**。这体现在三个层面:

1. **工具是硬白名单**:`role.tools[]` 非空时,未列出的工具在模型看到之前就被过滤掉,不是建议。
2. **权限是硬拒绝**:[role-permissions-policy.ts](file:///c:/Users/27933/Desktop/clawx/ClawX/openclaw_runtime/src/agents/role-permissions-policy.ts) 把 `permissions` 编译成工具拒绝列表,合并进 `inheritedToolDenylist`。
3. **能力缺口被记录而非绕过**:角色缺少所需能力时,runtime 记录 `capabilityGaps`,而不是悄悄扩大权限。

### 3.2 权限 → 拒绝列表的映射

[buildRolePermissionDenyList()](file:///c:/Users/27933/Desktop/clawx/ClawX/openclaw_runtime/src/agents/role-permissions-policy.ts#L44-L94) 的完整映射:

| 权限字段 | 值 | 拒绝的工具 |
|---|---|---|
| `filesystem` | `none` | 全部文件系统工具 + shell (read, glob, grep, write, edit, apply_patch, team_orchestrate, task_loop, mission_loop, exec, bash) |
| `filesystem` | `read` | 写工具 + shell (write, edit, apply_patch, team_orchestrate, task_loop, mission_loop, exec, bash) |
| `filesystem` | `write`/`admin` | 无额外拒绝 |
| `network` | `none` | web_search, web_fetch, x_search, code_execution, browser |
| `network` | `limited` | x_search, code_execution, browser(允许 web_search/web_fetch 只读检索) |
| `network` | `full` | 无拒绝 |
| `commands: []` + 只读 fs | — | shell 工具(额外保险) |

拒绝列表是**加法**的——只拒绝,从不授予超出 `tools[]` 白名单的能力。

### 3.3 Effort → Thinking 映射

[role-effort.ts](file:///c:/Users/27933/Desktop/clawx/ClawX/openclaw_runtime/src/agents/role-effort.ts) 把 7 级 effort 映射到 subagent thinking 级别:

```
auto → adaptive    minimal → minimal    low → low
medium → medium    high → high          xhigh → xhigh    max → max
```

`auto` 没有对应的 thinking 级别,解析为 `adaptive`(由 runtime 自行决定)。

### 3.4 注册表的容错合并

[buildRoleRegistry()](file:///c:/Users/27933/Desktop/clawx/ClawX/openclaw_runtime/src/agents/role-registry.ts#L51-L85) 的合并策略保证:

- 内置角色永远可用(配置缺失也能跑)
- 配置覆盖是按名字的(同名即覆盖,不合并字段)
- 校验失败的角色被记入 `issues` 数组返回,不阻塞其他角色加载
- `configRoleNames` 字段记录哪些名字来自配置,便于 UI 区分

---

## 4. 角色的记忆层级

### 4.1 控制平面 vs 原生内存的硬边界

role-first 记忆是一个**控制平面**,叠加在原生 OpenClaw 内存栈之上,**不替换也不修改**原生内存。这条边界在代码中是多处强制的:

| 维度 | Role Memory(控制平面) | Native Memory(原生) |
|---|---|---|
| 存储 | `<stateDir>/role-memory.sqlite` | memory-core 索引、MEMORY.md、QMD、dreams |
| 写入 | 必须经过 gatekeeper 提案评审 | memorySearch 直接读写 |
| 读取 | spawn 时按角色注入 Context Pack | 全局检索 |
| 修改原生 | **禁止**(只读引用 evidence) | — |

`isRoleMemoryEnabled()` 是全局开关(Settings → System),关闭时:
- `role-spawn` 不解析也不注入记忆卡
- 不写 injection explain 记录
- 变更类 `memory.*` RPC 返回显式 disabled 错误
- 读类 RPC 返回空/disabled 状态
- 磁盘上的 `role-memory.sqlite` 保留不动,原生内存也不变

### 4.2 Memory Card 的完整结构

[MemoryCard](file:///c:/Users/27933/Desktop/clawx/ClawX/shared/types/memory.ts#L47-L76) 是角色记忆的核心记录:

```typescript
export type MemoryCard = {
  id: string;
  type: MemoryCardType;           // 9 种语义类型
  scope: MemoryCardScope;          // 9 个作用域层级
  scopeKey?: string | null;
  roleTags: string[];
  ownerRole?: string | null;        // v3 治理所有权
  sourceRole?: string | null;       // 谁发现的
  applicableRoles?: string[];       // 谁可以接收
  allowedMutators?: string[];       // 谁可以提议变更
  phaseTags?: MemoryPhaseTag[];     // plan/implement/test/review/security/docs/handoff
  content: string;
  evidence: string[];
  evidenceRefs?: MemoryEvidenceRef[];// 8 种证据引用类型
  confidence: number;
  importance: number;
  lastAccessedAt: string;
  createdAt: string;
  updatedAt?: string;
  accessCount: number;
  version: number;
  status: MemoryCardStatus;         // active/cold/archived/tombstone
  sensitivity?: MemoryCardSensitivity;
  durability?: MemoryCardDurability;
  source?: MemoryCardSource;
  supersedes?: string | null;       // 版本链
  supersededBy?: string | null;
  expiresAt?: string | null;
  retentionLabels?: string[];
};
```

### 4.3 九层记忆作用域

[SCOPE_IMPACT](file:///c:/Users/27933/Desktop/clawx/ClawX/openclaw_runtime/src/memory/memory-policy.ts#L51-L61) 定义了 9 个作用域及其影响权重:

| Scope | 影响权重 | 含义 |
|---|---|---|
| `global` | 5 | 全局 |
| `user` | 5 | 用户级 |
| `workspace` | 4 | 工作区 |
| `project` | 3 | 项目 |
| `agent` | 2 | 单 agent |
| `team` | 2 | 团队 |
| `role` | 1 | 单角色 |
| `session` | 0 | 会话 |
| `task` | 0 | 任务 |

权重直接影响风险评分:scope 越大,risk 越高,越需要评审。例如 `evaluateMemoryPolicy()` 中,`actor === "role"` 写 `workspace`/`user` scope 会被拒绝或要求评审,而 `role` scope 的角色写入通常被允许。

### 4.4 九种语义类型与保留权重

[SEMANTIC_MEMORY_TYPES](file:///c:/Users/27933/Desktop/clawx/ClawX/openclaw_runtime/src/memory/memory-policy.ts#L23-L33) + [RETENTION_TYPE_WEIGHT](file:///c:/Users/27933/Desktop/clawx/ClawX/openclaw_runtime/src/memory/memory-policy.ts#L63-L73):

| Type | 保留权重 | 含义 |
|---|---|---|
| `constraint` | 1.00 | 硬约束(注入为 must) |
| `decision` | 0.95 | 决策(应被 supersede 而非 update) |
| `risk` | 0.80 | 风险 |
| `procedure` | 0.75 | 流程 |
| `preference` | 0.65 | 偏好 |
| `fact` | 0.60 | 事实 |
| `handoff` | 0.45 | 交接 |
| `artifact_ref` | 0.40 | 制品引用 |
| `episode` | 0.30 | 情节 |

旧类型(`project_fact`/`role_experience`/`episodic`/`procedural`)通过 `LEGACY_TYPE_MAP` 归一化到新类型。

### 4.5 四态生命周期

| Status | 含义 | 注入行为 |
|---|---|---|
| `active` | 活跃 | 可注入 |
| `cold` | 冷却 | 不自动注入,需强 task match (≥0.75) |
| `archived` | 归档 | 仅历史,不注入 |
| `tombstone` | 逻辑删除 | 不注入,保留链 |

[evaluateRetentionCandidate()](file:///c:/Users/27933/Desktop/clawx/ClawX/openclaw_runtime/src/memory/memory-policy.ts#L244-L285) 基于重要性、置信度、证据强度、访问频率、近期性、类型权重、过期、陈旧、敏感度计算保留分数,给出 `keep`/`cold`/`archive`/`tombstone`/`review` 建议——但建议是只读的,必须经提议评审才能落地。

### 4.6 Gatekeeper 提案评审流水线

所有角色记忆变更必须经过 [gatekeeper.ts](file:///c:/Users/27933/Desktop/clawx/ClawX/openclaw_runtime/src/memory/gatekeeper.ts) 的提案评审:

```
propose → normalize → classify → evidence check → conflict detect → decision → commit/review
```

关键阈值(硬编码):

| 阈值 | 值 | 行为 |
|---|---|---|
| `LOW_CONFIDENCE_REJECT_THRESHOLD` | 0.45 | 置信度低于此值直接拒绝 |
| `AUTO_ACCEPT_CONFIDENCE_THRESHOLD` | 0.7 | 置信度高于此值自动接受 |
| `HIGH_IMPORTANCE_REVIEW_THRESHOLD` | 0.8 | 高重要性低证据进评审 |

决策固定为 5 种:`accept` / `reject` / `merge` / `supersede` / `needs_review`。**agent 不能直接写长期记忆**。

策略引擎 [evaluateMemoryPolicy()](file:///c:/Users/27933/Desktop/clawx/ClawX/openclaw_runtime/src/memory/memory-policy.ts#L131-L186) 的关键规则:

- 角色写 `workspace`/`user` scope → 拒绝(constraint)或评审(其他)
- 角色写 `project` scope → 评审
- trace/session_summary 不能变更已有记忆 → 评审
- system 写 `global` → 评审 + 建议拒绝
- `update` 一个 `decision` → 评审 + 建议 supersede(决策应被取代而非静默更新)

### 4.7 Context Pack:七桶预算注入

[buildContextPack()](file:///c:/Users/27933/Desktop/clawx/ClawX/openclaw_runtime/src/memory/context-pack.ts#L218-L292) 在 spawn 时按角色构建预算化的上下文包:

| Bucket | 默认预算(token) | 收纳内容 |
|---|---|---|
| `hardConstraints` | 500 | constraint 类型 + secret/secret_adjacent |
| `rolePlaybook` | 600 | procedure/preference/risk + 角色标签匹配 |
| `projectFacts` | 600 | fact/decision |
| `teamHandoffs` | 400 | handoff 类型 + handoff 阶段标签 |
| `recentEpisodes` | 500 | episode 类型 + session scope |
| `openConflicts` | 400 | 冲突卡片 |
| `taskState` | 1000 | 当前任务状态 |
| **总计** | **3000** | 超出则从后向前裁剪 |

### 4.8 四级注入分类

[classifyInjectionCandidate()](file:///c:/Users/27933/Desktop/clawx/ClawX/openclaw_runtime/src/memory/memory-policy.ts#L195-L242) 在评分前先分类:

| Class | 含义 | 触发条件 |
|---|---|---|
| `must` | 必须注入 | active constraint,或相关 open conflict |
| `should` | 应该注入 | 重要 decision(importance≥0.7),或角色匹配的 procedure,或阶段匹配的 risk,或 task match≥0.45 的 fact/handoff |
| `may` | 可以注入 | 竞争剩余预算;cold 卡需 task match≥0.75 |
| `never` | 永不注入 | archived/tombstone/superseded/expired/secret |

评分公式([selectMemoryForContextPack](file:///c:/Users/27933/Desktop/clawx/ClawX/openclaw_runtime/src/memory/context-pack.ts#L119-L206)):

```
score = scope_weight*0.18 + role_match*0.18 + phase_match*0.1 + task_match*0.14
      + importance*0.25 + confidence*0.15 + recency*0.06 + access_freq*0.04
      - sensitivity_penalty - conflict_penalty - stale_penalty
      + class_rank*0.2
```

被跳过的卡片会记录 `whatWouldSelect`,解释"未来怎样才会被选中"。

---

## 5. 多 Agent 协作中的角色定位

### 5.1 三种编排模式

[role-router.ts](file:///c:/Users/27933/Desktop/clawx/ClawX/openclaw_runtime/src/agents/role-router.ts) 的 [resolveMode()](file:///c:/Users/27933/Desktop/clawx/ClawX/openclaw_runtime/src/agents/role-router.ts#L78-L93) 根据任务特征选择模式:

| 模式 | 触发条件 | 行为 |
|---|---|---|
| `router` | 简单任务(无 important 标志,文件提示 < 3) | 主 agent 选一个角色,单 worker |
| `lead-workers` | 复杂任务(文件提示 ≥ 3,或包含 refactor/模块/跨 等关键词) | lead 分解,workers 并行,lead 综合 |
| `adversarial-review` | 安全/审计任务(important,或包含 security/安全/auth/credential/secret/权限/release/发布) | security/review 角色运行,verifier 延迟启动,skeptic 挑战 |

支持角色:`planner`, `architect`, `implementer`, `tester`, `reviewer`, `security-reviewer`, `docs-writer`, `skeptic`(adversarial 模式下还包含 `skeptic`)。

### 5.2 角色路由的评分

[scoreRole()](file:///c:/Users/27933/Desktop/clawx/ClawX/openclaw_runtime/src/agents/role-router.ts#L43-L76) 的评分维度:

- **双语关键词匹配**(EN + 中文):`planner` 匹配 plan/规划/计划/breakdown/拆解/roadmap/sequence 等
- **文件提示正则**:tester 匹配 test/spec 文件,docs-writer 匹配 readme/docs/.md,security-reviewer 匹配 auth/token/secret/permission/security
- **角色标签**:任务文本包含角色 tag 加分
- **默认偏置**:implementer 有 +1 默认偏置(默认执行角色)

`preferredLeadRole` 可显式覆盖路由结果。

### 5.3 团队模板

[team-template.ts](file:///c:/Users/27933/Desktop/clawx/ClawX/openclaw_runtime/src/agents/team-template.ts) 定义 3 个内置团队模板:

| Template | Mode | Lead | Verifier | 角色组成 |
|---|---|---|---|---|
| `quick-development` | lead-workers | planner | reviewer | planner, implementer, tester, reviewer |
| `security-audit` | adversarial-review | security-reviewer | skeptic | security-reviewer, reviewer, tester, skeptic |
| `refactor` | lead-workers | architect | skeptic | architect, implementer, tester, reviewer, skeptic |

自定义团队通过 `cfg.agents.teams[]` 注入,按 id 覆盖内置。提供 `templateId`/`teamTemplateId` 时,编排严格使用该模板的 `roles`/`defaultLeadRole`/`verifierRole`;未提供时由 role router 决定。

### 5.4 任务图与执行波次

[orchestration-protocol.ts](file:///c:/Users/27933/Desktop/clawx/ClawX/openclaw_runtime/src/agents/orchestration-protocol.ts) 定义任务图结构:

- **节点 phase**:`plan` / `architecture` / `worker` / `implementation` / `verification` / `review` / `security` / `docs` / `verifier` / `repair` / `redo` / `followup`
- **边类型**:`dependency` / `handoff` / `verification` / `repair_of` / `followup_of`
- **节点状态**:`planned` / `ready` / `running` / `accepted` / `failed` / `skipped`

`buildExecutionWaves()` 把图分成执行波次,同一波次的 ready 节点用 `Promise.allSettled` 并行;`maxWorkers` 限制每波 worker 数,但不删除后续图节点。

### 5.5 角色交接规则

每个角色的 `handoff` 字段定义合法流转:

- `to`:可以交接给哪些角色
- `from`:可以从哪些角色接收
- `requiresReview`:交接是否必须经过评审

观察内置角色的交接图:`planner → architect → implementer → tester → reviewer → skeptic`,形成一条带评审关卡的流水线。`security-reviewer` 和 `skeptic` 的 `requiresReview: true` 是安全防线——它们的输出不能直接闭环,必须有人审。

### 5.6 Verifier 两阶段启动

对抗模式下,verifier 不在初始 spawn 批次中:

1. 初始 spawn 只启动 workers
2. runtime 等待所有预期 workers 到达终态
3. 然后启动 verifier
4. 全部 worker 失败时跳过 verifier,直接报告失败 bundle

这避免 verifier 在 workers 还没产出时就运行,保证 verifier 有东西可验证。

### 5.7 Worker 质量评估

Team Result Bundle 包含确定性 worker 质量信号(非模型评判):

| 维度 | 取值 |
|---|---|
| `schemaCompliance` | pass / weak / fail |
| `evidenceCoverage` | strong / partial / missing |
| `scopeDiscipline` | pass / risk / fail |
| `actionability` | strong / partial / missing |
| `verificationSignal` | present / weak / missing |
| `verifierVerdict` | accepted / partial / refuted / not_available |
| `runtimeHealth` | healthy / tool_error / timeout / empty_output / error |

差评 worker 会被记为降级/修复证据;runtime **不会在运行时删除角色契约**。

### 5.8 编排的可靠性保证

- **单 worker 超时**(120s):`Promise.race` 包裹,挂起 worker 记为失败,不阻塞 run
- **错误恢复**:单个 worker 失败不中止其他 workers(失败被收集,不抛出)
- **修复/重做图节点**:超时/无输出产生 redo 节点,部分/verifier 缺口产生 repair 节点,权限/能力缺口产生 reroute 建议(不扩大角色工具)
- **有界 follow-up**:worker follow-up 候选仅在 `allowFollowupPlanning` 开启时成为 `pendingGraphNodes`,受 `maxFollowupRuns` 限制;leaf worker 不能 spawn 后代
- **无自动 worker 间聊天**:v4 默认不启用 worker-to-worker `sessions_send`,所有 worker 结果回到 lead 综合

---

## 6. 交互层面:用户如何使用

### 6.1 入口:Agents 页面

[Agents/index.tsx](file:///c:/Users/27933/Desktop/clawx/ClawX/src/pages/Agents/index.tsx#L209) 在 agent 列表下方渲染 `RolesOrchestrationPanel`:

```tsx
<RolesOrchestrationPanel agents={agents} />
```

用户进入 Agents 页面即可看到角色编排面板,无需进入二级菜单。

### 6.2 RolesOrchestrationPanel 的核心交互

[RolesOrchestrationPanel.tsx](file:///c:/Users/27933/Desktop/clawx/ClawX/src/components/agents/RolesOrchestrationPanel.tsx) 是 role-first runtime 的主操作面板,所有数据流经 `hostApi.gateway.rpc`(无专用 host-api 模块):

| 操作 | RPC 方法 | 类型 | 说明 |
|---|---|---|---|
| 浏览角色 | `roles.list` | read | 列出内置 + 配置角色 |
| 查看契约 | `roles.get` | read | 返回编译后的 SOUL 预览 |
| 预览编排计划 | `orchestrator.plan` | read | 不 spawn,只返回计划 |
| 启动编排运行 | `orchestrator.run` | write | spawn 真实 subagent,可能返回 approval-required |
| 浏览团队模板 | `teams.list` | read | 内置 + 配置团队 |

`orchestrator.run` 是变更操作,可能返回 `approvalRequired` 响应,面板用内联 approve/reject 控件处理,不会静默失败。

### 6.3 RoleCard:角色卡片的视觉语言

[RoleCard.tsx](file:///c:/Users/27933/Desktop/clawx/ClawX/src/components/agents/RoleCard.tsx) 展示角色契约,选中时展开详情:

- **头部**:角色名 + effort 徽章 + 工具数
- **描述**:`description` 或 `rolePrompt`(2 行截断)
- **展开详情**:工具白名单网格 + 权限三件套(文件系统/网络/命令数) + "View contract" 按钮(调用 `roles.get` 获取编译后的 SOUL)

[role-visuals.ts](file:///c:/Users/27933/Desktop/clawx/ClawX/src/lib/role-visuals.ts) 定义统一的视觉色调:

| 角色 | Tone | 含义 |
|---|---|---|
| planner | blue | 规划 |
| architect | sky | 架构 |
| implementer | emerald | 实现 |
| tester | amber | 测试 |
| reviewer | violet | 评审 |
| security-reviewer | red | 安全 |
| docs-writer | cyan | 文档 |
| skeptic | rose | 质疑 |

色调在 RolesOrchestrationPanel 和 Observability TraceWaterfall 之间共享,保证角色视觉一致。配置自定义角色用 hash 派生确定色调,同名角色永远同色。

### 6.4 角色记忆的四个 Tab

RolesOrchestrationPanel 的 Role Memory 区域有 4 个 tab:

| Tab | 用途 |
|---|---|
| Active | 浏览活跃记忆卡,创建记忆,归档 |
| Review | 评审队列:approve/reject/apply-as-cold/supersede/merge |
| Conflicts | 检查冲突组,打开对比/详情,生成 merge 草稿 |
| Injections | 查看最近注入日志,按 must/should/may/never 分组,模拟注入 |

用户可以编辑语义类型、scope、敏感度、置信度、重要性、所有权、适用角色、允许变更者、阶段标签、过期、证据引用,然后通过 `memory.previewProposal` dry-run 评审流程,再提交。

### 6.5 实时生命周期事件

每个 worker spawn 发出 `subagent-lifecycle` 广播,链路:

```
runtime spawn → event-dispatch → main/index.ts relay
  → renderer hostEvents.onSubagentLifecycle
  → RolesOrchestrationPanel 进度面板
```

进度面板按 worker 显示状态(`started`/`completed`/`verified`/`error`),用角色色调着色。面板还订阅 `PermissionApprovalEvent`、`TaskLoopLifecycleEvent`、`MissionLifecycleEvent`。

### 6.6 可观测性

Observability 页面展示 role-first trace,12 种 span:

`orchestrator` / `role-router` / `team` / `subagent` / `model` / `tool` / `memory` / `context-pack` / `gatekeeper` / `verifier` / `input-mode` / `custom`

`runOrchestrationObserved` 把 plan + 初始 worker spawn 包进 recorder span → `storeRuntimeTrace` → trace buffer(上限 100,内存)。延迟 verifier 通过 `orchestrationRunId` 和 child-run 元数据关联。

---

## 7. 完整数据流

一次 role-first 编排的完整流程:

```
1. 用户在 Agents 页面选角色/团队模板,填任务
2. RolesOrchestrationPanel 调用 hostApi.gateway.rpc('orchestrator.plan', {...})
   → role-orchestration-methods.ts 解析参数
   → orchestrator.ts createOrchestratorPlan()
     → role-router.ts routeRole() 评分选角色
     → team-template.ts resolveTeamTemplate() 解析团队
     → orchestration-protocol.ts buildTaskGraph() + buildExecutionWaves()
   → 返回计划预览(不 spawn)
3. 用户确认后调用 hostApi.gateway.rpc('orchestrator.run', {...})
   → runOrchestrationObserved()
     → spawnRoleSubagent() per worker
       → resolveRoleContract() 解析角色
       → buildRoleSpawnParams()
         → roleEffortToThinking() 映射 effort
         → resolveRoleMemoryCards() 解析记忆卡
         → buildContextPack() 构建 7 桶预算上下文
         → buildRoleSystemPrompt() 编译 SOUL + Memory Context
       → buildRoleSpawnContext()
         → role.tools[] 作为硬白名单
         → buildRolePermissionDenyPatches() 编译权限拒绝
       → spawnSubagentDirect() 派生真实 subagent
     → observability 记录 trace
     → subagent-lifecycle 广播
4. workers 完成 → Team Result Bundle → lead 综合
5. (对抗模式)verifier 延迟启动 → skeptic 挑战
6. 结果回到 UI,trace 进入 Observability
```

---

## 8. 边界自检:可交付给 agent 的代码锚点

以下锚点可用于让 agent 判定 role-first 设计的边界,确保不越界修改:

### 8.1 角色定义边界

| 边界 | 文件 | 行 | 说明 |
|---|---|---|---|
| RoleContract 类型 | `openclaw_runtime/src/agents/role-contract.ts` | L33-L50 | 字段不可私自增减 |
| 8 个内置角色 | `openclaw_runtime/src/agents/role-contract.ts` | L230-L359 | 内置角色定义 |
| SOUL 编译格式 | `openclaw_runtime/src/agents/role-contract.ts` | L207-L226 | 编译产物的字段顺序 |
| 校验规则 | `openclaw_runtime/src/agents/role-contract.ts` | L162-L189 | name/rolePrompt/tools 校验 |

### 8.2 权限边界

| 边界 | 文件 | 行 | 说明 |
|---|---|---|---|
| 拒绝列表映射 | `openclaw_runtime/src/agents/role-permissions-policy.ts` | L44-L94 | filesystem/network/commands → deny |
| 拒绝合并 | `openclaw_runtime/src/agents/role-permissions-policy.ts` | L101-L118 | 与现有 deny 合并 |
| spawn 上下文 | `openclaw_runtime/src/agents/role-spawn.ts` | L208-L221 | allowlist + deny 合并点 |

### 8.3 记忆边界

| 边界 | 文件 | 行 | 说明 |
|---|---|---|---|
| 控制平面声明 | `openclaw_runtime/src/memory/memory-store.ts` | — | 不写原生内存 |
| Scope 影响权重 | `openclaw_runtime/src/memory/memory-policy.ts` | L51-L61 | 9 层 scope 权重 |
| 评审阈值 | `openclaw_runtime/src/memory/gatekeeper.ts` | L32-L34 | 0.45/0.7/0.8 三个阈值 |
| Context Pack 预算 | `openclaw_runtime/src/memory/context-pack.ts` | L18-L27 | 7 桶默认预算 |
| 注入分类 | `openclaw_runtime/src/memory/memory-policy.ts` | L195-L242 | must/should/may/never |

### 8.4 编排边界

| 边界 | 文件 | 行 | 说明 |
|---|---|---|---|
| 三种模式 | `openclaw_runtime/src/agents/role-router.ts` | L78-L93 | 模式选择规则 |
| 路由评分 | `openclaw_runtime/src/agents/role-router.ts` | L43-L76 | 关键词/文件/tag 评分 |
| 团队模板 | `openclaw_runtime/src/agents/team-template.ts` | L3-L50 | 3 个内置团队 |
| 任务图节点 phase | `openclaw_runtime/src/agents/orchestration-protocol.ts` | L8-L20 | 12 种节点 phase |
| 边类型 | `openclaw_runtime/src/agents/orchestration-protocol.ts` | L21 | 5 种边类型 |

### 8.5 交互边界

| 边界 | 文件 | 行 | 说明 |
|---|---|---|---|
| 面板入口 | `src/pages/Agents/index.tsx` | L209 | RolesOrchestrationPanel 渲染点 |
| RPC 入口 | `src/components/agents/RolesOrchestrationPanel.tsx` | — | 全部经 hostApi.gateway.rpc |
| 角色色调 | `src/lib/role-visuals.ts` | L21-L41 | 8 个内置角色固定色调 |
| Role Memory 4 Tab | `src/components/agents/RolesOrchestrationPanel.tsx` | — | Active/Review/Conflicts/Injections |

### 8.6 不可越界的硬规则

1. **agent 不能直接写长期记忆**——必须经 gatekeeper 提案评审(见 §4.6)
2. **角色权限是硬约束**——工具在模型看到之前就被过滤(见 §3.2)
3. **role memory 不写原生内存**——只读引用 evidence(见 §4.1)
4. **leaf worker 不能 spawn 后代**——follow-up 受 maxFollowupRuns 限制(见 §5.8)
5. **verifier 延迟启动**——不在初始 spawn 批次(见 §5.6)
6. **决策应被 supersede 而非 update**——`update` 一个 `decision` 会进评审(见 §4.6)
7. **角色写 workspace/user scope 被拒绝或评审**——防止角色篡改高 scope(见 §4.6)

---

## 9. 与原生内存的对照表

| 维度 | Role Memory | Native Memory |
|---|---|---|
| 存储 | `role-memory.sqlite` | memory-core 索引、MEMORY.md、QMD、dreams |
| 写入路径 | propose → gatekeeper → commit/review | memorySearch 直接 |
| 读取路径 | spawn 时按角色注入 Context Pack | 全局检索 |
| 修改原生 | 禁止 | — |
| 修改 role | 禁止(原生不写 role-memory.sqlite) | — |
| Evidence 引用 | 可引用 memory_search/memory_md/qmd/dream/trace/session/file/manual | — |
| 全局开关 | `OPENCLAW_ROLE_MEMORY_ENABLED` | 始终可用 |

这条边界在 [memory-policy.ts](file:///c:/Users/27933/Desktop/clawx/ClawX/openclaw_runtime/src/memory/memory-policy.ts#L297-L300) 的 `getMemoryPolicySnapshot()` 中显式声明:`evidencePolicy.nativeBridge = "read_only"`。

---

## 10. 设计取舍总结

| 取舍 | 选择 | 代价 |
|---|---|---|
| 角色是契约 vs persona | 契约 | 失去 persona 的情感表达 |
| 工具白名单 vs 黑名单 | 白名单 | 配置更严格,但更安全 |
| 记忆评审 vs 直接写 | 评审 | 写入延迟,但可审计 |
| 控制平面 vs 替换原生 | 控制平面 | 两套系统,但原生不被破坏 |
| Verifier 延迟 vs 同时 | 延迟 | 总时长变长,但 verifier 有东西可验 |
| 确定性路由 vs 模型路由 | 确定性 | 可解释,但缺少模型判断 |
| 角色色调固定 vs 自由 | 固定 | 视觉一致,但配置角色用 hash |

这些取舍共同构成了 role-first 设计的实际体现:可审计、可解释、硬约束、不破坏原生。

---

**文档版本**:基于 2026-07-06 仓库代码撰写。所有代码锚点可在上述文件路径中溯源。
