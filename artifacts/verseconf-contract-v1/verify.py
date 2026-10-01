#!/usr/bin/env python3
"""Offline TF-0244 fixture/oracle checks. Never executes a product mutation."""
from __future__ import annotations

import argparse
import copy
from datetime import datetime, timezone
import hashlib
from importlib.metadata import version
import json
import math
from pathlib import Path
import subprocess
import sys
import time

from jsonschema import Draft202012Validator
from referencing import Registry
from referencing.exceptions import NoSuchResource

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent
MAX_SAFE = 9007199254740991
DRAFT = "https://json-schema.org/draft/2020-12/schema"


class ContractError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def require(condition: bool, code: str, message: str) -> None:
    if not condition:
        raise ContractError(code, message)


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def safe_number(value: str, integer: bool = False):
    if integer:
        require(len(value.lstrip("-")) <= 16, "unsafe_number", "Integer exceeds the safe range")
    number = int(value) if integer else float(value)
    require(abs(number) <= MAX_SAFE, "unsafe_number", "Number outside the bounded binary64 profile")
    require(math.isfinite(number), "unsafe_number", "Non-finite JSON number")
    return number


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "duplicate_key", f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def reject_constant(value):
    raise ContractError("unsafe_number", f"Not a JSON number: {value}")


def strict_json(raw: bytes, byte_limit: int = 262144, depth_limit: int = 32):
    require(len(raw) <= byte_limit, "limit_exceeded", "JSON byte limit")
    require(not raw.startswith(b"\xef\xbb\xbf"), "invalid_json", "BOM excluded by this profile")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ContractError("invalid_json", "Invalid UTF-8") from error
    depth, quoted, escaped = 0, False, False
    for char in text:
        if quoted:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                quoted = False
        elif char == '"':
            quoted = True
        elif char in "[{":
            depth += 1
            require(depth <= depth_limit, "limit_exceeded", "JSON nesting limit")
        elif char in "]}":
            depth -= 1
    try:
        value = json.loads(text, object_pairs_hook=unique_object,
                           parse_int=lambda token: safe_number(token, True),
                           parse_float=safe_number, parse_constant=reject_constant)
        # json.loads accepts escaped lone surrogates; the declared profile does not.
        json.dumps(value, ensure_ascii=False).encode("utf-8")
        return value
    except (json.JSONDecodeError, UnicodeEncodeError, RecursionError) as error:
        raise ContractError("invalid_json", str(error)) from error


def encode(value) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")


def deny_retrieval(uri):
    raise NoSuchResource(ref=uri)


def schema_validator(schema):
    require(schema.get("$schema") == DRAFT, "unsupported_schema", "Only draft 2020-12 is selected")

    def check_refs(value):
        if isinstance(value, dict):
            for key, item in value.items():
                if key in {"$ref", "$dynamicRef"}:
                    require(isinstance(item, str) and item.startswith("#"),
                            "unsupported_schema", "Only bundled fragment references are allowed")
                check_refs(item)
        elif isinstance(value, list):
            for item in value:
                check_refs(item)

    check_refs(schema)
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema, registry=Registry(retrieve=deny_retrieval))


def validate_shape(validator, value):
    error = next(validator.iter_errors(value), None)
    if error is not None:
        raise ContractError("schema_invalid", error.message)


def json_equal(left, right):
    # Python's True == 1 must not turn an expectation mismatch into a match.
    numeric = lambda value: isinstance(value, (int, float)) and not isinstance(value, bool)
    if numeric(left) and numeric(right):
        return left == right
    if type(left) is not type(right):
        return False
    if isinstance(left, dict):
        return left.keys() == right.keys() and all(json_equal(left[key], right[key]) for key in left)
    if isinstance(left, list):
        return len(left) == len(right) and all(json_equal(a, b) for a, b in zip(left, right))
    return left == right


def validate_source(validator, raw):
    source = strict_json(raw)
    validate_shape(validator, source)
    ids = [record["id"] for record in source["records"]]
    source_ids = [entry["id"] for entry in source["sources"]]
    require(len(ids) == len(set(ids)), "domain_invalid", "Repeated record ID")
    require(len(source_ids) == len(set(source_ids)), "domain_invalid", "Repeated source ID")
    known = set(source_ids)
    require(all(set(record["evidenceRefs"]) <= known for record in source["records"]),
            "domain_invalid", "Dangling evidence reference")
    return source


