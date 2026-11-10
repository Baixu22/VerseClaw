# 工作树回收保护增量

Windows 源码组合回归77项全部通过；提交后的干净检出16项保护检查全部通过。Node/Test类型、Lint和Harness检查通过，指定Codex/DeepSeek复审无finding。

复用原执行域屏障、工作树registry与writer，保留忽略文件和未保留内容/权限。原生Git dirty refusal按已知无效果结算；EACCES、I/O与未知失败保留unknown。原Git无force删除与共享ref保留准则继续生效。

本增量交由原U6/TF0867会话合并；R4候选pipeline继续由原R4会话完成，原节点保持in_progress。
