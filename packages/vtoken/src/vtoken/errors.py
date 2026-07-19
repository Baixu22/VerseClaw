"""Structured, machine-parseable errors (spec §8.1: JSON error reports)."""
from __future__ import annotations

import json
from dataclasses import dataclass


@dataclass
class VTIssue:
    """One error/warning with a line anchor. Serializes to the spec's report entry shape."""

    line: int
    type: str
    message: str
    id: str | None = None
    symbol: str | None = None

    def to_dict(self) -> dict:
        d = {"line": self.line, "type": self.type, "message": self.message}
        if self.id is not None:
            d["id"] = self.id
        if self.symbol is not None:
            d["symbol"] = self.symbol
        return d


class VTError(Exception):
    """Base class for all Verse Token errors."""


class VTParseError(VTError):
    """Raised by the parser/compiler with the full list of collected issues."""

    def __init__(self, file: str, issues: list[VTIssue]):
        self.file = file
        self.issues = issues
        super().__init__(f"{len(issues)} error(s) in {file}")

    def report(self) -> dict:
        return {
            "status": "error",
            "file": self.file,
            "errors": [i.to_dict() for i in self.issues],
        }

    def to_json(self) -> str:
        return json.dumps(self.report(), ensure_ascii=False, indent=2)


class VTResolveError(VTError):
    """resolve() called with an unknown root node id."""


class VTStoreError(VTError):
    """Graph/store level failure (duplicate id across files, corrupt WAL, ...)."""
