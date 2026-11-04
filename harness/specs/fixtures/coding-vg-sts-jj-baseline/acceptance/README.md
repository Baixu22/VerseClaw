# TF-0764 当前编码与组件基线

- driven_by: agent；actor: codex-coding-c0-builder；realHumanEvidence: false
- 受测候选：27bd9df474236a52da03fd6b63613b66d0cc6af4，tree=811915f1ad0bfde40c90d7821878ff4e01d86188，dirty=false。
- 基线结论：established；产品结论：needs-fix。10/10 原审计发现复现，本节点没有修复这些产品问题。
- 固定50项源码/规格输入，13项能力边界；STS契约1.1/2.0共69条摘要通过，wheel的96个源码/契约文件逐字节匹配。
- 定向单元测试：5文件、46 passed、0 failed、0 skipped。包含证据篡改/缺失/错候选/错误范围的9个拒绝对照。
- 语料：httpx、packaging精确commit/tree，以及ClawX TypeScript；完整协议在同目录上层evaluation-protocol.json。C0只锁输入，不宣称已测性能或模型质量。
- JJ的内部jj-lib=0.46.0已绑定，独立CLI oracle未执行；后续TF-0776负责供给/固定并对拍。
- 依赖和VG/VS二进制复用已有安装/构建，经锁文件或manifest绑定；不是fresh-install/source-rebuild证据。

复核本包：node scripts/coding-baseline/verify.mjs harness/specs/fixtures/coding-vg-sts-jj-baseline/acceptance/report.json

重新生成请运行node scripts/coding-baseline/run.mjs --help，提供固定VG源码、STS解释器/构建wheel、两个固定语料检出和新的输出目录。新目录必须位于忽略的.audit内或仓库外。驱动拒绝dirty候选与覆盖旧跑次。

源码、安装包、真实模型、性能和恢复收益分别裁决；A1-A10未修复，不能把基线门通过写成GA。下一执行叶TF-0765。原失败跑次保留于acceptance.json的retainedFailure，原d8d1691a2审计与本次结果不互相覆盖。
