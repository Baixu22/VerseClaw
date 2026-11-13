---
lifecycleStatus: active
id: coding-sts-selection-evaluation
title: TF-0778 STS 选择完整性、契约版本与真实净收益
scenario: versegit-validation-layer-extension
taskType: evaluation
diffBase: ccdec60606198df406b63515b7ae2a82b20f977b
intent: 在干净安装与真实 VG 宿主下验证 STS 1.1/2.0 契约、pytest 选择完整性、负例拒绝和两个真实项目的同候选 selected/full 全链成本，不把 selected 升级为 full。
ownedPaths:
  - harness/specs/tasks/coding-sts-selection-evaluation.md
  - scripts/coding-evaluation/sts.py
  - scripts/coding-evaluation/verify-sts.py
  - scripts/coding-evaluation/test_sts_evidence.py
  - harness/specs/fixtures/coding-evaluation/TF-0778/**
requiredRules:
  - disk-temp-policy
  - repository-artifact-retention
requiredProfiles: []
expectedUserBehavior:
  - 当前候选只在已声明的 Python/pytest 支持域内提供选择；选择默认关闭，1.1 历史路径与显式 2.0 路径各自产出可复算的 request、plan、result 和 consume。
  - 漏选、零选择、收集失败、nodeid 漂移、参数化或 conftest/plugin 变化、flaky、timeout 和环境漂移均被明确分类并拒绝错误通过。
  - 两个固定 pytest 项目报告同候选 selected/full 的样本量、冷热 wall、RSS、执行数与清理成本；没有净收益时保留事实，不宣称提速或默认毕业。
requiredTests:
  - python -X utf8 -B scripts/coding-evaluation/test_sts_evidence.py
  - <eval-python-with-psutil-7.0.0> -X utf8 -B scripts/coding-evaluation/sts.py --help
  - python -X utf8 -B scripts/coding-evaluation/verify-sts.py <report.json> --candidate <frozen-ClawX-commit> --expected-report-digest <retained-digest> --negative-checks
  - <native-STS-python> -B -m pytest -q -p no:cacheprovider <native-root>/extensions/sts/tests
  - python -X utf8 -B scripts/coding-evaluation/sts.py --native-root <native-root> --sts-python <installed-STS-python> --vg <current-vg.exe> --contracts <native-root>/vendor/sts-vg-contract --package-report <clean-install-report.json> --wheel <clean-install.whl> --httpx <pinned-httpx> --packaging <pinned-packaging> --output <new-evidence-directory>
  - pnpm harness validate --spec harness/specs/tasks/coding-sts-selection-evaluation.md
  - node scripts/check-repository-artifacts.mjs
acceptance:
  - 负例覆盖漏选、零选择、收集失败、nodeid 漂移、动态参数化、conftest/plugin 改动、flaky、timeout 和候选环境漂移；每项记录命令、exit、预期拒绝原因及磁盘产物摘要。
  - selected 永不满足 full；collected、selected、passed、failed、skipped、not-run、missed 分开记录，full 检出而 selected 漏掉时拒绝毕业。
  - clean wheel 从源码目录外加载，真实 VG 宿主完成 1.1/2.0 的 request/plan/execute/consume、宿主 selection、稳定性与 2.0 负例闭环。
  - httpx 与 packaging 使用固定 commit/tree，同 candidate selected/full 每臂至少 5 次 cold/warm，并保留总 wall、RSS、collect、materialize、execute、final-full 和 cleanup 成本。
  - 报告、命令输出、清点、进程/文件读回与 SHA-256 由独立 verifier 从磁盘复算；7 个结构或摘要篡改反例全部拒绝。
  - 全部证据标 driven_by=agent、actor=codex-coding-sts-evaluator、realHumanEvidence=false；不改变产品锁、默认值或发布状态。
docs:
  required: false
  readmeTranslations: not-required
---

TF-0758/E4。该叶只拥有评测驱动、独立 verifier、单体负例和精选证据，不修改原生 VG/STS 产品逻辑，不接线 renderer/Main/Gateway，也不改变默认选择开关。

正式证据使用 D 盘一次性源码副本、wheel、venv、目标仓库和 Cargo target。STS 包根、VG 根和目标 repo 根逐项记录；clean wheel 与 VG 二进制绑定原生提交 `d9c38a8659274c24ea776b56480a260831b4537f` 及其 tree/摘要。历史 `tf0028_eval`、`workflow-r5.json` 和 `tf0250` 仅作参考，不能替代当前候选的 selected/full 配对。
