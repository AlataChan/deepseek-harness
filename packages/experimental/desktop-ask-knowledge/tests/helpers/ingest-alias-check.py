"""Ingest applies a multi-page proposal whose pages share tags, and a source-named digest.

Exercises the vendored package directly: tag promotion, the source-page exclusion
in alias-collision detection, the vault's own spelling for an append target, and
the severe-lint findings a rejection now carries.
"""

import hashlib
import json
import tempfile
from pathlib import Path

from octopus_kb_compound.apply import validate_proposal_file
from octopus_kb_compound.propose import fill_create_page_frontmatter

AGENTS = """---
title: AGENTS
page_type: schema
lang: zh
role: schema
---

# schema
"""

INDEX = """---
title: INDEX
page_type: index
lang: zh
role: index
---

# 索引
"""

LOG = """---
title: LOG
page_type: log
lang: zh
role: log
---

# 日志
"""

# The source page is titled from the file name, punctuation and all, so a digest
# titled with the document's real name shares its normalized key but not its string.
RAW = """---
title: "A_Hands-On_Guide_to_Fine-Tuning_LLMs_-_Daniel_Voigt_Godoy"
type: raw_source
lang: en
role: raw_source
layer: source
tags: []
---

Fine-tuning large language models with PyTorch.
"""


SHA256 = hashlib.sha256(RAW.encode("utf-8")).hexdigest()


def _page(path: str, title: str, tags: list[str], aliases: list[str] | None = None) -> dict:
    frontmatter = {
        "title": title,
        "type": "concept",
        "lang": "en",
        "role": "concept",
        "layer": "wiki",
        "summary": f"{title} summary.",
        "tags": tags,
    }
    if aliases is not None:
        frontmatter["aliases"] = aliases
    return {
        "op": "create_page",
        "path": path,
        "frontmatter": frontmatter,
        "body": f"{title} body.",
        "rationale": "digest",
        "confidence": 0.9,
        "source_span": {"path": "raw/guide.md", "start_line": 1, "end_line": 3},
    }


def _log(path: str, entry: str) -> dict:
    return {"op": "append_log", "path": path, "entry": entry, "rationale": "log", "confidence": 0.9}


def _bootstrap(vault: Path) -> None:
    (vault / "wiki").mkdir(parents=True)
    (vault / "raw").mkdir()
    (vault / ".octopus-kb" / "proposals").mkdir(parents=True)
    (vault / "AGENTS.md").write_text(AGENTS, encoding="utf-8")
    (vault / "wiki" / "INDEX.md").write_text(INDEX, encoding="utf-8")
    (vault / "wiki" / "LOG.md").write_text(LOG, encoding="utf-8")
    (vault / "raw" / "guide.md").write_text(RAW, encoding="utf-8")
    (vault / ".octopus-kb" / "config.toml").write_text(
        'version = 1\n[llm]\ndefault_profile = "deepseek"\n',
        encoding="utf-8",
    )


def _write_proposal(vault: Path, proposal_id: str, operations: list[dict]) -> Path:
    body = {
        "id": proposal_id,
        "created_at": "2026-09-16T00:00:00Z",
        "status": "pending",
        "source": {"kind": "raw_file", "path": "raw/guide.md", "sha256": SHA256},
        "produced_by": {
            "provider_profile": "deepseek",
            "model": "deepseek-v4-flash",
            "prompt_version": "prompts/propose.md",
        },
        "operations": operations,
    }
    path = vault / ".octopus-kb" / "proposals" / f"{proposal_id}.json"
    path.write_text(json.dumps(body, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


# The fill keeps tags on the page and adds no alias for them.
filled = {"operations": [_page("wiki/x.md", "X", ["pytorch"])]}
fill_create_page_frontmatter(filled)
frontmatter = filled["operations"][0]["frontmatter"]
if frontmatter.get("tags") != ["pytorch"]:
    raise SystemExit(f"fill dropped tags: {frontmatter}")
if "aliases" in frontmatter:
    raise SystemExit(f"fill promoted a tag to an alias: {frontmatter}")

with tempfile.TemporaryDirectory() as tmp:
    vault = Path(tmp)
    _bootstrap(vault)

    # Two pages sharing a tag, one of them titled like the source page.
    shared = _write_proposal(vault, "shared-tag", [
        _page("wiki/sources/a-hands-on-guide.md", "A Hands-On Guide to Fine-Tuning LLMs (Daniel Voigt Godoy)", ["pytorch", "lora"]),
        _page("wiki/entities/daniel-voigt-godoy.md", "Daniel Voigt Godoy", ["pytorch"]),
        _log("wiki/log.md", "- [[a-hands-on-guide]]"),
    ])
    result = validate_proposal_file(shared, vault, apply=True).to_dict()
    if result.get("status") != "applied":
        raise SystemExit(f"shared tag or source-named digest rejected: {result}")

    if not (vault / "wiki" / "sources" / "a-hands-on-guide.md").is_file():
        raise SystemExit("digest page was not written")
    if not (vault / "wiki" / "entities" / "daniel-voigt-godoy.md").is_file():
        raise SystemExit("entity page was not written")
    log_text = (vault / "wiki" / "LOG.md").read_text(encoding="utf-8")
    if "a-hands-on-guide" not in log_text:
        raise SystemExit(f"append did not land in the vault's own LOG.md: {log_text[-200:]}")
    if (vault / "wiki" / "log.md").exists() and not (vault / "wiki" / "LOG.md").exists():
        raise SystemExit("append created a second log path")

    # A real alias collision is still a rejection, and it names its rule.
    collide = _write_proposal(vault, "real-collision", [
        _page("wiki/one.md", "One", [], ["shared"]),
        _page("wiki/two.md", "Two", [], ["shared"]),
    ])
    rejected = validate_proposal_file(collide, vault, apply=True).to_dict()
    if rejected.get("status") != "rejected_post_lint":
        raise SystemExit(f"a real alias collision applied: {rejected}")
    rules = [row.get("rule_id") for row in rejected.get("rule_results") or []]
    if "ALIAS_COLLISION" not in rules:
        raise SystemExit(f"rejection did not name ALIAS_COLLISION: {rejected}")

print("ok")
