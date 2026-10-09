# Harness 缺口闭环：开发—测试—验收设计

日期：2026-10-09（Asia/Shanghai）。性质：**规划合同，不是实现/验收报告**。

本文件固定范围、来源映射、实验与收口合同；**状态、依赖和每包详细开发/测试/验收只以本地 Task Forest 为准**。包码用于稳定引用，不是第二份进度账本。原有节点和当前真实模型证据任务保持不变；本次不改产品代码、默认值、产品锁，不发布，不触发付费调用。

## 1. 来源校正与限制

核查起点HEAD为 2749f07b2a5555f65ec45155a5936c038de5b53d，工作区已有其他任务未提交改动。用户提及的 docs/research/harness-gap-register-2026-10-08.md 在当前检出及核对的两个现有工作树未找到；**没有把新文档冒充原始登记表**。

用户摘要称14+8+5+3=30：第2类只展示7条；第3类没有逐项展开5条。因此保留30个**来源槽位**：28个可识别主题、HG22/HG27两个来源不完整槽位。分类与映射为本次重建，不能声称与缺失原表逐行等价。B00负责从仓库事实补证，找不到原条目则记录无法恢复，不等待真人、不编造需求或功能完成。

| 对象 | 当前代码/规范定位 | 规划结论 |
|---|---|---|
| approvalPromptRate | openclaw_runtime/src/context-engine/coding-observability.ts:216; shared/dcs/prod-flags-catalog.ts | 当前已算出/已登记；限定路径检索未发现消费。不是零工程：仍需消费者、窗口、缺测、告警恢复测试。 |
| 内容守卫 | openclaw_runtime/src/agents/stage1-request-envelope.ts; shadow-census.ts | 文件头说明shadow-only、不改变请求字节；S01验证一个适配器的发送前拒绝，网络SSRF规则独立。 |
| sink来源 | shared/security/content-provenance.ts; harness/specs/tasks/*provenance-boundary.md | 11来源/4信任/6sink、5个classification-only成立；但network、secret、write、browser、credential已有窄策略和测试，不能说5类都无拦截。 |
| 现有消融 | tests/unit/runtime-memory-embedding-ablation.test.ts; runtime-memory-mvp-module-b-ablation-test.test.ts; runtime-memory-phase4-ablation-benefit.test.ts | 已存在局部/合成消融：mock embedding、21融合变体、Phase4组件对照；缺口改为受控生产消费者和可归因闭环证据。 |
| Working Context | electron/services/task-ledger-working-context.ts; shared/task-ledger-working-context.ts | 已复用JSONL append/read/projection；历史3/10→1/10评分不等于当前集成覆盖，需现场复验。 |
| EffectReceipt | openclaw_runtime/src/agents/effect-receipt.ts; apply-patch-effect-receipt.ts | 已有实现；本计划只核memory写入调用面与恢复闭环。 |
| A1–A6 | harness/specs/tasks/a1-*至a6-*-pilot.md | 标题Active Pilot Gate不是当前状态或验收结果；逐方向引用原门限，不能一项ablation覆盖全部。 |

这是规划前的定向核查，**未运行上述产品测试**；已有文件/测试不等于当前候选通过。本次不沿用历史验收数、自评分、spec数量或旧候选PASS。

### 30个槽位的追踪

| 槽位 | 主题 | 主责任包 | 来源状态 |
|---|---|---|---|
| HG01 | 上下文压力下的焦虑式提前收尾 | L02 | 用户摘要可识别；缺口判断须按当前实现复核 |
| HG02 | 调用速率级断路器 | L05 | 用户摘要可识别；缺口判断须按当前实现复核 |
| HG03 | pass^k可靠性聚合 | E01 | 用户摘要可识别；缺口判断须按当前实现复核 |
| HG04 | 可归因的组件消融 | E02 | 用户摘要可识别；缺口判断须按当前实现复核 |
| HG05 | flake率阈值 | E01 | 用户摘要可识别；缺口判断须按当前实现复核 |
| HG06 | 交接深度约束 | L02 | 用户摘要可识别；缺口判断须按当前实现复核 |
| HG07 | 热点文件写入归属 | L06 | 用户摘要可识别；缺口判断须按当前实现复核 |
| HG08 | 规范僵化 ossification | G02 | 用户摘要可识别；缺口判断须按当前实现复核 |
| HG09 | doc-gardening | G02 | 用户摘要可识别；缺口判断须按当前实现复核 |
| HG10 | 错误即受控修复指引 | G01 | 用户摘要可识别；缺口判断须按当前实现复核 |
| HG11 | 周窗口trace转eval | G03 | 用户摘要可识别；缺口判断须按当前实现复核 |
| HG12 | 运行中steering | L03 | 用户摘要可识别；缺口判断须按当前实现复核 |
| HG13 | 持久化挂件/恢复检查点 | L04 | 用户摘要可识别；缺口判断须按当前实现复核 |
| HG14 | 轨迹采样 | O02 | 用户摘要可识别；缺口判断须按当前实现复核 |
| HG15 | Provider内容Guard拒绝路径 | S01 | 用户摘要可识别；缺口判断须按当前实现复核 |
| HG16 | 敏感sink覆盖闭环 | S02 | 用户摘要可识别；缺口判断须按当前实现复核 |
| HG17 | approvalPromptRate消费者 | O01 | 用户摘要可识别；缺口判断须按当前实现复核 |
| HG18 | memory写入Effect边界 | S06 | 用户摘要可识别；缺口判断须按当前实现复核 |
| HG19 | verifier完成裁决权限 | S07 | 用户摘要可识别；缺口判断须按当前实现复核 |
| HG20 | 正向放行锚点 | E01 | 用户摘要可识别；缺口判断须按当前实现复核 |
| HG21 | requestId与cost关联 | O02 | 用户摘要可识别；缺口判断须按当前实现复核 |
| HG22 | 原第2类未展示的第8条 | B00 | 来源未完整展示；待仓库复核，不虚构内容 |
| HG23 | 工程与集成证据落差 | V01 | 用户摘要可识别；缺口判断须按当前实现复核 |
| HG24 | Working Context任务账本集成 | L01 | 用户摘要可识别；缺口判断须按当前实现复核 |
| HG25 | A1–A6有效pilot证据 | A01 | 用户摘要可识别；缺口判断须按当前实现复核 |
| HG26 | 产品锁维持false（约束，不是缺陷） | V03 | 既有产品约束；不授权解锁 |
| HG27 | 原第3类未明确展开的条目 | B00 | 来源未完整展示；待仓库复核，不虚构内容 |
| HG28 | 规范数量与有效性风险 | G02 | 用户摘要可识别；缺口判断须按当前实现复核 |
| HG29 | AGENTS入口过重风险 | G02 | 用户摘要可识别；缺口判断须按当前实现复核 |
| HG30 | 任务账本承担多种职责的集中风险 | L01 | 用户摘要可识别；缺口判断须按当前实现复核 |

HG16由S02主汇总、S03/S04/S05各验一个独立出口，command-exec作为已有正反回归基线；HG25由A01主汇总但A01–A06分别拥有各方向验收；HG04由E02首轮、V01集成复验。一个槽位只有一个主责任，不丢跨包贡献。HG26是约束，不能创建“把false改成true就完成”的任务。

## 2. 分期与依赖原则

| 阶段 | 交付目标 | 包码 | 目的 |
|---|---|---|---|
| B | 核准缺口与既有实现 | B00 | 按当前调用链校正研究结论，冻结非默认启用范围。 |
| E | 先接观测消费者并做可重复实验 | O01、O02、E01、E02 | 审批率、请求成本与可靠性口径先落地，再运行首次配对消融。 |
| S | 补齐内容与副作用窄边界 | S01、S02、S03、S04、S05、S06、S07 | 复用既有 Guard、来源与 EffectReceipt，逐出口验拒绝和放行。 |
| L | 完成长任务状态与恢复闭环 | L01、L02、L03、L04、L05、L06 | 以现有任务账本为真源，连接上下文、交接、steering、恢复与速率限制。 |
| G | 让维护与评测持续反馈 | G01、G02、G03 | 错误可修复、规范可维护、脱敏轨迹可转回归。 |
| V | 完成集成、各方向 pilot 与交付裁决 | V01、A01、A02、A03、A04、A05、A06、V02、V03 | 独立验证真实消费者、收益、恢复和残余边界，保持产品锁。 |

共30个可执行包、6个阶段、1个总目标。各包内包含开发、定向测试、验收和回滚，不拆成90个空壳测试子节点。详细条目通过正式proposal写进Task Forest。

推荐起步顺序：**B00 → O01 → O02 → E01 → E02**。逻辑依赖不是全队列强行串联：安全修复只依赖基线和评测锚点，**不等待收益消融**。实际执行一次只推进一个ready包，其余保留proposed。现有TF-0263真实模型工作不被中断或改状态，不把资源竞争伪装成技术depends_on。

首轮消融选择已有可逆非安全组件；Guard和sink的拒绝实现与安全验收是独立必需项。A1–A6分别读原spec的fallback、p99、恢复等门限，不得重定义毕业标准。收益显著也不授予verifier全局权限或修改产品锁。

## 3. 每包执行合同

1. **进入**：读当前图与来源槽位，核对depends_on、dirty与已有测试。运行 pnpm harness context --spec <本包spec>。没有合适spec时补一个窄task spec，不一次新增30份模板。后端/通信改动引用 gateway-backend-communication。B00把候选路径收窄为明确ownedPaths后才能实现，目录级定位不代表全目录写权限。
2. **设计和复现**：确认已有生产caller、trust boundary、最小失败反例、正向必须放行样例、effect发生前后位置。既有实现足够时只补验证/接线，不重复建store/registry/router/指标平台。
3. **开发**：一次一个ready包，复用host-api/JSONL ledger/receipts/trace/scenario registry。开发Task Forest不作为产品Working Context存储；不改变冻结默认和产品锁。
4. **定向测试**：每包至少覆盖正常、拒绝/缺失/非法输入、失败/超时、重试/重复/乱序、恢复的适用矩阵，不适用须给理由。断言最终副作用和消费者，而非只spy helper。来源场景覆盖trusted/operator/untrusted/derived/missing/invalid。
5. **入口集成**：原始输入→真实caller→decision→effect/零effect→receipt/状态→continuation。UI改变必须四语言i18n+design tokens+Electron E2E/截图；通信改变必须comms replay+compare；host contract改变必须contract check。
6. **审核**：pnpm harness validate --spec <本包spec>（不使用--no-diff掩盖范围漂移）；pnpm harness run --spec <本包spec> --dry-run确认门选择。定向lint/适用typecheck与原spec requiredTests记录command/exit/count/timing/未执行项。dirty外部改动独立报告，不扩大ownedPaths来放行。
7. **冻结与验收**：正式运行使用clean candidate commit/tree。Executor与独立Verifier从原始产物交叉核查；两角色可由脚本/agent实现，记录actor，不把实现者自述当独立验证。改变候选使受影响旧证据失效。
8. **收口**：回读全部AC、证据、hash和扫描；保存proposal，base_graph_hash匹配才apply，随后validate/export。不足项仍未完成，技术失败继续修复；不要求真人数据/verdict。锁或发布决定另行升级，不是内部受控验收前置。

### 正式全门（V02，不在本次规划阶段运行）

- pnpm test；pnpm run typecheck（uncached）；适用runtime项目类型与测试；定向与正式lint。
- pnpm run comms:replay；pnpm run comms:compare。禁止随意刷新baseline消除回归。
- pnpm contract:check；pnpm i18n:lint；pnpm run build:vite后原spec要求的完整Electron测试（Windows执行）。
- pnpm run harness:ci；全部本次task spec validate与实际required profiles。
- Agent Dev控制面改变：fresh/full pnpm agent-dev:deep-test及pnpm agent-dev:audit；缓存/复用/smoke只算daily-loop。
- 原spec独立Executor/Verifier、故障恢复、进程残留和锁快照。全门不是每次小改都跑，但最终不能拿focused替代。

## 4. 评测、实验与阈值

**阈值性质**：以下是新测试/实验预登记合同，不是生产默认修改；既有spec更严格时从严。B00记录冲突并通过正式提案修订实验口径，不能跑完后调阈值。

- 审批率仍用prompts/(prompts+skips)。O01试验：最近100次有效决策、至少20样本，rate≥0.5连续两窗触发，≤0.3连续两窗清除；记录时间、样本与缺测。仅告警，不自动审批、不改安全策略。
- 可靠性：k=3、至少20个核心场景；pass^k为全部k次成功的完整case比例，另报逐trial成功率。缺跑/超时/崩溃/skip不能静默删除，缺跑即不完整。不得混用pass@k。
- flake：同候选固定重跑后由初次失败变成功的case比例，保留首次失败；安全必测0 skip/0 flake，规定语料内良性放行/恶意拒绝100%；非安全flake≤1%，同时报告样本不足，重试成功不洗掉原门失败。
- Ablation：至少20case×3重复×2条件，固定候选/语料/模型/采样参数、配对seed、随机顺序、隔离状态。先验证组件生效/移除痕迹，再报任务成功、pass^k、tokens/cost、p50/p95、误拦截、安全违规、效应量及95%区间。主指标/退化预算先登记，不能事后挑赢家。零/负效应是有效实验结果，但不表示功能完成或应扩大启用。
- 无真实provider调用则明确synthetic/local-fixture，不升级为live。已有获准资源可用就自动执行；确需新第三方资源时汇总一次凭据/端点请求，不索要真人操作/数据。
- 速率fixture用虚拟时钟10请求/秒、cooldown2秒、half-open单探测；这是边界测试，不是生产配置。不得移除SSRF、loop guard或审批使实验通过。
- 交接fixture深度3/最多2次转交；生产阈值仍受既有配置与基线约束。

## 5. 证据与完成判据

每包保留candidate、commands、原始events/cases、metrics、verdict、rollback与hash索引（沿用原schema，不强造新框架）。最低字段：candidate commit/tree/dirty=false、runId、actor、driven_by=agent、数据来源、场景/seed、起止、command/exit/count、decision、continuation、覆盖面/残余与证据摘要。

原始运行可归私有本地目录；稳定spec、fixture、精选最终报告进入跟踪源码。最终SHA256SUMS覆盖保留文件（manifest自身按既有约定处理），credential scan必须0命中。未知价格、未跑平台、未完成CI、无统计把握写unknown/not-measured，不填0或PASS。

完成必须同时满足：实现及真实消费者接通、正反与故障恢复证实、必需门通过、当前候选可重放、残余与声明一致。仅“决策报告写完”不能关闭缺实现的包。0误拦/0绕过仅限规定语料，不推导世界范围无风险。

## 6. 不做项与风险

- 不从摘要直接启动30个新功能，不重写已有sink/EffectReceipt/ablation/ledger。
- 不把产品锁和来源缺项当功能bug，不把评分低当生产故障证据。
- 不引入第二任务真源、通用taint引擎、新插件平台、后台daemon或多agent高并发写。
- 不新增定时automation；“周trace”先交付显式触发的最近7天批处理。
- 不改旧done，不中断TF-0263，不清理/重置其他dirty工作，不改锁/发布/公开/付费配置。
- NO-GO可来自收益不足、误拦截、consumer未覆盖、样本/候选证据失效；分别修复或明确受控裁决，不能靠叙事宣布通过。

## 7. 本次规划检查与README复核

检查proposal预校验、apply base hash、validate、单HTML导出及未开始任务计数；检查37个新增节点、30执行包、30槽位唯一主owner、无环依赖和每包开发/测试/验收/回滚。运行本规范Harness context/validate/dry-run与既有Harness结构单测，区分dirty范围门与隔离文档验证。**PASS只证明规划结构有效，不证明30包已开发。**

README.md、README.zh-CN.md、README.ja-JP.md按只新增规划的边界复核：无当前用户行为或接口变化，本次不改产品宣传；后续功能包同变更同步。

本次任务图入口：总目标 TF-0264；首个ready TF-0271（B00）；之后建议 TF-0272审批率、TF-0273遥测、TF-0274可靠性、TF-0275首轮消融。编号仅为定位，实时状态以本地Task Forest为准。
