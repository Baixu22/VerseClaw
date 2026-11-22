---
driven_by: agent
actor: codex-g7-inline-spill-tf0749-01a1d34c
realHumanEvidence: false
---

# G7 最终卫生复核

已提交验收证据的110条卫生诊断已清零：15份UI层级文件加入精确保留清单，80份G8日志和截图
增加逐文件ignore例外。原95份证据全部SHA256一致，G8原始清单逐项匹配，证据内容和候选不改。
四个未生成的未来输出路径检查仍被忽略；既有95份证据全部可正常入库。

repo:artifacts:check退出0、issues=0；重复检查33组匹配、退出0。保留规则回归1文件13项通过，完整Harness CI的59项测试通过并退出0。
本次只修改.gitattributes、.gitignore、scripts/repository-artifacts.json、收尾spec与本证据目录。
G7已完成的B1–B7及TF-0700/TF-0749状态保持；原失败、模型结果、阈值和生产默认保持。

旧归档工作树的空目录已在2026-11-14移除。三棵D盘检出和原始临时证据已在上一收尾封存、清理；
当前G7会话主检出仍为Codex保护的clean工作树，其可再生输出已清理，唯一原始证据保留于
D:/ClawX-archives/g7-inline-spill-20261113-01a1d34c。

复现：pnpm repo:artifacts:check；pnpm repo:duplicates:check；
pnpm exec vitest run tests/unit/repository-artifact-retention.test.ts --maxWorkers=1。
所选Harness validate和dry-run退出0；TF-0749从磁盘回读done/100。最终提交/main/私有远端身份从本地最终交付回执回读。
