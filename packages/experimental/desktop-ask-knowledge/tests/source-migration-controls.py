"""Exercise rollback from a SQLite WAL snapshot without copying database files."""
import importlib
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'python'))
from documents.schema import ensure_schema
from documents.store import register_source_revision
migration = importlib.import_module('documents.migrate')


class MigrationDurability(unittest.TestCase):
    def test_failed_index_restores_committed_wal_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            vault = Path(directory)
            (vault / 'raw').mkdir()
            (vault / 'raw' / 'input.md').write_text('# Source\nbody\n')
            db = vault / '.octopus-kb' / 'documents.sqlite'
            writer = ensure_schema(db)
            try:
                writer.execute('CREATE TABLE durable_marker(value TEXT)')
                writer.execute('INSERT INTO durable_marker VALUES (?)', ('committed in WAL',))
                writer.commit()
                self.assertTrue(Path(str(db) + '-wal').is_file())
                with patch.object(migration, 'index_raw_vault', side_effect=RuntimeError('index failed')):
                    result = migration.migrate_legacy_library(vault, 'library')
                self.assertFalse(result['ok'])
                self.assertEqual(writer.execute('SELECT value FROM durable_marker').fetchall(), [('committed in WAL',)])
                self.assertEqual(writer.execute('SELECT count(*) FROM documents').fetchone()[0], 0)
            finally:
                writer.close()

    def test_stale_backup_recovery_reads_committed_wal_state(self):
        with tempfile.TemporaryDirectory() as directory:
            vault = Path(directory)
            (vault / 'raw').mkdir()
            db = vault / '.octopus-kb' / 'documents.sqlite'
            writer = ensure_schema(db)
            try:
                writer.execute('CREATE TABLE durable_marker(value TEXT)')
                writer.execute('INSERT INTO durable_marker VALUES (?)', ('committed WAL source',))
                writer.commit()
                backup = db.with_name('documents.sqlite.bak')
                backup.write_bytes(b'stale backup')
                result = migration.migrate_legacy_library(vault, 'library')
                self.assertTrue(result['ok'], result)
                self.assertFalse(backup.exists())
                self.assertEqual(writer.execute('SELECT value FROM durable_marker').fetchall(), [('committed WAL source',)])
            finally:
                writer.close()

    def test_stale_backup_recovery_can_flush_on_write_required_filesystems(self):
        with tempfile.TemporaryDirectory() as directory:
            vault = Path(directory)
            (vault / 'raw').mkdir()
            db = vault / '.octopus-kb' / 'documents.sqlite'
            ensure_schema(db).close()
            backup = db.with_name('documents.sqlite.bak')
            backup.write_bytes(b'interrupted backup')
            original_open = Path.open
            original_sync = migration.os.fsync
            handles = {}

            def tracked_open(path, *args, **kwargs):
                stream = original_open(path, *args, **kwargs)
                handles[stream.fileno()] = stream
                return stream

            def require_write_access(descriptor):
                stream = handles.get(descriptor)
                if stream is not None and not stream.closed and not stream.writable():
                    raise OSError('flushing requires a writable handle')
                return original_sync(descriptor)

            with patch.object(Path, 'open', tracked_open), patch.object(migration.os, 'fsync', require_write_access):
                result = migration.migrate_legacy_library(vault, 'library')
            self.assertTrue(result['ok'], result)
            self.assertFalse(backup.exists())

    def test_future_schema_preserves_stale_backup_and_live_version(self):
        with tempfile.TemporaryDirectory() as directory:
            vault = Path(directory)
            db = vault / '.octopus-kb' / 'documents.sqlite'
            writer = ensure_schema(db)
            try:
                writer.execute("UPDATE schema_info SET value='999' WHERE key='schema_version'")
                writer.commit()
                backup = db.with_name('documents.sqlite.bak')
                backup.write_bytes(b'preserve recovery bytes')
                result = migration.migrate_legacy_library(vault, 'library')
                self.assertFalse(result['ok'])
                self.assertEqual(result['code'], 'backup-recovery-required')
                self.assertEqual(backup.read_bytes(), b'preserve recovery bytes')
                self.assertEqual(writer.execute("SELECT value FROM schema_info WHERE key='schema_version'").fetchone()[0], '999')
            finally:
                writer.close()

    def test_revision_registration_rejects_changed_immutable_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            db = Path(directory) / "documents.sqlite"
            arguments = (db, "doc-one", "library-one", "file.md", "a" * 64, 8, ".octopus-kb/sources/revision/original")
            register_source_revision(*arguments)
            with self.assertRaisesRegex(ValueError, "identity conflict"):
                register_source_revision(*arguments[:-1], ".octopus-kb/sources/elsewhere/original")
            with self.assertRaisesRegex(ValueError, "another library"):
                register_source_revision(db, "doc-one", "library-two", "file.md", "a" * 64, 8, arguments[-1])
            reader = sqlite3.connect(db)
            try:
                self.assertEqual(reader.execute("SELECT object_path FROM source_revisions").fetchone()[0], arguments[-1])
            finally:
                reader.close()


if __name__ == '__main__':
    unittest.main()
