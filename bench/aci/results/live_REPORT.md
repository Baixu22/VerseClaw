# ACI-Bench LIVE Report

- Generated: 2026-10-14T10:09:54.380557+00:00
- Task set: 3.1.0
- Mode: **LIVE** (real LLM multi-turn tool-calling)
- Model: `sn-glm-5-3-flash`

## Leaderboard

| model | condition | tasks | success_rate | avg_tool_calls | avg_observation_tokens |
|---|---|---:|---:|---:|---:|
| sn-glm-5-3-flash | raw_shell | 8 | 1.0 | 2.88 | 279.5 |
| sn-glm-5-3-flash | raw_shell_coached | 8 | 1.0 | 2.62 | 170.0 |
| sn-glm-5-3-flash | verseshell_aci | 8 | 1.0 | 4.38 | 304.25 |

## Condition A vs D

**NOT CLAIMABLE** — single-collection diagnostics; not formal acceptance.

### sn-glm-5-3-flash / selected / raw_shell → **NOT CLAIMABLE** (single-collection diagnostic)
- Descriptive advantage (old OR): False
- Refusal reasons: exclusion_rate_above_10pct, complete_repeated_study_not_evaluated, frozen_family_inference_not_evaluated

| Metric | Raw Shell (A) | VerseShell ACI (D) | Ratio (D/A) |
|---|---|---:|---:|
| Success rate | 1.0 | 1.0 | — |
| Avg tool calls | 2.88 | 4.38 | 1.5217 |
| Avg observation tokens | 279.5 | 304.25 | 1.0886 |
| Formal acceptance | — | — | **NOT CLAIMABLE** |

### sn-glm-5-3-flash / selected / raw_shell_coached → **NOT CLAIMABLE** (single-collection diagnostic)
- Descriptive advantage (old OR): False
- Refusal reasons: exclusion_rate_above_10pct, complete_repeated_study_not_evaluated, frozen_family_inference_not_evaluated

| Metric | Raw Shell (A) | VerseShell ACI (D) | Ratio (D/A) |
|---|---|---:|---:|
| Success rate | 1.0 | 1.0 | — |
| Avg tool calls | 2.62 | 4.38 | 1.6667 |
| Avg observation tokens | 170.0 | 304.25 | 1.7897 |
| Formal acceptance | — | — | **NOT CLAIMABLE** |

## Per-Task Trajectories

### rust_fix_compile_error [raw_shell] → PASS
- Reason: behaviour and required unit-test checks passed
- Tool calls: 2, Observation tokens: 120
- Turns: 3, Elapsed: 14803ms
- LLM: 2430 prompt + 204 completion tokens
- Trajectory:
  1. `run_command` — {"command": "type src\\lib.rs & type Cargo.toml"}
  1. `run_command` — {"command": "powershell -NoProfile -Command \"(Get-Content src\\lib.rs) -replace '-> String','-> i32' | Set-Content src\\lib.rs; cargo check\""}
  1. `task_complete` — {"success": true, "summary": "Fixed lib.rs return type from String to i32; cargo check passes cleanly."}

