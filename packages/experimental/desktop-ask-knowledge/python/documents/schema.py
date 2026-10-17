"""SQLite schema definition and migration for Ask Knowledge documents.

Monotonic SCHEMA_VERSION ensures safe backward compatibility and explicit refusal
of unsupported future schemas.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
import time

SCHEMA_VERSION = 1


def open_db(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(db_path), timeout=30.0)
    con.execute("PRAGMA journal_mode = WAL")
    con.execute("PRAGMA foreign_keys = ON")
    return con


def ensure_schema(db_path: Path) -> sqlite3.Connection:
    con = open_db(db_path)
    cur = con.cursor()

    # Check for existing schema_info
    cur.execute(
        "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='schema_info'"
    )
    has_schema_table = cur.fetchone()[0] > 0

    if has_schema_table:
        cur.execute("SELECT value FROM schema_info WHERE key='schema_version'")
        row = cur.fetchone()
        if row:
            try:
                existing_version = int(row[0])
            except ValueError:
                con.close()
                raise RuntimeError(f"corrupt schema version: {row[0]}") from None

            if existing_version > SCHEMA_VERSION:
                con.close()
                raise RuntimeError(
                    f"unsupported future schema version {existing_version} (supported: {SCHEMA_VERSION})"
                )
    else:
        cur.execute(
            """
            CREATE TABLE schema_info (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
            """
        )

    # Base tables for document indexing
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS raw_documents (
            rel_path TEXT PRIMARY KEY,
            content_hash TEXT NOT NULL,
            byte_length INTEGER NOT NULL,
            mtime REAL NOT NULL,
            indexed_at REAL NOT NULL
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS raw_passages (
            passage_id TEXT PRIMARY KEY,
            rel_path TEXT NOT NULL,
            section_title TEXT NOT NULL,
            start_offset INTEGER NOT NULL,
            end_offset INTEGER NOT NULL,
            text TEXT NOT NULL,
            folded_text TEXT NOT NULL,
            FOREIGN KEY(rel_path) REFERENCES raw_documents(rel_path) ON DELETE CASCADE
        )
        """
    )

    cur.execute(
        """
        CREATE VIRTUAL TABLE IF NOT EXISTS raw_passages_fts USING fts5(
            passage_id UNINDEXED,
            rel_path UNINDEXED,
            section_title,
            text,
            folded_text,
            tokenize='trigram'
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS documents (
            document_id TEXT PRIMARY KEY,
            library_id TEXT NOT NULL,
            display_filename TEXT NOT NULL,
            active_revision_id TEXT,
            status TEXT NOT NULL,
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS source_revisions (
            revision_id TEXT PRIMARY KEY,
            document_id TEXT NOT NULL,
            library_id TEXT NOT NULL,
            sha256 TEXT NOT NULL,
            byte_length INTEGER NOT NULL,
            original_filename TEXT NOT NULL,
            object_path TEXT NOT NULL,
            status TEXT NOT NULL,
            imported_at REAL NOT NULL,
            mime_type TEXT,
            FOREIGN KEY(document_id) REFERENCES documents(document_id) ON DELETE CASCADE
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS index_meta (
            generation_id TEXT PRIMARY KEY,
            activated_at REAL NOT NULL,
            passage_count INTEGER NOT NULL,
            status TEXT NOT NULL
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS library_startup_attempts (
            library_id TEXT PRIMARY KEY,
            current_attempt INTEGER NOT NULL DEFAULT 1,
            updated_at REAL NOT NULL
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS document_jobs (
            job_id TEXT PRIMARY KEY,
            library_id TEXT NOT NULL,
            document_id TEXT NOT NULL,
            revision_id TEXT NOT NULL,
            startup_attempt INTEGER NOT NULL,
            stage TEXT NOT NULL,
            status TEXT NOT NULL,
            total_chunks INTEGER NOT NULL DEFAULT 0,
            completed_chunks INTEGER NOT NULL DEFAULT 0,
            current_chunk_index INTEGER NOT NULL DEFAULT 0,
            token_estimate INTEGER NOT NULL DEFAULT 0,
            tokens_used INTEGER NOT NULL DEFAULT 0,
            is_uncertain INTEGER NOT NULL DEFAULT 0,
            error TEXT,
            checkpoint_json TEXT,
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL,
            FOREIGN KEY(document_id) REFERENCES documents(document_id) ON DELETE CASCADE,
            FOREIGN KEY(revision_id) REFERENCES source_revisions(revision_id) ON DELETE CASCADE
        )
        """
    )

    cur.execute(
        "INSERT OR REPLACE INTO schema_info (key, value) VALUES ('schema_version', ?)",
        (str(SCHEMA_VERSION),),
    )
    cur.execute(
        "INSERT OR REPLACE INTO schema_info (key, value) VALUES ('updated_at', ?)",
        (str(time.time()),),
    )

    con.commit()
    return con
