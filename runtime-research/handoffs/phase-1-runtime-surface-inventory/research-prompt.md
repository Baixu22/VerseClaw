# Copy-Paste Prompt For Phase 1 Research

将下面提示词复制到每个并行窗口。复制前把 `<LANE_ID>`、`<LANE_TITLE>`、`<LANE_SCOPE>`、`<OUTPUT_FILE>` 替换成 `parallel-lanes.md` 中对应内容。

```text
你现在负责 ClawX Agent Runtime 迁移计划的第一轮调研，不做代码迁移实现。

工作区：C:\Users\27933\Desktop\clawx\ClawX
本轮 handoff 目录：
runtime-research/handoffs/phase-1-runtime-surface-inventory

你的 lane:
LANE_ID: <LANE_ID>
LANE_TITLE: <LANE_TITLE>
LANE_SCOPE: <LANE_SCOPE>
OUTPUT_FILE: <OUTPUT_FILE>

硬性要求：
1. 先阅读：
   - runtime-research/agent-runtime-index.md
   - runtime-research/migration-execution-plan.md
   - runtime-research/implementation-roadmap.md
   - runtime-research/agent-runtime-core-spec.md
   - runtime-research/handoffs/phase-1-runtime-surface-inventory/README.md
   - runtime-research/handoffs/phase-1-runtime-surface-inventory/submission-template.md
   - runtime-research/handoffs/phase-1-runtime-surface-inventory/parallel-lanes.md
2. 只调研当前实现和测试，不做 runtime 迁移代码修改。
3. 所有结论必须有本地文件路径、函数/类名、测试名或命令输出证据。
4. 如果找不到某个入口，记录你运行过的搜索命令和无结果结论。
5. 不要推翻 runtime-research 现有设计；如果发现当前代码与设计冲突，把冲突写入 Design Conflicts。
6. 只写你的 OUTPUT_FILE，不要修改其它 lane 的提交文件。
7. 输出必须严格使用 submission-template.md 的标题结构。格式不合格视为信息丢失。

推荐流程：
1. 根据 LANE_SCOPE 用 rg 搜索相关入口。
2. 阅读最小必要代码和测试。
3. 画出当前调用链，用文字或 mermaid 均可。
4. 标注 legacy path、migration seam、risk、test coverage。
5. 写入 OUTPUT_FILE。
6. 最后运行：
   rtk rg -n "Evidence Table|Legacy Surface|Migration Seams|Design Conflicts|Recommended Next Slice" <OUTPUT_FILE>

最终只提交调研文档，不提交实现代码。
```
