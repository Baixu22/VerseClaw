# 可复算 legacy 恢复基线

候选 9e23819203590366c78c64402be455e28fde3440 的两轮 legacy 各15个故障窗口均完整，原冻结投影逐槽15/15匹配，结构哈希 689c99ac956746a62f6173028bb93cdc4486f0efcfcbc31d4f04b6d9aec6ba6b。五个窗口各3次，另保留同候选30份真实模型质量答案。

基线指标由原评测器重算，结果为 FAIL；baseline-report.json 给出九指标、样本量与实际失败。这里完成基线采集和一致性验收，GA状态为NO_GO。

原13/15不完整复跑、12/13子集匹配及Windows启动器导入失败保留在raw-evidence.json.gz。所有产物为agent驱动；SHA256SUMS可复算封存文件。
