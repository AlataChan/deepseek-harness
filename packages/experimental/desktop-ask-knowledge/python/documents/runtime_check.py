#!/usr/bin/env python3
"""Preflight verification for Python SQLite and FTS5 trigram availability.

Runs standalone or imported by the sidecar and tests.
"""

from __future__ import annotations

import json
import sys


def check_sqlite_runtime() -> dict:
    try:
        import sqlite3
    except ImportError as exc:
        return {
            "ok": False,
            "sqlite_version": "",
            "fts5": False,
            "trigram": False,
            "error": f"sqlite3 module unavailable: {exc}",
        }

    version = sqlite3.sqlite_version
    fts5 = False
    trigram = False
    err: str | None = None

    try:
        con = sqlite3.connect(":memory:")
        cur = con.cursor()
        cur.execute("CREATE VIRTUAL TABLE _test_fts USING fts5(content)")
        fts5 = True
        cur.execute("CREATE VIRTUAL TABLE _test_trigram USING fts5(content, tokenize='trigram')")
        cur.execute("INSERT INTO _test_trigram VALUES ('测试文本')")
        res = cur.execute("SELECT * FROM _test_trigram WHERE _test_trigram MATCH '\"测试文\"'").fetchall()
        trigram = len(res) == 1
        con.close()
    except Exception as exc:  # noqa: BLE001
        err = str(exc)

    ok = fts5 and trigram
    return {
        "ok": ok,
        "sqlite_version": version,
        "fts5": fts5,
        "trigram": trigram,
        "error": err if not ok else None,
    }


def main() -> int:
    result = check_sqlite_runtime()
    json.dump(result, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
