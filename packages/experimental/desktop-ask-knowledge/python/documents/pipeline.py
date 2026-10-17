"""Approved full-document enrichment with durable inference and publication checkpoints.

Planning performs no inference. Execution binds approval to source ranges,
prompt version, source bytes, model route and a complete serialized-context allowance. An ambiguous paid call is never automatically repeated.
"""
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import tempfile
import uuid

from .chunks import create_chunks_from_blocks, verify_chunk_coverage
from .commit_lock import commit_lock
from .jobs import (create_job, get_job, get_or_increment_startup_attempt,
                   update_job_checkpoint, finish_job, cancel_job, verify_startup_attempt, list_jobs)
from .schema import open_db
from .token_budget import estimate_tokens


def _json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def _hash(value):
    return hashlib.sha256(_json(value).encode()).hexdigest()


def _write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, name = tempfile.mkstemp(prefix='.checkpoint-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as out:
            out.write(_json(value) + '\n')
            out.flush()
            os.fsync(out.fileno())
        os.replace(name, path)
        if os.name != 'nt':
            directory = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def _normalize_generated_page_categories(proposal):
    """Map unsupported model page categories to notes; retain all other validation."""
    from octopus_kb_compound.schema import load_page_meta_schema
    properties = load_page_meta_schema()['properties']
    for operation in proposal.get('operations', []):
        if not isinstance(operation, dict) or operation.get('op') != 'create_page':
            continue
        meta = operation.get('frontmatter')
        if not isinstance(meta, dict):
            continue
        if meta.get('type') not in properties['type']['enum']:
            meta['type'] = 'note'
        if meta.get('role') not in properties['role']['enum']:
            meta['role'] = meta['type'] if meta['type'] in properties['role']['enum'] else 'note'


def _safe_raw(vault, rel):
    root = vault.resolve()
    path = root / rel
    if not isinstance(rel, str) or not rel.startswith('raw/') or not path.resolve().is_relative_to(root / 'raw'):
        raise ValueError('Raw source must be inside the library raw directory')
    for component in [path, *path.parents]:
        if component == root:
            break
        if component.is_symlink():
            raise ValueError('Symlinked raw sources are not permitted')
    if not path.is_file():
        raise ValueError('Raw source does not exist')
    return path


def _frozen_plan(plan):
    return {key: plan[key] for key in ('version', 'documentId', 'revisionId', 'libraryId', 'rawPath',
        'rawSha256', 'route', 'promptVersion', 'conversion', 'chunks', 'tokenEstimate', 'retryReserve', 'estimator',
        'totalChunks', 'totalChars', 'retryNonce', 'chunkChars', 'outputReserve', 'contextChars', 'conversionStatus') if key in plan}


def _plan_path(vault, document_id):
    # Opaque IDs are hashed before use as file paths.
    return vault / '.octopus-kb' / 'document-plans' / (hashlib.sha256(document_id.encode()).hexdigest() + '.json')


def _route(vault):
    from octopus_kb_compound.config import load_config
    config = load_config(vault)
    profile = config.resolve_profile()
    return {'profile': config.default_profile, 'baseUrl': profile.base_url, 'model': profile.model}, profile


def _fence(vault, plan, attempt):
    db = vault / '.octopus-kb' / 'documents.sqlite'
    if not verify_startup_attempt(db, plan['libraryId'], attempt):
        raise RuntimeError('stale startup attempt fencing before wiki publication')
    job = get_job(db, plan['jobId'])
    if not job or job['status'] in {'cancelled', 'failed'} or job['startupAttempt'] != attempt:
        raise RuntimeError('Cancelled, failed, or superseded document job')


@contextmanager
def publication_guard(vault, plan, attempt):
    """Validate ownership while holding the same lock used by cancellation and reboot."""
    with commit_lock(vault):
        _fence(vault, plan, attempt)
        yield


def resolve_candidate_wiki_context(vault: Path, chunk: dict, context_chars: int) -> list[dict[str, str]]:
    """Resolve candidate wiki pages by title/alias relevance, links, and recency."""
    from octopus_kb_compound.frontmatter import parse_document
    wiki_dir = vault / 'wiki'
    if not wiki_dir.is_dir():
        return []
    pages = sorted(wiki_dir.glob('*.md'))
    for page in pages:
        if any(part.is_symlink() for part in [page, *page.parents] if part != vault and part.is_relative_to(vault)):
            raise ValueError('Symlinked wiki context is refused')
        if not page.resolve().is_relative_to(vault.resolve()):
            raise ValueError('Wiki context is outside this library')

    text = chunk.get('primaryText', '').lower()
    headings = [h.lower() for h in chunk.get('headings', [])]

    candidates = []
    for page in pages:
        rel_posix = page.relative_to(vault).as_posix()
        try:
            raw_content = page.read_text(encoding='utf-8')
        except OSError:
            continue
        frontmatter, _ = parse_document(raw_content)
        title = str(frontmatter.get('title') or page.stem)
        aliases = [str(a) for a in frontmatter.get('aliases', []) if isinstance(a, str)]
        role = str(frontmatter.get('role') or frontmatter.get('type') or '')

        score = 0
        title_lower = title.lower()
        if title_lower in text:
            score += 100
        for alias in aliases:
            if alias.lower() in text:
                score += 80
        for heading in headings:
            if heading and (heading in title_lower or title_lower in heading):
                score += 60
        if role == 'index' or page.name == 'INDEX.md':
            score += 10
        elif page.name != 'LOG.md':
            score += 20

        candidates.append({
            'path': page,
            'rel_path': rel_posix,
            'score': score,
            'mtime': page.stat().st_mtime,
            'raw_content': raw_content,
        })

    candidates.sort(key=lambda c: (-c['score'], -c['mtime'], c['rel_path']))

    # Include paths, separators and JSON escaping in the configured allowance.
    context = []
    for candidate in candidates:
        raw_content = candidate['raw_content']
        lo, hi = 0, min(len(raw_content), context_chars)
        while lo < hi:
            end = (lo + hi + 1) // 2
            trial = context + [{'path': candidate['rel_path'], 'text': raw_content[:end]}]
            if len(_json(trial)) <= context_chars:
                lo = end
            else:
                hi = end - 1
        if lo:
            context.append({'path': candidate['rel_path'], 'text': raw_content[:lo]})
    return context


def _handle_proposal_conflicts_and_merges(vault: Path, proposal: dict, plan: dict, chunk: dict) -> None:
    """Retain conflicting or duplicate policies safely without overwriting manual edits."""
    from octopus_kb_compound.adapters.obsidian.store import ObsidianStore
    from octopus_kb_compound.canonical import _canonical_pages_by_key
    from octopus_kb_compound.links import normalize_page_name
    store = ObsidianStore(vault)
    pages = store.list_page_records()
    existing_canonical = set(_canonical_pages_by_key(pages))
    new_ops = []
    reserved = {}
    deduped_claims = 0

    def content_at(rel):
        if rel in reserved:
            return reserved[rel]
        path = vault / rel
        return path.read_text(encoding='utf-8') if path.exists() else None

    for op in proposal.get('operations', []):
        if op.get('op') == 'create_page':
            frontmatter = dict(op.get('frontmatter') or {})
            title = str(frontmatter.get('title') or Path(op.get('path', '')).stem)
            key = normalize_page_name(frontmatter.get('canonical_name') or title)
            existing_text = content_at(op['path'])
            proposed_body = str(op.get('body') or '').strip()
            if existing_text is not None or key in existing_canonical:
                if proposed_body and existing_text is not None and proposed_body in existing_text:
                    deduped_claims += 1
                    continue
                safe_rev = plan['revisionId'][:8]
                stem = Path(op['path']).stem
                conflict_base = f"wiki/{stem}-conflict-{safe_rev}"
                counter = 0
                while True:
                    suffix = '' if counter == 0 else f"-c{chunk['index']}" + (f"-{counter - 1}" if counter > 1 else '')
                    conflict_filename = f"{conflict_base}{suffix}.md"
                    previous_body = content_at(conflict_filename)
                    if previous_body is None or (proposed_body and proposed_body in previous_body):
                        break
                    counter += 1
                if previous_body is not None:
                    deduped_claims += 1
                    continue
                extra = '' if counter == 0 else f" - Chunk {chunk['index'] + 1}" + (f".{counter - 1}" if counter > 1 else '')
                conflict_title = f"{title} (Conflict - {safe_rev}{extra})"
                frontmatter['title'] = conflict_title
                frontmatter['canonical_name'] = conflict_title
                frontmatter['conflict_with'] = op['path']
                frontmatter['summary'] = f"Conflicting policy with [[{title}]] from revision {safe_rev}"
                op['path'] = conflict_filename
                op['body'] = f"Conflicting policy with [[{title}]]:\n\n{proposed_body}\n\nSource citation: revision `{plan['revisionId']}`, lines {chunk['startLine']}..{chunk['endLine']}.\n"
            frontmatter['source_revision'] = plan['revisionId']
            frontmatter['source_path'] = plan['rawPath']
            op['frontmatter'] = frontmatter
            reserved[op['path']] = op.get('body', '')
            existing_canonical.add(normalize_page_name(frontmatter.get('canonical_name') or frontmatter.get('title') or title))
        new_ops.append(op)
    if not new_ops and deduped_claims > 0:
        new_ops.append({
            'op': 'append_log',
            'path': 'wiki/LOG.md',
            'entry': f"- verified duplicate claims for chunk {chunk['index']} from revision {plan['revisionId'][:8]}",
            'rationale': 'duplicate claim deduplicated',
            'confidence': 1.0,
        })
    proposal['operations'] = new_ops


def _publish_index(index_path: Path, content: str, expected_bytes: bytes) -> None:
    """Publish a complete index atomically, refusing an observed concurrent edit."""
    fd, staged = tempfile.mkstemp(prefix='.index-', dir=index_path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8', newline='') as out:
            out.write(content)
            out.flush()
            os.fsync(out.fileno())
        if index_path.read_bytes() != expected_bytes:
            raise RuntimeError('Wiki index changed during publication; resume to merge the current index')
        os.replace(staged, index_path)
        if os.name != 'nt':
            directory = os.open(index_path.parent, os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        if os.path.exists(staged):
            os.unlink(staged)


def _link_accepted_pages_to_index(vault: Path, proposal: dict) -> None:
    """Link newly accepted wiki pages into the curated topic index."""
    index_path = vault / 'wiki' / 'INDEX.md'
    if not index_path.is_file():
        return
    index_bytes = index_path.read_bytes()
    index_content = index_bytes.decode('utf-8')
    new_links = []
    for op in proposal.get('operations', []):
        if op.get('op') == 'create_page':
            conflict_target = op.get('frontmatter', {}).get('conflict_with')
            if conflict_target:
                orig_title = Path(conflict_target).stem
                orig_link = f"[[{orig_title}]]"
                if orig_link not in index_content and orig_link not in new_links:
                    new_links.append(orig_link)
            title = op.get('frontmatter', {}).get('title') or Path(op.get('path', '')).stem
            link_ref = f"[[{title}]]"
            if link_ref not in index_content and link_ref not in new_links:
                new_links.append(link_ref)
    if new_links:
        if not index_content.endswith('\n'):
            index_content += '\n'
        index_content += '\n'.join(f"- {link}" for link in new_links) + '\n'
        _publish_index(index_path, index_content, index_bytes)


def plan_document(req):
    """Freeze complete source ranges and a serialized-request ceiling without inference."""
    from octopus_kb_compound.propose import _prompt_path, _proposal_schema_path, _render_template
    vault = Path(req['vault'])
    document_id, revision_id, library_id = req['documentId'], req['revisionId'], req['libraryId']
    with commit_lock(vault):
        from .store import get_source_revision
        revision = get_source_revision(vault / '.octopus-kb' / 'documents.sqlite', revision_id)
        if not revision or revision['documentId'] != document_id or revision['libraryId'] != library_id:
            raise ValueError('Document revision does not belong to this library')
        raw = _safe_raw(vault, req['rawPath'])
        text = raw.read_text(encoding='utf-8')
        chunk_chars = int(req.get('chunkChars', 4000))
        output_reserve = int(req.get('outputReserve', 2048))
        context_chars = int(req.get('contextChars', 2000))
        retry_reserve = int(req.get('retryReserve', output_reserve * 2))
        if not 100 <= chunk_chars <= 16000 or not 64 <= output_reserve <= 16000 or not 0 <= context_chars <= 8000:
            raise ValueError('Invalid chunk, output, or context allowance')
        route, _ = _route(vault)
        template = _prompt_path().read_text(encoding='utf-8')
        schema = _proposal_schema_path().read_text(encoding='utf-8')
        prompt_version = 'document-manifest-v1'

        manifest = create_chunks_from_blocks(
            document_id,
            revision_id,
            req.get('blocks'),
            text,
            max_chunk_chars=chunk_chars,
            overlap_chars=int(req.get('overlapChars', 0)),
        )
        chunks = []
        for span in manifest['chunks']:
            index = span['index']
            start, end = span['start'], span['end']
            start_line, end_line = span['startLine'], span['endLine']
            citation_scaffold = f'\nSource document revision {revision_id}; source character span [{start},{end}); source line range {start_line}..{end_line}. Only cite this range.\n'
            # Serialized context contains no raw controls: four UTF-8 bytes per character
            # also bounds ASCII quote/backslash escaping in the outer request JSON.
            context_ceiling = '\U00010000' * context_chars if context_chars >= 2 else '[]'
            prompt_scaffold = _render_template(template, {
                'raw_path': req['rawPath'],
                'raw_body': span['primaryText'],
                'existing_bundle': context_ceiling,
                'proposal_schema': schema,
            }) + citation_scaffold
            simulated_request = {
                'model': route['model'],
                'messages': [{'role': 'user', 'content': prompt_scaffold}],
                'temperature': 0.1,
                'max_tokens': output_reserve,
                'response_format': {'type': 'json_object'},
            }
            input_estimate = estimate_tokens(_json(simulated_request))
            work_key = f"{revision_id}:{index}:{start}-{end}:{prompt_version}"
            chunks.append({
                'index': index,
                'chunkId': span['chunkId'],
                'chunkIndex': index,
                'start': start,
                'end': end,
                'primaryStartChar': start,
                'primaryEndChar': end,
                'startLine': start_line,
                'endLine': end_line,
                'primaryText': span['primaryText'],
                'headings': span.get('headings', []),
                'workKey': work_key,
                'inputEstimate': input_estimate,
                'outputReserve': output_reserve,
            })
        coverage = verify_chunk_coverage(text, chunks)
        if not coverage['ok']:
            raise ValueError('Range manifest failed full-document coverage: ' + '; '.join(coverage['errors']))
        required = sum(c['inputEstimate'] + c['outputReserve'] for c in chunks) + retry_reserve
        plan = {'version': 1, 'documentId': document_id, 'revisionId': revision_id,
                'libraryId': library_id, 'rawPath': req['rawPath'],
                'rawSha256': hashlib.sha256(raw.read_bytes()).hexdigest(), 'route': route,
                'promptVersion': prompt_version,
                'conversion': req.get('conversion', {}), 'chunks': chunks,
                'tokenEstimate': required, 'retryReserve': retry_reserve,
                'estimator': 'conservative-manifest-ceiling',
                'totalChunks': len(chunks), 'totalChars': len(text), 'retryNonce': '',
                'chunkChars': chunk_chars, 'outputReserve': output_reserve, 'contextChars': context_chars,
                'conversionStatus': req.get('conversionStatus', 'complete')}
        plan_hash = _hash(plan)
        previous_path = _plan_path(vault, document_id)
        conversion_path = _conversion_path(vault, document_id)
        if not previous_path.is_file():
            conversion_cancelled = conversion_path.is_file() and json.loads(conversion_path.read_text(encoding='utf-8')).get('status') == 'cancelled'
            cancelled_job = any(job['documentId'] == document_id and job['revisionId'] == revision_id and job['status'] == 'cancelled'
                                for job in list_jobs(vault / '.octopus-kb' / 'documents.sqlite', library_id))
            if conversion_cancelled or cancelled_job:
                raise RuntimeError('Cannot plan a cancelled conversion')
        if previous_path.is_file():
            previous = json.loads(previous_path.read_text(encoding='utf-8'))
            if previous['status'] in {'running', 'uncertain'}:
                raise RuntimeError('Cannot replace an active or uncertain paid inference plan')
            if req.get('freshRetry'):
                if previous['rawSha256'] != plan['rawSha256']:
                    raise RuntimeError('Retry source revision changed; import a new revision')
                for chunk in plan['chunks']:
                    old = previous_path.parent / (previous['planHash'] + '-' + str(chunk['index']) + '.json')
                    if chunk['index'] < len(previous['chunks']) and old.is_file() and json.loads(old.read_text(encoding='utf-8')).get('state') == 'applied':
                        old_chunk = previous['chunks'][chunk['index']]
                        if (old_chunk['start'], old_chunk['end']) == (chunk['start'], chunk['end']):
                            chunk['alreadyApplied'] = True
                plan['retryNonce'] = uuid.uuid4().hex
                plan_hash = _hash(plan)
            if previous['planHash'] == plan_hash and previous['status'] != 'cancelled':
                return _public_plan(previous)
        plan.update({'planHash': plan_hash, 'jobId': req.get('jobId') or 'job-' + uuid.uuid4().hex,
                     'status': 'awaiting_approval', 'budgetApproved': False, 'completedChunks': 0,
                     'tokensUsed': 0, 'usageKnown': True, 'approvedTokens': 0})
        db = vault / '.octopus-kb' / 'documents.sqlite'
        attempt = get_or_increment_startup_attempt(db, library_id, increment=False)
        existing = get_job(db, plan['jobId'])
        if not existing:
            create_job(db, plan['jobId'], library_id, document_id, revision_id, attempt,
                       'awaiting_approval', len(chunks), required)
        else:
            if existing['documentId'] != document_id or existing['revisionId'] != revision_id or existing['libraryId'] != library_id:
                raise ValueError('Existing job belongs to another document revision')
            if existing['status'] in {'cancelled', 'failed', 'completed'}:
                raise ValueError('Cannot replace a terminal document job')
            con = open_db(db)
            try:
                con.execute("UPDATE document_jobs SET stage='awaiting_approval', total_chunks=?, token_estimate=?, startup_attempt=? WHERE job_id=?",
                            (len(chunks), required, attempt, plan['jobId']))
                con.commit()
            finally:
                con.close()
        plan['startupAttempt'] = attempt
        # Keep every approved/requestable generation for audit after retry replaces the current view.
        manifest_path = _plan_path(vault, document_id).parent / 'manifests' / (plan_hash + '.json')
        if not manifest_path.exists():
            _write(manifest_path, plan)
        _write(_plan_path(vault, document_id), plan)
        return _public_plan(plan)


def _public_plan(plan):
    return {key: plan[key] for key in ('documentId', 'revisionId', 'libraryId', 'jobId', 'planHash',
            'status', 'budgetApproved', 'tokenEstimate', 'totalChunks', 'completedChunks',
            'tokensUsed', 'usageKnown', 'rawPath', 'error') if key in plan and plan[key] is not None
            and not (key == 'error' and plan['status'] == 'completed')} | {'ok': True, 'estimatedTokens': plan['tokenEstimate']}


def _reported_usage(plan_path, plan):
    total = 0
    seen_attempts = set()
    attempts_dir = plan_path.parent / 'attempts'
    if attempts_dir.is_dir():
        for path in attempts_dir.glob(f"att-{plan['planHash'][:12]}-*.json"):
            try:
                rec = json.loads(path.read_text(encoding='utf-8'))
                att_id = rec.get('attemptId')
                if att_id:
                    seen_attempts.add(att_id)
                total += (rec.get('inputTokens') or 0) + (rec.get('outputTokens') or 0)
            except Exception:
                pass
    for path in plan_path.parent.glob(plan['planHash'] + '-*.json'):
        try:
            saved = json.loads(path.read_text(encoding='utf-8'))
            if saved.get('attemptId') not in seen_attempts:
                total += (saved.get('inputTokens') or 0) + (saved.get('outputTokens') or 0)
        except Exception:
            pass
    return total


def execute_document(req):
    """Execute approved ranges with bounded live wiki context and durable attempt records."""
    from octopus_kb_compound.llm import ChatClient, _parse_response, parse_json_content
    from octopus_kb_compound.propose import fill_create_page_frontmatter
    from octopus_kb_compound.proposals import validate_proposal_dict
    from octopus_kb_compound.apply import validate_proposal_file, recover_proposal
    from octopus_kb_compound import audit
    vault = Path(req['vault'])
    plan_path = _plan_path(vault, req['documentId'])
    db = vault / '.octopus-kb' / 'documents.sqlite'
    with commit_lock(vault):
        plan = json.loads(plan_path.read_text(encoding='utf-8'))
        if plan['libraryId'] != req['libraryId'] or plan['planHash'] != req['expectedPlanHash']:
            raise ValueError('Document approval does not match the frozen plan')
        if plan['status'] == 'completed':
            return _public_plan(plan)
        if req.get('requireExistingApproval') and not plan.get('budgetApproved'):
            raise ValueError('Budget approval is required before resuming extraction')
        approved = req['approvedTokens']
        if not isinstance(approved, int) or approved < plan['tokenEstimate']:
            raise ValueError('Explicit approval must cover the full manifest estimate')
        current_attempt = get_or_increment_startup_attempt(db, plan['libraryId'], increment=False)
        if _hash(_frozen_plan(plan)) != plan['planHash']:
            raise ValueError('Frozen request manifest integrity check failed')
        has_calling_checkpoint = any(json.loads(p.read_text(encoding='utf-8')).get('state') == 'calling' for p in plan_path.parent.glob(plan['planHash'] + '-*.json'))
        if plan['status'] == 'uncertain' or has_calling_checkpoint:
            if req.get('uncertainOutcome') != 'replay':
                raise RuntimeError('Previous inference outcome is uncertain; explicit outcome decision required to resume (uncertainOutcome: replay)')
        elif plan['status'] == 'running' and plan['startupAttempt'] == current_attempt:
            raise RuntimeError('Execution is active; automatic duplicate inference is refused')
        if plan['status'] == 'cancelled':
            raise RuntimeError('Cancelled jobs cannot resume; explicitly retry to create a new plan')
        route, profile = _route(vault)
        if route != plan['route']:
            raise ValueError('Model route changed; re-plan and approve the new estimate')
        raw = _safe_raw(vault, plan['rawPath'])
        raw_bytes = raw.read_bytes()
        if hashlib.sha256(raw_bytes).hexdigest() != plan['rawSha256']:
            raise ValueError('Source bytes changed after approval')
        raw_text = raw_bytes.decode('utf-8')
        coverage = verify_chunk_coverage(raw_text, plan['chunks'])
        if not coverage['ok']:
            raise ValueError('Range manifest failed full-document coverage: ' + '; '.join(coverage['errors']))
        attempt = get_or_increment_startup_attempt(db, plan['libraryId'], increment=False)
        job = get_job(db, plan['jobId'])
        if not job:
            raise RuntimeError('Document job is missing')
        # A recovered, checkpointed job can transfer to the current startup generation.
        con = open_db(db)
        try:
            con.execute("UPDATE document_jobs SET startup_attempt=?, status='active', is_uncertain=0, error=NULL WHERE job_id=? AND status NOT IN ('cancelled','failed')", (attempt, plan['jobId']))
            con.commit()
        finally:
            con.close()
        _fence(vault, plan, attempt)
        plan.update(status='running', startupAttempt=attempt, budgetApproved=True, approvedTokens=approved)
        plan.pop('error', None)
        plan['tokensUsed'] = _reported_usage(plan_path, plan)
        _write(plan_path, plan)
        _write(plan_path.parent / 'approvals' / (plan['planHash'] + '.json'),
               {'planHash': plan['planHash'], 'approvedTokens': approved,
                'startupAttempt': attempt, 'approvedAt': datetime.now(timezone.utc).isoformat()})
    kwargs = profile.as_client_kwargs()
    kwargs['max_retries'] = 0
    client = ChatClient(**kwargs)
    from octopus_kb_compound.propose import _prompt_path, _proposal_schema_path, _render_template
    template = _prompt_path().read_text(encoding='utf-8')
    schema = _proposal_schema_path().read_text(encoding='utf-8')
    try:
        for chunk in plan['chunks']:
            if chunk.get('alreadyApplied'):
                plan['completedChunks'] = chunk['index'] + 1
                continue
            checkpoint = plan_path.parent / (plan['planHash'] + '-' + str(chunk['index']) + '.json')
            request = None
            request_hash = None
            attempt_id = None
            with publication_guard(vault, plan, attempt):
                saved = json.loads(checkpoint.read_text(encoding='utf-8')) if checkpoint.is_file() else None
                if saved and saved.get('workKey') and saved.get('workKey') != chunk.get('workKey'):
                    raise ValueError('Saved provider response work key mismatch')
                if saved and saved['state'] == 'applied':
                    plan['completedChunks'] = max(plan['completedChunks'], chunk['index'] + 1)
                    continue
                if saved and (saved.get('state') == 'calling' or saved.get('finishReason') not in {None, 'stop', 'end_turn'}):
                    if req.get('uncertainOutcome') == 'replay':
                        if 'attemptId' in saved:
                            attempts_dir = plan_path.parent / 'attempts'
                            attempts_dir.mkdir(parents=True, exist_ok=True)
                            _write(attempts_dir / f"{saved['attemptId']}.json", saved)
                        saved = None
                    elif saved.get('state') == 'calling':
                        raise RuntimeError('Previous inference outcome is uncertain; explicit outcome decision required to resume (uncertainOutcome: replay)')
                if not saved:
                    context = resolve_candidate_wiki_context(vault, chunk, plan.get('contextChars', 2000))
                    prompt = _render_template(template, {
                        'raw_path': plan['rawPath'],
                        'raw_body': chunk['primaryText'],
                        'existing_bundle': _json(context),
                        'proposal_schema': schema,
                    })
                    prompt += f"\nSource document revision {plan['revisionId']}; source character span [{chunk['start']},{chunk['end']}); source line range {chunk['startLine']}..{chunk['endLine']}. Only cite this range.\n"
                    request = {
                        'model': route['model'],
                        'messages': [{'role': 'user', 'content': prompt}],
                        'temperature': 0.1,
                        'max_tokens': plan['outputReserve'],
                        'response_format': {'type': 'json_object'},
                    }
                    request_hash = _hash(request)
                    actual_input_tokens = estimate_tokens(_json(request))
                    remaining_chunks = plan['chunks'][chunk['index'] + 1:]
                    remaining_need = sum(c['inputEstimate'] + c['outputReserve'] for c in remaining_chunks)
                    projected_tokens = plan['tokensUsed'] + actual_input_tokens + plan['outputReserve'] + remaining_need
                    if projected_tokens > approved:
                        raise RuntimeError('Remaining approved allowance does not cover pending requests')
                    attempt_id = f"att-{plan['planHash'][:12]}-{chunk['index']}-{uuid.uuid4().hex[:8]}"
                    calling_record = {
                        'state': 'calling',
                        'attemptId': attempt_id,
                        'workKey': chunk.get('workKey') or f"{plan['revisionId']}:{chunk['index']}:{chunk['start']}-{chunk['end']}",
                        'requestHash': request_hash,
                        'inputTokensEstimated': actual_input_tokens,
                        'request': request,
                        'startedAt': datetime.now(timezone.utc).isoformat(),
                    }
                    _write(checkpoint, calling_record)
                    attempts_dir = plan_path.parent / 'attempts'
                    attempts_dir.mkdir(parents=True, exist_ok=True)
                    _write(attempts_dir / f"{attempt_id}.json", calling_record)
                    con = open_db(db)
                    try:
                        con.execute("UPDATE document_jobs SET is_uncertain=1, stage='inference' WHERE job_id=?", (plan['jobId'],))
                        con.commit()
                    finally:
                        con.close()
            if not saved:
                headers = {'Content-Type': 'application/json'}
                if profile.api_key:
                    headers['Authorization'] = 'Bearer ' + profile.api_key
                # Send the dynamically rendered request; preserve raw replies and usage before parsing.
                payload = client._send_with_retries('POST', profile.base_url.rstrip('/') + '/chat/completions', headers, request)
                response = _parse_response(payload, profile.model)
                saved = {
                    'state': 'response',
                    'attemptId': attempt_id,
                    'workKey': chunk.get('workKey'),
                    'requestHash': request_hash,
                    'content': response.content,
                    'model': response.model,
                    'inputTokens': response.input_tokens,
                    'outputTokens': response.output_tokens,
                    'finishReason': response.finish_reason,
                }
                attempts_dir = plan_path.parent / 'attempts'
                attempts_dir.mkdir(parents=True, exist_ok=True)
                _write(attempts_dir / f"{attempt_id}.json", saved)
                with publication_guard(vault, plan, attempt):
                    _write(checkpoint, saved)
                    con = open_db(db)
                    try:
                        con.execute("UPDATE document_jobs SET is_uncertain=0 WHERE job_id=?", (plan['jobId'],))
                        con.commit()
                    finally:
                        con.close()
                    plan['tokensUsed'] = _reported_usage(plan_path, plan)
                    if saved.get('inputTokens') is None or saved.get('outputTokens') is None:
                        plan['usageKnown'] = False
                    _write(plan_path, plan)
                    update_job_checkpoint(db, plan['jobId'], attempt, plan['completedChunks'],
                        chunk['index'], plan['tokensUsed'], stage='response_saved')
            if saved.get('finishReason') == 'length':
                raise RuntimeError("Provider output limit reached (finish_reason='length'); enrichment incomplete")
            if saved.get('finishReason') not in {None, 'stop', 'end_turn'}:
                raise RuntimeError(f"Ambiguous provider finish reason ({saved.get('finishReason')}); enrichment incomplete")
            proposal = saved.get('proposal')
            if not proposal:
                parsed = parse_json_content(saved['content'])
                if not isinstance(parsed, dict):
                    raise ValueError('Provider proposal is not an object')
                proposal = parsed
                proposal.update(id='prop-' + plan['planHash'][:20] + '-' + str(chunk['index']),
                    created_at=datetime.now(timezone.utc).isoformat(), status='pending',
                    source={'kind': 'raw_file', 'path': plan['rawPath'], 'sha256': plan['rawSha256']},
                    produced_by={'provider_profile': plan['route']['profile'], 'model': saved['model'],
                                 'prompt_version': f"document-manifest-v1:{plan['revisionId']}:{chunk['index']}:{saved.get('requestHash')}"})
                for op in proposal.get('operations', []):
                    if 'source_span' in op:
                        span = op['source_span']
                        if span.get('path') != plan['rawPath']:
                            raise ValueError('Proposal citation is outside the approved primary source range')
                        s_line, e_line = span.get('start_line', 0), span.get('end_line', 0)
                        if not chunk['startLine'] <= s_line <= e_line <= chunk['endLine']:
                            raise ValueError('Proposal citation is outside the approved primary source range')
                        if 'page' in span:
                            page_num = span['page']
                            total_p = plan.get('conversion', {}).get('pageCount') or plan.get('conversion', {}).get('pages')
                            if total_p is not None and isinstance(total_p, int):
                                if page_num < 1 or page_num > total_p:
                                    raise ValueError(f"Proposal citation page {page_num} exceeds document page count {total_p}")
                            elif total_p is None and plan.get('conversion', {}).get('format') in {'txt', 'markdown', 'md'} and page_num > 1:
                                raise ValueError(f"Proposal cited page {page_num} for non-paginated document format")
                _handle_proposal_conflicts_and_merges(vault, proposal, plan, chunk)
            # Saved generated proposals need the same repair as fresh provider output.
            # Conflict destinations remain the durable publication intent on resume.
            _normalize_generated_page_categories(proposal)
            fill_create_page_frontmatter(proposal)
            errors = validate_proposal_dict(proposal)
            if errors:
                raise ValueError('Provider proposal rejected: ' + '; '.join(str(e) for e in errors))
            saved['proposal'] = proposal
            _write(checkpoint, saved)
            if saved.get('attemptId'):
                attempts_dir = plan_path.parent / 'attempts'
                attempts_dir.mkdir(parents=True, exist_ok=True)
                _write(attempts_dir / f"{saved['attemptId']}.json", saved)
            proposal_path = vault / '.octopus-kb' / 'proposals' / (proposal['id'] + '.json')
            with publication_guard(vault, plan, attempt):
                existing_id = proposal['id'] + ('-recovery-' + str(saved['applyAttempt']) if saved.get('applyAttempt') else '')
                existing_audit = audit.find_entry(vault, existing_id)
                already_applied = False
                if existing_audit is not None:
                    audit_entry = json.loads(existing_audit.read_text(encoding='utf-8'))
                    audit_state = audit_entry.get('status')
                    if audit_state == 'pending':
                        recover_proposal(existing_id, vault)
                        audit_state = 'rolled_back'
                    elif audit_state == 'applied':
                        already_applied = True
                    if audit_state == 'rolled_back':
                        saved['applyAttempt'] = saved.get('applyAttempt', 0) + 1
                        _write(checkpoint, saved)
                if not already_applied:
                    if saved.get('applyAttempt'):
                        proposal['id'] += '-recovery-' + str(saved['applyAttempt'])
                        proposal_path = proposal_path.with_name(proposal['id'] + '.json')
                    _write(proposal_path, proposal)
                    result = validate_proposal_file(proposal_path, vault, apply=True,
                                commit_guard=lambda: publication_guard(vault, plan, attempt))
                    if result.status not in {'applied', 'already_applied'}:
                        details = '; '.join(
                            str(row.get('rule_id', 'validation')) + ': ' + str(row.get('reason', 'rejected'))
                            for row in result.rule_results if row.get('verdict') == 'reject')
                        raise RuntimeError('Wiki publication ' + result.status +
                            (': ' + details if details else ''))
                _link_accepted_pages_to_index(vault, proposal)
                saved['state'] = 'applied'
                _write(checkpoint, saved)
                if saved.get('attemptId'):
                    attempts_dir = plan_path.parent / 'attempts'
                    attempts_dir.mkdir(parents=True, exist_ok=True)
                    _write(attempts_dir / f"{saved['attemptId']}.json", saved)
                plan['completedChunks'] = chunk['index'] + 1
                # Only provider-reported usage is represented as billed usage.
                _write(plan_path, plan)
                update_job_checkpoint(db, plan['jobId'], attempt, plan['completedChunks'],
                                      plan['completedChunks'], plan['tokensUsed'], stage='enriching')
        with publication_guard(vault, plan, attempt):
            final_coverage = verify_chunk_coverage(raw.read_text(encoding='utf-8'), plan['chunks'])
            if not final_coverage['ok']:
                raise RuntimeError('Range manifest failed full-document coverage: ' + '; '.join(final_coverage['errors']))
            for chunk in plan['chunks']:
                if chunk.get('alreadyApplied'):
                    continue
                cp = plan_path.parent / (plan['planHash'] + '-' + str(chunk['index']) + '.json')
                if not cp.is_file() or json.loads(cp.read_text(encoding='utf-8')).get('state') != 'applied':
                    raise RuntimeError(f"Chunk {chunk['index']} was not applied; refusing completed status")
            plan['status'] = 'completed'
            _write(plan_path, plan)
            finish_job(db, plan['jobId'], attempt)
        return _public_plan(plan)
    except Exception as exc:
        with commit_lock(vault):
            current = json.loads(plan_path.read_text(encoding='utf-8'))
            if current['status'] != 'cancelled':
                current['status'] = 'uncertain' if any(json.loads(p.read_text(encoding='utf-8')).get('state') == 'calling' for p in plan_path.parent.glob(plan['planHash'] + '-*.json')) else 'paused'
                current['error'] = str(exc)
                _write(plan_path, current)
                if verify_startup_attempt(db, plan['libraryId'], attempt):
                    con = open_db(db)
                    try:
                        con.execute("UPDATE document_jobs SET status='paused', is_uncertain=?, error=? WHERE job_id=? AND status NOT IN ('cancelled','completed','failed')",
                                    (int(current['status'] == 'uncertain'), str(exc), plan['jobId']))
                        con.commit()
                    finally:
                        con.close()
        return {**_public_plan(current), 'error': str(exc), 'ok': False}


def _conversion_path(vault, document_id):
    return vault / '.octopus-kb' / 'conversion-status' / (hashlib.sha256(document_id.encode()).hexdigest() + '.json')


def record_conversion(req):
    """Persist conversion diagnostics even when no searchable text was produced."""
    from .store import get_document
    vault = Path(req['vault'])
    with commit_lock(vault):
        doc = get_document(vault / '.octopus-kb' / 'documents.sqlite', req['documentId'])
        if not doc or doc['libraryId'] != req['libraryId']:
            raise ValueError('Cross-library conversion status rejected')
        job = get_job(vault / '.octopus-kb' / 'documents.sqlite', req['jobId']) if req.get('jobId') else next(
            (item for item in list_jobs(vault / '.octopus-kb' / 'documents.sqlite', req['libraryId'])
             if item['documentId'] == req['documentId']), None)
        if job and (job['documentId'] != req['documentId'] or job['libraryId'] != req['libraryId']):
            raise ValueError('Conversion job belongs to another document')
        previous_status_path = _conversion_path(vault, req['documentId'])
        previous_status = json.loads(previous_status_path.read_text(encoding='utf-8')).get('status') if previous_status_path.is_file() else None
        status = 'cancelled' if previous_status == 'cancelled' or (job and job['status'] == 'cancelled') else req.get('conversionStatus', 'failed')
        error = req.get('error', 'Conversion did not produce searchable text')
        if job and job['status'] not in {'cancelled', 'failed', 'completed'}:
            if status == 'cancelled':
                cancel_job(vault / '.octopus-kb' / 'documents.sqlite', job['jobId'])
            else:
                finish_job(vault / '.octopus-kb' / 'documents.sqlite', job['jobId'], job['startupAttempt'], status='failed', error=error)
        _write(_conversion_path(vault, req['documentId']), {
            'status': status, 'conversion': req.get('conversion', {}), 'error': error})
    return {'ok': True}


def document_location(req):
    """Resolve only registered, library-owned original/text/audit locations."""
    from .store import get_document, get_source_revision
    vault = Path(req['vault'])
    db = vault / '.octopus-kb' / 'documents.sqlite'
    doc = get_document(db, req['documentId'])
    if not doc or doc['libraryId'] != req['libraryId']:
        raise ValueError('Cross-library document location rejected')
    action = req.get('action', 'text')
    if action not in {'original', 'text', 'sources'}:
        raise ValueError('Unsupported document location action')
    if action == 'sources':
        revision = get_source_revision(db, doc['activeRevisionId'])
        plan_path = _plan_path(vault, req['documentId'])
        plan = json.loads(plan_path.read_text(encoding='utf-8')) if plan_path.is_file() else None
        lines = ['文档来源 / Document sources', '', '文件 / File: ' + doc['displayFilename']]
        if revision:
            lines.extend(['版本 / Revision: ' + revision['revisionId'],
                          'SHA-256: ' + revision['sha256'], '字节数 / Bytes: ' + str(revision['byteLength'])])
        if plan:
            lines.extend(['文本 / Text: ' + plan['rawPath'],
                          '知识提取 / Extraction: ' + str(plan['completedChunks']) + '/' + str(plan['totalChunks']),
                          '', '原文区间 / Source ranges (Unicode code points):'])
            for chunk in plan['chunks']:
                lines.append(str(chunk['index'] + 1) + ': ' + str(chunk['start']) + '–' + str(chunk['end']))
        else:
            failure = _conversion_path(vault, req['documentId'])
            if failure.is_file():
                diagnostic = json.loads(failure.read_text(encoding='utf-8'))
                lines.append('转换 / Conversion: ' + diagnostic['status'])
            lines.append('尚未生成知识提取计划 / No extraction plan has been created')
        return {'ok': True, 'text': '\n'.join(lines) + '\n'}
    if action == 'original':
        revision = get_source_revision(db, doc['activeRevisionId'])
        if not revision:
            raise ValueError('Original source is unavailable')
        rel = revision['objectPath']
    else:
        plan_path = _plan_path(vault, req['documentId'])
        if not plan_path.is_file():
            raise ValueError('Document has no extracted text')
        plan = json.loads(plan_path.read_text(encoding='utf-8'))
        rel = plan['rawPath']
    path = vault / rel
    if not path.is_file() or not path.resolve().is_relative_to(vault.resolve()):
        raise ValueError('Document location is missing or outside this library')
    for component in [path, *path.parents]:
        if component == vault:
            break
        if component.is_symlink():
            raise ValueError('Symlinked document locations are refused')
    return {'ok': True, 'path': rel, 'relativePath': rel}


def document_status(req):
    """List registered sources, verified retention and durable enrichment state."""
    from .store import list_documents, get_source_revision
    vault = Path(req['vault'])
    db = vault / '.octopus-kb' / 'documents.sqlite'
    rows = []
    jobs = list_jobs(db, req['libraryId'])
    for doc in list_documents(db, req['libraryId']):
        document_id = doc.get('id') or doc.get('documentId')
        if req.get('documentId') and req['documentId'] != document_id:
            continue
        revision_id = doc.get('activeRevisionId')
        revision = get_source_revision(db, revision_id) if revision_id else None
        available = False
        if revision and revision['status'] != 'original_unavailable':
            source = vault / revision['objectPath']
            linked = any(part.is_symlink() for part in [source, *source.parents] if part != vault and part.is_relative_to(vault))
            available = source.is_file() and not linked and source.resolve().is_relative_to(vault.resolve()) and hashlib.sha256(source.read_bytes()).hexdigest() == revision['sha256']
        path = _plan_path(vault, document_id)
        plan = json.loads(path.read_text(encoding='utf-8')) if path.is_file() else None
        raw_rel = plan['rawPath'] if plan else (revision['objectPath'] if revision and revision['objectPath'].startswith('raw/') else None)
        searchable = False
        text_available = False
        if raw_rel:
            try:
                _safe_raw(vault, raw_rel)
                text_available = True
                con = open_db(db)
                try:
                    searchable = con.execute('SELECT 1 FROM raw_documents WHERE rel_path=?', (raw_rel,)).fetchone() is not None
                finally:
                    con.close()
            except (ValueError, OSError):
                searchable = False
        row = {'id': document_id, 'documentId': document_id, 'libraryId': req['libraryId'],
               'filename': doc.get('displayFilename', ''), 'revisionId': revision_id,
               'originalAvailable': available, 'searchable': searchable, 'textAvailable': text_available,
               'status': plan['status'] if plan else doc.get('status', 'retained'),
               'stage': plan['status'] if plan else 'retained', 'totalChunks': 0, 'completedChunks': 0,
               'estimatedTokens': 0, 'budgetApproved': False, 'planHash': None, 'error': None}
        if plan:
            if plan['status'] == 'running' and not verify_startup_attempt(db, plan['libraryId'], plan['startupAttempt']):
                plan['status'] = 'uncertain' if any(json.loads(p.read_text(encoding='utf-8')).get('state') == 'calling' for p in path.parent.glob(plan['planHash'] + '-*.json')) else 'paused'
            row.update(_public_plan(plan))
            row['conversionStatus'] = plan['conversionStatus']
            row['stage'] = plan['status']
            row['needsOcrPage'] = plan.get('conversion', {}).get('needsOcrPage') or next(iter(plan.get('conversion', {}).get('needsOcrPages', [])), None)
        else:
            job = next((item for item in jobs if item['documentId'] == document_id), None)
            if job:
                row.update(status=job['status'], stage='conversion', jobId=job['jobId'], error=job.get('error'))
            failure = _conversion_path(vault, document_id)
            if failure.is_file() and not (job and job['status'] in {'active', 'queued'}):
                diagnostic = json.loads(failure.read_text(encoding='utf-8'))
                row['conversionStatus'] = diagnostic['status']
                row.update(status='cancelled' if (job and job['status'] == 'cancelled') or diagnostic['status'] == 'cancelled' else 'failed',
                           stage='conversion', error=diagnostic.get('error'))
                row['needsOcrPage'] = diagnostic.get('conversion', {}).get('needsOcrPage') or next(iter(diagnostic.get('conversion', {}).get('needsOcrPages', [])), None)
        row['status'] = {'awaiting_approval': 'paused', 'uncertain': 'paused', 'running': 'active'}.get(row['status'], row['status'])
        row = {key: value for key, value in row.items() if value is not None}
        rows.append(row)
    return {'ok': True, 'documents': rows}


def document_action(req):
    """Cancel durably or resume an explicitly approved, unambiguous saved plan."""
    vault = Path(req['vault'])
    path = _plan_path(vault, req['documentId'])
    if req['action'] in {'resume', 'approve'}:
        return execute_document({**req, 'requireExistingApproval': req['action'] == 'resume'})
    with commit_lock(vault):
        if not path.is_file():
            from .store import get_document
            db = vault / '.octopus-kb' / 'documents.sqlite'
            doc = get_document(db, req['documentId'])
            if not doc or doc['libraryId'] != req['libraryId']:
                raise ValueError('Cross-library document action rejected')
            if req['action'] != 'cancel':
                raise RuntimeError('Source conversion must complete before document planning')
            job = next((item for item in list_jobs(db, req['libraryId']) if item['documentId'] == req['documentId']), None)
            if not job:
                raise RuntimeError('Document has no processing job to cancel')
            if job['status'] == 'completed':
                raise RuntimeError('Completed document processing cannot be cancelled')
            cancel_job(db, job['jobId'])
            _write(_conversion_path(vault, req['documentId']), {'status': 'cancelled', 'conversion': {}, 'error': 'Processing cancelled'})
            return {'ok': True, 'documentId': req['documentId'], 'status': 'cancelled'}
        plan = json.loads(path.read_text(encoding='utf-8'))
        if plan['libraryId'] != req['libraryId']:
            raise ValueError('Cross-library document action rejected')
        if req['action'] == 'cancel':
            if plan['status'] == 'completed':
                raise RuntimeError('Completed document processing cannot be cancelled')
            cancel_job(vault / '.octopus-kb' / 'documents.sqlite', plan['jobId'])
            plan['status'] = 'cancelled'
            _write(path, plan)
            return _public_plan(plan)
        if req['action'] == 'retry':
            # Retry retains responses and never silently repeats uncertain provider calls.
            if plan['status'] in {'running', 'uncertain'}:
                raise RuntimeError('Cannot retry active or uncertain paid inference')
            return plan_document({'vault': str(vault), 'documentId': plan['documentId'],
                'revisionId': plan['revisionId'], 'libraryId': plan['libraryId'],
                'rawPath': plan['rawPath'], 'conversion': plan.get('conversion', {}), 'freshRetry': True,
                'chunkChars': plan['chunkChars'], 'outputReserve': plan['outputReserve'],
                'contextChars': plan['contextChars'], 'conversionStatus': plan['conversionStatus']})
        raise ValueError('Unsupported document action')
