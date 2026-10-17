"""Document records and source revision storage operations in SQLite.

Provides atomic registration of immutable source revisions and integrity verification.
"""

from __future__ import annotations

import hashlib
import os
import stat
from pathlib import Path
import sqlite3
import time

from .schema import ensure_schema, open_db


def register_source_revision(
    db_path: Path,
    document_id: str,
    library_id: str,
    filename: str,
    sha256_hash: str,
    byte_length: int,
    object_path: str,
    mime_type: str | None = None,
) -> dict:
    """Register or update an immutable source revision atomically in documents.sqlite."""
    con = ensure_schema(db_path)
    try:
        cur = con.cursor()
        now = time.time()
        con.execute("BEGIN IMMEDIATE")
        existing = con.execute("SELECT library_id FROM documents WHERE document_id = ?", (document_id,)).fetchone()
        if existing and existing[0] != library_id:
            con.close()
            raise ValueError("document belongs to another library")

        # Infer mime_type if not provided
        if not mime_type:
            import mimetypes
            if filename.endswith('.md'):
                mime_type = 'text/markdown'
            else:
                guessed, _ = mimetypes.guess_type(filename)
                mime_type = guessed or 'application/octet-stream'

        # Generate revision ID deterministically from document_id + sha256
        rev_id = f"rev-{hashlib.sha256(f'{document_id}:{sha256_hash}'.encode()).hexdigest()[:16]}"

        existing_revision = con.execute(
            "SELECT document_id, library_id, sha256, byte_length, object_path FROM source_revisions WHERE revision_id = ?",
            (rev_id,),
        ).fetchone()
        if existing_revision and tuple(existing_revision) != (document_id, library_id, sha256_hash, byte_length, object_path):
            con.close()
            raise ValueError("immutable source revision identity conflict")

        # Check if document already exists
        cur.execute(
            "SELECT document_id, created_at FROM documents WHERE document_id = ? AND library_id = ?",
            (document_id, library_id),
        )
        doc_row = cur.fetchone()
        if doc_row:
            created_at = doc_row[1]
            cur.execute(
                """
                UPDATE documents
                SET display_filename = ?, active_revision_id = ?, status = 'retained', updated_at = ?
                WHERE document_id = ?
                """,
                (filename, rev_id, now, document_id),
            )
        else:
            created_at = now
            cur.execute(
                """
                INSERT INTO documents (document_id, library_id, display_filename, active_revision_id, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'retained', ?, ?)
                """,
                (document_id, library_id, filename, rev_id, created_at, now),
            )

        # Insert source revision immutably (never replace existing revision)
        cur.execute(
            """
            INSERT OR IGNORE INTO source_revisions (
                revision_id, document_id, library_id, sha256, byte_length,
                original_filename, object_path, status, imported_at, mime_type
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, 'retained', ?, ?)
            """,
            (
                rev_id,
                document_id,
                library_id,
                sha256_hash,
                byte_length,
                filename,
                object_path,
                now,
                mime_type,
            ),
        )

        con.commit()
        con.close()

        return {
            "ok": True,
            "document": {
                "id": document_id,
                "libraryId": library_id,
                "displayFilename": filename,
                "activeRevisionId": rev_id,
                "status": "retained",
                "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(created_at)),
                "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
            },
            "revision": {
                "revisionId": rev_id,
                "documentId": document_id,
                "libraryId": library_id,
                "sha256": sha256_hash,
                "byteLength": byte_length,
                "originalFilename": filename,
                "objectPath": object_path,
                "status": "retained",
                "importedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
                "mimeType": mime_type,
            },
        }
    finally:
        con.close()


