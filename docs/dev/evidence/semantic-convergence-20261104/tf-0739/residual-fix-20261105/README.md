# TF-0739 残留修复（2026-11-05）

干净源码候选：`b5558f44aa78398aacef3ef9345ff776e593353c`。全部检查由 agent 驱动。

RSI 运行结果已有 promotion，但类型声明缺项；现已对齐共享类型及全部现有返回字段。COMPASS SSP/retrieval 已退役，入口测试改为验证退役输入不能上 wire、不能计费；另用有效知识 Block 保留预算占满后拒绝原子替换的回归覆盖。产品运行逻辑与默认值保持。

完整入口套件 23/23、RSI 11/11、退役契约 7/7 均通过，全量 uncached node/web/test 类型检查 exit 0。结构化复核 exit 0 / 0 findings。详见 report.json、commands.json 和测试 JSON。

上一份 report.json 与哈希保持历史原样；本补充只记录本次候选。模拟 transport/provider 响应不能外推为 live-provider、全 runtime 或 GA 验收。
