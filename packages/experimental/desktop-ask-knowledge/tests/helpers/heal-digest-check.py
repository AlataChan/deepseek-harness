import json
import tempfile
from pathlib import Path

from octopus_kb_compound.heal import heal_page_meta_rejections
from octopus_kb_compound.lookup import lookup_term
from octopus_kb_compound.retrieve import build_retrieval_bundle

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

RAW = """---
title: "source-doc"
type: raw_source
lang: zh
role: raw_source
layer: source
---

\u2faf\u5411\u2fbc\u8d28\u91cf\u53d1\u5c55\u7684\u201c\u2f00\u2f7c\u2f00\u2f29\u201d\u653f\u7b56
"""

PROPOSAL = {
    "id": "prop_heal_001",
    "created_at": "2026-09-01T05:00:00Z",
    "status": "pending",
    "source": {
        "kind": "raw_file",
        "path": "raw/source-doc.md",
        "sha256": "c6474ff7ad0a72704bee144684ec6e15603dbff6df737e05b7b1bb096838e86c",
    },
    "produced_by": {
        "provider_profile": "deepseek",
        "model": "deepseek-v4-flash",
        "prompt_version": "prompts/propose.md@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
    "operations": [
        {
            "op": "create_page",
            "path": "wiki/pension-childcare.md",
            "confidence": 0.9,
            "rationale": "digest",
            "body": "\u653f\u7b56\u4ece\u6709\u6ca1\u6709\u8f6c\u5411\u597d\u4e0d\u597d\u3002",
            "source_span": {
                "path": "raw/source-doc.md",
                "start_line": 1,
                "end_line": 8,
            },
            "frontmatter": {
                "title": "\u517b\u8001\u6258\u80b2\u653f\u7b56",
                "type": "concept",
                "lang": "zh",
                "tags": ["\u4e00\u8001\u4e00\u5c0f"],
            },
        },
        {
            "op": "append_log",
            "path": "wiki/INDEX.md",
            "confidence": 0.9,
            "rationale": "index",
            "entry": "- [[pension-childcare]]",
        },
    ],
}


def _bootstrap(vault: Path) -> None:
    (vault / "wiki").mkdir(parents=True)
    (vault / "raw").mkdir()
    (vault / ".octopus-kb" / "proposals").mkdir(parents=True)
    (vault / ".octopus-kb" / "rejections").mkdir()
    (vault / "AGENTS.md").write_text(AGENTS, encoding="utf-8")
    (vault / "wiki" / "INDEX.md").write_text(INDEX, encoding="utf-8")
    (vault / "wiki" / "LOG.md").write_text(LOG, encoding="utf-8")
    (vault / "raw" / "source-doc.md").write_text(RAW, encoding="utf-8")
    (vault / ".octopus-kb" / "config.toml").write_text(
        'version = 1\n[llm]\ndefault_profile = "deepseek"\n',
        encoding="utf-8",
    )


with tempfile.TemporaryDirectory() as tmp:
    vault = Path(tmp)
    _bootstrap(vault)
    (vault / ".octopus-kb" / "proposals" / "prop_heal_001.json").write_text(
        json.dumps(PROPOSAL, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    rejection = {
        **PROPOSAL,
        "decision_status": "rejected",
        "reason": "new page frontmatter fails page-meta schema",
        "rule_id": "schema.page_meta_invalid",
        "rule_results": [{"rule_id": "schema.page_meta_invalid", "verdict": "reject"}],
    }
    (vault / ".octopus-kb" / "rejections" / "prop_heal_001.json").write_text(
        json.dumps(rejection, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    raw_only = build_retrieval_bundle(vault, "\u4e00\u8001\u4e00\u5c0f")
    if not raw_only.raw_source_items:
        raise SystemExit(f"raw fold missed before heal: {raw_only.to_dict()}")
    before = lookup_term("\u4e00\u8001\u4e00\u5c0f", vault)
    if before.canonical is None:
        raise SystemExit("lookup should fall back to raw before wiki lands")

    applied = heal_page_meta_rejections(vault)
    if applied != ["prop_heal_001"]:
        raise SystemExit(f"heal applied {applied}")
    wiki = vault / "wiki" / "pension-childcare.md"
    if not wiki.is_file():
        raise SystemExit("digest page was not written")
    wiki_text = wiki.read_text(encoding="utf-8")
    if "养老托育政策" not in wiki_text:
        raise SystemExit(f"digest body missing: {wiki_text[:200]}")

    after = lookup_term("\u4e00\u8001\u4e00\u5c0f", vault)
    if after.canonical is None or after.canonical.get("path") != "wiki/pension-childcare.md":
        raise SystemExit(f"lookup missed digest page: {after.to_dict()}")

    again = heal_page_meta_rejections(vault)
    if again != ["prop_heal_001"]:
        raise SystemExit(f"second heal should be already_applied: {again}")

print("ok")
