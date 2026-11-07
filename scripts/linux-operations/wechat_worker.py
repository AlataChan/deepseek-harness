"""Single desktop owner: retain Gamma daily jobs and consume separately authorized ad-hoc jobs."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import tempfile
import threading
import time
from zoneinfo import ZoneInfo


def sha(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def save(path, value):
    """Flush one receipt and its directory before returning."""
    path = Path(path)
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent, delete=False) as stream:
        os.chmod(stream.name, 0o600)
        json.dump(value, stream, ensure_ascii=False)
        stream.flush()
        os.fsync(stream.fileno())
        temporary = stream.name
    try:
        os.replace(temporary, path)
        fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def document(path):
    path = Path(path)
    if path.is_symlink() or path.stat().st_size > 16384:
        raise ValueError('unsafe_document')
    value = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(value, dict):
        raise ValueError('invalid_document')
    return value


def validate_job(path, config, now_ms, trusted_uid=0):
    """Accept immutable root-owned jobs only; models cannot write this outbox."""
    path = Path(path)
    metadata = path.lstat()
    if path.is_symlink() or metadata.st_uid != trusted_uid or metadata.st_mode & 0o022:
        raise ValueError('untrusted_job_owner')
    job = document(path)
    required = {'schema_version', 'kind', 'job_id', 'account_sha256', 'recipient_id', 'recipient_alias',
                'text', 'text_sha256', 'created_at', 'expires_at', 'confirmation_request_id'}
    if set(job) != required or job['schema_version'] != 1 or job['kind'] not in {'send', 'probe'}:
        raise ValueError('invalid_job_fields')
    if not re.fullmatch('[0-9a-f]{24}', job['job_id']) or path.name != job['job_id'] + '.json':
        raise ValueError('invalid_job_id')
    if (not isinstance(job['text'], str) or len(job['text'].encode('utf-8')) > 4096
            or sha(job['text']) != job['text_sha256'] or '\0' in job['text']):
        raise ValueError('invalid_text')
    if job['kind'] == 'send' and (not job['text'].strip() or not isinstance(job['confirmation_request_id'], str) or not job['confirmation_request_id']):
        raise ValueError('missing_send_authorization')
    if (job['account_sha256'] != sha(config['account_id']) or job['recipient_id'] != config['recipient_id']
            or config.get('enabled') is not True or config.get('direct_enabled') is not True):
        raise ValueError('identity_or_policy_changed')
    if type(job['created_at']) is not int or type(job['expires_at']) is not int:
        raise ValueError('invalid_time')
    if job['created_at'] > now_ms or job['expires_at'] <= now_ms or not 0 < job['expires_at'] - job['created_at'] <= 1800000:
        raise ValueError('expired')
    return job


def label_rows(rows, image, template, matcher):
    """Restore only the pinned non-identity label when exact pixel matching proves its presence."""
    if any(row['text'] == '朋友资料' for row in rows):
        return rows
    try:
        box = matcher(image, template)
    except Exception:
        return rows
    return rows + [{'text': '朋友资料', 'box': box}]


def compatible_desktop(desktop_class, friend_label_anchor):
    if not friend_label_anchor:
        return desktop_class

    class CompatibleDesktop(desktop_class):
        def capture(self, window):
            image, rows = super().capture(window)
            if window['box'][2] == 292 and not any(row['text'] == '朋友资料' for row in rows):
                from PIL import Image
                import numpy as np
                from gamma_cn.moments.desktop import find_template
                template = np.array(Image.open(friend_label_anchor).convert('RGB'))
                rows = label_rows(rows, image, template, find_template)
            if window['box'][2] == 292:
                rows = recipient_id_rows(rows, self.config['recipient_id'])
            return image, rows

    return CompatibleDesktop


def recipient_id_rows(rows, expected):
    """Target the separate ID value row for copying; clipboard equality remains authoritative."""
    labels = [row for row in rows if '微信号' in row['text']]
    if len(labels) != 1:
        return rows
    label = labels[0]
    x, y, width, height = label['box']
    values = [row for row in rows if row is not label and row['text'].strip() == expected
              and row['box'][0] >= x + width
              and row['box'][0] - x - width <= 40
              and abs(row['box'][1] + row['box'][3] / 2 - y - height / 2) <= 5]
    if len(values) != 1:
        return rows
    return [{**row, 'box': values[0]['box']} if row is label else row for row in rows]


def process_job(path, root, config, queue_class, run_one, desktop_class, clock=time.time, trusted_uid=0, friend_label_anchor=None):
    """Run once under Gamma's existing account lock; uncertain jobs never auto-replay."""
    root = Path(root)
    receipts = root / 'adhoc' / 'receipts'
    receipts.mkdir(parents=True, exist_ok=True, mode=0o700)
    receipt = receipts / (Path(path).stem + '.json')
    previous = document(receipt) if receipt.exists() else None
    if previous:
        if previous.get('state') in {'preparing', 'prepared', 'publishing'}:
            previous.update(state='needs_review', reason='worker_stopped_during_ui_transaction')
            save(receipt, previous)
        return previous
    try:
        job = validate_job(path, config, int(clock() * 1000), trusted_uid)
    except Exception as error:
        result = {'state': 'refused', 'reason': str(error)[:100]}
        save(receipt, result)
        return result
    shared = queue_class(root / 'outbox', root / 'receipts')
    desktop_class = compatible_desktop(desktop_class, friend_label_anchor)
    if job['kind'] == 'probe':
        try:
            with shared.lock(job['account_sha256']):
                desktop = desktop_class(config)
                if desktop.identity() != job['account_sha256']:
                    raise ValueError('account_not_verified')
                desktop._open_recipient(job['recipient_id'])
                result = {'state': 'identity_verified', 'recipient_alias': job['recipient_alias'], 'checked_at': clock()}
        except BlockingIOError:
            return {'state': 'busy'}
        except Exception as error:
            reason = str(error)
            result = {'state': 'auth_required', 'reason': reason if re.fullmatch('[a-z_]{1,100}', reason) else type(error).__name__}
        save(receipt, result)
        return result

    class AdhocQueue(queue_class):
        def load(self, key):
            if key != job['job_id']:
                raise ValueError('job_identity_mismatch')
            return document(receipt) if receipt.exists() else {'state': 'queued', 'attempts': 0}

        def save(self, key, record):
            if key != job['job_id']:
                raise ValueError('job_identity_mismatch')
            save(receipt, record)

        def read_job(self, key):
            fresh = validate_job(path, config, int(clock() * 1000), trusted_uid)
            return {**fresh, 'channel': 'direct', 'visibility': 'private',
                    'trade_date': datetime.fromtimestamp(fresh['created_at'] / 1000, ZoneInfo('Asia/Shanghai')).date().isoformat()}

        def lock(self, key, *, producer=False):
            return shared.lock(key, producer=producer)

    class TimedDesktop(desktop_class):
        def preflight(self):
            if int(clock() * 1000) >= job['expires_at']:
                raise ValueError('expired_before_preflight')
            return super().preflight()

        def submit(self):
            if int(clock() * 1000) >= job['expires_at']:
                raise ValueError('expired_before_submit')
            return super().submit()

    queue = AdhocQueue(root / 'adhoc' / 'outbox', receipts)
    return run_one(queue, job['job_id'], TimedDesktop(config))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--legacy-module', choices=['gamma_cn.moments.worker'], required=True)
    parser.add_argument('--poll-seconds', type=int, required=True)
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--friend-label-anchor', type=Path)
    args = parser.parse_args()
    if not 2 <= args.poll_seconds <= 30:
        raise ValueError('invalid_poll_interval')
    from gamma_cn.moments.worker import tick
    from gamma_cn.moments.delivery import Queue, run_one, atomic_json
    from gamma_cn.moments.direct import DirectDesktop
    queue = Queue(args.root / 'outbox', args.root / 'receipts')
    if args.dry_run:
        config = document(args.config)
        jobs = list((args.root / 'adhoc' / 'outbox').glob('*.json'))
        for path in jobs:
            validate_job(path, config, int(time.time() * 1000))
        print(json.dumps({'validated': len(jobs), 'submitted': 0}))
        return
    stopping = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stopping.set())
    signal.signal(signal.SIGINT, lambda *_: stopping.set())
    pid_path = args.root / 'receipts' / 'worker.pid.json'
    with queue.lock(sha('moments-daemon')):
        atomic_json(pid_path, {'pid': os.getpid()})
        next_daily = 0
        try:
            while not stopping.is_set():
                if time.monotonic() >= next_daily:
                    tick(args.root, args.config)
                    next_daily = time.monotonic() + 60
                config = document(args.config)
                for path in sorted((args.root / 'adhoc' / 'outbox').glob('*.json')):
                    if stopping.is_set():
                        break
                    try:
                        process_job(path, args.root, config, Queue, run_one, DirectDesktop, friend_label_anchor=args.friend_label_anchor)
                    except Exception as error:
                        print(json.dumps({'worker_error': type(error).__name__}), flush=True)
                stopping.wait(args.poll_seconds)
        finally:
            pid_path.unlink(missing_ok=True)


if __name__ == '__main__':
    main()
