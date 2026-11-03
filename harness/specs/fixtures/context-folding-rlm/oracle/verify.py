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

    folded_mode = modes["folded-child"]
    require(folded_mode.get("evidenceRefsResolution") == 1.0, "required evidence refs did not resolve 100%")

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
    if isinstance(baseline.get("latencyMs"), (int, float)) and baseline["latencyMs"] > 0:
        latency_ratio = float(folded.get("latencyMs", 0)) / float(baseline["latencyMs"])
        require(latency_ratio <= 2.5, f"latency multiplier above 2.5: {latency_ratio:.3f}")
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



def validate_multiround(result: dict) -> None:
    """Validate the 10-round formal positive-benefit aggregate."""
    require(result.get("schemaVersion") == "ContextFoldingMultiRoundEvalResult/v2", "unexpected multi-round schema")
    require(result.get("driven_by") == "agent", "multi-round result must be agent-driven")
    require(bool(str(result.get("actor", "")).strip()), "multi-round result must name an actor")
    require(result.get("status") == "pass", "multi-round status must be pass")
    rounds = result.get("rounds") or {}
    require(rounds.get("frozen") == 5, "multi-round needs 5 frozen rounds")
    require(rounds.get("perturbed") == 5, "multi-round needs 5 perturbed rounds")
    require(rounds.get("total") == 10, "multi-round total must be 10")
    round_summaries = result.get("roundSummaries")
    require(isinstance(round_summaries, list) and len(round_summaries) == 10, "multi-round needs 10 per-round records")
    for summary in round_summaries:
        require(isinstance(summary, dict), "invalid per-round record")
        require(summary.get("pass") is True, f"{summary.get('roundId')} did not pass")
        require(not summary.get("failedChecks"), f"{summary.get('roundId')} has failed checks")
        ratios = summary.get("ratios") or {}
        require(float(ratios.get("mainContextReduction", 0)) >= 0.30, f"{summary.get('roundId')} main-context reduction below 30%")
        require(float(ratios.get("totalTokenMultiplier", 99)) < 1.0, f"{summary.get('roundId')} total-token multiplier is not positive")
        require(float(ratios.get("latencyMultiplier", 99)) <= 2.5, f"{summary.get('roundId')} latency multiplier above 2.5")
        require(summary.get("evidenceRefsResolution") == 1.0, f"{summary.get('roundId')} evidence refs incomplete")
        require(summary.get("scopeViolations") == 0 and summary.get("staleReferences") == 0, f"{summary.get('roundId')} has scope/stale failures")
        require(summary.get("rawChildTranscriptChars") == 0, f"{summary.get('roundId')} leaked raw transcript")
        require(summary.get("rawTranscriptInjected") is False, f"{summary.get('roundId')} injected raw transcript")
        require(int(summary.get("maxRecursiveDepth", 99)) <= 1, f"{summary.get('roundId')} depth exceeded")
    stats = result.get("stats") or {}
    token = stats.get("tokenMultiplier") or {}
    context = stats.get("mainContextReduction") or {}
    require(float(token.get("median", 99)) < 1.0, "median total-token multiplier is not positive")
    require(float(token.get("p95", 99)) < 1.0, "P95 total-token multiplier is not positive")
    require(float(context.get("median", 0)) >= 0.30, "median main-context reduction below 30%")
    gates = result.get("gates") or {}
    require(gates.get("all") is True, "multi-round aggregate gate is not true")
    perturbation = result.get("perturbation") if isinstance(result.get("perturbation"), dict) else None
    require(perturbation is not None and perturbation.get("profile") == "varied", "aggregate perturbation profile is missing")
    require(perturbation.get("extraCharsPerRound") == [4000, 8000, 12000, 16000, 24000], "varied-noise sizes are not the frozen sequence")
    profiles = result.get("profiles")
    require(isinstance(profiles, list) and len(profiles) == 2, "multi-round needs 2 profiles")
    require(any((p.get("perturbation") or {}).get("profile") == "varied" for p in profiles if isinstance(p, dict)), "varied perturbation profile is missing")

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--result", required=True, type=Path)
    args = parser.parse_args()
    workspace = args.workspace.resolve()
    result = load_json(args.result.resolve())
    if result.get("schemaVersion") == "ContextFoldingMultiRoundEvalResult/v2":
        validate_multiround(result)
        print("PASS: multi-round real-task evidence is valid")
        return
    run_tests(workspace)
    validate_result(result, workspace)
    print("PASS: real task tests and context-folding eval manifest are valid")


if __name__ == "__main__":
    main()