### rust_fix_compile_error [raw_shell_coached] → PASS
- Reason: behaviour and required unit-test checks passed
- Tool calls: 2, Observation tokens: 117
- Turns: 3, Elapsed: 23968ms
- LLM: 2546 prompt + 222 completion tokens
- Trajectory:
  1. `run_command` — {"command": "type src\\lib.rs & type Cargo.toml"}
  1. `run_command` — {"command": "python -c \"open('src/lib.rs','w').write('pub fn add(a: i32, b: i32) -> i32 {\\n    a + b\\n}\\n')\" && cargo check > check.log 2>&1 & findstr /C:\"error\" /C:\"warning\" /C:\"Finished\" 
  1. `task_complete` — {"success": true, "summary": "Changed add()'s return type from String to i32 in src/lib.rs; cargo check passes cleanly."}

### rust_fix_compile_error [verseshell_aci] → PASS
- Reason: behaviour and required unit-test checks passed
- Tool calls: 3, Observation tokens: 231
- Turns: 4, Elapsed: 19951ms
- LLM: 9541 prompt + 238 completion tokens
- Trajectory:
  1. `file.read_many` — {"paths": ["Cargo.toml", "src/lib.rs"]} aci_ok=True
  1. `file.replace_exact` — {"expected_hash": "sha256:471dfab5b79f216a", "new": "pub fn add(a: i32, b: i32) -> i32 {", "old": "pub fn add(a: i32, b: i32) -> String {", "path": "src/lib.rs"} aci_ok=True
  1. `exec.run` — {"argv": ["cargo", "check"], "profile": "cargo"} aci_ok=True
  1. `task_complete` — {"success": true, "summary": "Fixed src/lib.rs `add` return type from String to i32; cargo check passes with 0 errors/warnings."}

### rust_add_unit_test [raw_shell_coached] → PASS
- Reason: behaviour and required unit-test checks passed
- Tool calls: 2, Observation tokens: 121
- Turns: 3, Elapsed: 26413ms
- LLM: 2536 prompt + 205 completion tokens
- Trajectory:
  1. `run_command` — {"command": "type Cargo.toml & echo --- & type src\\lib.rs"}
  1. `run_command` — {"command": "python -c \"open('src/lib.rs','a').write('''\\n#[cfg(test)]\\nmod tests {\\n    use super::add;\\n\\n    #[test]\\n    fn it_adds() {\\n        assert_eq!(add(2, 3), 5);\\n    }\\n}\\n'''
  1. `task_complete` — {"success": true, "summary": "Added a #[cfg(test)] unit test for add() in src/lib.rs; cargo test passes with 1 test passing."}

### rust_add_unit_test [verseshell_aci] → PASS
- Reason: behaviour and required unit-test checks passed
- Tool calls: 5, Observation tokens: 341
- Turns: 6, Elapsed: 24663ms
- LLM: 15580 prompt + 694 completion tokens
- Trajectory:
  1. `file.read_many` — {"paths": ["Cargo.toml", "src/lib.rs"]} aci_ok=True
  1. `file.replace_exact` — {"expected_hash": "sha256:2551a0f2f738405d", "new": "pub fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n\n#[cfg(test)]\nmod tests {\n    use super::*;\n\n    #[test]\n    fn test_add() {\n        asse aci_ok=False
  1. `file.replace_exact` — {"new": "pub fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n\n#[cfg(test)]\nmod tests {\n    use super::*;\n\n    #[test]\n    fn test_add() {\n        assert_eq!(add(2, 3), 5);\n    }\n\n    #[test]\ aci_ok=False
  1. `file.write` — {"content": "pub fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n\n#[cfg(test)]\nmod tests {\n    use super::*;\n\n    #[test]\n    fn test_add() {\n        assert_eq!(add(2, 3), 5);\n    }\n\n    #[te aci_ok=True
  1. `exec.run` — {"argv": ["cargo", "test"], "profile": "cargo"} aci_ok=True
  1. `task_complete` — {"success": true, "summary": "Added #[cfg(test)] unit tests for add() in src/lib.rs (positive and negative cases); cargo test passes with 2/2 tests green."}

### rust_add_unit_test [raw_shell] → PASS
- Reason: behaviour and required unit-test checks passed
- Tool calls: 3, Observation tokens: 327
- Turns: 4, Elapsed: 51335ms
- LLM: 3891 prompt + 675 completion tokens
- Trajectory:
  1. `run_command` — {"command": "type Cargo.toml & type src\\lib.rs"}
  1. `run_command` — {"command": "powershell -NoProfile -Command \"Add-Content -Path src\\lib.rs -Value @'\n\n#[cfg(test)]\nmod tests {\n    use super::*;\n\n    #[test]\n    fn test_add() {\n        assert_eq!(add(2, 3),
  1. `run_command` — {"command": "python -c \"f=open('src/lib.rs','a'); f.write('\\n#[cfg(test)]\\nmod tests {\\n    use super::*;\\n\\n    #[test]\\n    fn test_add() {\\n        assert_eq!(add(2, 3), 5);\\n        asser
  1. `task_complete` — {"success": true, "summary": "Added a #[cfg(test)] unit test for add() in src/lib.rs; cargo test passes (1 test, 0 failures)."}

### rust_search_and_edit [verseshell_aci] → PASS
- Reason: behaviour and required unit-test checks passed
- Tool calls: 9, Observation tokens: 642
- Turns: 8, Elapsed: 62873ms
- LLM: 23509 prompt + 854 completion tokens
- Trajectory:
  1. `repo.summary` — {} aci_ok=True
  1. `file.view` — {"path": "Cargo.toml"} aci_ok=True
  1. `file.view` — {"path": "src/lib.rs"} aci_ok=True
  1. `exec.run` — {"argv": ["cmd", "/d", "/c", "dir src && type TASK.md"]} aci_ok=True
  1. `file.replace_exact` — {"expected_hash": "sha256:9e7e6da826ccd2c0", "new": "pub fn sum(a: i32, b: i32) -> i32 {\n    a + b\n}\n\n#[cfg(test)]\nmod tests {\n    use super::sum;\n\n    #[test]\n    fn sums_two_numbers() {\n   aci_ok=False
  1. `file.replace_exact` — {"new": "pub fn sum(a: i32, b: i32) -> i32 {\n    a + b\n}\n\n#[cfg(test)]\nmod tests {\n    use super::sum;\n\n    #[test]\n    fn sums_two_numbers() {\n        assert_eq!(sum(2, 3), 5);\n        ass aci_ok=False
  1. `file.view` — {"cursor": 1, "path": "src/lib.rs", "window": 80} aci_ok=True
  1. `file.write` — {"content": "pub fn sum(a: i32, b: i32) -> i32 {\n    a + b\n}\n\n#[cfg(test)]\nmod tests {\n    use super::sum;\n\n    #[test]\n    fn sums_two_numbers() {\n        assert_eq!(sum(2, 3), 5);\n        aci_ok=True
  1. `exec.run` — {"argv": ["cmd", "/d", "/c", "cargo test"], "profile": "cargo"} aci_ok=True
  1. `task_complete` — {"success": true, "summary": "Replaced the TODO(fix-me) stub in src/lib.rs with `a + b` and added a unit test; cargo test passes (1 passed, 0 failed)."}

### rust_search_and_edit [raw_shell] → PASS
- Reason: behaviour and required unit-test checks passed
- Tool calls: 4, Observation tokens: 859
- Turns: 5, Elapsed: 19868ms
- LLM: 7153 prompt + 721 completion tokens
- Trajectory:
  1. `run_command` — {"command": "dir /s /b && type Cargo.toml && type src\\lib.rs && type TASK.md"}
  1. `run_command` — {"command": "powershell -NoProfile -Command \"Set-Content -Path src\\lib.rs -Value 'pub fn sum(a: i32, b: i32) -> i32 {`n    a + b`n}' -Encoding UTF8; cargo test\""}
  1. `run_command` — {"command": "echo pub fn sum(a: i32, b: i32) -> i32 {> src\\lib.rs && echo     a + b>> src\\lib.rs && echo }>> src\\lib.rs && type src\\lib.rs && cargo test"}
  1. `run_command` — {"command": "python -c \"open(r'src\\lib.rs','w').write('pub fn sum(a: i32, b: i32) -> i32 {\\n    a + b\\n}\\n')\" && type src\\lib.rs && cargo test"}
  1. `task_complete` — {"success": true, "summary": "Implemented sum() in src/lib.rs to return a + b, replacing the TODO(fix-me) stub; cargo test passes."}

### rust_search_and_edit [raw_shell_coached] → PASS
- Reason: behaviour and required unit-test checks passed
- Tool calls: 2, Observation tokens: 220
- Turns: 3, Elapsed: 7878ms
- LLM: 2834 prompt + 240 completion tokens
- Trajectory:
  1. `run_command` — {"command": "dir /s /b . && type Cargo.toml && type src\\lib.rs && type TASK.md"}
  1. `run_command` — {"command": "python -c \"open(r'src\\lib.rs','w').write('pub fn sum(a: i32, b: i32) -> i32 {\\n    a + b\\n}\\n')\" && cargo test 2>&1 | findstr /R /C:\"^test result\" /C:\"error\" /C:\"warning\""}
  1. `task_complete` — {"success": true, "summary": "Implemented sum(a,b) in src/lib.rs to return a + b, replacing the TODO(fix-me) stub; cargo test passes."}

### python_fix_pytest_fail [raw_shell] → PASS
- Reason: all ok
- Tool calls: 4, Observation tokens: 249
- Turns: 4, Elapsed: 21019ms
- LLM: 3561 prompt + 187 completion tokens
- Trajectory:
  1. `run_command` — {"command": "type mathlib.py"}
  1. `run_command` — {"command": "type tests\\test_math.py"}
  1. `run_command` — {"command": "python -c \"open('mathlib.py','w').write('def add(a, b):\\n    return a + b\\n')\""}
  1. `run_command` — {"command": "python -m pytest tests -v"}
  1. `task_complete` — {"success": true, "summary": "Fixed mathlib.py add() to return a + b instead of a * b; pytest passes (1 passed)."}

### python_fix_pytest_fail [raw_shell_coached] → PASS
- Reason: all ok
- Tool calls: 3, Observation tokens: 239
- Turns: 4, Elapsed: 19935ms
- LLM: 3609 prompt + 207 completion tokens
- Trajectory:
  1. `run_command` — {"command": "type mathlib.py & type tests\\test_math.py"}
  1. `run_command` — {"command": "python -c \"open('mathlib.py','w').write('def add(a, b):\\n    return a + b\\n')\" && type mathlib.py"}
  1. `run_command` — {"command": "python -m pytest tests -v 2>&1"}
  1. `task_complete` — {"success": true, "summary": "Fixed mathlib.py add() to return a+b instead of a*b; pytest passes (1 passed)."}

### python_fix_pytest_fail [verseshell_aci] → PASS
- Reason: all ok
- Tool calls: 3, Observation tokens: 220
- Turns: 4, Elapsed: 116416ms
- LLM: 9090 prompt + 149 completion tokens
- Trajectory:
  1. `file.read_many` — {"paths": ["mathlib.py", "tests/test_math.py"]} aci_ok=True
  1. `file.replace_exact` — {"new": "    return a + b", "old": "    return a * b", "path": "mathlib.py"} aci_ok=True
  1. `exec.run` — {"argv": ["python", "-m", "pytest", "tests/test_math.py", "-q"]} aci_ok=True
  1. `task_complete` — {"success": true, "summary": "Fixed add() in mathlib.py to return a + b instead of a * b; test_add now passes."}

### python_edit_and_retest [raw_shell_coached] → PASS
- Reason: all ok
- Tool calls: 2, Observation tokens: 100
- Turns: 3, Elapsed: 9444ms
- LLM: 2422 prompt + 130 completion tokens
- Trajectory:
  1. `run_command` — {"command": "type greet.py & type tests\\test_greet.py"}
  1. `run_command` — {"command": "python -c \"open('greet.py','w').write('def greet(name):\\n    return f\\\"Hello, {name}!\\\"\\n')\" && python -m pytest tests -q"}
  1. `task_complete` — {"success": true, "summary": "Updated greet() to return 'Hello, {name}!' and verified tests pass (1 passed)."}

### python_edit_and_retest [verseshell_aci] → PASS
- Reason: all ok
- Tool calls: 3, Observation tokens: 226
- Turns: 4, Elapsed: 27375ms
- LLM: 9418 prompt + 206 completion tokens
- Trajectory:
  1. `file.read_many` — {"paths": ["greet.py", "tests/test_greet.py"]} aci_ok=True
  1. `file.replace_exact` — {"expected_hash": "3ab4a6cd647afe33", "new": "def greet(name):\n    return f\"Hello, {name}!\"", "old": "def greet(name):\n    return f\"Hi {name}\"", "path": "greet.py"} aci_ok=True
  1. `exec.run` — {"argv": ["python", "-m", "pytest", "-q"], "profile": "pytest"} aci_ok=True
  1. `task_complete` — {"success": true, "summary": "Updated greet() to return \"Hello, {name}!\" and re-ran pytest: 1 passed."}

### python_edit_and_retest [raw_shell] → PASS
- Reason: all ok
- Tool calls: 2, Observation tokens: 108
- Turns: 3, Elapsed: 10099ms
- LLM: 2356 prompt + 151 completion tokens
- Trajectory:
  1. `run_command` — {"command": "dir /b & type greet.py & echo --- & type tests\\test_greet.py"}
  1. `run_command` — {"command": "python -c \"open('greet.py','w').write('def greet(name):\\n    return f\\\"Hello, {name}!\\\"\\n')\" && python -m pytest tests -q"}
  1. `task_complete` — {"success": true, "summary": "Updated greet() to return 'Hello, {name}!' and tests pass (1 passed)."}

### python_noisy_install_summary [verseshell_aci] → PASS
- Reason: all ok
- Tool calls: 5, Observation tokens: 289
- Turns: 4, Elapsed: 41636ms
- LLM: 9783 prompt + 702 completion tokens
- Trajectory:
  1. `repo.summary` — {} aci_ok=True
  1. `file.view` — {"path": "requirements.txt"} aci_ok=True
  1. `exec.run` — {"argv": ["cmd", "/d", "/c", "pip install -r requirements.txt --disable-pip-version-check"], "cwd": ".", "profile": "npm_install"} aci_ok=True
  1. `file.write` — {"content": "Installed 1 package from requirements.txt: six==1.16.0 (pure-Python Python 2/3 compatibility library, no additional dependencies; pip install completed successfully).\n", "path": "SUMMARY aci_ok=True
  1. `exec.run` — {"argv": ["python", "-c", "import six; print(six.__version__)"], "cwd": ".", "profile": "none"} aci_ok=True
  1. `task_complete` — {"success": true, "summary": "Installed 1 dependency (six==1.16.0) from requirements.txt via pip (exit 0, verified importable) and wrote the one-line dependency summary to SUMMARY.txt."}

### python_noisy_install_summary [raw_shell] → PASS
- Reason: all ok
- Tool calls: 4, Observation tokens: 325
- Turns: 4, Elapsed: 38331ms
- LLM: 4234 prompt + 330 completion tokens
- Trajectory:
  1. `run_command` — {"command": "dir && type requirements.txt && type TASK.md"}
  1. `run_command` — {"command": "python --version && pip --version"}
  1. `run_command` — {"command": "pip install -r requirements.txt --no-input -q && pip show six | findstr /B \"Name Version Location\""}
  1. `run_command` — {"command": "python -c \"open('SUMMARY.txt','w').write('Installed 1 package from requirements.txt: six==1.16.0 (already satisfied, no other dependencies).')\" && type SUMMARY.txt"}
  1. `task_complete` — {"success": true, "summary": "Installed requirements (six==1.16.0) and wrote one-line dependency summary to SUMMARY.txt."}

### python_noisy_install_summary [raw_shell_coached] → PASS
- Reason: all ok
- Tool calls: 4, Observation tokens: 227
- Turns: 5, Elapsed: 22305ms
- LLM: 4792 prompt + 728 completion tokens
- Trajectory:
  1. `run_command` — {"command": "type requirements.txt & echo --- & type TASK.md & echo --- & dir /B"}
  1. `run_command` — {"command": "pip install -r requirements.txt > install.log 2>&1 & python -c \"import six; print(six.__version__)\" & type SUMMARY.txt 2>nul"}
  1. `run_command` — {"command": "findstr /R \"Successfully installed already-satisfied\" install.log & python -c \"open('SUMMARY.txt','w').write('Installed 1 package from requirements.txt: six==1.16.0 (verified importabl
  1. `run_command` — {"command": "python -c \"print(open('install.log',encoding='utf-8',errors='replace').read()[-600:])\""}
  1. `task_complete` — {"success": true, "summary": "Installed requirements (1 package: six==1.16.0, already satisfied and import-verified) and wrote one-line summary to SUMMARY.txt."}

### ts_fix_type_error [raw_shell] → PASS
- Reason: command_exit_0 ['node', 'node_modules/typescript/bin/tsc', '--noEmit'] -> 0
- Tool calls: 2, Observation tokens: 151
- Turns: 3, Elapsed: 25573ms
- LLM: 3108 prompt + 354 completion tokens
- Trajectory:
  1. `run_command` — {"command": "type src\\index.ts & echo --- & type tsconfig.json & echo --- & type package.json"}
  1. `run_command` — {"command": "powershell -NoProfile -Command \"(Get-Content src\\index.ts -Raw) -replace 'const x: string = a \\+ b;','const x: number = a + b;' | Set-Content src\\index.ts -NoNewline\" && npx tsc --no
  1. `task_complete` — {"success": true, "summary": "Fixed type error in src/index.ts by changing `const x: string` to `const x: number`; tsc --noEmit now passes."}

### ts_fix_type_error [raw_shell_coached] → PASS
- Reason: command_exit_0 ['node', 'node_modules/typescript/bin/tsc', '--noEmit'] -> 0
- Tool calls: 2, Observation tokens: 171
- Turns: 3, Elapsed: 34204ms
- LLM: 3195 prompt + 333 completion tokens
- Trajectory:
  1. `run_command` — {"command": "type package.json & type tsconfig.json & type src\\index.ts"}
  1. `run_command` — {"command": "python -c \"import io; p='src/index.ts'; s=io.open(p,encoding='utf-8').read(); s=s.replace('const x: string = a + b;','const x: number = a + b;'); io.open(p,'w',encoding='utf-8',newline='
  1. `task_complete` — {"success": true, "summary": "Fixed type error in src/index.ts by changing `const x: string` to `const x: number`; tsc --noEmit now succeeds."}

### ts_package_script_fail [raw_shell_coached] → PASS
- Reason: command_exit_0 ['C:\\Program Files\\nodejs\\npm.CMD', 'test'] -> 0
- Tool calls: 4, Observation tokens: 165
- Turns: 4, Elapsed: 50905ms
- LLM: 3653 prompt + 2852 completion tokens
- Trajectory:
  1. `run_command` — {"command": "type package.json"}
  1. `run_command` — {"command": "dir /B"}
  1. `run_command` — {"command": "node -e \"const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.scripts.test='node -e \\\"process.exit(0)\\\"';fs.writeFileSync('package.json',JSON.stringify
  1. `run_command` — {"command": "npm test"}
  1. `task_complete` — {"success": true, "summary": "Fixed package.json test script from exit(1) to exit(0); npm test now exits 0."}

### ts_package_script_fail [verseshell_aci] → PASS
- Reason: command_exit_0 ['C:\\Program Files\\nodejs\\npm.CMD', 'test'] -> 0
- Tool calls: 4, Observation tokens: 235
- Turns: 4, Elapsed: 11321ms
- LLM: 9414 prompt + 243 completion tokens
- Trajectory:
  1. `repo.summary` — {} aci_ok=True
  1. `file.view` — {"path": "package.json"} aci_ok=True
  1. `file.replace_exact` — {"new": "    \"test\": \"node -e \\\"process.exit(0)\\\"\"", "old": "    \"test\": \"node -e \\\"process.exit(1)\\\"\"", "path": "package.json"} aci_ok=True
  1. `exec.run` — {"argv": ["npm", "test"], "profile": "npm_install"} aci_ok=True
  1. `task_complete` — {"success": true, "summary": "Fixed package.json test script to exit 0 instead of 1; verified `npm test` exits 0."}

### ts_package_script_fail [raw_shell] → PASS
- Reason: command_exit_0 ['C:\\Program Files\\nodejs\\npm.CMD', 'test'] -> 0
- Tool calls: 2, Observation tokens: 97
- Turns: 3, Elapsed: 11306ms
- LLM: 2314 prompt + 239 completion tokens
- Trajectory:
  1. `run_command` — {"command": "dir /B && type package.json"}
  1. `run_command` — {"command": "node -e \"const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.scripts.test='node -e \\\"process.exit(0)\\\"';fs.writeFileSync('package.json',JSON.stringify
  1. `task_complete` — {"success": true, "summary": "Fixed package.json test script to run a passing command; npm test now exits 0."}

### ts_fix_type_error [verseshell_aci] → PASS
- Reason: command_exit_0 ['node', 'node_modules/typescript/bin/tsc', '--noEmit'] -> 0
- Tool calls: 3, Observation tokens: 250
- Turns: 4, Elapsed: 38415ms
- LLM: 10392 prompt + 332 completion tokens
- Trajectory:
  1. `file.read_many` — {"max_total_lines": 120, "paths": ["src/index.ts", "tsconfig.json", "package.json"]} aci_ok=True
  1. `file.replace_exact` — {"expected_hash": "d99b13deba072b7f", "new": "  const x: number = a + b;", "old": "  const x: string = a + b;", "path": "src/index.ts"} aci_ok=True
  1. `exec.run` — {"argv": ["node", "node_modules/typescript/bin/tsc", "--noEmit"], "profile": "auto"} aci_ok=True
  1. `task_complete` — {"success": true, "summary": "Fixed type error in src/index.ts by correcting the annotation of x from string to number; tsc --noEmit now passes with exit code 0."}

---

**Key**:
- Condition A = raw shell (`run_command` only — full build logs, no reduction)
- Condition D = VerseShell ACI (`file.view`, `exec.run`, `file.replace_exact`, etc. via `ae --serve --agent`, with semantic output reduction)
- `aci_ok` = whether the individual AE op returned success
- Descriptive advantage only: D success > A success, OR D tool_calls < 70% of A, OR D obs_tokens < 60% of A
- Formal claims require tools/study_inference.py with a frozen plan, calibrated multiplicity and complete independent repeats.
