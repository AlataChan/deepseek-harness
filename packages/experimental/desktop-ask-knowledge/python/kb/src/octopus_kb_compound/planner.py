from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from octopus_kb_compound.impact import find_impacted_pages
from octopus_kb_compound.vault import load_page


@dataclass(slots=True)
class MaintenancePlan:
    changed_pages: list[str]
    new_pages: list[str] = field(default_factory=list)
    suggested_actions: list[str] = field(default_factory=list)


def plan_maintenance(page: str | Path, vault: str | Path) -> MaintenancePlan:
    root = Path(vault)
    page_path = Path(page)
    if not page_path.is_absolute():
        page_path = root / page_path

    target = load_page(page_path, root=root)
    changed_pages = find_impacted_pages(page_path, root)
    actions = ["update", "review_aliases"]
    if target.frontmatter.get("role") == "raw_source":
        actions.append("create_stub")

    return MaintenancePlan(changed_pages=changed_pages, suggested_actions=actions)


def render_plan(plan: MaintenancePlan) -> str:
    lines: list[str] = []
    for page in plan.changed_pages:
        lines.append(f"changed_page\t{page}")
    for page in plan.new_pages:
        lines.append(f"new_page\t{page}")
    for action in plan.suggested_actions:
        lines.append(f"action\t{action}")
    return "\n".join(lines)
