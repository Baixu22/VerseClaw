# ACI-Bench LIVE Report

- Generated: 2026-10-14T07:26:12.997192+00:00
- Task set: 3.1.0
- Mode: **LIVE** (real LLM multi-turn tool-calling)
- Model: `sn-glm-5-3-flash`

## Leaderboard

| model | condition | tasks | success_rate | avg_tool_calls | avg_observation_tokens |
|---|---|---:|---:|---:|---:|
| sn-glm-5-3-flash | raw_shell | 8 | 1.0 | 2.88 | 237.25 |
| sn-glm-5-3-flash | raw_shell_coached | 8 | 1.0 | 3.12 | 189.25 |
| sn-glm-5-3-flash | verseshell_aci | 8 | 1.0 | 4.12 | 298.25 |

## Condition A vs D

**NOT CLAIMABLE** — single-collection diagnostics; not formal acceptance.

### sn-glm-5-3-flash / selected / raw_shell → **NOT CLAIMABLE** (single-collection diagnostic)
- Descriptive advantage (old OR): False
- Refusal reasons: complete_repeated_study_not_evaluated, frozen_family_inference_not_evaluated

| Metric | Raw Shell (A) | VerseShell ACI (D) | Ratio (D/A) |
|---|---|---:|---:|
| Success rate | 1.0 | 1.0 | — |
| Avg tool calls | 2.88 | 4.12 | 1.4348 |
| Avg observation tokens | 237.25 | 298.25 | 1.2571 |
| Formal acceptance | — | — | **NOT CLAIMABLE** |

### sn-glm-5-3-flash / selected / raw_shell_coached → **NOT CLAIMABLE** (single-collection diagnostic)
- Descriptive advantage (old OR): False
- Refusal reasons: complete_repeated_study_not_evaluated, frozen_family_inference_not_evaluated

| Metric | Raw Shell (A) | VerseShell ACI (D) | Ratio (D/A) |
|---|---|---:|---:|
| Success rate | 1.0 | 1.0 | — |
| Avg tool calls | 3.12 | 4.12 | 1.32 |
| Avg observation tokens | 189.25 | 298.25 | 1.576 |
| Formal acceptance | — | — | **NOT CLAIMABLE** |

## Per-Task Trajectories

### rust_fix_compile_error [raw_shell] → PASS
- Reason: behaviour and required unit-test checks passed
- Tool calls: 2, Observation tokens: 212
- Turns: 3, Elapsed: 13946ms
- LLM: 2773 prompt + 214 completion tokens
- Trajectory:
  1. `run_command` — {"command": "dir && type src\\lib.rs"}
  1. `run_command` — {"command": "python -c \"open(r'src\\lib.rs','w').write('pub fn add(a: i32, b: i32) -> i32 {\\n    a + b\\n}\\n')\" && cargo check"}
  1. `task_complete` — {"success": true, "summary": "Fixed src/lib.rs: changed add() return type from String to i32; cargo check passes."}

### rust_fix_compile_error [raw_shell_coached] → PASS
- Reason: behaviour and required unit-test checks passed
- Tool calls: 3, Observation tokens: 147
- Turns: 4, Elapsed: 33729ms
- LLM: 3627 prompt + 209 completion tokens
- Trajectory:
  1. `run_command` — {"command": "type src\\lib.rs & type Cargo.toml"}
  1. `run_command` — {"command": "python -c \"import io; p='src/lib.rs'; s=io.open(p,encoding='utf-8').read().replace('-> String','-> i32'); io.open(p,'w',encoding='utf-8',newline='').write(s)\" & type src\\lib.rs"}
  1. `run_command` — {"command": "cargo check 2>&1"}
  1. `task_complete` — {"success": true, "summary": "Changed add() return type from String to i32 in src/lib.rs; cargo check passes."}

