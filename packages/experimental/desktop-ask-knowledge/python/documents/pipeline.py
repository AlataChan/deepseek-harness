"""Approved full-document enrichment with durable inference and publication checkpoints.

Planning performs no inference. Execution binds approval to frozen serialized requests,
source bytes and model route. An ambiguous paid call is never automatically repeated.
"""
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import tempfile
import uuid

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
        'rawSha256', 'route', 'conversion', 'chunks', 'tokenEstimate', 'estimator', 'totalChunks', 'totalChars', 'retryNonce', 'chunkChars', 'outputReserve', 'contextChars', 'conversionStatus')}


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


def plan_document(req):
    """Freeze complete requests and an approval estimate without calling a provider."""
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
        if not 100 <= chunk_chars <= 16000 or not 64 <= output_reserve <= 16000 or not 0 <= context_chars <= 8000:
            raise ValueError('Invalid chunk, output, or context allowance')
        route, _ = _route(vault)
        template = _prompt_path().read_text(encoding='utf-8')
        schema = _proposal_schema_path().read_text(encoding='utf-8')
        context = []
        remaining = context_chars
        for page in sorted((vault / 'wiki').glob('*.md')):
            if remaining <= 0:
                break
            if any(part.is_symlink() for part in [page, *page.parents] if part != vault and part.is_relative_to(vault)):
                raise ValueError('Symlinked wiki context is refused')
            if not page.resolve().is_relative_to(vault.resolve()):
                raise ValueError('Wiki context is outside this library')
            with page.open(encoding='utf-8') as context_file:
                body = context_file.read(remaining)
            context.append({'path': page.relative_to(vault).as_posix(), 'text': body})
            remaining -= len(body)
        chunks = []
        # Literal slices make the primary ranges an exact contiguous cover.
        for index, start in enumerate(range(0, len(text), chunk_chars)):
            end = min(len(text), start + chunk_chars)
            start_line = text.count('\n', 0, start) + 1
            end_line = text.count('\n', 0, end) + 1
            prompt = _render_template(template, {
                'raw_path': req['rawPath'], 'raw_body': text[start:end],
                'existing_bundle': _json(context), 'proposal_schema': schema,
            })
            prompt += f'\nSource character span [{start},{end}); source line range {start_line}..{end_line}. Only cite this range.\n'
            request = {'model': route['model'], 'messages': [{'role': 'user', 'content': prompt}],
                       'temperature': 0.1, 'max_tokens': output_reserve,
                       'response_format': {'type': 'json_object'}}
            chunks.append({'index': index, 'start': start, 'end': end,
                           'startLine': start_line, 'endLine': end_line,
                           'request': request, 'requestHash': _hash(request),
                           'inputEstimate': estimate_tokens(_json(request)),
                           'outputReserve': output_reserve})
        required = sum(c['inputEstimate'] + c['outputReserve'] for c in chunks)
        plan = {'version': 1, 'documentId': document_id, 'revisionId': revision_id,
                'libraryId': library_id, 'rawPath': req['rawPath'],
                'rawSha256': hashlib.sha256(raw.read_bytes()).hexdigest(), 'route': route,
                'conversion': req.get('conversion', {}), 'chunks': chunks,
                'tokenEstimate': required, 'estimator': 'utf8-byte-upper-bound',
                'totalChunks': len(chunks), 'totalChars': len(text), 'retryNonce': '',
                'chunkChars': chunk_chars, 'outputReserve': output_reserve, 'contextChars': context_chars,
                'conversionStatus': req.get('conversionStatus', 'complete')}
        plan_hash = _hash(plan)
        previous_path = _plan_path(vault, document_id)
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
            'tokensUsed', 'usageKnown', 'rawPath', 'error') if key in plan and plan[key] is not None} | {'ok': True, 'estimatedTokens': plan['tokenEstimate']}


def _reported_usage(plan_path, plan):
    total = 0
    for path in plan_path.parent.glob(plan['planHash'] + '-*.json'):
        saved = json.loads(path.read_text(encoding='utf-8'))
        total += (saved.get('inputTokens') or 0) + (saved.get('outputTokens') or 0)
    return total


