from __future__ import annotations

from pathlib import Path

from octopus_kb_compound.models import VaultProfile


PROFILE_FILENAMES = (".octopus-kb.yml", ".octopus-kb.yaml")


def load_vault_profile(root: str | Path) -> VaultProfile:
    root_path = Path(root)
    for filename in PROFILE_FILENAMES:
        path = root_path / filename
        if not path.exists():
            continue
        data = _parse_profile_text(path.read_text(encoding="utf-8", errors="replace"))
        return VaultProfile(
            schema=_as_optional_str(data.get("schema")),
            index=_as_optional_str(data.get("index")),
            exclude_globs=_as_str_list(data.get("exclude_globs")),
        )
    return VaultProfile()


def _parse_profile_text(text: str) -> dict[str, object]:
    data: dict[str, object] = {}
    current_key: str | None = None
    current_list: list[str] | None = None

    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        if not line or line.lstrip().startswith("#"):
            continue

        if current_list is not None:
            if line.startswith("  - "):
                current_list.append(line[4:].strip())
                continue
            data[current_key or ""] = current_list
            current_key = None
            current_list = None

        if ":" not in line:
            continue

        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()
        if value == "":
            current_key = key
            current_list = []
            continue
        data[key] = _strip_scalar(value)

    if current_list is not None and current_key is not None:
        data[current_key] = current_list
    return data


def _strip_scalar(value: str) -> str:
    if value.startswith('"') and value.endswith('"'):
        return value[1:-1]
    if value.startswith("'") and value.endswith("'"):
        return value[1:-1].replace("''", "'")
    return value


def _as_optional_str(value: object) -> str | None:
    if isinstance(value, str) and value:
        return value
    return None


def _as_str_list(value: object) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value]
    return []
