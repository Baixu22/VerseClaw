# 2026-10-05 全量验收与收尾审计

`driven_by: agent` · `actor: codex-full-acceptance`

**结论：NOT ACCEPTED，不能判定全项目收口或发布就绪。** 本轮已修复可复现的小范围问题，并跑完当前 Windows Electron 测试清单；仍存在交付依赖、真实审批链和启动预算失败。旧节点 done、开发目录内可运行、Agent Dev 绿灯都不能替代这些结果。

起点是干净主线 `55a33921e92c10eff4b5cb1b10305e8bcfbdda4a`。修复提交为 `028563810` 和 `07271b063`，保存在本地 `codex/full-acceptance-closeout-20261005`。后半程使用独立安装依赖的干净候选 `07271b0632b7ee141a05d1034393a0add888695c`，避开工作过程中并行产生的品牌探索资源。没有发布、推送、安装到用户系统或改变产品锁。

## 实际验证结果

| 门禁 | 本轮结果 | 解释 |
| --- | --- | --- |
| 根全量 `pnpm test` | 8035 passed / 50 skipped，exit 0 | 在起点提交执行；后续改动有定向复验。不能外推为全部 runtime 或真实模型验收。 |
| Runtime 完整发现清单 | 422 个项目/文件执行项，419 个唯一文件；分批及失败文件复验后 3175 passed / 5 skipped | 按 JSON 核对文件多重集合，未漏文件。原单次入口超时和失败保留，**不声称单次全量命令全绿**。 |
| 根类型、runtime 四个非增量类型门 | 全部 exit 0 | 在独立候选复验；未关闭 declaration、删覆盖或增加类型抑制。 |
| 只读 lint | 0 errors / 120 warnings，exit 0 | 既有警告与阈值保留；新增构建改动的定向 lint 也通过。 |
| Electron 全套 | 324 passed / 4 failed / 10 skipped，exit 1，约 50.3 分钟 | 338 项全部进入结果清单，无额外筛选。 |
| Electron 失败项单次复验 | 3 passed / 1 failed | Scheduled/Browser、Knowledge Hub、goal-wake 通过；RC-10 H-02 再次超时。原全套失败不被覆盖。 |
| Agent Dev fresh/full deep-test | 11 步通过，约 89.9 秒，exit 0 | 严格审计 97/A，无 disqualifier；这是控制面结果，不是全产品发布判定。 |
| `harness:ci`、差异感知 task validate、供应链策略检查 | exit 0 | 本轮真实 task 明确以起点提交为 diffBase，未用 `--no-diff` 或通配 residual；CI 中的结构性 example 校验保留原配置。 |
| 启动资源预算 | exit 1 | 首屏 JS 5.07 MB > 2.50 MB，math-rendering JS/CSS 被提前加载；重建后复验仍失败。 |
| Windows 完整构建 | exit 1 | Vite、runtime/Gateway smoke 和 unpacked 目录生成完成；7-Zip 因依赖链接告警失败，**未生成新 NSIS 安装器**。 |
| VerseConf 综合验证 | 41/43 passed，exit 1 | 两项失败均为安装器不存在/无法检查其嵌入交付；不能把模块检查通过说成安装器通过。 |

所有命令、退出码、候选身份、时间和收据摘要在[机器报告](../../artifacts/project-closeout-20261005/report.json)。不同套件有重叠，不将它们相加为独立测试总量。

独立候选的四个 runtime 类型门运行于 `028563810`；随后 `07271b063` 仅改变构建链路及其回归，不改变 runtime TypeScript。后续完整 Electron、构建和 Deep Test 使用 `07271b063`。各轮身份与 dirty 状态均保留在收据中，不将多轮结果描述成同一提交的一次全绿。

## 当前阻断与未完成项

### P1：交付包仍依赖开发目录

新候选的 7-Zip 返回 1；16 条告警对应 8 种路径。进一步检查发现 runtime 交付树内有 **37 个指向包外的绝对链接**。它们在开发机器上仍可能可读，换机器后不能成立。

同时，相关 workspace 包要求 `typebox@1.1.39`，交付顶层却是 `1.1.38`。因此不能删除嵌套目录后，直接假设顶层回退正确。打包后的 VerseShell MCP 入口还会从 `C:/Users/27933/node_modules` 解析 SDK，这能掩盖 SDK 未正确入包的问题。

