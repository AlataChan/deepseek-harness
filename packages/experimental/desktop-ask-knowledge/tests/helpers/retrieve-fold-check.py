import tempfile
from pathlib import Path

from octopus_kb_compound.retrieve import build_retrieval_bundle

# PDF/markitdown often emits Kangxi radicals instead of CJK unified ideographs.
KANGXI_BODY = '⼤向⽡质量发展的“⼀⽼⼀⼩”政策'


def _write(vault: Path, name: str, title: str, body: str) -> None:
    path = vault / "raw" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "\n".join(
            [
                "---",
                f'title: "{title}"',
                "role: raw_source",
                "layer: source",
                "---",
                body,
                "",
            ]
        ),
        encoding="utf-8",
    )


with tempfile.TemporaryDirectory() as tmp:
    vault = Path(tmp)
    _write(vault, "kangxi.md", "政策原文", KANGXI_BODY)
    bundle = build_retrieval_bundle(vault, "一老一小")
    paths = [item["path"] for item in bundle.raw_source_items]
    if paths != ["raw/kangxi.md"]:
        raise SystemExit(f"kangxi body missed: {bundle.to_dict()}")

    title_vault = Path(tmp) / "title"
    _write(title_vault, "named.md", "一老一小政策", "unrelated sales rows")
    titled = build_retrieval_bundle(title_vault, "一老一小")
    titled_paths = [item["path"] for item in titled.raw_source_items]
    if titled_paths != ["raw/named.md"]:
        raise SystemExit(f"title missed: {titled.to_dict()}")

    miss = build_retrieval_bundle(vault, "报销")
    if miss.raw_source_items:
        raise SystemExit(f"unrelated term hit: {miss.to_dict()}")

print("ok")
