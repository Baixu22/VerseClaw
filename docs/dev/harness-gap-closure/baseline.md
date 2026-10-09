# B00：来源基线与最小实施边界

2026-10-09，actor: codex-baseline-executor；driven_by: agent。

## 交付与使用

本包交付30个来源槽位、29个后续工作包的精确文件/入口/spec/测试边界及可失败校验器。动态状态仍只在本地Task Forest；本报告不是运行时功能或全系统验收。

- 清单：`source-inventory.json`。每项只有一个主owner；HG22/HG27来源未恢复，不编造需求。
- 核验：`node scripts/check-harness-gap-baseline.mjs`；测试：`pnpm exec vitest run tests/unit/harness-gap-baseline.test.ts`。当前源核验与不可变结构测试分开，后续改动不应悄悄刷新本历史基线。
- 当前候选、原始运行、退出码/计数/耗时、独立核验、扫描与未执行范围见 `baseline-evidence.json`。
- sourceBaseline标识核查生产源的已提交基线；新清单/脚本的冻结候选另行记录。复用现有依赖，不声称全新安装通过。

## 已证实的纠偏

1. approvalPromptRate零样本也返回0；计数来自工具破坏层分类、早于execute，并不能证明审批UI出现。O01必须携带样本/窗口/缺测语义，不能用rate=0宣称正常。
2. classification-only总表不表示没有拦截：command/message/secret/外写/browser/credential已有窄策略；先复用原正反回归，只补证实的旁路。
3. 三份局部ablation和Working Context的JSONL、projection、stage3消费者已存在，不重造store或实验平台；日常跨层消费、配对收益和可靠性仍归后续包。
4. 六个pilot分别保留原spec门限与回退，不能用Active Pilot Gate标题、近似p99或旧报告作为当前PASS。A4生产caller和已缺失的旧测试路径单列。
5. 原工作区含其他dirty改动；本包使用独立工作树，快进至已落地主线后发现4份spec引用摘要漂移及1份已归档报告。四份spec只有文档保留路径变化，未改验收阈值；完整失败结果保留，不沿用旧绿灯。

## 历史证据摘录（不复活被清理文件）

A5历史报告基线为734ec877e75682861103660fbdea2bd55253ece0，仅shadow/diagnostics-only，不是当前pilot验收。

该事实从旧源commit 9a48096f94a5df7cd0c9b127c929e57f597d6c50中的reports/context-compression/P5-EVIDENCE-2026-08-17.md复核；原路径已按仓库保留策略归档。原摘要/路径/commit保存在清单historicalEvidence.originalSource，原始读取及摘要比对保留在本地证据。当前引用仅指向本摘录，不暗示原报告仍是当前源码。

HG22/HG27的原登记表在已检出的源树未找到；全引用历史搜索可能遇缺失Git tree，失败必须保留。检索范围有限，不能推导所有历史都无文件，更不能推导功能不存在。

## 验证和授权边界

B00不改生产代码，不发外部请求；生产effect、UI、通信回放和产品故障恢复不适用于本包。正常/非法/缺失/重复/漂移/恢复由清单校验器回归覆盖。后续包仍必须验证真实caller→decision→effect/零effect→continuation。

productLocks来自原文件快照；live_ready/product_approved/default_on保持false。实验参数仅为fixture，不是生产默认；没有发布、模型调用或产品解锁。README.md、README.zh-CN.md、README.ja-JP.md按无用户行为/接口变化复核，不改宣传。

回滚：本包只有新增开发文档、清单与验证器，可撤回本包新增文件；生产行为和产品锁无需回滚。下一包按当前TF依赖选择O01，先解决分类计数和缺测语义，再接已有消费者。
