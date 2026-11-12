---
lifecycleStatus: active
id: coding-vg-sts-jj-maturity-closeout
title: TF-0782 编码、VG、STS、JJ 成熟度与发布前结论
scenario: gateway-backend-communication
taskType: runtime-bridge
diffBase: c00e5ae3ca7f0c745b60b1b611dff64859116abe
intent: 聚合 TF-0764–TF-0781 的当前磁盘证据，在同一候选完成两角色全量门、当前 Windows win-unpacked 重验和独立 verifier，形成功能、质量、性能、运营、分发与发布分别裁决的非 GA 结论。
ownedPaths:
  - harness/specs/tasks/coding-vg-sts-jj-maturity-closeout.md
  - .gitignore
  - plans/system-maturity/gates.json
  - plans/system-maturity/**/*.delivery.md
  - artifacts/system-maturity/P0-001/audit-baseline-check.json
  - artifacts/system-maturity/P0-002/validate-system-maturity-plan.json
  - artifacts/system-maturity/P0-003/validate-test-gates.json
  - artifacts/system-maturity/P0-004/evidence-index.json
  - artifacts/system-maturity/P0-004/validate-system-maturity-evidence.json
  - artifacts/system-maturity/P7-001/traceability-report.json
  - plans/system-maturity/residual-register.json
  - plans/system-maturity/findings-registry.json
  - artifacts/system-maturity/P8-001/residual-audit-report.json
  - artifacts/system-maturity/P8-001/residual-audit-dry-run.json
  - artifacts/system-maturity/P8-001/residual-revalidation-20261111.json
  - artifacts/system-maturity/P8-001/residual-revalidation-20261111.stdout.txt
  - .gitattributes
  - harness/specs/fixtures/rsi-evidence-loop/decision-implementation-validation.v1.json
  - harness/specs/fixtures/harness-codex-active-verification/acceptance.json
  - harness/specs/fixtures/harness-codex-active-verification/SHA256SUMS
  - artifacts/agent-dev-workbench/evidence.json
  - artifacts/agent-dev-deep-test/history.json
  - artifacts/agent-dev-deep-test/report.json
  - artifacts/agent-dev-deep-test/report.md
  - artifacts/agent-dev-quality/report.json
  - openclaw_runtime/extensions/amazon-bedrock-mantle/npm-shrinkwrap.json
  - openclaw_runtime/extensions/tlon/npm-shrinkwrap.json
  - openclaw_runtime/extensions/amazon-bedrock/npm-shrinkwrap.json
  - openclaw_runtime/extensions/diagnostics-otel/npm-shrinkwrap.json
  - tests/unit/channels-page.test.tsx
  - scripts/lib/agent-engineering-acceptance.mjs
  - scripts/rc00-acceptance-bootstrap.mjs
  - scripts/lib/acceptance-artifacts.mjs
  - scripts/lib/acceptance-artifacts.d.mts
  - scripts/audit-baseline-check.mjs
  - scripts/validate-system-maturity-plan.mjs
  - scripts/validate-test-gates.mjs
  - scripts/validate-system-maturity-evidence.mjs
  - scripts/run-system-maturity-residual-audit.mjs
  - scripts/validate-system-maturity-traceability.mjs
  - scripts/agent-dev-deep-test.mjs
  - scripts/agent-dev-audit.mjs
  - scripts/agent-dev-workbench.mjs
  - scripts/collect-p6-005-evidence.mjs
  - scripts/validate-release-baseline.mjs
  - scripts/lib/system-maturity-security-suite.mjs
  - tests/unit/acceptance-artifact-routing.test.ts
  - docs/agent-dev-control-plane.md
  - docs/dev/handoffs/CODING-VG-STS-JJ-RELAY-20261111-01A1BE4A.md
  - scripts/coding-evaluation/package-evaluation.py
  - scripts/coding-evaluation/final_evaluation.py
  - scripts/coding-evaluation/verify_final_evaluation.py
  - scripts/coding-evaluation/test_final_evaluation.py
  - harness/specs/fixtures/coding-evaluation/TF-0782/**
  - harness/specs/fixtures/coding-evaluation/TF-0777/typecheck-test.log
  - harness/specs/fixtures/coding-evaluation/TF-0778/environment/httpx-setup.log
  - harness/specs/fixtures/coding-evaluation/TF-0778/environment/packaging-setup.log
  - harness/specs/fixtures/coding-evaluation/TF-0778/inputs/vg.exe
  - harness/specs/fixtures/coding-evaluation/TF-0778/package/artifacts/*.log
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - docs/modules/workspace-and-coding.md
  - docs/modules/verse-tools.md
  - shared/dcs/component-disposition-catalog.ts
  - shared/host-api/host-action-timeouts.ts
  - tests/unit/host-action-timeouts.test.ts
  - tests/unit/agent-engineering-acceptance.test.ts
  - tests/unit/versegit-wp9-global-acceptance.test.ts
  - tests/unit/system-maturity-evidence-validator.test.ts
  - tests/unit/rc01r-prerequisite-provenance.test.ts
  - scripts/lib/agent-engineering-acceptance.d.mts
  - tests/unit/first-product-claims.test.ts
  - tests/unit/versegit-wp2-profile.test.ts
  - tests/unit/versegit-wp6-closeout.test.ts
  - tests/unit/fixtures/versegit-wp6/9a50-closeout.json
  - scripts/versegit-wp6-closeout.d.mts
  - harness/specs/fixtures/versegit-planning-correction/mc0-evidence/baseline.json
  - harness/specs/fixtures/versegit-planning-correction/wp2-diagnostic-profile-fixture.json
  - scripts/versegit-wp2-profile.mjs
  - openclaw_runtime/src/context-engine/coding-tool-navigation.ts
  - openclaw_runtime/src/context-engine/coding-tool-navigation.test.ts
  - openclaw_runtime/src/context-engine/dcs-prod-flags-catalog.test.ts
  - openclaw_runtime/src/context-engine/runtime-flag-attribution.test.ts
  - openclaw_runtime/src/context-engine/assembler.ts
touchedAreas:
  - harness/specs/tasks/coding-vg-sts-jj-maturity-closeout.md
  - .gitignore
  - plans/system-maturity/gates.json
  - plans/system-maturity/**/*.delivery.md
  - artifacts/system-maturity/P0-001/audit-baseline-check.json
  - artifacts/system-maturity/P0-002/validate-system-maturity-plan.json
  - artifacts/system-maturity/P0-003/validate-test-gates.json
  - artifacts/system-maturity/P0-004/evidence-index.json
  - artifacts/system-maturity/P0-004/validate-system-maturity-evidence.json
  - artifacts/system-maturity/P7-001/traceability-report.json
  - plans/system-maturity/residual-register.json
  - plans/system-maturity/findings-registry.json
  - artifacts/system-maturity/P8-001/residual-audit-report.json
  - artifacts/system-maturity/P8-001/residual-audit-dry-run.json
  - artifacts/system-maturity/P8-001/residual-revalidation-20261111.json
  - artifacts/system-maturity/P8-001/residual-revalidation-20261111.stdout.txt
  - .gitattributes
  - harness/specs/fixtures/rsi-evidence-loop/decision-implementation-validation.v1.json
  - harness/specs/fixtures/harness-codex-active-verification/acceptance.json
  - harness/specs/fixtures/harness-codex-active-verification/SHA256SUMS
  - artifacts/agent-dev-workbench/evidence.json
  - artifacts/agent-dev-deep-test/history.json
  - artifacts/agent-dev-deep-test/report.json
  - artifacts/agent-dev-deep-test/report.md
  - artifacts/agent-dev-quality/report.json
  - openclaw_runtime/extensions/tlon/npm-shrinkwrap.json
  - openclaw_runtime/extensions/amazon-bedrock-mantle/npm-shrinkwrap.json
  - openclaw_runtime/extensions/amazon-bedrock/npm-shrinkwrap.json
  - openclaw_runtime/extensions/diagnostics-otel/npm-shrinkwrap.json
  - tests/unit/channels-page.test.tsx
  - scripts/lib/agent-engineering-acceptance.mjs
  - scripts/rc00-acceptance-bootstrap.mjs
  - scripts/lib/acceptance-artifacts.mjs
  - scripts/lib/acceptance-artifacts.d.mts
  - scripts/audit-baseline-check.mjs
  - scripts/validate-system-maturity-plan.mjs
  - scripts/validate-test-gates.mjs
  - scripts/validate-system-maturity-evidence.mjs
  - scripts/run-system-maturity-residual-audit.mjs
  - scripts/validate-system-maturity-traceability.mjs
  - scripts/agent-dev-deep-test.mjs
  - scripts/agent-dev-audit.mjs
  - scripts/agent-dev-workbench.mjs
  - scripts/collect-p6-005-evidence.mjs
  - scripts/validate-release-baseline.mjs
  - scripts/lib/system-maturity-security-suite.mjs
  - tests/unit/acceptance-artifact-routing.test.ts
  - docs/agent-dev-control-plane.md
  - docs/dev/handoffs/CODING-VG-STS-JJ-RELAY-20261111-01A1BE4A.md
  - scripts/coding-evaluation/package-evaluation.py
  - scripts/coding-evaluation/final_evaluation.py
  - scripts/coding-evaluation/verify_final_evaluation.py
  - scripts/coding-evaluation/test_final_evaluation.py
  - harness/specs/fixtures/coding-evaluation/TF-0782/**
  - harness/specs/fixtures/coding-evaluation/TF-0777/typecheck-test.log
  - harness/specs/fixtures/coding-evaluation/TF-0778/environment/httpx-setup.log
  - harness/specs/fixtures/coding-evaluation/TF-0778/environment/packaging-setup.log
  - harness/specs/fixtures/coding-evaluation/TF-0778/inputs/vg.exe
  - harness/specs/fixtures/coding-evaluation/TF-0778/package/artifacts/*.log
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - docs/modules/workspace-and-coding.md
  - docs/modules/verse-tools.md
  - shared/dcs/component-disposition-catalog.ts
  - shared/host-api/host-action-timeouts.ts
  - tests/unit/host-action-timeouts.test.ts
  - tests/unit/agent-engineering-acceptance.test.ts
  - tests/unit/versegit-wp9-global-acceptance.test.ts
  - tests/unit/system-maturity-evidence-validator.test.ts
  - tests/unit/rc01r-prerequisite-provenance.test.ts
  - scripts/lib/agent-engineering-acceptance.d.mts
  - tests/unit/first-product-claims.test.ts
  - tests/unit/versegit-wp2-profile.test.ts
  - tests/unit/versegit-wp6-closeout.test.ts
  - tests/unit/fixtures/versegit-wp6/9a50-closeout.json
  - scripts/versegit-wp6-closeout.d.mts
  - harness/specs/fixtures/versegit-planning-correction/mc0-evidence/baseline.json
  - harness/specs/fixtures/versegit-planning-correction/wp2-diagnostic-profile-fixture.json
  - scripts/versegit-wp2-profile.mjs
  - openclaw_runtime/src/context-engine/coding-tool-navigation.ts
  - openclaw_runtime/src/context-engine/coding-tool-navigation.test.ts
  - openclaw_runtime/src/context-engine/dcs-prod-flags-catalog.test.ts
  - openclaw_runtime/src/context-engine/runtime-flag-attribution.test.ts
  - openclaw_runtime/src/context-engine/assembler.ts
requiredRules:
  - backend-communication-boundary
  - comms-regression
  - disk-temp-policy
  - repository-artifact-retention
  - task-forest-autoclose-and-roles
requiredProfiles:
  - fast
  - comms
  - runtime
  - e2e
  - release
expectedUserBehavior:
  - A1-A10 全部由当前代码谱系中的 resolved 证据覆盖，VG、JJ、VS、STS、joint、recovery 与 Windows win-unpacked 分别给出可读结论。
  - STS 选择不宣称净收益；未提供 Python 或独立 JJ 时明确不可用；默认 off 和 managed opt-in 保持真实。
  - 功能、质量、性能、运营、分发与发布分开裁决，installer、GA、default-on 和发布批准保持未授权。
  - 删除 receipt、替换候选、伪造 scope、复用非祖先结果和篡改摘要均由独立 verifier 拒绝。
requiredTests:
  - python -X utf8 -B scripts/coding-evaluation/test_final_evaluation.py
  - python -X utf8 -B scripts/coding-evaluation/final_evaluation.py --check-inputs
  - node scripts/validate-release-baseline.mjs --ref codex/tf0782-maturity-final
  # The frozen product-acceptance contract anchors this consumer for final entry.
  - pnpm docs:policy:validate
  - pnpm harness validate --spec harness/specs/tasks/coding-vg-sts-jj-maturity-closeout.md --since c00e5ae3ca7f0c745b60b1b611dff64859116abe
  - git diff --check
acceptance:
  - TF-0764–TF-0781 的 18 份叶证据、SHA256SUMS、候选谱系和 A1-A10 映射从磁盘读回，缺失或矛盾保持 needs-fix。
  - 同一 clean candidate 由两个不同 actor 执行全量 fast/runtime/comms/e2e/release 门并分别生成可读报告；verifier 接受 executor 结果。
  - 当前候选的 Windows win-unpacked 重新生成 3 个 fresh profile 证据，独立 package verifier 接受；安装器保持 not-run。
  - 独立 TF-0782 verifier 复算 report digest、acceptance、SHA256SUMS、候选、叶证据、两角色门和包证据，并拒绝删除、未修复、错候选、同 actor、伪 scope、产品锁和发布越权等反例。
  - 四语 README、编码文档、Verse tools 文档和组件处置目录说明当前可执行范围；产品锁、默认值、M4/land/admit 和发布权限保持不变。
docs:
  required: true
  files:
    - README.md
    - README.zh-CN.md
    - README.ja-JP.md
    - README.ru-RU.md
    - docs/modules/workspace-and-coding.md
    - docs/modules/verse-tools.md
---

# TF-0782 最终结论

本节点把 TF-0764–TF-0781 的现有证据聚合为一个候选绑定结论。功能通过、质量门和
Windows win-unpacked 运行分别成立；性能结论仍是没有证明净收益。安装器、GA、
default-on 和发布批准不属于本节点的自动授权范围。

正式流程先在 source candidate 上生成两个不同 actor 的全量门报告，再使用当前候选重新
构建 win-unpacked 并执行三个 fresh profile。`final_evaluation.py` 只消费磁盘上的
acceptance、SHA256SUMS、门报告和包报告；`verify_final_evaluation.py` 从这些输入重新
推导并在隔离 worktree 中执行反例矩阵。

干净检出在全量单测之前准备 VG 侧车和 active verification 所需的三个包输入；
输入的路径、字节数与 SHA-256 随执行计划固定，复制前后都校验。VerseShell 仍按
冻结源码和有序补丁重建。WP2 单测在隔离目录重放 MC0 捕获的三个输出，并覆盖
二进制变更时零调用拒绝；显式历史 replay 继续校验 MC0 原始二进制摘要。

带注入的 WP2 报告标为 fixture replay，不能被默认 native verifier 接受。执行器在
全部门结束后再次复核 source 和 detached checkout 的准备输入；大文件 SHA-256
使用有界内存读取。WP6 历史失败 consumer 读取固定提交的完整快照，producer 的
缺件及篡改拒绝由独立的小型文件夹具验证。
