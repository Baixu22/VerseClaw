# TF-0582 接力：产品矩阵与首批验收

driven_by: agent；actor: codex/tf0582-relay。

已建立九组产品矩阵，关联 28 份现有 Electron 测试并覆盖 13 项默认能力的验收映射。测试源码 SHA 冻结后，删除用例或削弱断言会使矩阵检查失败；运行结果同时核对发现清单、实际用例、退出码、跳过、重试与来源变化。

源码候选：`c210571ecc9449a02364dadd8ade6364a73a6f01`。复用本机已安装依赖；具体版本见 `validation.json`。

| 验证 | 结果 |
| --- | --- |
| 矩阵回归 | 10/10，通过；0 failed、0 skipped |
| Settings/诊断 Electron 批次 | 6/6，通过；0 failed、0 skipped |
| 桌面与运行时构建 | 通过，构建清单 7425 个文件 |
| 来源与进程清理 | 源码未改变，遗留测试进程 0 |
| 类型、lint、专项 Harness、通讯回放与比较 | 通过，命令和退出码见 validation.json |

支持包已在临时 profile 清理前写入测试输出，脱敏校验和真实 Gateway child mirror 均已直接读回。原始数据归档的 CRC 与逐文件 SHA256 已验证，恢复入口见 `raw-index.json`。

首轮构建缺少生成的扩展桥接，未执行 Electron 用例；第二轮 6 个用例通过，但原支持包随临时 profile 删除；第三轮在用例收集阶段超时，0 个测试执行。前三次记录保持原样，第四轮保留了可读回的业务产物。

TF-0582 保持进行中。后续继续其余八组，并补齐真实知识与记忆消费、直接工具调用、Doctor、三组重复 live 旅程、20 分钟探索和 Judge 校准。完整检查清单保存在 `validation.json` 的 `remainingAcceptance`；TF-0584、TF-0585 仍按原依赖推进。