def validate_preconditions(validator, baseline, request, artifact_id, revision):
    validate_shape(validator, request)
    require(request["artifactId"] == artifact_id, "artifact_mismatch", "Wrong fixture artifact")
    require(request["baseRevision"] == revision, "version_conflict", "Wrong fixture baseline revision")
    seen = set()
    for change in request["changes"]:
        field = change["fieldPath"][0]
        target = (change["recordId"], field)
        require(target not in seen, "duplicate_target", "Repeated baseline target")
        seen.add(target)
        records = [record for record in baseline["records"] if record["id"] == change["recordId"]]
        require(len(records) == 1, "target_missing" if not records else "target_ambiguous", "Record selection")
        require(field in records[0], "target_missing", "setField does not create absent fields")
        expected = change["expected"]
        require(expected["kind"] == "value" and json_equal(records[0][field], expected["value"]),
                "expectation_mismatch", "Expected baseline value differs")


def value_ranges(raw: bytes):
    """Independent locator for fixture paths, using stdlib decoding, not engine spans."""
    strict_json(raw)
    text = raw.decode("utf-8")
    decoder = json.JSONDecoder()
    offsets = [0]
    for char in text:
        offsets.append(offsets[-1] + len(char.encode("utf-8")))
    ranges = {}

    def whitespace(index):
        while index < len(text) and text[index] in " \r\n\t":
            index += 1
        return index

    def visit(index, path):
        start = whitespace(index)
        index = start
        if text[index] == "{":
            index = whitespace(index + 1)
            while text[index] != "}":
                key, index = decoder.raw_decode(text, index)
                index = whitespace(index)
                require(text[index] == ":", "invalid_json", "Expected object separator")
                index = whitespace(visit(index + 1, (*path, key)))
                if text[index] == ",":
                    index = whitespace(index + 1)
                else:
                    break
            index += 1
        elif text[index] == "[":
            index = whitespace(index + 1)
            item = 0
            while text[index] != "]":
                index = whitespace(visit(index, (*path, item)))
                item += 1
                if text[index] == ",":
                    index = whitespace(index + 1)
                else:
                    break
            index += 1
        else:
            _, index = decoder.raw_decode(text, index)
        ranges[path] = (offsets[start], offsets[index])
        return index

    visit(0, ())
    return ranges


def untouched_segments(raw, paths):
    located = value_ranges(raw)
    spans = sorted(located[tuple(path)] for path in paths)
    result, cursor = [], 0
    for start, end in spans:
        require(start >= cursor, "oracle_invalid", "Oracle ranges overlap")
        result.append(raw[cursor:start])
        cursor = end
    result.append(raw[cursor:])
    return result


def check_candidate(source_validator, baseline_raw, candidate_raw, expected_raw, oracle):
    baseline = validate_source(source_validator, baseline_raw)
    candidate = validate_source(source_validator, candidate_raw)
    expected = validate_source(source_validator, expected_raw)
    require(json_equal(candidate, expected), "candidate_mismatch", "Candidate differs from authored expectation")
    require([record["id"] for record in baseline["records"]] == oracle["recordOrder"],
            "oracle_invalid", "Fixture record order differs from the authored oracle")
    for target in oracle["targets"]:
        _, index, field = target["path"]
        require(baseline["records"][index]["id"] == target["recordId"], "oracle_invalid", "Wrong oracle record")
        require(json_equal(baseline["records"][index][field], target["before"]), "oracle_invalid", "Oracle pre-value")
        require(json_equal(expected["records"][index][field], target["after"]), "oracle_invalid", "Oracle post-value")
    paths = [target["path"] for target in oracle["targets"]]
    require(untouched_segments(baseline_raw, paths) == untouched_segments(candidate_raw, paths),
            "non_target_bytes_changed", "Bytes outside the two permitted values changed")


