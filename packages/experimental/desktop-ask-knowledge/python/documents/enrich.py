"""Compatibility entry for injected extraction tests; production uses approved plans."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from .jobs import update_job_checkpoint, verify_startup_attempt
from .pipeline import publication_guard


def generate_chunk_proposal(*args, **kwargs):
    """Reject the removed synthetic extractor; production requires an approved plan."""
    raise RuntimeError('Synthetic extraction was removed; plan and approve real document inference')


def enrich_document_chunks(
    vault: Path, library_id: str, job_id: str, document_id: str, revision_id: str,
    chunks: list[dict[str, Any]], expected_startup_attempt: int,
    max_tokens_budget: int | None = None, mock_extractor: Any = None,
) -> dict[str, Any]:
    """Apply explicitly injected proposals under the production publication fence.

    The sidecar wire command never accepts an extractor. Real provider execution,
    request budgeting, usage and approval are exclusively owned by pipeline.py.
    """
    if mock_extractor is None:
        raise RuntimeError('Unapproved enrichment refused; use plan-document and execute-document')
    db = vault / '.octopus-kb' / 'documents.sqlite'
    if not verify_startup_attempt(db, library_id, expected_startup_attempt):
        return {'ok': False, 'status': 'superseded', 'completedChunks': 0}
    from octopus_kb_compound.apply import validate_proposal_file
    from .pipeline import _write
    plan = {'libraryId': library_id, 'jobId': job_id}
    completed = 0
    for index, chunk in enumerate(chunks):
        proposal = mock_extractor(vault, document_id, revision_id, chunk)
        with publication_guard(vault, plan, expected_startup_attempt):
            if not proposal.get('operations'):
                completed += 1
                continue
            # Hash the caller's identifier rather than interpolating it into a path.
            import hashlib
            name = hashlib.sha256(str(proposal['id']).encode()).hexdigest() + '.json'
            path = vault / '.octopus-kb' / 'proposals' / name
            _write(path, proposal)
            result = validate_proposal_file(path, vault, apply=True,
                commit_guard=lambda: publication_guard(vault, plan, expected_startup_attempt))
            if result.status not in {'applied', 'already_applied'}:
                return {'ok': False, 'status': 'failed', 'completedChunks': completed}
            completed += 1
            update_job_checkpoint(db, job_id, expected_startup_attempt,
                completed, index + 1, 0, stage='enriching')
    return {'ok': True, 'status': 'completed', 'completedChunks': completed,
            'totalChunks': len(chunks), 'tokensUsed': 0}
