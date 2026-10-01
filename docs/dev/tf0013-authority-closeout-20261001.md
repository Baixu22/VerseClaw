# TF-0013 Context Orchestrator residual 收口

2026-10-01；actor: codex/root；driven_by: agent。

## 验收结论

独立目录的最终候选 `ed97400bdc0a6e16c06387ba808e287bd1380475` 完成节点级验收。每个门禁前后均检查 Git 状态，源码始终干净；依赖来自两个 workspace 的锁文件离线安装，没有链接主工作区 node_modules。产品源码与主工作区交付源码的 SHA-256 逐文件匹配。

最终 **18/18 门禁 exit 0，233 项测试通过，7 次原生请求通过**。另一次真实 Agent Dev 证据刷新有 **87 项单测、4 项 Electron E2E 通过**，fullGateComplete=true、requiredFullGates=[]。源码候选是 `75c56def5920921c4f34c72e67491533ef92823e`，最终候选只追加真实刷新后的五份 Agent Dev 报告及 spec 记录；最终所有门禁按最终提交重新执行。

| TF-0013 原验收条件 | 当前证据 |
| --- | --- |
| 生产静态扫描只有一个 assembly authority | entry scan 6 项；生产 projectContextCandidates 只能留在候选/Orchestrator owner，原生 SDK 回调原 attempt owner |
| 任意 source 不能绕过总预算 | 候选/预算 115 项、SDK 10 项，原生进程的 atomic drop、COMPASS 耗尽、历史免计费与实际请求核对 |
| working-memory、role-memory、CVK、VToken 组合开启 | embedded 48 项及候选组合矩阵，排序、去重、收费与 lineage 均有断言 |
| flag off/kill switch 零查询零注入 | source flag/kill 矩阵，原生 kill 场景 engine assemble=0、最终请求无增强标记 |

233 项包括 native SDK 10、插件诊断 6、回复 COMPASS 1、embedded 48、组合预算 115、entry scan 6 和 Harness CI 单测 47，不累加之前重跑的次数。完整命令、真实退出码、耗时及 dirtyBefore/After 在 `artifacts/tf0013-codex-contract-20261001/candidate-verification.json`。

## 最后补齐的契约

Codex package 原有 8 条类型错误已全部清零。动态调用和 side question 在调用开始创建一次宿主 UUID 与冻结 trace，终局复用；显式携带 attempt 的 parent trace，避免共享 client 回调继承旧调用上下文。原生事件 projector 将身份与既有开始时间一起保存在 item map，交错完成不会串号。schema quarantine 产生有效的独立 blocked 事件。没有增加全局诊断缓存、修改公开 SDK、降低事件类型要求或伪造 requestId。

工具统计补齐既有 definitionChars=listChars+schemaChars 契约，保持 Codex 原有 listChars=0 和 deferred schema 不计费语义。6 项行为测试使用真实 dispatcher、event projector 和拒绝路径；首次测试订阅了仅接收非 trusted 事件的 listener，修正 fixture 后通过，失败日志保留。

结构化 autoreview 无 actionable findings。此前跨模块预算及 stale resume 恢复修复也有两轮已归档复审。本轮是节点级工程验收，不重签历史 RC-02/03/09/10。

## 证据与诚实边界

- `acceptance.json`：四项条件逐条判定、候选 commit/tree、测试计数和局限。
- `candidate-verification.json` / `candidate-checks/`：最终候选的 18 门原始日志。
- `candidate-native/`：真实 Codex 0.137.0、插件加载、公开 SDK、透明 stdio/RPC、本地 scripted Responses provider 的请求、绑定和续跑记录。
- `agent-dev-fresh-evidence/` / `agent-dev-refresh.log`：通过真实 full deep-test 刷新的证据。最初 CI 唯一失败是原报告超过 24 小时；没有修改时间戳、放宽阈值或使用 report-only 模式。
- `source-hashes.json` / `SHA256SUMS` / `credential-scan.json`：源码身份及封存。所有模拟输入、provider 回复、engine 场景明确为 agent 驱动。

初始未封存的验证轮次与最终轮次复用了日志名，初始原始日志被覆盖，只保留其已观察的数值报告。**验收仅使用最终候选报告与对应日志**；局限记录在 `historical-artifact-limits.json`，后续验证脚本已改为按 commit 分目录。

部分 embedded 测试会把环境中的外部 context-runtime-kit 因无效 resource id 隔离；正向 CVK 准入使用受控 engine。这里验证仓库拥有的仲裁、预算与失败隔离边界，不认证该外部插件。原生 provider 的模型回复为本地脚本生成，不是付费模型质量、真人行为或新全量 RC 证据。

三个产品锁、6000/0.1 默认值、TF-0006、SEKB 自动写回和 D7 产品范围均未改变。README 三语已包含预算行为说明；诊断修复恢复既有契约，不增加用户交互入口，因此无需新增 UI 文案。

后续按用户“完成全部剩余节点”的目标继续处理父节点及剩余工作。TF-0013 收口不自动表示所有节点、发布或联合系统 GA 已完成。