这是本轮最明确的交付假阳性风险：**本机能解析依赖，不等于产物自包含。** 应修复实际复制和依赖闭包，保留锁定版本，并从真正交付入口验证解析结果都位于包内。不得忽略压缩错误或只删除报警链接。

证据：[交付解析检查](../../.local/full-acceptance-20261005/candidate-proof/packaging-portability.json)、[构建收据](../../.local/full-acceptance-20261005/candidate-proof/candidate-windows-build.json)、[独立审查](../../.local/full-acceptance-20261005/packaging-independent-review.json)。

### P1：RC-10 当前审批链未通过

完整套件和定向复验均在 H-02 等待审批时超过既有 30 秒界限。后续 H-03..H-06 因此没有执行。这不是等待真人：驱动本来就是 agent 执行；需要定位当前驱动/生产契约，而不能沿用旧候选的 accepted 结论。

证据：[原始完整结果](../../.local/full-acceptance-20261005/candidate-proof/electron-full-tests.json)、[复验结果](../../.local/full-acceptance-20261005/candidate-proof/electron-rerun-tests.json)。

### P2：启动预算及桌面验证残余

- 既定首屏预算仍失败，不能用功能测试通过替代性能门；本轮未提高阈值。
- Scheduled/Browser 全套中未找到预期 Cron 卡片，Knowledge Hub 全套中成功通知拦住了菜单点击；相同源码下定向复验均通过。当前只能认定存在全套运行中的不稳定记录，不能宣布已修复。
- goal-wake 初次失败是本轮包装器同时引入 `NO_COLOR` 与 Playwright 的 `FORCE_COLOR`，stderr 告警触发严格断言。已去掉包装器的冲突变量，原断言不变，复验通过；不将此项归为产品缺陷。
- 6 项固定跳过仍需如实管理：`CheckpointsDialog`、`ComposerGitStrip`、`CompactionArtifactViewer` 没有生产页面入口；单次/会话模型作用域尚无选择入口；另有 token 用量过滤 UI 的覆盖缺口。有辅助代码不代表可用功能。

## 本轮已修复

1. **5 条声明类型诊断**：显式约束 mock、私有 rollback symbol 和 secrets 配置适配器返回类型。三个模块转译后的 JavaScript 前后字节一致。
2. **过期测试夹具**：网络替身改为传输适配器识别的 `vi.fn`；SEKB 正向轨迹补齐来源；goal-wait 夹具声明隔离场景的执行权限并正确引用 Windows Node 路径；打包契约从真实插件 importer 解析锁定依赖。生产权限、来源校验、断言和时限保留。
3. **TF-0253 最终证据漏跟踪**：三份原文件与原验收提交逐字节一致，40 个原源码摘要匹配；增加精确保留规则与输入检查，没有改写历史候选或 verdict。
4. **插件资产漏构建/复制**：完整 runtime 构建现在执行既有 asset build/copy hooks。实际 Diffs 资源读取从 `ENOENT` 变为 5,333,988 字节；Canvas 的交付复制也已验证。此修复没有让随后失败的 NSIS 门变成通过。
5. **Agent Dev 旧证据**：通过真实 fresh/full 门重新生成 5 份受跟踪输出，严格 audit 与 Harness CI 通过。

代码修复均经过独立新聊天审查。审查发现的 importer 解析基点问题已修复并获 approve；后续交付审查的 request_changes 保留，未混为一个“全部批准”。

## 边界与收尾状态

- 实际执行范围是 Windows x64。真实付费模型、macOS/Linux 执行、交互安装/卸载/升级没有验收。
- CVK 仅报告诊断是当前规范明确要求，不将其未阻断工具调用误报为漏实现。
- PPTX 当前固定三页模板拒绝超量记录；短例已经生成，不能外推为任意长文本的视觉分页合格。
- 原 Task Forest 的空 todo 不代表无问题。历史偏差账本仍有 81 条未结记录（33 条缺状态）；落库检查有历史祖先/归档告警，不能把告警条数当作当前软件缺陷数。
- 共享工作区的 `resources/brand-exploration/` 被完整保留，未提交、未纳入本轮冻结候选。
- 真正失败项继续保持开放，并记录具体下一步；不以“等待真人”作为理由，不改变 `liveReady/productApproved/defaultOn`。

原始日志、JSON、trace 和截图已复制到本地私有归档，索引见 [candidate-proof-index.json](../../.local/full-acceptance-20261005/candidate-proof-index.json)。最终保留目录只含机器摘要、凭据扫描和 SHA-256 清单；本报告不授权发布。
