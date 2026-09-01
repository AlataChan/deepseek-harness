# Linking Policy

## Canonical Pages

- Prefer one canonical page per stable concept, entity, or topic.
- Use aliases in frontmatter when naming varies.
- Link to the canonical page instead of creating near-duplicate pages.
- Keep aliases explicit in page metadata. Do not rely on code-side domain heuristics.

## When To Link

- Add a wikilink when the target page materially helps navigation or context.
- Add links for first strong mentions, not every repetition.
- Link pages that are likely hubs, evidence anchors, or navigation bridges.

## When Not To Link

- Avoid overlinking repeated terms in the same page.
- Avoid links to pages that do not yet have a clear canonical page.
- Avoid decorative links that do not improve retrieval or graph structure.

## Graph Hygiene

- Keep concept pages connected to at least one index, overview, or peer concept page.
- Prefer explicit entity and concept pages over loose tag sprawl.
- Use lint to find orphans, broken links, and concepts that need stub pages.