def execute_document(req):
    """Run only explicitly approved frozen requests; persist uncertain calls before dispatch."""
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
        approved = req['approvedTokens']
        if not isinstance(approved, int) or approved < plan['tokenEstimate']:
            raise ValueError('Explicit approval must cover the full manifest estimate')
        current_attempt = get_or_increment_startup_attempt(db, plan['libraryId'], increment=False)
        if _hash(_frozen_plan(plan)) != plan['planHash']:
            raise ValueError('Frozen request manifest integrity check failed')
        if plan['status'] == 'uncertain' or (plan['status'] == 'running' and plan['startupAttempt'] == current_attempt):
            raise RuntimeError('Execution is active or uncertain; automatic duplicate inference is refused')
        if plan['status'] == 'running' and any(json.loads(p.read_text(encoding='utf-8')).get('state') == 'calling' for p in plan_path.parent.glob(plan['planHash'] + '-*.json')):
            raise RuntimeError('Interrupted inference outcome is uncertain; refusing automatic repeat')
        if plan['status'] == 'cancelled':
            raise RuntimeError('Cancelled jobs cannot resume; explicitly retry to create a new plan')
        route, profile = _route(vault)
        if route != plan['route']:
            raise ValueError('Model route changed; re-plan and approve the new estimate')
        raw = _safe_raw(vault, plan['rawPath'])
        if hashlib.sha256(raw.read_bytes()).hexdigest() != plan['rawSha256']:
            raise ValueError('Source bytes changed after approval')
        attempt = get_or_increment_startup_attempt(db, plan['libraryId'], increment=False)
        job = get_job(db, plan['jobId'])
        if not job:
            raise RuntimeError('Document job is missing')
        # A recovered, checkpointed job can transfer to the current startup generation.
        con = open_db(db)
        try:
            con.execute("UPDATE document_jobs SET startup_attempt=?, status='active', is_uncertain=0 WHERE job_id=? AND status NOT IN ('cancelled','failed')", (attempt, plan['jobId']))
            con.commit()
        finally:
            con.close()
        _fence(vault, plan, attempt)
        plan.update(status='running', startupAttempt=attempt, budgetApproved=True, approvedTokens=approved)
        plan['tokensUsed'] = _reported_usage(plan_path, plan)
        _write(plan_path, plan)
        _write(plan_path.parent / 'approvals' / (plan['planHash'] + '.json'),
               {'planHash': plan['planHash'], 'approvedTokens': approved,
                'startupAttempt': attempt, 'approvedAt': datetime.now(timezone.utc).isoformat()})
    kwargs = profile.as_client_kwargs()
    kwargs['max_retries'] = 0
    client = ChatClient(**kwargs)
    try:
        for chunk in plan['chunks']:
            if chunk.get('alreadyApplied'):
                plan['completedChunks'] = chunk['index'] + 1
                continue
            checkpoint = plan_path.parent / (plan['planHash'] + '-' + str(chunk['index']) + '.json')
            with publication_guard(vault, plan, attempt):
                saved = json.loads(checkpoint.read_text(encoding='utf-8')) if checkpoint.is_file() else None
                if saved and saved.get('requestHash') != chunk['requestHash']:
                    raise ValueError('Saved provider response request identity mismatch')
                if saved and saved['state'] == 'applied':
                    plan['completedChunks'] = max(plan['completedChunks'], chunk['index'] + 1)
                    continue
                if saved and saved['state'] == 'calling':
                    raise RuntimeError('Previous inference outcome is uncertain; refusing automatic repeat')
                if not saved:
                    if sum(c['inputEstimate'] + c['outputReserve'] for c in plan['chunks'][chunk['index']:]) + plan['tokensUsed'] > approved:
                        raise RuntimeError('Remaining approved allowance does not cover pending requests')
                    _write(checkpoint, {'state': 'calling', 'requestHash': chunk['requestHash']})
                    con = open_db(db)
                    try:
                        con.execute("UPDATE document_jobs SET is_uncertain=1, stage='inference' WHERE job_id=?", (plan['jobId'],))
                        con.commit()
                    finally:
                        con.close()
            if not saved:
                request = chunk['request']
                headers = {'Content-Type': 'application/json'}
                if profile.api_key:
                    headers['Authorization'] = 'Bearer ' + profile.api_key
                # Send the approved body unchanged; preserve raw replies and usage before parsing.
                payload = client._send_with_retries('POST', profile.base_url.rstrip('/') + '/chat/completions', headers, request)
                response = _parse_response(payload, profile.model)
                saved = {'state': 'response', 'requestHash': chunk['requestHash'],
                         'content': response.content, 'model': response.model,
                         'inputTokens': response.input_tokens, 'outputTokens': response.output_tokens,
                         'finishReason': response.finish_reason}
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
            if saved.get('finishReason') not in {None, 'stop', 'end_turn'}:
                raise RuntimeError('Incomplete provider response; source remains searchable, enrichment incomplete')
            proposal = parse_json_content(saved['content'])
            if not isinstance(proposal, dict):
                raise ValueError('Provider proposal is not an object')
            proposal.update(id='prop-' + plan['planHash'][:20] + '-' + str(chunk['index']),
                created_at=datetime.now(timezone.utc).isoformat(), status='pending',
                source={'kind': 'raw_file', 'path': plan['rawPath'], 'sha256': plan['rawSha256']},
                produced_by={'provider_profile': plan['route']['profile'], 'model': saved['model'],
                             'prompt_version': 'document-manifest-v1:' + chunk['requestHash']})
            for op in proposal.get('operations', []):
                if 'source_span' in op:
                    span = op['source_span']
                    if span.get('path') != plan['rawPath'] or not chunk['startLine'] <= span.get('start_line', 0) <= span.get('end_line', 0) <= chunk['endLine']:
                        raise ValueError('Proposal citation is outside the approved primary source range')
            fill_create_page_frontmatter(proposal)
            errors = validate_proposal_dict(proposal)
            if errors:
                raise ValueError('Provider proposal rejected: ' + '; '.join(str(e) for e in errors))
            proposal_path = vault / '.octopus-kb' / 'proposals' / (proposal['id'] + '.json')
            with publication_guard(vault, plan, attempt):
                existing_id = proposal['id'] + ('-recovery-' + str(saved['applyAttempt']) if saved.get('applyAttempt') else '')
                existing_audit = audit.find_entry(vault, existing_id)
                if existing_audit is not None:
                    audit_state = json.loads(existing_audit.read_text(encoding='utf-8'))['status']
                    if audit_state == 'pending':
                        recover_proposal(existing_id, vault)
                        audit_state = 'rolled_back'
                    if audit_state == 'rolled_back':
                        saved['applyAttempt'] = saved.get('applyAttempt', 0) + 1
                        _write(checkpoint, saved)
                if saved.get('applyAttempt'):
                    proposal['id'] += '-recovery-' + str(saved['applyAttempt'])
                    proposal_path = proposal_path.with_name(proposal['id'] + '.json')
                _write(proposal_path, proposal)
                result = validate_proposal_file(proposal_path, vault, apply=True,
                            commit_guard=lambda: publication_guard(vault, plan, attempt))
                if result.status not in {'applied', 'already_applied'}:
                    raise RuntimeError('Wiki publication ' + result.status)
                saved['state'] = 'applied'
                _write(checkpoint, saved)
                plan['completedChunks'] = chunk['index'] + 1
                # Only provider-reported usage is represented as billed usage.
                _write(plan_path, plan)
                update_job_checkpoint(db, plan['jobId'], attempt, plan['completedChunks'],
                                      plan['completedChunks'], plan['tokensUsed'], stage='enriching')
        with publication_guard(vault, plan, attempt):
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
        job = get_job(vault / '.octopus-kb' / 'documents.sqlite', req['jobId']) if req.get('jobId') else None
        if job and (job['documentId'] != req['documentId'] or job['libraryId'] != req['libraryId']):
            raise ValueError('Conversion job belongs to another document')
        status = 'cancelled' if job and job['status'] == 'cancelled' else req.get('conversionStatus', 'failed')
        error = req.get('error', 'Conversion did not produce searchable text')
        if job and job['status'] not in {'cancelled', 'failed', 'completed'}:
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
    if action == 'original':
        revision = get_source_revision(db, doc['activeRevisionId'])
        if not revision:
            raise ValueError('Original source is unavailable')
        rel = revision['objectPath']
    else:
        plan = json.loads(_plan_path(vault, req['documentId']).read_text(encoding='utf-8'))
        rel = plan['rawPath'] if action == 'text' else _plan_path(vault, req['documentId']).relative_to(vault).as_posix()
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
        if raw_rel:
            try:
                _safe_raw(vault, raw_rel)
                con = open_db(db)
                try:
                    searchable = con.execute('SELECT 1 FROM raw_documents WHERE rel_path=?', (raw_rel,)).fetchone() is not None
                finally:
                    con.close()
            except (ValueError, OSError):
                searchable = False
        row = {'id': document_id, 'documentId': document_id, 'libraryId': req['libraryId'],
               'filename': doc.get('displayFilename', ''), 'revisionId': revision_id,
               'originalAvailable': available, 'searchable': searchable,
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
        return execute_document(req)
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
