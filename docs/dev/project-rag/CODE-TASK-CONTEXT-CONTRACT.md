# 代码关系与任务线索

编码上下文工具通过 FactStore 发现跨文件关系，再读取当前源码复验每个落点。Task Ledger 提供当前会话绑定的任务 revision、约束与证据引用。两类结果分别使用 `RelationshipExpansion/v1` 与 `TaskContextHint/v1`。

## 入口

正常编码会话的 `context_understand` 支持显式关系请求：

```json
{
  "query": "src/feature.ts",
  "intent": "relationship",
  "depth": 1,
  "maxNodes": 32,
  "includeTaskHint": true
}
```

`intent` 可选 `lookup`、`relationship` 或 `research`；默认 `lookup`。关系与研究请求复用同一有界扩展；`context_impact` 根据精确文件或 `path:symbol` 返回匹配符号和调用关系。符号在多个文件中重名时，需要提供实际路径。

Task Ledger 的独立只读入口为 `hostApi.taskLedger.contextHint({ workspaceId, sessionKey })`。Main 从当前工作区、会话 generation 和协调器绑定派生身份。调用者可带上上次返回的 `sourceRef`，把再次读取限定在同一任务版本。

## 关系解析与准入

- 相对模块采用 TypeScript 的真实模块路径解析，包括 `.js` 到源码 `.ts` 的映射；不同目录中的同名文件保持独立。
- 调用采用当前源码的 TypeScript 符号绑定，支持本地声明、导入别名、命名 default export 和 namespace import；参数遮蔽保持其实际含义。
- 未解析的包、路径别名或符号产生 `unresolved_module`／`unresolved_symbol` 缺口，返回已准入的关系。
- 默认一跳，最多两跳；最多 32 个文件落点、128 条返回边，每轮边候选扫描有上限。每份源码最多读取 512 KiB。
- 边的两端携带独立 `SourceRef/v2`，包含 project owner、namespace、实际文件路径、repository/file revision、源码 digest 与 policy epoch。调用边另带实际符号 ID、名称、源码行和深度。
- 读取拒绝符号链接和多链接文件。源与目标文件都经过 owner 复验、当前字节/hash 比较；末次异步校验后同步复读落点字节与 pin，拒绝期间新增的链接或内容变化。本轮拒绝的落点保持拒绝。
- 代码片段从已复验的当前源码截取，优先包含调用目标的实际符号正文。片段保留 UTF-8 byte/line locator，并受字符预算控制；它们沿既有代码工具结果进入 DCS。

`complete` 表示所选有界关系查询完成；`partial` 带已准入关系及拒绝／截断记录；`unavailable` 表示身份、来源或 seed 不能形成有效结果；普通 `lookup` 的关系扩展为 `disabled`。

## 当前任务 hint

hint 直接读取现存 TaskSystemStore 的当前 generation 绑定。字段包括任务 ID、合同 revision/digest、objective、constraints，以及当前 revision 的 owner evidence refs 和 checkpoint artifact refs。最多返回 32 条证据引用，超出时标记 `truncated`。

checkpoint 的合同 revision 从任务 owner 已有的创建／修订和 checkpoint 事件序列回读。旧 revision 或不能确定 revision 的 checkpoint 引用被排除，并返回对应缺口；checkpoint 原记录保持原样。

证据引用保留 owner 记录的路径与 SHA-256，供后续回读定位。hint 的 `sourceRef` 固定任务和引用内容，读取前后会重新检查绑定、revision 和身份。任务修订解除绑定后返回 `missing_task_binding`；建立新绑定后，旧 pin 返回 `task_pin_changed`。

读取使用既有任务 owner，不领取、续租、创建或修订任务，不把任务内容写入长期 chunk 表。缺少 Ledger、绑定或 session generation 时，返回 `unavailable` 和对应原因，正常编码检索继续。

## 回滚与验证

使用 `intent: "lookup"` 恢复普通编码检索；`includeTaskHint: false` 关闭关系请求中的任务 hint，独立 Host 请求可用 `enabled: false`。既有 context view 工具关闭入口继续适用。

聚焦验证：

```powershell
pnpm exec vitest run tests/unit/project-rag-graph-task-context.test.ts tests/unit/task-ledger-reference.test.ts --maxWorkers=1
pnpm run test:e2e tests/e2e/project-rag-research.spec.ts
pnpm harness validate --spec harness/specs/tasks/project-rag-code-graph-task-context.md
```

Electron 旅程通过正常工作区、Task Ledger Host API 与 Chat composer 调用生产 context 工具，回读真实工具结果、任务快照和 SQLite chunk 数据，并保留过期边、跨工作区和回滚证据。模拟模型与执行产物标记为 agent 驱动。
