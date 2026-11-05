# VB / VG / VS 修复验收

日期：2026-11-05，Asia/Shanghai。全部交互、运行与审查均由 agent 驱动。

本次已修复原审计的权限、会话归属、网络策略、能力暴露和当前证据问题，以及独立复核发现的 IPv6 分类与验收脚本缺口。下列结果属于明确绑定的隔离候选，不代表其他会话的主工作区改动已经验收，也不代表产品默认值或发布资格变化。

## 修复结果

- Gateway 只分发当前可用的模型动作，拒绝模型自报批准、模式升级和缺失/冲突 owner；Host 管理接口保留原有受权管理职责。
- 所有受管页面、重定向、子资源与 DNS 结果执行 Host 私网策略；IPv4-translatable、IPv6 多播和已弃用 site-local 均按受限地址处理。
- 空或未知能力快照保持仅发现；native tab 关闭、失败导航与 session/profile 清理保留宿主所有权。
- 构建在编译前记录源码、编译后封存产物，实际 app.asar/main-runtime.asar 内容与来源清单匹配；类型声明按真实打包规则区分两份归档。
- Windows 探针按完整 user-data-dir 匹配进程，核对存活与创建时间，并在终止前验证同一进程句柄。失败、中断、重试与目录清理均留回执。
- N8 的全部检查、N9 的逐轮行为/清理/唯一身份及汇总由 verifier 重算；中断回执必须绑定本轮实际观察到的进程。零轮次、伪造汇总、错误 backend/创建时间/目录都不能制造通过。
- VG 文档和候选校验按当前模块契约执行，严格验收要求实际必需命令结果。固定上游 Git 对象用于 VB 补丁验证。

## 读盘确认的结果

| 检查 | 结果 | 证据 |
|---|---|---|
| 宿主定向测试 | 166 passed，0 failed / skipped | focused-unit-current.json |
| 浏览器模块 | 44 passed，0 failed / skipped | browser-unit-current.json |
| Runtime provenance | 24 passed，0 failed / skipped | runtime-provenance-current.json |
| 探针与构建回归 | 13 passed | deepseek-fixes-node-tests.txt |
| 真实 Electron E2E | 1 passed，0 skipped；含 IPv6、私网 fetch/image/iframe/redirect/WebSocket、native tab close | vb-e2e.json / host-invocation.json |
| 全量 typecheck | node / web / test 通过，cache disabled | typecheck.json |
| lint、Harness、comms replay/compare | 对应检查通过 | bound-gate-receipts.json / 各 txt 日志 |
| 新安装包 N8 | 10/10 检查通过 | ../versebrowser-invocation-maturity/current-20261105/n8-result.json |
| 新安装包 N9 | 46/46：10 冷启动、30 闭环、3 中断及 3 恢复；零残留，46/46 目录回收 | ../versebrowser-invocation-maturity/current-20261105/n9-result.json |
| VB / VG strict | 两者通过；VG 9 criteria / 15 groups / 66 files，保留原有 6 项 P2 范围限制 | vb-strict-bound.json / vg-strict-bound.txt |
| DeepSeek 独立源码复核 | approve，最终增量无阻断发现；此前发现及更正链完整保留 | deepseek-source-review.json |

## 候选与边界

- 运行及源码审查候选：a5d49452d394f3f401f3ffd989fc6ea13c2e533c。
- 实际产品构建：9f5970e12a07be6be547a5b5273064fc6325a6e7。后续只修改验收脚本、测试或证据；verifier 检查产品源码没有漂移。
- 最终审查返回模型：deepseek-v4.1-flash；response ID：01a1a90558f67a78aafc7919aaffd996；finish reason：stop。执行器不冒充审查模型，未保留隐藏推理或凭据。
- N9 本批次闭环 p50=10098ms、p95=16061ms，包含本机启动和清理，仅为本批次观测。
- 先前声明文件打包不匹配、3/46 清理失败及后续采样工作进程失败都作为失败保留。最终目录清理成功不会把失败轮次改为通过。旧 current-20261104 仍是历史证据。
- 验收编排期间触发的 E2E 文件变更保护和 VG 未提交证据拒绝也保留失败记录；文件稳定并提交后，相应门禁重新运行通过。
- VG M4 未授权，VS default-off 不变。未发布、未推送；非 Windows 运行、外部模型任务质量和外部 VerseShell MCP 连接器未纳入本轮通过声明。
- 全仓库 harness:ci 的既有 Agent Dev 证据过期问题未被本任务覆盖，不宣称全仓库全绿。

源码审查是静态分组及增量复核；运行验收来自上述真实命令与安装包。manifest 覆盖本目录保留文件，所有收口继续按仓库证据门禁执行。

## 主线集成

已合入 main：64e36f236aaaef43c3e1077443e75faeb1276423。原有工作区改动和暂存状态保留；主线的旧浏览器编译产物已重新构建，508 个文件与已验收产物匹配。合入后的 90 项定向测试与 13 项探针回归通过。具体回执见 integration.json；并行的其他主线改动仍不在本次完整安装包验收范围。
