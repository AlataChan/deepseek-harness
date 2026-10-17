"""Legacy library migration and metadata synchronization.

Imports existing raw Markdown pages as legacy source revisions with
status='original_unavailable', indexing full text into raw_passages,
preserving existing wiki pages, hand-written edits, aliases, and library IDs.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
import sqlite3
import os
import time
from typing import Any

from .schema import ensure_schema, open_db, SCHEMA_VERSION
from .search import index_raw_vault


def _sync_directory(path: Path) -> None:
    """Persist backup directory entries where directory fsync is supported."""
    if os.name == "nt":
        return
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _discard_safe_stale_backup(db_path: Path, bak_path: Path) -> None:
    """Discard an interrupted-run backup only after validating the live database."""
    if db_path.is_symlink() or bak_path.is_symlink() or not db_path.is_file() or not bak_path.is_file():
        raise ValueError("migration backup recovery requires regular live database and backup files")
    con = sqlite3.connect(db_path.resolve().as_uri() + '?mode=ro', uri=True)
    try:
        if con.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
            raise ValueError('live database integrity check failed; migration backup preserved')
        tables = {row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not {'schema_info', 'documents', 'source_revisions'}.issubset(tables):
            raise ValueError('live database has no complete document schema; migration backup preserved')
        version = con.execute("SELECT value FROM schema_info WHERE key='schema_version'").fetchone()
        if not version or not 1 <= int(version[0]) <= SCHEMA_VERSION:
            raise ValueError('live database schema version is unsupported; migration backup preserved')
        if con.execute('PRAGMA foreign_key_check').fetchall():
            raise ValueError('live database references are invalid; migration backup preserved')
    finally:
        con.close()
    bak_path.unlink()
    _sync_directory(bak_path.parent)


def migrate_legacy_library(
    vault: Path,
    library_id: str,
) -> dict[str, Any]:
    """Migrate legacy library raw markdown files to documents.sqlite store and passage index.

    Preserves existing wiki pages, raw files, and hand-written edits.
    Marks legacy sources with status='original_unavailable'.
    Performs atomic activation and stops safely on corruption or future schemas.
    """
    db_path = vault / ".octopus-kb" / "documents.sqlite"
    bak_path = vault / ".octopus-kb" / "documents.sqlite.bak"

    existed = db_path.is_file()
    if bak_path.exists() or bak_path.is_symlink():
        try:
            _discard_safe_stale_backup(db_path, bak_path)
        except Exception as exc:
            return {"ok": False, "code": "backup-recovery-required",
                    "error": "an earlier migration backup requires recovery: " + str(exc), "backupPath": str(bak_path)}

    # Back up a coherent committed snapshot, including frames still in the WAL.
    if db_path.is_file():
        try:
            source = sqlite3.connect(str(db_path))
            backup = sqlite3.connect(str(bak_path))
            try:
                source.backup(backup)
                backup.commit()
            finally:
                backup.close()
                source.close()
            with bak_path.open("r+b") as saved:
                os.fsync(saved.fileno())
            _sync_directory(bak_path.parent)
        except Exception as exc:
            return {
                "ok": False,
                "error": f"failed to create backup: {exc}",
                "code": "backup-failed",
            }

    raw_dir = vault / "raw"
    if not raw_dir.is_dir():
        raw_dir.mkdir(parents=True, exist_ok=True)

    now = time.time()
    migrated_count = 0
    total_docs = 0

    con = None
    try:
        if raw_dir.is_symlink():
            raise ValueError("legacy raw directory contains a symbolic link")
        raw_dir.resolve(strict=True).relative_to(vault.resolve(strict=True))
        con = ensure_schema(db_path)
        cur = con.cursor()

        managed_paths = set()
        for row in cur.execute('SELECT document_id, revision_id, object_path FROM source_revisions WHERE library_id=?', (library_id,)):
            managed_paths.add(row[2])
            managed_paths.add(f'raw/{row[0]}-{row[1]}.md')

        # Find all markdown files in raw/
        md_files = sorted(raw_dir.glob("**/*.md"))

        for file_path in md_files:
            current = raw_dir
            for part in file_path.relative_to(raw_dir).parts:
                current = current / part
                if current.is_symlink():
                    raise ValueError("legacy source path contains a symbolic link")
            file_path.resolve(strict=True).relative_to(raw_dir.resolve(strict=True))
            rel_path = f"raw/{file_path.relative_to(raw_dir).as_posix()}"
            total_docs += 1
            if rel_path in managed_paths:
                continue

            stat = file_path.stat()
            content_bytes = file_path.read_bytes()
            sha256_hash = hashlib.sha256(content_bytes).hexdigest()
            byte_length = len(content_bytes)
            mtime = stat.st_mtime

            # Deterministic IDs
            doc_id = f"doc-legacy-{hashlib.sha256(f'{library_id}:{rel_path}'.encode()).hexdigest()[:12]}"
            rev_id = f"rev-legacy-{hashlib.sha256(f'{rel_path}:{sha256_hash}'.encode()).hexdigest()[:12]}"

            # Check if document already exists
            cur.execute(
                "SELECT document_id, active_revision_id FROM documents WHERE document_id = ? AND library_id = ?",
                (doc_id, library_id),
            )
            existing_doc = cur.fetchone()

            if existing_doc is None:
                # Insert document
                cur.execute(
                    """
                    INSERT INTO documents (
                        document_id, library_id, display_filename, active_revision_id,
                        status, created_at, updated_at
                    )
                    VALUES (?, ?, ?, ?, 'retained', ?, ?)
                    """,
                    (doc_id, library_id, file_path.name, rev_id, mtime, now),
                )

                # Insert legacy source revision (original_unavailable)
                cur.execute(
                    """
                    INSERT INTO source_revisions (
                        revision_id, document_id, library_id, sha256, byte_length,
                        original_filename, object_path, status, imported_at, mime_type
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'original_unavailable', ?, 'text/markdown')
                    """,
                    (
                        rev_id,
                        doc_id,
                        library_id,
                        sha256_hash,
                        byte_length,
                        file_path.name,
                        rel_path,
                        now,
                    ),
                )
                migrated_count += 1

        con.commit()
        con.close()
        con = None

        # Index passages for fast full-text retrieval
        index_res = index_raw_vault(vault)
        if index_res.get("ok") is False:
            raise RuntimeError(str(index_res.get("error", "passage indexing failed")))
        total_passages = index_res.get("total_passages", 0)

        # Successful migration: remove temporary backup
        if bak_path.is_file():
            try:
                bak_path.unlink()
            except Exception:
                pass

        return {
            "ok": True,
            "status": "completed",
            "migratedDocuments": migrated_count,
            "totalDocuments": total_docs,
            "totalPassages": total_passages,
            "generationId": index_res.get("generation_id"),
        }

    except Exception as exc:
        if con is not None:
            con.close()
        # Restore through SQLite so committed WAL frames are restored coherently too.
        if bak_path.is_file():
            try:
                backup = sqlite3.connect(str(bak_path))
                target = sqlite3.connect(str(db_path))
                try:
                    backup.backup(target)
                    target.commit()
                finally:
                    target.close()
                    backup.close()
                bak_path.unlink()
            except Exception as restore_error:
                return {"ok": False, "status": "failed", "code": "restore-failed",
                        "error": f"{exc}; restore failed: {restore_error}", "backupPath": str(bak_path)}
        elif not existed:
            for path in (db_path, Path(str(db_path) + "-wal"), Path(str(db_path) + "-shm")):
                path.unlink(missing_ok=True)
        return {
            "ok": False,
            "status": "failed",
            "error": str(exc),
            "code": "migration-failed",
        }
