# Maintenance Prompt

Treat the wiki as a persistent, compounding artifact.

For any ingest or maintenance request:

1. Read schema and index.
2. Identify affected concept, entity, and overview pages.
3. Update frontmatter and summary if needed.
4. Update links and backlinks where they improve navigation.
5. Update index or log when the change is durable.
6. Run a lint pass for broken links, orphans, and missing metadata.

Output:

- pages changed
- links added or removed
- metadata changes
- remaining issues
