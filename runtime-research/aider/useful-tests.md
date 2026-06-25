# Aider Useful Tests

证据源：`C:\Users\27933\Desktop\verseshell\aider-main\tests\basic\test_repomap.py`。

## 值得移植的测试形态

- `test_get_repo_map`: 小仓库生成 repo map，确认关键符号出现。
- `test_repo_map_refresh_files`: 文件刷新策略不会因内容变化误刷新。
- `test_repo_map_refresh_auto`: 自动刷新和 `force_refresh=True` 的差异。
- `test_get_repo_map_with_identifiers`: 用户提到 identifier 后，相关定义进入 map。
- `test_get_repo_map_all_files`: 多文件都能被纳入排序。
- `test_get_repo_map_excludes_added_files`: 已经加入 chat 的文件不重复进入 repo map。
- `TestRepoMapAllLanguages`: 多语言 query 覆盖，验证 tree-sitter tags 的广度。
- `test_repo_map_sample_code_base`: 用 fixture 快照比较真实小仓库的 repo map 输出。

## ClawX 应新增的 fixture

- TypeScript/Electron 小仓库：组件、hook、main-process API、shared 类型分散在不同目录。
- 用户提到 UI 名称但不提文件名：验证 path component + symbol name 排序。
- active file 中引用另一个模块：验证 reference -> definition 提升。
- 大文件预算：验证二分预算不会截断在不完整 symbol 中间。
- cache invalidation：修改文件 mtime/content 后只重新提取该文件 tags。
