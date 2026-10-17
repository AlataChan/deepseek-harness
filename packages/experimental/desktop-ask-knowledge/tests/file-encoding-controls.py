"""Exercise UTF-8 durable documents under an emulated Windows file encoding."""
import ast
import hashlib
import io
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

PYTHON = Path(__file__).resolve().parents[1] / 'python'
sys.path[:0] = [str(PYTHON), str(PYTHON / 'kb' / 'src')]
from documents import pipeline
from documents.store import register_source_revision

NATIVE_OPEN = io.open
TEXT = '保存社区培训预算。\n'


def legacy_open(file, mode='r', buffering=-1, encoding=None, *args, **kwargs):
    """Emulate only the default text-file codec; explicit UTF-8 and binary IO stay real."""
    if 'b' not in mode and encoding in (None, 'locale'):
        encoding = 'cp1252'
    return NATIVE_OPEN(file, mode, buffering, encoding, *args, **kwargs)


class DurableFileEncoding(unittest.TestCase):
    def setUp(self):
        directory = self.enterContext(tempfile.TemporaryDirectory())
        self.vault = Path(directory)
        self.enterContext(patch.dict(os.environ, {'OCTOPUS_KB_ROOT': str(PYTHON / 'kb')}))
        self.enterContext(patch('io.open', legacy_open))
        (self.vault / 'raw').mkdir()
        (self.vault / '.octopus-kb').mkdir()
        (self.vault / 'raw' / 'source.md').write_text(TEXT, encoding='utf-8')
        # Ensure this actually rejects a default-codec read on every host.
        with self.assertRaises(UnicodeDecodeError):
            (self.vault / 'raw' / 'source.md').read_text()
        (self.vault / '.octopus-kb' / 'config.toml').write_text(
            'version = 1\n[llm]\ndefault_profile = "test"\n'
            '[llm.profiles.test]\nbase_url = "http://127.0.0.1:9/v1"\nmodel = "test"\n',
            encoding='utf-8')
        revision = register_source_revision(
            self.vault / '.octopus-kb' / 'documents.sqlite', 'doc', 'library', '保存.md',
            hashlib.sha256(TEXT.encode('utf-8')).hexdigest(), len(TEXT.encode('utf-8')), 'raw/source.md')
        self.request = {'vault': str(self.vault), 'documentId': 'doc', 'libraryId': 'library',
                        'revisionId': revision['revision']['revisionId'], 'rawPath': 'raw/source.md'}

    def test_status_locations_retry_and_cancel_preserve_chinese_manifests(self):
        plan = pipeline.plan_document(self.request)
        self.assertEqual(pipeline.document_status(self.request)['documents'][0]['planHash'], plan['planHash'])
        self.assertEqual(pipeline.document_location(self.request)['path'], 'raw/source.md')
        self.assertEqual(pipeline.plan_document(self.request)['planHash'], plan['planHash'])
        path = pipeline._plan_path(self.vault, 'doc')
        pipeline._write(path.parent / (plan['planHash'] + '-0.json'), {'state': 'applied', 'text': TEXT})
        no_pending = pipeline.document_action({**self.request, 'action': 'retry'})
        self.assertEqual(no_pending['planHash'], plan['planHash'])
        pipeline._write(path.parent / (plan['planHash'] + '-0.json'), {'state': 'response', 'content': TEXT})
        retry = pipeline.document_action({**self.request, 'action': 'retry'})
        self.assertNotEqual(retry['planHash'], plan['planHash'])
        self.assertEqual(pipeline.document_action({**self.request, 'action': 'cancel'})['status'], 'cancelled')

    def test_checkpoint_usage_reads_utf8_without_a_provider_call(self):
        path = pipeline._plan_path(self.vault, 'doc')
        pipeline._write(path.parent / 'checkpoint-0.json', {'text': TEXT, 'inputTokens': 31, 'outputTokens': 7})
        self.assertEqual(pipeline._reported_usage(path, {'planHash': 'checkpoint'}), 38)

    def test_conversion_failure_keeps_the_original_chinese_diagnostic(self):
        pipeline.record_conversion({**self.request, 'error': TEXT, 'conversionStatus': 'needs_ocr'})
        row = pipeline.document_status(self.request)['documents'][0]
        self.assertEqual(row['error'], TEXT)
        self.assertEqual(row['conversionStatus'], 'needs_ocr')

    def test_production_path_text_io_declares_utf8(self):
        missing = []
        for path in PYTHON.rglob('*.py'):
            for node in ast.walk(ast.parse(path.read_text(encoding='utf-8'))):
                if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
                    continue
                if node.func.attr not in ('read_text', 'write_text'):
                    continue
                index = 0 if node.func.attr == 'read_text' else 1
                encoding = next((kw.value for kw in node.keywords if kw.arg == 'encoding'), None)
                if encoding is None and len(node.args) > index:
                    encoding = node.args[index]
                if not isinstance(encoding, ast.Constant) or encoding.value not in ('utf-8', 'utf8'):
                    missing.append(f'{path.relative_to(PYTHON)}:{node.lineno}')
        self.assertEqual(missing, [], 'Durable text must not depend on the Host locale')


if __name__ == '__main__':
    unittest.main()
