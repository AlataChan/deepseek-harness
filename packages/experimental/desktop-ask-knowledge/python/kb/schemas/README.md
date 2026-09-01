# Schemas

`page-meta.json` defines the PageMeta frontmatter validation floor used by octopus-kb and external tools: declared fields are type-checked, enums are enforced, and wiki pages must carry a non-empty summary while legacy/custom keys remain allowed. The runtime copy lives at `src/octopus_kb_compound/_schemas/page-meta.json` so installed wheels can load it via package resources; this directory keeps a byte-identical development mirror for humans and downstream integrations. Propose schema changes by opening a pull request that updates both copies and the matching tests.
