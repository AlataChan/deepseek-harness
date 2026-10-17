"""Fault-injection controls for preserving curated wiki indexes during publication."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from contextlib import contextmanager

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'python'))
from documents import pipeline


class IndexPublicationControls(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.TemporaryDirectory()
        self.addCleanup(self.root.cleanup)
        self.vault = Path(self.root.name)
        (self.vault / 'wiki').mkdir()
        self.index = self.vault / 'wiki/INDEX.md'
        self.original = '# Topics\n\nHUMAN_CURATED_INDEX_CONTENT\n'
        self.index.write_text(self.original, encoding='utf-8')
        self.proposal = {'operations': [{'op': 'create_page', 'path': 'wiki/NewPage.md',
                                       'frontmatter': {'title': 'NewPage'}}]}

    def publish(self):
        pipeline._link_accepted_pages_to_index(self.vault, self.proposal)

    def test_interrupted_staging_write_preserves_index(self):
        fdopen = pipeline.os.fdopen

        @contextmanager
        def interrupted_file(*args, **kwargs):
            with fdopen(*args, **kwargs) as stream:
                class InterruptedWriter:
                    def write(self, text):
                        stream.write(text[:10])
                        raise OSError('interrupted staging write')
                yield InterruptedWriter()

        with patch.object(pipeline.os, 'fdopen', interrupted_file):
            with self.assertRaisesRegex(OSError, 'interrupted staging write'):
                self.publish()
        self.assertEqual(self.index.read_text(), self.original)
        self.assertEqual(list(self.index.parent.glob('.index-*')), [])
        self.publish()
        self.assertIn(self.original, self.index.read_text())
        self.assertEqual(self.index.read_text().count('[[NewPage]]'), 1)

    def test_failed_replace_and_resume_preserve_curated_edits(self):
        with patch.object(pipeline.os, 'replace', side_effect=OSError('publication failed')):
            with self.assertRaisesRegex(OSError, 'publication failed'):
                self.publish()
        self.assertEqual(self.index.read_text(), self.original)
        self.index.write_text(self.original + 'LATER_MANUAL_EDIT\n', encoding='utf-8')
        self.publish()
        self.publish()
        content = self.index.read_text()
        self.assertIn('HUMAN_CURATED_INDEX_CONTENT', content)
        self.assertIn('LATER_MANUAL_EDIT', content)
        self.assertEqual(content.count('[[NewPage]]'), 1)

    def test_observed_concurrent_edit_refuses_replacement(self):
        fsync = pipeline.os.fsync
        edited = self.original + 'CONCURRENT_MANUAL_EDIT\n'

        def edit_during_flush(fd):
            self.index.write_text(edited, encoding='utf-8')
            fsync(fd)

        with patch.object(pipeline.os, 'fsync', edit_during_flush):
            with self.assertRaisesRegex(RuntimeError, 'index changed'):
                self.publish()
        self.assertEqual(self.index.read_text(), edited)
        self.publish()
        self.assertIn(edited, self.index.read_text())
        self.assertIn('[[NewPage]]', self.index.read_text())


if __name__ == '__main__':
    result = unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(IndexPublicationControls))
    print(json.dumps({'passed': result.testsRun - len(result.failures) - len(result.errors), 'tests': result.testsRun}))
    sys.exit(0 if result.wasSuccessful() else 1)
