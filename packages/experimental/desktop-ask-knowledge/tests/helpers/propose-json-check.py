import os
import sys
import types
from pathlib import Path

try:
    import httpx  # noqa: F401
except ModuleNotFoundError:
    sys.modules["httpx"] = types.SimpleNamespace(HTTPError=Exception, post=None)

from octopus_kb_compound.llm import LLMInvalidOutputError, parse_json_content
from octopus_kb_compound.propose import clip_raw_body, fill_create_page_frontmatter
from octopus_kb_compound.proposals import _schema_path, kb_resource_root

assert parse_json_content('{"ok": true}')["ok"] is True
assert parse_json_content("```json\n{\"n\": 1}\n```")["n"] == 1
assert parse_json_content('here is the object {"k": "v"} done')["k"] == "v"

try:
    parse_json_content("")
except LLMInvalidOutputError as exc:
    assert exc.content == ""
else:
    raise AssertionError("empty input must fail")

try:
    parse_json_content("not json at all")
except LLMInvalidOutputError as exc:
    assert exc.content == "not json at all"
else:
    raise AssertionError("prose must fail")

assert clip_raw_body("short") == "short"
assert "truncated for propose" in clip_raw_body("x" * 12001)

filled = {
    "operations": [
        {
            "op": "create_page",
            "frontmatter": {
                "title": "一老一小",
                "type": "concept",
                "lang": "zh",
                "tags": ["一老一小"],
            },
            "body": "养老与托育政策。",
        }
    ]
}
fill_create_page_frontmatter(filled)
assert filled["operations"][0]["frontmatter"]["role"] == "concept"
assert filled["operations"][0]["frontmatter"]["layer"] == "wiki"
assert filled["operations"][0]["frontmatter"]["summary"] == "养老与托育政策。"
assert "一老一小" in filled["operations"][0]["frontmatter"]["aliases"]

previous_root = os.environ.get("OCTOPUS_KB_ROOT")
os.environ.pop("OCTOPUS_KB_ROOT", None)
try:
    assert _schema_path().is_file(), _schema_path()
    assert (kb_resource_root() / "schemas" / "rules" / "v1.json").is_file()
    os.environ["OCTOPUS_KB_ROOT"] = "/tmp/kb-root-does-not-exist"
    schema = _schema_path()
    assert schema == Path("/tmp/kb-root-does-not-exist/schemas/llm/proposal.json"), schema
finally:
    if previous_root is None:
        os.environ.pop("OCTOPUS_KB_ROOT", None)
    else:
        os.environ["OCTOPUS_KB_ROOT"] = previous_root

print("ok")