def expect_error(code, action):
    try:
        action()
    except ContractError as error:
        require(error.code == code, "wrong_error", f"Expected {code}; received {error.code}")
        return
    raise ContractError("missing_refusal", f"Expected rejection: {code}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", required=True, type=Path)
    args = parser.parse_args()
    report_path = args.report.resolve()
    if not report_path.is_relative_to((ROOT / "verification").resolve()):
        parser.error("Reports must stay under this fixture pack's verification directory")
    if report_path.exists():
        parser.error("Choose a new report filename; existing evidence is never overwritten")
    started = time.perf_counter()
    load = lambda name: strict_json((ROOT / name).read_bytes())
    contract = load("contract.json")
    source_schema = strict_json((ROOT / contract["sourceSchema"]).read_bytes(), contract["limitsProposal"]["schemaBytes"])
    request_schema = strict_json((ROOT / contract["requestSchema"]).read_bytes(), contract["limitsProposal"]["schemaBytes"])
    source_validator = schema_validator(source_schema)
    request_validator = schema_validator(request_schema)
    fixture = contract["fixture"]
    before = (ROOT / fixture["baseline"]).read_bytes()
    after = (ROOT / fixture["expected"]).read_bytes()
    baseline = strict_json(before)
    expected = strict_json(after)
    request = strict_json((ROOT / fixture["request"]).read_bytes(), contract["limitsProposal"]["requestBytes"])
    oracle = load(fixture["oracle"])
    trials = load(fixture["runtimeTrials"])
    owners = load("owner-map.json")
    results = []
    input_files = [ROOT / name for name in ["contract.json", "owner-map.json", "runtime-trials.json",
                   contract["sourceSchema"], contract["requestSchema"], fixture["baseline"],
                   fixture["expected"], fixture["request"], fixture["oracle"], "verify.py", "requirements.txt"]]
    input_files.append(REPO / "docs/dev/verseconf-clawx-contract-v1.md")
    input_hashes = {str(path.relative_to(REPO)).replace("\\", "/"): sha256(path.read_bytes()) for path in input_files}

    def check(name, action):
        try:
            action()
            results.append({"name": name, "pass": True})
        except Exception as error:
            results.append({"name": name, "pass": False, "error": f"{type(error).__name__}: {error}"})

    def preconditions(value):
        validate_preconditions(request_validator, baseline, value, fixture["artifactId"], fixture["baseRevision"])

    def candidate(raw, base=before, golden=after):
        check_candidate(source_validator, base, raw, golden, oracle)

    def mutated_request(mutator):
        value = copy.deepcopy(request)
        mutator(value)
        return value

    check("source-schema-meta-valid", lambda: Draft202012Validator.check_schema(source_schema))
    check("request-schema-meta-valid", lambda: Draft202012Validator.check_schema(request_schema))
    check("baseline-source-valid", lambda: validate_source(source_validator, before))
    check("authored-expected-source-valid", lambda: validate_source(source_validator, after))
    check("three-records-two-changes", lambda: require(len(baseline["records"]) == 3 and len(request["changes"]) == 2,
                                                       "fixture_invalid", "Golden fixture dimensions"))
    check("request-preconditions-valid", lambda: preconditions(request))
    check("joint-candidate-semantic-and-byte-oracle", lambda: candidate(after))
    check("crlf-preserved", lambda: candidate(after.replace(b"\n", b"\r\n"), before.replace(b"\n", b"\r\n"), after.replace(b"\n", b"\r\n")))
    check("equivalent-target-escape-permitted", lambda: candidate(after.replace(b'"linked"', b'"\\u006cinked"', 1)))
    for index, field in enumerate(["evidenceState", "evidenceRefs"]):
        partial = copy.deepcopy(baseline)
        partial["records"][1][field] = expected["records"][1][field]
        check(f"intermediate-{index + 1}-invalid", lambda partial=partial: expect_error("schema_invalid", lambda: validate_source(source_validator, encode(partial))))
    reverse = copy.deepcopy(request)
    reverse["changes"].reverse()
    check("reverse-order-same-baseline-preconditions", lambda: preconditions(reverse))
    for label, value in [("null", None), ("bool", True), ("integer", 2), ("float", 1.5), ("empty-string", ""),
                         ("empty-array", []), ("empty-object", {}), ("recursive-null", {"nested": [None, False, 2]})]:
        envelope = mutated_request(lambda item: item["changes"][0].update(value=value))
        check(f"envelope-value-{label}", lambda envelope=envelope: validate_shape(request_validator, envelope))
    for label, raw in [("nan", b"NaN"), ("infinity", b"1e999"), ("unsafe-int", b"9007199254740992")]:
        check(f"reject-{label}", lambda raw=raw: expect_error("unsafe_number", lambda: strict_json(raw)))
    for label, raw in [("duplicate-key", b'{"a":1,"a":2}'), ("duplicate-nested", b'{"x":{"a":1,"a":2}}')]:
        check(f"reject-{label}", lambda raw=raw: expect_error("duplicate_key", lambda: strict_json(raw)))
    for label, raw in [("comments", b'{/* no */"a":1}'), ("trailing-comma", b'{"a":1,}'), ("single-quotes", b"{'a':1}"),
                       ("bom", b"\xef\xbb\xbf{}"), ("utf8", b'{"a":"\xff"}'), ("lone-surrogate", b'"\\ud800"')]:
        check(f"reject-{label}", lambda raw=raw: expect_error("invalid_json", lambda: strict_json(raw)))
    check("reject-depth-over-limit", lambda: expect_error("limit_exceeded", lambda: strict_json(b"[" * 33 + b"0" + b"]" * 33)))
    check("reject-byte-over-limit", lambda: expect_error("limit_exceeded", lambda: strict_json(b" " * 262145)))
    check("reject-request-byte-over-limit", lambda: expect_error("limit_exceeded", lambda: strict_json(b" " * 65537, contract["limitsProposal"]["requestBytes"])))
    check("reject-huge-integer-without-overflow", lambda: expect_error("unsafe_number", lambda: strict_json(b"9" * 1000)))
    check("reject-escaped-duplicate-key", lambda: expect_error("duplicate_key", lambda: strict_json(b'{"a":1,"\\u0061":2}')))
    too_many = {**request, "changes": [copy.deepcopy(request["changes"][0]) for _ in range(17)]}
    check("reject-too-many-changes", lambda: expect_error("schema_invalid", lambda: preconditions(too_many)))
    check("safe-integer-boundaries", lambda: require(strict_json(str(MAX_SAFE).encode()) == MAX_SAFE and strict_json(str(-MAX_SAFE).encode()) == -MAX_SAFE,
                                                     "unsafe_number", "Safe integer edge rejected"))
    for key in ["runId", "workspace", "actor", "force", "sourcePath", "schema"]:
        value = {**request, key: "not-authorized-input"}
        check(f"reject-authority-argument-{key}", lambda value=value: expect_error("schema_invalid", lambda: preconditions(value)))
    for label, mutator, code in [
        ("unknown-operation", lambda item: item["changes"][0].update(op="moveRecord"), "schema_invalid"),
        ("identity-field", lambda item: item["changes"][0].update(fieldPath=["id"]), "schema_invalid"),
        ("deep-path", lambda item: item["changes"][0].update(fieldPath=["finding", "child"]), "schema_invalid"),
        ("missing-value", lambda item: item["changes"][0].pop("value"), "schema_invalid"),
        ("missing-expect-value", lambda item: item["changes"][0].update(expected={"kind": "value"}), "schema_invalid"),
        ("duplicate-target", lambda item: item["changes"].append(copy.deepcopy(item["changes"][0])), "duplicate_target"),
        ("revision-mismatch", lambda item: item.update(baseRevision="revision-fixture-other"), "version_conflict"),
        ("wrong-expect", lambda item: item["changes"][0].update(expected={"kind": "value", "value": "linked"}), "expectation_mismatch"),
        ("absent-is-not-null", lambda item: item["changes"][0].update(recordId="rec-baseline", fieldPath=["limitations"], expected={"kind": "absent"}, value="new"), "expectation_mismatch"),
        ("set-missing-field", lambda item: item["changes"][0].update(fieldPath=["notes"], expected={"kind": "absent"}, value=None), "target_missing"),
    ]:
        value = mutated_request(mutator)
        check(f"reject-{label}", lambda value=value, code=code: expect_error(code, lambda: preconditions(value)))
    null_change = mutated_request(lambda item: item["changes"][0].update(recordId="rec-baseline", fieldPath=["limitations"], expected={"kind": "value", "value": None}, value="bounded"))
    check("null-expectation-is-an-existing-value", lambda: preconditions(null_change))
    check("bool-is-not-number", lambda: require(not json_equal(True, 1), "oracle_invalid", "Boolean/number confusion"))
    for label, mutator in [
        ("duplicate-record-id", lambda item: item["records"][1].update(id="rec-baseline")),
        ("dangling-reference", lambda item: item["records"][1].update(evidenceRefs=["src-missing"])),
    ]:
        value = copy.deepcopy(expected)
        mutator(value)
        check(f"reject-{label}", lambda value=value: expect_error("domain_invalid", lambda: validate_source(source_validator, encode(value))))
    wrong = copy.deepcopy(expected)
    wrong["records"][0]["finding"] = "Wrong non-target record"
    check("oracle-rejects-wrong-record", lambda: expect_error("candidate_mismatch", lambda: candidate(encode(wrong))))
    check("oracle-rejects-untouched-baseline", lambda: expect_error("candidate_mismatch", lambda: candidate(before)))
    check("oracle-rejects-outside-whitespace", lambda: expect_error("non_target_bytes_changed", lambda: candidate(after.replace(b'  "title"', b'   "title"', 1))))
    check("oracle-rejects-outside-unicode-reserialization", lambda: expect_error("non_target_bytes_changed", lambda: candidate((json.dumps(expected, ensure_ascii=True, indent=2) + "\n").encode())))
    for label, schema in [("wrong-draft", {**source_schema, "$schema": "https://json-schema.org/draft/2019-09/schema"}),
                          ("external-ref", {**source_schema, "$ref": "https://example.invalid/schema"}),
                          ("local-file-ref", {**source_schema, "$ref": "file:///not-allowed"})]:
        check(f"reject-schema-{label}", lambda schema=schema: expect_error("unsupported_schema", lambda: schema_validator(schema)))
    families = trials["failureFamilies"]
    check("five-runtime-families-remain-not-run", lambda: require(len(families) == 5 and {item["id"] for item in families} == {"F1", "F2", "F3", "F4", "F5"}
          and trials["executionStatus"] == "not-run" and trials["happyPath"]["executionStatus"] == "not-run"
          and all(item["executionStatus"] == "not-run" and item["steps"] and item["proof"] and item["faultAt"] for item in families),
          "trial_design_invalid", "Missing trial definition or false execution claim"))
    owner_observations = []
    for owner in owners["owners"]:
        path = REPO / owner["path"]
        raw = path.read_bytes()
        text = raw.decode("utf-8")
        found = [{"symbol": anchor, "line": text[:text.index(anchor)].count("\n") + 1} for anchor in owner["anchors"] if anchor in text]
        check(f"source-anchor-{owner['area']}", lambda found=found, owner=owner: require(len(found) == len(owner["anchors"]), "owner_map_stale", owner["path"]))
        owner_observations.append({"path": owner["path"], "sha256": sha256(raw), "anchors": found, "observationType": "static-source-reference"})
    for path in [owners["harnessMapping"]["futureScenario"], *owners["harnessMapping"]["futureRules"]]:
        check(f"harness-mapping-{Path(path).stem}", lambda path=path: require((REPO / path).is_file(), "owner_map_stale", path))
    check("inputs-unchanged-during-verification", lambda: require(all(sha256(path.read_bytes()) == input_hashes[str(path.relative_to(REPO)).replace("\\", "/")] for path in input_files), "input_changed", "Input drift"))
    git = lambda *args: subprocess.check_output(["git", *args], cwd=REPO, text=True, encoding="utf-8").strip()
    status = git("status", "--porcelain=v1", "--untracked-files=normal")
    failures = [result for result in results if not result["pass"]]
    report = {
        "schema": "tf0244-offline-contract-verification/v1", "taskId": "TF-0244",
        "driven_by": "agent", "actor": "claude/tf0244-contract", "createdAt": datetime.now(timezone.utc).isoformat(),
        "scope": "offline fixture/schema/oracle and static-reference checks only",
        "environment": {"python": sys.version, "jsonschema": version("jsonschema"), "referencing": version("referencing")},
        "candidate": {"head": git("rev-parse", "HEAD"), "dirty": bool(status), "status": status.splitlines()},
        "inputs": input_hashes, "ownerObservations": owner_observations,
        "oracleObservation": {
            "basis": "authored expected fixture, not an engine or runtime result",
            "rangeUnit": "UTF-8 bytes [startByte,endByte)",
            "targets": [{"path": target["path"],
                         "baselineRange": value_ranges(before)[tuple(target["path"])],
                         "expectedRange": value_ranges(after)[tuple(target["path"])]} for target in oracle["targets"]],
            "untouchedSegmentDigests": [sha256(segment) for segment in untouched_segments(before, [target["path"] for target in oracle["targets"]])]
        },
        "counts": {"total": len(results), "passed": len(results) - len(failures), "failed": len(failures)},
        "checks": results, "pass": not failures, "elapsedSeconds": round(time.perf_counter() - started, 3),
        "productIntegrationVerdict": "not-run", "runtimeTrialExecutionStatus": "not-run",
        "realProviderCalls": 0, "productSourceFilesWritten": 0, "independentReviewer": False,
        "limitations": ["Same agent authored the fixture and checker; independent refers to oracle mechanism, not a second reviewer.",
                        "No runtime permissions, journal/DB effects, Electron UI, wasm or Office generation were executed.",
                        "A dirty working-tree check is development evidence, not a clean candidate acceptance."]
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with report_path.open("x", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(json.dumps({"report": str(report_path), "counts": report["counts"], "pass": report["pass"], "productIntegrationVerdict": "not-run"}, ensure_ascii=False))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
