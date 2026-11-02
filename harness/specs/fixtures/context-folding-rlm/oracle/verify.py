#!/usr/bin/env python3
"""Deterministic oracle for the context-folding real task.

This verifier runs the real workspace tests and checks the agent-produced
evaluation manifest. It intentionally does not accept a model's text as task
completion.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path


def fail(message: str) -> None:
    print(f"FAIL: {message}")
    raise SystemExit(1)


def load_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001 - oracle must report malformed evidence
        fail(f"cannot read {path}: {exc}")
    if not isinstance(value, dict):
        fail(f"{path} must contain a JSON object")
    return value


def run_tests(workspace: Path) -> tuple[int, int, int]:
    completed = subprocess.run(
        [sys.executable, "-m", "unittest", "discover", "-s", "tests", "-v"],
        cwd=workspace,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )
    output = completed.stdout
    ran = re.search(r"Ran\s+(\d+)\s+tests?", output)
    failed = re.search(r"FAILED\s+\(failures=(\d+), errors=(\d+)\)", output)
    skipped = re.search(r"skipped=(\d+)", output)
    if completed.returncode != 0:
        fail(f"workspace tests failed\n{output[-4000:]}")
    if not ran:
        fail("workspace test output did not include a test count")
    failure_count = int(failed.group(1)) + int(failed.group(2)) if failed else 0
    skipped_count = int(skipped.group(1)) if skipped else 0
    return completed.returncode, int(ran.group(1)), failure_count + skipped_count


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def validate_result(result: dict, workspace: Path) -> None:
    require(result.get("schemaVersion") == "ContextFoldingEvalResult/v1", "unexpected result schema")
    require(result.get("driven_by") == "agent", "result must be agent-driven")
    require(bool(str(result.get("actor", "")).strip()), "result must name an actor")
    require(result.get("status") == "pass", "result status must be pass")
    modes = result.get("modes")
    require(isinstance(modes, dict), "result.modes is required")
    for mode_name in ("baseline", "expand-only", "folded-child"):
        mode = modes.get(mode_name)
        require(isinstance(mode, dict), f"missing mode: {mode_name}")
        tests = mode.get("tests")
        require(isinstance(tests, dict), f"missing tests for {mode_name}")
        require(tests.get("exitCode") == 0, f"{mode_name} tests must exit 0")
        require(tests.get("failed") == 0, f"{mode_name} must have zero failed tests")
        require(tests.get("skipped") == 0, f"{mode_name} must have zero skipped tests")
        refs = mode.get("evidenceRefs")
        require(isinstance(refs, list) and refs, f"{mode_name} must retain evidence refs")
        require(not mode.get("scopeViolations"), f"{mode_name} has scope violations")
        require(not mode.get("staleReferences"), f"{mode_name} has stale references")

    baseline = modes["baseline"].get("metrics", {})
    folded = modes["folded-child"].get("metrics", {})
    baseline_chars = baseline.get("mainContextChars")
    folded_chars = folded.get("mainContextChars")
    require(isinstance(baseline_chars, (int, float)) and baseline_chars > 0, "baseline mainContextChars is required")
    require(isinstance(folded_chars, (int, float)) and folded_chars > 0, "folded mainContextChars is required")
    reduction = 1.0 - (float(folded_chars) / float(baseline_chars))
    require(reduction >= 0.30, f"main context reduction below 30%: {reduction:.3f}")
    if isinstance(baseline.get("totalTokens"), (int, float)) and baseline["totalTokens"] > 0:
        ratio = float(folded.get("totalTokens", 0)) / float(baseline["totalTokens"])
        require(ratio <= 2.0, f"total token multiplier above 2.0: {ratio:.3f}")

    folded_mode = modes["folded-child"]
    require(folded_mode.get("maxRecursiveDepth", 99) <= 1, "recursive depth must not exceed 1")
    require(folded_mode.get("rawChildTranscriptChars", 10**9) <= 8000, "raw child transcript exceeded 8000 chars")
    require(folded_mode.get("rawTranscriptInjected") is False, "raw child transcript was injected")
    events = folded_mode.get("contextEvents")
    require(isinstance(events, list) and events, "folded-child contextEvents are required")
    require(any(item.get("type") == "context_expand" for item in events if isinstance(item, dict)), "no context_expand event")
    require(any(item.get("type") == "context_fold" for item in events if isinstance(item, dict)), "no context_fold event")
    child_results = folded_mode.get("foldedResults")
    require(isinstance(child_results, list) and child_results, "no ContextFoldResult")
    for child in child_results:
        require(isinstance(child, dict), "invalid ContextFoldResult")
        require(child.get("childRunId") or child.get("childSessionKey"), "ContextFoldResult missing child identity")
        require(isinstance(child.get("evidenceRefs"), list) and child["evidenceRefs"], "ContextFoldResult missing evidenceRefs")
        require("unresolvedClaims" in child, "ContextFoldResult missing unresolvedClaims")

    # The real workspace must remain unchanged by the oracle; the caller is
    # responsible for using a disposable copy. We only run the tests here.
    require((workspace / "src" / "taskboard.py").is_file(), "workspace source is missing")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--result", required=True, type=Path)
    args = parser.parse_args()
    workspace = args.workspace.resolve()
    result = load_json(args.result.resolve())
    run_tests(workspace)
    validate_result(result, workspace)
    print("PASS: real task tests and context-folding eval manifest are valid")


if __name__ == "__main__":
    main()
