# P0 记忆评测完整性修复

启动：2026-10-09；本次更新：2026-10-10。driven_by: agent；actor: codex-p0-remediation。

## 范围与证据边界

本轮以 GitHub 开工时的六个 P0（#62、#134–#138）为范围。只修改评测、回归检测与证据契约，不改变 Runtime Memory 产品默认值、产品锁或发布状态。历史 0.752 / 0.452 未找到可验证的逐题运行记录，不能作为已测量能力基线。新模型运行即使成功，也不能倒推验证这两个旧数值。

## 已实现的指标修复

- **#134**：LoCoMo 的 evidence 是轮次 ID。评测的 cached/fresh 两条路径均用该会话的真实 turn-text map 解析，再计算词级上下文覆盖；合并 ID、零填充和数据集中的 D:11:26 形态均规范化。空 evidence 计 0；无法解析的 ID 留在分母中作未命中，不再获得满分。缺少解析表却传入 ID 时直接报错。这个字段是**最终上下文的词级覆盖诊断**，不是主检索指标，更不能混同 L2 之前的检索效果。
- **#137**：保持 frozen-v2-generous-2026-07-04 judge 的冻结规则原样；显式披露部分正确、列表覆盖 50%、日期相差 14 天、子串/超串、同实体别名都可以判 CORRECT。外部论文值放入 references，整体 judgeComparable=false / rankingAllowed=false；控制台也不把 ours 混排。不同 judge、数据或管线下的分数不可直接比较。

## 仍须完成的验收

- #135：代码已输出 L0/L1/L2 分数与占比、L0+L1 子集和选择偏差；空子集为 null，不给满分。schema 校验各层计数、全量/子集加权分数及 full_conversation_rate，拒绝把全量 J 冒充纯记忆分。**原管线真实运行仍待完成**。
- #136：已修复比较器的漏报：整体/类别检索 proxy 回归独立置失败，J 上升不能抵消；新增不同/未知 judge 的不可比警告，context_recall 仅在定义相同的版本间比较。直接读取仓库历史文件得到 temporal -0.1195185185，而 J +0.4533333333；这仍是未经验证历史聚合值的算术，不是可重复的实测退化或已恢复检索质量的证据。真实配对复验随 #138 的资源齐备后运行。
- #138：完整逐题产物、来源指纹与失效门。现有历史 fixture 不得改标签冒充新运行。StepFun 生成/判分资源已通过真实探针，原混合检索管线另需 SiliconFlow 嵌入资源。
- #62：fsck exit 2，all-history 遍历 exit 128，仍缺 29 个对象；精确哈希 fetch exit 128，13 个相关本地镜像均不含这些对象。保留三个 rescue 引用，未 prune / gc / 删除历史，未改 main 或主工作区内容。

## 开发验证与省略项

第一批：context-recall + locomo-pipeline 共 41 passed / 0 failed / 0 skipped。测试直接使用 locomo10_raw.json 的真实 ID 形态，但这是确定性代码回归，不是真实模型评测。完整门禁收据保存在 D:/ClawX-work/p0-issues-20261009/，后续完成项在本文件追加实测结果。

已检查 README.md、README.zh-CN.md、README.ja-JP.md、README.ru-RU.md：均无 LoCoMo/SOTA/0.752/0.452 声明，本轮不改变用户产品流程，因此无需翻译界面或改 README。未宣称完整单测、Electron E2E、打包、发布或完整 500 题通过。

## 第二批开发检查（2026-10-10）

- 四个聚焦文件：93 passed / 0 failed / 0 skipped。原测试曾把 temporal 下降的样本断言为无回归，现改为明确检测下降；历史文件 I/O 测试不再临时写入伪造的“真实 baseline”。
- 测试项目类型检查、scoped ESLint、comms replay / compare 均 exit 0（通信是确定性回放，不是真实模型或渠道验收）。
- 本地 TF-0305=in_progress。首次 proposal-apply 返回 exit 1，但回读已为 applied 且节点存在；没有重放应用。随后 validate/export 均 exit 0，129 条历史偏差中 85 条未结不属于本轮清理范围。
