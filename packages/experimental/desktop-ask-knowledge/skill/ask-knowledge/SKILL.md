---
name: ask-knowledge
description: Retrieve from a hung octopus_DSH knowledge library using terms, not sentences.
---

# 问知识

Use `ask_knowledge_retrieve` with 1 to 6 names in `terms`. Do not pass a sentence.
Each name is at most 16 characters after trim and must not contain `?？。！!` or newlines.
Use `ask_knowledge_lookup` when you need one page body.
Do not edit the vault or `.octopus-kb/` with write, edit, or bash.
