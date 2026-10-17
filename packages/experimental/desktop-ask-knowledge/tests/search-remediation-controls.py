"""Synthetic search authorization, quotation, budgeting, and full-reading controls."""
import base64
import gc
import hashlib
import hmac
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
import warnings

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'python'))
from documents.search import decode_cursor, fold_with_mapping, index_raw_vault, make_cursor, read_passage, search_passages


class SearchRemediation(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='search-remediation-')
        self.vault = Path(self.temp.name) / 'vault'
        (self.vault / 'raw').mkdir(parents=True)

    def tearDown(self):
        self.temp.cleanup()

    def put(self, text, name='source.md'):
        path = self.vault / 'raw' / name
        path.write_text(text, encoding='utf-8')
        return path

    def test_unicode_spans_reconstruct_expansion_composition_and_radicals(self):
        for raw, query, expected in [('ß' * 500 + 'UNIQUE_FACT', 'unique_fact', 'UNIQUE_FACT'),
                                     ('prefix e\u0301 suffix', 'é', 'e\u0301'),
                                     ('⼀⽼⼀⼩', '一老一小', '⼀⽼⼀⼩'),
                                     ('ﬁnal ＡＢＣ', 'final abc', 'ﬁnal ＡＢＣ')]:
            with self.subTest(raw=raw[-30:]):
                folded, mapping = fold_with_mapping(raw)
                start = folded.index(query)
                span = raw[min(p[0] for p in mapping[start:start + len(query)]):max(p[1] for p in mapping[start:start + len(query)])]
                self.assertEqual(span, expected)

    def test_first_excerpt_contains_a_late_hit_when_allowance_can_fit_it(self):
        self.put('x' * 700 + 'NEEDLE' + 'z' * 700)
        result = search_passages(self.vault, ['NEEDLE'], max_chars=64, max_bytes=3000)
        self.assertTrue(any('NEEDLE' in item['text'] for item in result['items']), result)

    def test_read_continuations_reconstruct_every_character_without_overlap(self):
        original = '# Header\n' + '前文' * 500 + 'NEEDLE' + '后文' * 600
        self.put(original)
        result = search_passages(self.vault, ['NEEDLE'], max_chars=64)
        passage = next(item['passageId'] for item in result['items'])
        chunks = []
        cursor = None
        seen = set()
        for _ in range(200):
            result = read_passage(self.vault, passage, cursor, max_chars=73)
            chunks.extend(item['text'] for item in result['items'])
            cursor = result['cursor']
            if cursor is None:
                break
            self.assertNotIn(cursor, seen)
            seen.add(cursor)
        else:
            self.fail('continuation did not terminate')
        self.assertEqual(''.join(chunks), original)

    def test_match_survives_serialized_byte_shrinking_when_the_hit_can_fit(self):
        self.put('# ' + '题' * 7000 + '\nNEEDLE')
        result = search_passages(self.vault, ['NEEDLE'], max_chars=24000, max_bytes=1500)
        self.assertTrue(any('NEEDLE' in item['text'] for item in result['items']), result)

    def test_full_passage_read_counts_metadata_and_unicode_bytes(self):
        original = '检索文本' * 1500 + 'NEEDLE'
        self.put(original)
        passage = search_passages(self.vault, ['NEEDLE'])['items'][0]['passageId']
        cursor = None
        collected = []
        for _ in range(100):
            result = read_passage(self.vault, passage, cursor, max_chars=100000, max_bytes=1024)
            self.assertLessEqual(len(json.dumps(result, ensure_ascii=False).encode()), 1024)
            self.assertTrue(result['items'][0]['text'])
            collected.append(result['items'][0]['text'])
            cursor = result['cursor']
            if cursor is None:
                break
        else:
            self.fail('bounded read did not finish')
        self.assertEqual(''.join(collected), original)

    def test_read_rejects_nonpositive_allowance_instead_of_repeating_cursor(self):
        self.put('NEEDLE')
        passage = search_passages(self.vault, ['NEEDLE'])['items'][0]['passageId']
        for allowance in [0, -1]:
            with self.subTest(allowance=allowance), self.assertRaises(ValueError):
                read_passage(self.vault, passage, max_chars=allowance)

    def test_public_key_forgery_and_authenticated_invalid_offsets_are_refused(self):
        self.put('NEEDLE ' * 500)
        result = search_passages(self.vault, ['NEEDLE'], max_chars=30)
        token = result['cursor']
        self.assertIsNotNone(token)
        payload, _ = base64.urlsafe_b64decode(token).split(b'.', 1)
        forged = base64.urlsafe_b64encode(payload + b'.' + hmac.new(b'octopus-kb-cursor-v1', payload, hashlib.sha256).hexdigest()[:16].encode()).decode()
        with self.assertRaises(ValueError):
            search_passages(self.vault, ['NEEDLE'], cursor=forged)
        qhash = json.loads(payload)['q']
        for passage_offset, text_offset in [(-1, 0), (0, -1), (100, 0), (0, 999999)]:
            bad = make_cursor(str(self.vault), result['generation_id'], qhash, passage_offset, text_offset=text_offset)
            with self.subTest(offset=(passage_offset, text_offset)), self.assertRaises(ValueError):
                search_passages(self.vault, ['NEEDLE'], cursor=bad)
        self.assertEqual((self.vault / '.octopus-kb' / 'cursor.key').stat().st_mode & 0o777, 0o600)

    def test_different_query_arrays_cannot_reuse_an_ambiguous_joined_identity(self):
        self.put('ALPHA BETA GAMMA ' * 200)
        result = search_passages(self.vault, ['ALPHA BETA', 'GAMMA'], max_chars=20)
        self.assertIsNotNone(result['cursor'])
        with self.assertRaises(ValueError):
            search_passages(self.vault, ['ALPHA', 'BETA GAMMA'], cursor=result['cursor'], max_chars=20)

    def test_handwritten_wiki_remains_searchable_and_fresh_without_raw_pages(self):
        wiki = self.vault / 'wiki'
        wiki.mkdir()
        path = wiki / 'handwritten.md'
        path.write_text('# Manual entry\nALPHA private editorial text')
        (wiki / 'INDEX.md').write_text('OPERATIONAL_ONLY index text')
        (wiki / 'LOG.md').write_text('OPERATIONAL_ONLY runtime journal')
        result = search_passages(self.vault, ['ALPHA'])
        self.assertTrue(any(item['path'] == 'wiki/handwritten.md' for item in result['items']))
        self.assertEqual(search_passages(self.vault, ['OPERATIONAL_ONLY'])['items'], [])
        original = path.stat()
        path.write_text('# Manual entry\nOMEGA private editorial text')
        os.utime(path, ns=(original.st_atime_ns, original.st_mtime_ns))
        self.assertTrue(search_passages(self.vault, ['OMEGA'])['items'])
        self.assertEqual(search_passages(self.vault, ['ALPHA'])['items'], [])

    def test_same_size_and_mtime_replacement_invalidates_hash(self):
        path = self.put('alpha')
        index_raw_vault(self.vault)
        original = path.stat()
        path.write_text('omega')
        os.utime(path, ns=(original.st_atime_ns, original.st_mtime_ns))
        self.assertTrue(search_passages(self.vault, ['omega'])['items'])
        self.assertEqual(search_passages(self.vault, ['alpha'])['items'], [])

    def test_removed_file_and_removed_raw_directory_are_not_searchable(self):
        path = self.put('UNIQUE_NEEDLE')
        index_raw_vault(self.vault)
        path.unlink()
        self.assertEqual(search_passages(self.vault, ['UNIQUE_NEEDLE'])['items'], [])
        self.put('UNIQUE_NEEDLE')
        index_raw_vault(self.vault)
        shutil.rmtree(self.vault / 'raw')
        self.assertEqual(search_passages(self.vault, ['UNIQUE_NEEDLE'])['items'], [])

    def test_leaf_and_ancestor_links_are_refused_without_resource_leaks(self):
        outside = Path(self.temp.name) / 'outside'
        outside.mkdir()
        (outside / 'private.md').write_text('PRIVATE_NEEDLE')
        for component in ['leaf', 'ancestor', 'root']:
            with self.subTest(component=component):
                shutil.rmtree(self.vault / 'raw')
                (self.vault / 'raw').mkdir()
                if component == 'leaf':
                    (self.vault / 'raw' / 'linked.md').symlink_to(outside / 'private.md')
                elif component == 'ancestor':
                    (self.vault / 'raw' / 'nested').symlink_to(outside, target_is_directory=True)
                else:
                    (self.vault / 'raw').rmdir()
                    (self.vault / 'raw').symlink_to(outside, target_is_directory=True)
                with warnings.catch_warnings(record=True) as captured:
                    warnings.simplefilter('always', ResourceWarning)
                    try:
                        result = search_passages(self.vault, ['PRIVATE_NEEDLE'])
                    except (ValueError, RuntimeError):
                        pass
                    else:
                        self.assertEqual(result['items'], [])
                    gc.collect()
                    self.assertEqual([str(w.message) for w in captured if issubclass(w.category, ResourceWarning)], [])
                if component == 'root':
                    (self.vault / 'raw').unlink()
                    (self.vault / 'raw').mkdir()

    def test_entire_json_payload_obeys_byte_allowance_with_long_unicode_title(self):
        self.put('# ' + '题' * 7000 + '\nNEEDLE')
        for budget in [1024, 2000, 5000]:
            with self.subTest(budget=budget):
                result = search_passages(self.vault, ['NEEDLE'], max_chars=100, max_bytes=budget)
                self.assertLessEqual(len(json.dumps(result, ensure_ascii=False).encode('utf-8')), budget)
                self.assertTrue(result['items'] or result['cursor'])

    def test_new_index_generation_and_changed_document_filter_reject_old_cursor(self):
        self.put('NEEDLE ' * 1000)
        result = search_passages(self.vault, ['NEEDLE'], max_chars=20, document_filter='raw/source.md')
        continued = search_passages(self.vault, ['NEEDLE'], cursor=result['cursor'], max_chars=20, document_filter='raw/source.md')
        self.assertTrue(continued['items'])
        with self.assertRaises(ValueError):
            search_passages(self.vault, ['NEEDLE'], cursor=result['cursor'], document_filter='raw/other.md')
        self.put('NEEDLE different ' * 1000)
        with self.assertRaises(ValueError):
            search_passages(self.vault, ['NEEDLE'], cursor=result['cursor'], document_filter='raw/source.md')


if __name__ == '__main__':
    unittest.main(verbosity=2)
