# Project RAG RAG-06 验收证据

本目录记录候选 `5c15e3507340b679986377026665b80585d1efbc` 的 agent 驱动正式验收。21 项门禁全部退出 0；root unit 308/308，runtime unit 33/33，Electron journey 1/1 零 skip/flaky。

容量报告使用确定性合成 768 维向量，分别覆盖 portable 20k 与 LanceDB ANN 100k。SQLite/LanceDB 数据文件是可重建的测量产物，保留在 `D:\tmp\project-rag-TF-0883\formal-5c15e3507-rag06-20261111-final3`，本目录保存报告、日志、截图、lifecycle receipt 与 SHA256SUMS。

- portable：Recall@20 1.0，热查询 P95 25.37 ms，峰值 RSS 944.8 MiB，磁盘 86.3 MiB。
- ANN：Recall@20 1.0，热查询 P95 409.47 ms，峰值 RSS 1119.1 MiB，磁盘 817.0 MiB。
- Electron：portable、ANN 切换、即时 ACL、未索引追加、重启恢复、删除、workspace 隔离和禁用全部通过。
