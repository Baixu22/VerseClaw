---
lifecycleStatus: active
implementationStatus: planned
id: project-rag-packaging-portability
title: 完成跨平台安装、离线运行与升级回滚
scenario: gateway-backend-communication
taskType: runtime-bridge
programKey: RAG-18
intent: 让目标系统在实际发布平台可安装、可恢复、可持续维护。
diffBase: c5896951eaaf2e567072ff4430e2a23f8bf30e46
touchedAreas:
  - "electron-builder.yml"
  - "openclaw_runtime/package.json"
  - "scripts/bundle-openclaw*.mjs"
  - "scripts/build-openclaw-runtime.mjs"
  - "scripts/release-*.mjs"
  - "harness/specs/fixtures/project-rag/**"
  - "docs/dev/project-rag/**"
  - "docs/dev/adr/2026-11-09-project-rag-retrieval-plane.md"
  - "docs/dev/adr/2026-08-17-knowledge-system-unification-authority.md"
  - "docs/modules/knowledge-base.md"
  - "docs/enhancements/knowledge-persistence/*.md"
  - "docs/clawx-design-overview.md"
  - "docs/dev/runtime-control-planes.md"
  - "docs/dev/evidence/project-rag-longterm-20261109/**"
  - "harness/specs/tasks/project-rag-*.md"
  - "harness/specs/rules/project-rag-long-term-boundary.md"
  - ".gitignore"
  - "scripts/repository-artifacts.json"
  - "README*.md"
  - "tests/unit/runtime-package-resolution.test.ts"
  - "tests/unit/project-rag-package-manifest.test.ts"
  - "tests/e2e/project-rag-packaged-smoke.spec.ts"
requiredProfiles:
  - "fast"
  - "comms"
requiredRules:
  - "contract-first-boundary"
  - "backend-communication-boundary"
  - "knowledge-source-set-read-admission"
  - "project-rag-long-term-boundary"
requiredTests:
  - "tests/unit/runtime-package-resolution.test.ts"
plannedTests:
  - "tests/unit/project-rag-package-manifest.test.ts"
plannedE2E:
  - "tests/e2e/project-rag-packaged-smoke.spec.ts"
expectedUserBehavior:
  - "让目标系统在实际发布平台可安装、可恢复、可持续维护。"
acceptance:
  - "按实际release target矩阵运行原生SDK/模型/FTS/SQLite probe；npm包清单不当作加载成功。"
  - "Intel Mac等缺ANN预编译包的平台具备完整portable语义路径与容量边界；ANN tier仅在实测通过的目标声明。"
  - "有网首次安装、签名/校验、离线重启、低空间、半安装、模型更换、旧binary读取和增量schema回滚通过。"
  - "正式升级不整库覆盖、不丢governance/SEKB/Task Ledger资料；所有临时输出遵守D盘策略。"
  - "本叶plannedTests与plannedE2E已实际实现并纳入requiredTests，磁盘结果绑定当前候选；旧基线测试不能替代新增能力验证。"
docs:
  required: true
  readmeTranslations: required
  files:
    - docs/dev/adr/2026-11-09-project-rag-retrieval-plane.md
    - docs/dev/project-rag/WORK-PACKAGES.md
---

# 完成跨平台安装、离线运行与升级回滚

所属长期计划：RAG-18。前置工作包：RAG-06、RAG-08、RAG-12。Owner：packaging / provider lifecycle / platform validation。

契约：RetrievalPlatformMatrix/v1、RetrievalArtifactManifest/v1、RetrievalUpgradeReceipt/v1。

本文件冻结实现合同。当前规划不代表产品实现已通过；执行该叶前复核绑定的工作树、前置证据与实际 HEAD，刷新 diffBase。新增测试必须实现并加入 requiredTests；plannedE2E 指定的是必须补齐的产品旅程。

所有检索来源和模型调用接受 owner 准入，DCS 保留最终上下文决定权；验证结果标记 driven_by: agent。

回滚：停用不兼容feature pack，回portable/lexical；保留canonical owner和正常Chat启动。