def get_document(db_path: Path, document_id: str) -> dict | None:
    if not db_path.is_file():
        return None
    con = open_db(db_path)
    cur = con.cursor()
    cur.execute(
        """
        SELECT document_id, library_id, display_filename, active_revision_id, status, created_at, updated_at
        FROM documents
        WHERE document_id = ?
        """,
        (document_id,),
    )
    row = cur.fetchone()
    con.close()
    if not row:
        return None
    return {
        "id": row[0],
        "libraryId": row[1],
        "displayFilename": row[2],
        "activeRevisionId": row[3],
        "status": row[4],
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(row[5])),
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(row[6])),
    }


def list_documents(db_path: Path, library_id: str) -> list[dict]:
    if not db_path.is_file():
        return []
    con = open_db(db_path)
    cur = con.cursor()
    cur.execute(
        """
        SELECT document_id, library_id, display_filename, active_revision_id, status, created_at, updated_at
        FROM documents
        WHERE library_id = ?
        ORDER BY created_at DESC
        """,
        (library_id,),
    )
    rows = cur.fetchall()
    con.close()
    return [
        {
            "id": row[0],
            "libraryId": row[1],
            "displayFilename": row[2],
            "activeRevisionId": row[3],
            "status": row[4],
            "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(row[5])),
            "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(row[6])),
        }
        for row in rows
    ]


def get_source_revision(db_path: Path, revision_id: str) -> dict | None:
    if not db_path.is_file():
        return None
    con = open_db(db_path)
    cur = con.cursor()
    cur.execute(
        """
        SELECT revision_id, document_id, library_id, sha256, byte_length,
               original_filename, object_path, status, imported_at, mime_type
        FROM source_revisions
        WHERE revision_id = ?
        """,
        (revision_id,),
    )
    row = cur.fetchone()
    con.close()
    if not row:
        return None
    return {
        "revisionId": row[0],
        "documentId": row[1],
        "libraryId": row[2],
        "sha256": row[3],
        "byteLength": row[4],
        "originalFilename": row[5],
        "objectPath": row[6],
        "status": row[7],
        "importedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(row[8])),
        "mimeType": row[9],
    }


def verify_source_integrity(vault_dir: Path, revision_id: str) -> dict:
    """Verify that the immutable stored file on disk matches its registered SHA-256 hash."""
    db_path = vault_dir / ".octopus-kb" / "documents.sqlite"
    rev = get_source_revision(db_path, revision_id)
    if not rev:
        return {"ok": False, "error": f"revision not found: {revision_id}"}

    file_path = vault_dir / rev["objectPath"]
    try:
        root = vault_dir.resolve(strict=True)
        relative_path = file_path.relative_to(vault_dir)
        if relative_path.parts[:2] != (".octopus-kb", "sources") or ".." in relative_path.parts:
            raise ValueError("source path escapes immutable storage")
        current = vault_dir
        for part in relative_path.parts:
            current = current / part
            if current.is_symlink():
                raise ValueError("source path contains a symbolic link")
        file_path.resolve(strict=True).relative_to(root)
    except (ValueError, OSError) as exc:
        return {"ok": True, "revisionId": revision_id, "status": "unavailable", "matches": False, "error": str(exc)}
    if not file_path.is_file():
        return {
            "ok": True,
            "revisionId": revision_id,
            "status": "unavailable",
            "matches": False,
            "error": f"stored object missing at {file_path}",
        }

    try:
        descriptor = os.open(file_path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(descriptor, "rb") as source:
            if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
                raise ValueError("source object is not a regular file")
            content = source.read()
        actual_hash = hashlib.sha256(content).hexdigest()
        actual_len = len(content)
        matches = (actual_hash == rev["sha256"]) and (actual_len == rev["byteLength"])
        return {
            "ok": True,
            "revisionId": revision_id,
            "status": "retained" if matches else "corrupt",
            "matches": matches,
            "expectedSha256": rev["sha256"],
            "actualSha256": actual_hash,
            "expectedLength": rev["byteLength"],
            "actualLength": actual_len,
        }
    except Exception as exc:  # noqa: BLE001
        return {"ok": True, "revisionId": revision_id, "status": "corrupt", "matches": False, "error": str(exc)}
