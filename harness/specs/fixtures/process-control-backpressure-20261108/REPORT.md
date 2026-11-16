# 进程控制与日志背压验收

验收候选 `0fc3dc067c242e1622968608d4276009b3ba5f97`；交付提交 `228d717b476a10db578a9e01574af8edbcac81fa` 仅追加主线证据和合同基点，产品与测试文件逐路径diff为0。

86项测试全部通过，无跳过；5项旧源码负例已复现。真实Node协议server验证一个executor的两个生命周期互不误关，真实发布ae.exe验证16个poll下stdin/kill、输出洪泛、artifact head/slice和owned子树退出。
该原生跑次stdin为779.5ms、kill为3.4ms，控制期限仍为5000ms。输出保留32768字节，stdout/stderr共用32768字节上限。

Node/Web类型、lint、契约、四语、通信、Harness、retention及diff通过。runtime完整类型检查exit2，基点与候选均38项既有诊断，新增0；完整日志与逐项差异在runtime-type-comparison.json及原始索引。

CLI/native对照为每组8次相同文件读取，各模式4轮。
| 模式 | 中位耗时ms | 每轮新增进程 |
|---|---:|---|
| cli | 1032.35 | [8, 8, 8, 8] |
| batch | 123.07 | [1, 1, 1, 1] |
| server | 9.43 | [0, 0, 0, 0] |
| native | 1.66 | [0, 0, 0, 0] |

既有typed server冷启动1189.8ms、1个常驻executor；working set/private与host RSS分别记录。保留现有native读和typed执行路径，不新增通用常驻CLI中转。

正式原生验收使用与发布manifest完全同哈希的独立ae.exe副本；原安装路径的E_PROCESS_PERSIST在旧main也复现。二进制内容和原路径配置均未修改，诊断构建仅用于定位。

所有证据均为agent驱动；SHA256SUMS覆盖本目录，credential-scan零命中。