### rust_fix_compile_error [verseshell_aci] → PASS
- Reason: behaviour and required unit-test checks passed
- Tool calls: 4, Observation tokens: 284
- Turns: 4, Elapsed: 27268ms
- LLM: 9779 prompt + 240 completion tokens
- Trajectory:
  1. `file.read_many` — {"paths": ["Cargo.toml", "src/lib.rs"]} aci_ok=True
  1. `repo.summary` — {} aci_ok=True
  1. `file.replace_exact` — {"expected_hash": "sha256:471dfab5b79f216a", "new": "pub fn add(a: i32, b: i32) -> i32 {", "old": "pub fn add(a: i32, b: i32) -> String {", "path": "src/lib.rs"} aci_ok=True
  1. `exec.run` — {"argv": ["cargo", "check"], "cwd": ".", "profile": "cargo"} aci_ok=True
  1. `task_complete` — {"success": true, "summary": "Changed add()'s return type from String to i32 in src/lib.rs; cargo check passes with 0 errors/warnings."}

### rust_add_unit_test [raw_shell_coached] → PASS
- Reason: behaviour and required unit-test checks passed
- Tool calls: 3, Observation tokens: 226
- Turns: 4, Elapsed: 38723ms
- LLM: 3664 prompt + 223 completion tokens
- Trajectory:
  1. `run_command` — {"command": "type Cargo.toml & type src\\lib.rs"}
  1. `run_command` — {"command": "python -c \"open('src/lib.rs','a').write('\\n#[cfg(test)]\\nmod tests {\\n    use super::*;\\n\\n    #[test]\\n    fn test_add() {\\n        assert_eq!(add(2, 3), 5);\\n        assert_eq!
  1. `run_command` — {"command": "cargo test"}
  1. `task_complete` — {"success": true, "summary": "Added a unit test module for add() in src/lib.rs; cargo test passes (1 test ok)."}

### rust_add_unit_test [verseshell_aci] → PASS
- Reason: behaviour and required unit-test checks passed
- Tool calls: 6, Observation tokens: 414
- Turns: 6, Elapsed: 54177ms
- LLM: 16196 prompt + 1035 completion tokens
- Trajectory:
  1. `file.read_many` — {"paths": ["Cargo.toml", "src/lib.rs"]} aci_ok=True
  1. `repo.summary` — {} aci_ok=True
  1. `file.replace_exact` — {"expected_hash": "sha256:2551a0f2f738405d", "new": "pub fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n\n#[cfg(test)]\nmod tests {\n    use super::add;\n\n    #[test]\n    fn test_add() {\n        as aci_ok=False
  1. `file.view` — {"path": "src/lib.rs"} aci_ok=True
  1. `file.write` — {"content": "pub fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n\n#[cfg(test)]\nmod tests {\n    use super::add;\n\n    #[test]\n    fn test_add() {\n        assert_eq!(add(2, 3), 5);\n    }\n\n    #[ aci_ok=True
  1. `exec.run` — {"argv": ["cargo", "test"], "profile": "cargo"} aci_ok=True
  1. `task_complete` — {"success": true, "summary": "Added a #[cfg(test)] module in src/lib.rs with 3 unit tests for add(); cargo test passes (3 passed, 0 failed)."}

### rust_add_unit_test [raw_shell] → PASS
- Reason: behaviour and required unit-test checks passed
- Tool calls: 2, Observation tokens: 208
- Turns: 3, Elapsed: 26068ms
- LLM: 2597 prompt + 260 completion tokens
- Trajectory:
  1. `run_command` — {"command": "type Cargo.toml & type src\\lib.rs"}
  1. `run_command` — {"command": "python -c \"open(r'src\\lib.rs','a',encoding='utf-8').write('''\\n#[cfg(test)]\\nmod tests {\\n    use super::add;\\n\\n    #[test]\\n    fn test_add() {\\n        assert_eq!(add(2, 3), 5
  1. `task_complete` — {"success": true, "summary": "Added a #[cfg(test)] unit test for add() in src/lib.rs covering positive, negative, and zero cases; cargo test passes (1 passed, 0 failed)."}

### rust_search_and_edit [verseshell_aci] → PASS
- Reason: behaviour and required unit-test checks passed
- Tool calls: 6, Observation tokens: 415
- Turns: 6, Elapsed: 62886ms
- LLM: 15380 prompt + 572 completion tokens
- Trajectory:
  1. `repo.summary` — {} aci_ok=True
  1. `file.read_many` — {"paths": ["Cargo.toml", "src/lib.rs"]} aci_ok=True
  1. `file.replace_exact` — {"new": "pub fn sum(a: i32, b: i32) -> i32 {\n    a + b\n}", "old": "pub fn sum(a: i32, b: i32) -> i32 {\n    // TODO(fix-me)\n    0\n}", "path": "src/lib.rs"} aci_ok=False
  1. `file.view` — {"path": "src/lib.rs"} aci_ok=True
  1. `file.write` — {"content": "pub fn sum(a: i32, b: i32) -> i32 {\n    a + b\n}\n", "path": "src/lib.rs"} aci_ok=True
  1. `exec.run` — {"argv": ["cargo", "test"], "profile": "cargo"} aci_ok=True
  1. `task_complete` — {"success": true, "summary": "Implemented the unfinished `sum` function in src/lib.rs (replaced TODO(fix-me) stub returning 0 with `a + b`); cargo test compiles and passes cleanly."}

### rust_search_and_edit [raw_shell] → PASS
- Reason: behaviour and required unit-test checks passed
- Tool calls: 2, Observation tokens: 313
- Turns: 3, Elapsed: 17271ms
- LLM: 2924 prompt + 341 completion tokens
- Trajectory:
  1. `run_command` — {"command": "dir /s /b && type Cargo.toml && type src\\lib.rs && type TASK.md"}
  1. `run_command` — {"command": "python -c \"open('src/lib.rs','w').write('''pub fn sum(a: i32, b: i32) -> i32 {\\n    a + b\\n}\\n\\n#[cfg(test)]\\nmod tests {\\n    use super::*;\\n\\n    #[test]\\n    fn sums_values()
  1. `task_complete` — {"success": true, "summary": "Implemented the TODO(fix-me) in src/lib.rs: `sum` now returns `a + b`; verified with a passing `cargo test` run."}

### rust_search_and_edit [raw_shell_coached] → PASS
- Reason: behaviour and required unit-test checks passed
- Tool calls: 3, Observation tokens: 248
- Turns: 4, Elapsed: 15283ms
- LLM: 4014 prompt + 330 completion tokens
- Trajectory:
  1. `run_command` — {"command": "dir /s /b . && type Cargo.toml && type src\\lib.rs && type TASK.md"}
  1. `run_command` — {"command": "python -c \"open(r'src\\lib.rs','w').write('pub fn sum(a: i32, b: i32) -> i32 {\\n    a + b\\n}\\n')\" && type src\\lib.rs"}
  1. `run_command` — {"command": "cargo check 2>&1"}
  1. `task_complete` — {"success": true, "summary": "Implemented the TODO(fix-me) sum function body to return a + b; cargo check passes."}

### python_fix_pytest_fail [raw_shell] → PASS
- Reason: all ok
- Tool calls: 2, Observation tokens: 209
- Turns: 3, Elapsed: 17435ms
- LLM: 2754 prompt + 209 completion tokens
- Trajectory:
  1. `run_command` — {"command": "dir && type mathlib.py && type tests\\test_math.py"}
  1. `run_command` — {"command": "python -c \"open('mathlib.py','w').write('def add(a, b):\\n    return a + b\\n')\" && type mathlib.py && python -m pytest -q"}
  1. `task_complete` — {"success": true, "summary": "Fixed mathlib.py add() to return a + b instead of a * b; pytest passes (1 passed)."}

### python_fix_pytest_fail [raw_shell_coached] → PASS
- Reason: all ok
- Tool calls: 2, Observation tokens: 93
- Turns: 3, Elapsed: 13724ms
- LLM: 2437 prompt + 131 completion tokens
- Trajectory:
  1. `run_command` — {"command": "type mathlib.py & type tests\\test_math.py"}
  1. `run_command` — {"command": "python -c \"open('mathlib.py','w').write('def add(a, b):\\n    return a + b\\n')\" && python -m pytest -q"}
  1. `task_complete` — {"success": true, "summary": "Fixed mathlib.add to return a + b; pytest passes (1 passed)."}

### python_fix_pytest_fail [verseshell_aci] → PASS
- Reason: all ok
- Tool calls: 3, Observation tokens: 221
- Turns: 4, Elapsed: 43088ms
- LLM: 9524 prompt + 302 completion tokens
- Trajectory:
  1. `file.read_many` — {"paths": ["mathlib.py", "tests/test_math.py"]} aci_ok=True
  1. `file.replace_exact` — {"expected_hash": "sha256:4fb46b3507c096ae", "new": "    return a + b", "old": "    return a * b", "path": "mathlib.py"} aci_ok=True
  1. `exec.run` — {"argv": ["python", "-m", "pytest", "-v"], "profile": "pytest"} aci_ok=True
  1. `task_complete` — {"success": true, "summary": "Fixed mathlib.py add() to return a+b instead of a*b; pytest verified with 1 passed."}

### python_edit_and_retest [raw_shell_coached] → PASS
- Reason: all ok
- Tool calls: 3, Observation tokens: 118
- Turns: 3, Elapsed: 14765ms
- LLM: 2493 prompt + 158 completion tokens
- Trajectory:
  1. `run_command` — {"command": "type greet.py"}
  1. `run_command` — {"command": "type tests\\test_greet.py"}
  1. `run_command` — {"command": "python -c \"open('greet.py','w').write('def greet(name):\\n    return f\\\"Hello, {name}!\\\"\\n')\" && python -m pytest -q"}
  1. `task_complete` — {"success": true, "summary": "Updated greet() to return 'Hello, {name}!' and all tests pass (1 passed)."}

### python_edit_and_retest [verseshell_aci] → PASS
- Reason: all ok
- Tool calls: 3, Observation tokens: 226
- Turns: 4, Elapsed: 22795ms
- LLM: 9498 prompt + 248 completion tokens
- Trajectory:
  1. `file.read_many` — {"paths": ["greet.py", "tests/test_greet.py"]} aci_ok=True
  1. `file.replace_exact` — {"new": "def greet(name):\n    return f\"Hello, {name}!\"", "old": "def greet(name):\n    return f\"Hi {name}\"", "path": "greet.py"} aci_ok=True
  1. `exec.run` — {"argv": ["python", "-m", "pytest", "tests/test_greet.py", "-q"], "profile": "pytest"} aci_ok=True
  1. `task_complete` — {"success": true, "summary": "Updated greet() in greet.py to return f\"Hello, {name}!\"; pytest passed (1/1)."}

### python_edit_and_retest [raw_shell] → PASS
- Reason: all ok
- Tool calls: 4, Observation tokens: 268
- Turns: 4, Elapsed: 36749ms
- LLM: 3555 prompt + 197 completion tokens
- Trajectory:
  1. `run_command` — {"command": "type greet.py"}
  1. `run_command` — {"command": "type tests\\test_greet.py"}
  1. `run_command` — {"command": "python -c \"open('greet.py','w').write('def greet(name):\\n    return f\\\"Hello, {name}!\\\"\\n')\" && type greet.py"}
  1. `run_command` — {"command": "python -m pytest tests -v"}
  1. `task_complete` — {"success": true, "summary": "Updated greet() to return \"Hello, {name}!\" and verified with pytest (1 passed)."}

### python_noisy_install_summary [verseshell_aci] → PASS
- Reason: all ok
- Tool calls: 4, Observation tokens: 312
- Turns: 4, Elapsed: 20507ms
- LLM: 9860 prompt + 261 completion tokens
- Trajectory:
  1. `repo.summary` — {} aci_ok=True
  1. `file.view` — {"path": "requirements.txt"} aci_ok=True
  1. `exec.run` — {"argv": ["cmd", "/d", "/c", "python -m pip install -r requirements.txt --no-input"], "profile": "none"} aci_ok=True
  1. `file.write` — {"content": "Installed requirements.txt via pip: 1 package (six==1.16.0), already satisfied, exit code 0.\n", "path": "SUMMARY.txt"} aci_ok=True
  1. `task_complete` — {"success": true, "summary": "Installed 1 package (six==1.16.0) from requirements.txt and wrote SUMMARY.txt."}

### python_noisy_install_summary [raw_shell] → PASS
- Reason: all ok
- Tool calls: 5, Observation tokens: 348
- Turns: 5, Elapsed: 63909ms
- LLM: 5841 prompt + 727 completion tokens
- Trajectory:
  1. `run_command` — {"command": "dir & type requirements.txt & echo ---TASK--- & type TASK.md"}
  1. `run_command` — {"command": "python --version & pip --version"}
  1. `run_command` — {"command": "pip install -r requirements.txt --quiet --no-input 2>&1 | findstr /V /C:\"Requirement already\" & echo INSTALL_EXIT:%errorlevel%"}
  1. `run_command` — {"command": "pip show six >nul 2>&1 && (for /f \"tokens=2\" %%v in ('pip show six ^| findstr /B /C:\"Version:\"') do set VER=%%v) & echo installed: six %VER% & python -c \"import six; print('import OK
  1. `run_command` — {"command": "python -c \"import six, importlib.metadata as m, pathlib; reqs=[l.strip() for l in pathlib.Path('requirements.txt').read_text().splitlines() if l.strip()]; print('installed six', six.__ve
  1. `task_complete` — {"success": true, "summary": "Installed 1 package from requirements.txt (six==1.16.0, import verified) and wrote one-line dependency summary to SUMMARY.txt."}

### python_noisy_install_summary [raw_shell_coached] → PASS
- Reason: all ok
- Tool calls: 5, Observation tokens: 351
- Turns: 6, Elapsed: 25128ms
- LLM: 6833 prompt + 442 completion tokens
- Trajectory:
  1. `run_command` — {"command": "dir & type requirements.txt & type TASK.md"}
  1. `run_command` — {"command": "pip install -r requirements.txt > install_log.txt 2>&1 & findstr /C:\"Successfully installed\" install_log.txt"}
  1. `run_command` — {"command": "type install_log.txt"}
  1. `run_command` — {"command": "python -c \"open('SUMMARY.txt','w').write('Installed 1 package from requirements.txt: six==1.16.0 (already satisfied, no changes needed).') ; import six ; print('six OK', six.__version__)
  1. `run_command` — {"command": "del install_log.txt & dir /B"}
  1. `task_complete` — {"success": true, "summary": "Installed requirements (1 package: six==1.16.0, already satisfied) and wrote one-line dependency summary to SUMMARY.txt without pasting install logs."}

### ts_fix_type_error [raw_shell] → PASS
- Reason: command_exit_0 ['node', 'node_modules/typescript/bin/tsc', '--noEmit'] -> 0
- Tool calls: 2, Observation tokens: 174
- Turns: 3, Elapsed: 15737ms
- LLM: 3105 prompt + 296 completion tokens
- Trajectory:
  1. `run_command` — {"command": "type src\\index.ts & type tsconfig.json & type package.json"}
  1. `run_command` — {"command": "powershell -NoProfile -Command \"(Get-Content src\\index.ts) -replace 'const x: string = a \\+ b;', 'const x: number = a + b;' | Set-Content src\\index.ts; Get-Content src\\index.ts; node
  1. `task_complete` — {"success": true, "summary": "Fixed type error in src/index.ts: changed `const x: string = a + b` to `const x: number = a + b`; tsc --noEmit passes."}

### ts_fix_type_error [raw_shell_coached] → PASS
- Reason: command_exit_0 ['node', 'node_modules/typescript/bin/tsc', '--noEmit'] -> 0
- Tool calls: 2, Observation tokens: 166
- Turns: 3, Elapsed: 49156ms
- LLM: 3217 prompt + 330 completion tokens
- Trajectory:
  1. `run_command` — {"command": "type src\\index.ts & echo --- & type tsconfig.json & echo --- & type package.json & echo --- & type TASK.md"}
  1. `run_command` — {"command": "python -c \"open('src/index.ts','w').write('export function add(a: number, b: number): number {\\n  const x: number = a + b;\\n  return x;\\n}\\n')\" && npx tsc --noEmit"}
  1. `task_complete` — {"success": true, "summary": "Fixed type error in src/index.ts by changing `const x: string` to `const x: number` for the a + b result; tsc --noEmit now succeeds."}

### ts_fix_type_error [verseshell_aci] → PASS
- Reason: command_exit_0 ['node', 'node_modules/typescript/bin/tsc', '--noEmit'] -> 0
- Tool calls: 3, Observation tokens: 250
- Turns: 4, Elapsed: 38355ms
- LLM: 10374 prompt + 277 completion tokens
- Trajectory:
  1. `file.read_many` — {"paths": ["src/index.ts", "tsconfig.json", "package.json"]} aci_ok=True
  1. `file.replace_exact` — {"expected_hash": "d99b13deba072b7f", "new": "  const x: number = a + b;", "old": "  const x: string = a + b;", "path": "src/index.ts"} aci_ok=True
  1. `exec.run` — {"argv": ["node_modules\\.bin\\tsc.cmd", "--noEmit"], "profile": "auto"} aci_ok=True
  1. `task_complete` — {"success": true, "summary": "Fixed type error in src/index.ts by changing `const x: string` to `const x: number` so a+b (number) matches; tsc --noEmit now exits 0."}

### ts_package_script_fail [raw_shell_coached] → PASS
- Reason: command_exit_0 ['C:\\Program Files\\nodejs\\npm.CMD', 'test'] -> 0
- Tool calls: 4, Observation tokens: 165
- Turns: 4, Elapsed: 24319ms
- LLM: 3636 prompt + 394 completion tokens
- Trajectory:
  1. `run_command` — {"command": "type package.json"}
  1. `run_command` — {"command": "dir /B"}
  1. `run_command` — {"command": "node -e \"const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.scripts.test='node -e \\\"process.exit(0)\\\"';fs.writeFileSync('package.json',JSON.stringify
  1. `run_command` — {"command": "npm test"}
  1. `task_complete` — {"success": true, "summary": "Fixed package.json test script from `node -e \"process.exit(1)\"` to `node -e \"process.exit(0)\"`; `npm test` now exits 0."}

### ts_package_script_fail [verseshell_aci] → PASS
- Reason: command_exit_0 ['C:\\Program Files\\nodejs\\npm.CMD', 'test'] -> 0
- Tool calls: 4, Observation tokens: 264
- Turns: 4, Elapsed: 34287ms
- LLM: 9547 prompt + 590 completion tokens
- Trajectory:
  1. `file.read_many` — {"paths": ["package.json", "TASK.md"]} aci_ok=True
  1. `repo.summary` — {} aci_ok=True
  1. `file.replace_exact` — {"expected_hash": "sha256:3c340a008ea26464", "new": "process.exit(0)", "old": "process.exit(1)", "path": "package.json"} aci_ok=True
  1. `exec.run` — {"argv": ["npm", "test"]} aci_ok=True
  1. `task_complete` — {"success": true, "summary": "Fixed package.json test script from `process.exit(1)` to `process.exit(0)`; verified `npm test` exits 0."}

### ts_package_script_fail [raw_shell] → PASS
- Reason: command_exit_0 ['C:\\Program Files\\nodejs\\npm.CMD', 'test'] -> 0
- Tool calls: 4, Observation tokens: 166
- Turns: 4, Elapsed: 14521ms
- LLM: 3457 prompt + 261 completion tokens
- Trajectory:
  1. `run_command` — {"command": "type package.json"}
  1. `run_command` — {"command": "dir /B"}
  1. `run_command` — {"command": "node -e \"const fs=require('fs');fs.writeFileSync('package.json',JSON.stringify({name:'bench-ts-script',version:'1.0.0',private:true,scripts:{test:'node -e \\\"process.exit(0)\\\"'}},null
  1. `run_command` — {"command": "type package.json && npm test"}
  1. `task_complete` — {"success": true, "summary": "Fixed package.json test script to exit 0; verified with a single successful `npm test` run."}

---

**Key**:
- Condition A = raw shell (`run_command` only — full build logs, no reduction)
- Condition D = VerseShell ACI (`file.view`, `exec.run`, `file.replace_exact`, etc. via `ae --serve --agent`, with semantic output reduction)
- `aci_ok` = whether the individual AE op returned success
- Descriptive advantage only: D success > A success, OR D tool_calls < 70% of A, OR D obs_tokens < 60% of A
- Formal claims require tools/study_inference.py with a frozen plan, calibrated multiplicity and complete independent repeats.
