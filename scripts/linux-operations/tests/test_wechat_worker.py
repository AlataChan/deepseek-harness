"""Use the deployed Gamma queue/transaction and a fake desktop; no messages are sent."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest

spec = importlib.util.spec_from_file_location('octopus_worker', Path(__file__).parents[1] / 'wechat_worker.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

from gamma_cn.moments.delivery import Queue, run_one


class Desktop:
    submissions = []
    fail_after_submit = False

    def __init__(self, config):
        self.config = config

    def identity(self):
        return worker.sha(self.config['account_id'])

    def _open_recipient(self, recipient):
        if recipient != self.config['recipient_id']:
            raise ValueError('recipient_mismatch')

    def prepare(self, text, recipient, *, trade_date):
        self.text = text
        return {'text': text, 'recipient_id': recipient, 'account_sha256': self.identity()}

    def preflight(self):
        return True

    def submit(self):
        self.submissions.append(self.text)
        if self.fail_after_submit:
            raise RuntimeError('uncertain_submission')

    def verify(self, text, recipient):
        return text == self.text and recipient == self.config['recipient_id']


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / 'adhoc' / 'outbox').mkdir(parents=True)
        (self.root / 'adhoc' / 'receipts').mkdir()
        (self.root / 'receipts').mkdir()
        self.config = {'enabled': True, 'direct_enabled': True, 'account_id': 'own-id', 'recipient_id': 'bound-id'}
        Desktop.submissions = []
        Desktop.fail_after_submit = False

    def job(self, identifier='a' * 24, text='first'):
        now = int(time.time() * 1000)
        job = {'schema_version': 1, 'kind': 'send', 'job_id': identifier, 'account_sha256': worker.sha('own-id'),
               'recipient_id': 'bound-id', 'recipient_alias': '默认联系人', 'text': text,
               'text_sha256': worker.sha(text), 'created_at': now, 'expires_at': now + 600000,
               'confirmation_request_id': 'authenticated-request'}
        path = self.root / 'adhoc' / 'outbox' / (identifier + '.json')
        path.write_text(json.dumps(job))
        path.chmod(0o640)
        return path

    def run_job(self, path):
        return worker.process_job(path, self.root, self.config, Queue, run_one, Desktop, trusted_uid=os.getuid())

    def test_multiple_same_day_messages_and_duplicate_ticks(self):
        first = self.job()
        self.assertEqual(self.run_job(first)['state'], 'sent_verified')
        self.assertEqual(self.run_job(first)['state'], 'sent_verified')
        self.assertEqual(self.run_job(self.job('b' * 24, 'second'))['state'], 'sent_verified')
        self.assertEqual(Desktop.submissions, ['first', 'second'])

    def test_crash_after_click_is_uncertain_and_never_replayed(self):
        path = self.job()
        Desktop.fail_after_submit = True
        self.assertEqual(self.run_job(path)['state'], 'needs_review')
        Desktop.fail_after_submit = False
        self.assertEqual(self.run_job(path)['state'], 'needs_review')
        self.assertEqual(Desktop.submissions, ['first'])

    def test_worker_restart_during_preparation_does_not_type_again(self):
        path = self.job()
        worker.save(self.root / 'adhoc' / 'receipts' / path.name, {'state': 'prepared'})
        self.assertEqual(self.run_job(path)['state'], 'needs_review')
        self.assertEqual(Desktop.submissions, [])

    def test_shared_account_lock_blocks_another_ui_owner(self):
        path = self.job()
        queue = Queue(self.root / 'outbox', self.root / 'receipts')
        with queue.lock(worker.sha('own-id')):
            self.assertEqual(self.run_job(path)['state'], 'busy')
        self.assertEqual(Desktop.submissions, [])
        self.assertEqual(self.run_job(path)['state'], 'sent_verified')

    def test_changed_recipient_or_content_is_refused(self):
        path = self.job()
        value = json.loads(path.read_text())
        value['text'] = 'changed'
        path.write_text(json.dumps(value))
        self.assertEqual(self.run_job(path)['state'], 'refused')
        self.assertEqual(Desktop.submissions, [])

    def test_expiry_and_untrusted_writable_files_are_refused(self):
        path = self.job()
        value = json.loads(path.read_text())
        value['expires_at'] = value['created_at'] - 1
        path.write_text(json.dumps(value))
        self.assertEqual(self.run_job(path)['state'], 'refused')
        other = self.job('c' * 24)
        other.chmod(0o666)
        self.assertEqual(self.run_job(other)['state'], 'refused')

    def test_identity_probe_never_submits(self):
        path = self.job()
        value = json.loads(path.read_text())
        value['kind'] = 'probe'
        path.write_text(json.dumps(value))
        self.assertEqual(self.run_job(path)['state'], 'identity_verified')
        self.assertEqual(Desktop.submissions, [])

    def test_label_fallback_requires_unique_visual_evidence(self):
        rows = [{'text': '其他文字', 'box': (0, 0, 10, 10)}]
        restored = worker.label_rows(rows, object(), object(), lambda image, template: (20, 30, 40, 15))
        self.assertEqual(restored[-1], {'text': '朋友资料', 'box': (20, 30, 40, 15)})
        def missing(image, template):
            raise ValueError('visual_anchor_not_unique')
        self.assertEqual(worker.label_rows(rows, object(), object(), missing), rows)
        self.assertEqual(worker.label_rows(restored, object(), object(), missing), restored)

    def test_separate_id_value_is_targeted_only_when_unique_and_aligned(self):
        label = {'text': '微信号', 'box': (100, 108, 37, 20)}
        value = {'text': 'bound-id', 'box': (154, 112, 60, 14)}
        self.assertEqual(worker.recipient_id_rows([label, value], 'bound-id')[0]['box'], value['box'])
        self.assertEqual(worker.recipient_id_rows([label, value], 'other-id'), [label, value])
        duplicate = {**value, 'box': (155, 112, 60, 14)}
        self.assertEqual(worker.recipient_id_rows([label, value, duplicate], 'bound-id'), [label, value, duplicate])
        lower = {**value, 'box': (154, 160, 60, 14)}
        self.assertEqual(worker.recipient_id_rows([label, lower], 'bound-id'), [label, lower])


if __name__ == '__main__':
    unittest.main()
