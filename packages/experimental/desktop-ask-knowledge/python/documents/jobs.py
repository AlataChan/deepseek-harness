"""Durable job tracking, resumable checkpoints, and startup attempt fencing.

Prevents stale sidecar publishing across host companion restarts and handles
uncertain paid-call states.
"""

from __future__ import annotations

import json
from pathlib import Path
import sqlite3
import time

from .schema import ensure_schema, open_db
from .commit_lock import serialized_job_mutation


@serialized_job_mutation
def get_or_increment_startup_attempt(
    db_path: Path,
    library_id: str,
    increment: bool = True,
) -> int:
    """Read or increment the monotonic startup attempt for a library."""
    con = ensure_schema(db_path)
    cur = con.cursor()
    now = time.time()

    cur.execute(
        "SELECT current_attempt FROM library_startup_attempts WHERE library_id = ?",
        (library_id,),
    )
    row = cur.fetchone()
    if row is None:
        attempt = 1
        cur.execute(
            """
            INSERT INTO library_startup_attempts (library_id, current_attempt, updated_at)
            VALUES (?, 1, ?)
            """,
            (library_id, now),
        )
    elif increment:
        attempt = row[0] + 1
        cur.execute(
            """
            UPDATE library_startup_attempts
            SET current_attempt = ?, updated_at = ?
            WHERE library_id = ?
            """,
            (attempt, now, library_id),
        )
    else:
        attempt = row[0]

    con.commit()
    con.close()
    return attempt


def verify_startup_attempt(
    db_path: Path,
    library_id: str,
    expected_attempt: int,
) -> bool:
    """Verify that expected_attempt matches the active startup attempt."""
    if not db_path.is_file():
        return False
    con = open_db(db_path)
    cur = con.cursor()
    cur.execute(
        "SELECT current_attempt FROM library_startup_attempts WHERE library_id = ?",
        (library_id,),
    )
    row = cur.fetchone()
    con.close()
    if row is None:
        return False
    return bool(row[0] == expected_attempt)


@serialized_job_mutation
def create_job(
    db_path: Path,
    job_id: str,
    library_id: str,
    document_id: str,
    revision_id: str,
    startup_attempt: int,
    stage: str = "queued",
    total_chunks: int = 0,
    token_estimate: int = 0,
) -> dict:
    """Create a new tracked job, fencing it to the current startup attempt."""
    con = ensure_schema(db_path)
    cur = con.cursor()
    now = time.time()

    cur.execute(
        """
        INSERT INTO document_jobs (
            job_id, library_id, document_id, revision_id, startup_attempt,
            stage, status, total_chunks, completed_chunks, current_chunk_index,
            token_estimate, tokens_used, is_uncertain, error, checkpoint_json,
            created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, 'active', ?, 0, 0, ?, 0, 0, NULL, NULL, ?, ?)
        """,
        (
            job_id,
            library_id,
            document_id,
            revision_id,
            startup_attempt,
            stage,
            total_chunks,
            token_estimate,
            now,
            now,
        ),
    )
    con.commit()
    con.close()
    return {
        "ok": True,
        "jobId": job_id,
        "libraryId": library_id,
        "documentId": document_id,
        "revisionId": revision_id,
        "startupAttempt": startup_attempt,
        "stage": stage,
        "status": "active",
        "totalChunks": total_chunks,
        "completedChunks": 0,
        "currentChunkIndex": 0,
        "tokenEstimate": token_estimate,
        "tokensUsed": 0,
        "isUncertain": False,
    }


@serialized_job_mutation
def update_job_checkpoint(
    db_path: Path,
    job_id: str,
    expected_startup_attempt: int,
    completed_chunks: int,
    current_chunk_index: int,
    tokens_used: int,
    checkpoint_json: str | None = None,
    stage: str | None = None,
) -> dict:
    """Update checkpoint progress, rejecting if startup attempt was superseded."""
    con = ensure_schema(db_path)
    cur = con.cursor()
    now = time.time()

    cur.execute(
        "SELECT library_id, startup_attempt, status FROM document_jobs WHERE job_id = ?",
        (job_id,),
    )
    row = cur.fetchone()
    if row is None:
        con.close()
        raise RuntimeError(f"job not found: {job_id}")

    lib_id, job_attempt, job_status = row
    if job_status in {"cancelled", "failed", "completed"}:
        con.close()
        return {"ok": False, "error": f"job was cancelled: {job_id}"}

    # Verify startup attempt against current active attempt in library
    cur.execute(
        "SELECT current_attempt FROM library_startup_attempts WHERE library_id = ?",
        (lib_id,),
    )
    att_row = cur.fetchone()
    current_lib_attempt = att_row[0] if att_row else 1

    if expected_startup_attempt != current_lib_attempt or job_attempt != expected_startup_attempt:
        con.close()
        raise RuntimeError(
            f"stale startup attempt fencing: expected {expected_startup_attempt}, active {current_lib_attempt}"
        )

    set_clauses = [
        "completed_chunks = ?",
        "current_chunk_index = ?",
        "tokens_used = ?",
        "updated_at = ?",
    ]
    params: list[object] = [completed_chunks, current_chunk_index, tokens_used, now]

    if checkpoint_json is not None:
        set_clauses.append("checkpoint_json = ?")
        params.append(checkpoint_json)
    if stage is not None:
        set_clauses.append("stage = ?")
        params.append(stage)

    params.append(job_id)
    cur.execute(
        f"UPDATE document_jobs SET {', '.join(set_clauses)} WHERE job_id = ?",
        params,
    )
    con.commit()
    con.close()
    return {"ok": True, "jobId": job_id, "completedChunks": completed_chunks}


@serialized_job_mutation
def finish_job(
    db_path: Path,
    job_id: str,
    expected_startup_attempt: int,
    status: str = "completed",
    error: str | None = None,
) -> dict:
    """Mark job completed or failed under startup attempt fencing."""
    con = ensure_schema(db_path)
    cur = con.cursor()
    now = time.time()

    cur.execute(
        "SELECT library_id, startup_attempt, status FROM document_jobs WHERE job_id = ?",
        (job_id,),
    )
    row = cur.fetchone()
    if row is None:
        con.close()
        raise RuntimeError(f"job not found: {job_id}")

    lib_id, job_attempt, job_status = row
    if job_status in {"cancelled", "failed", "completed"}:
        con.close()
        return {"ok": True, "jobId": job_id, "status": job_status}

    cur.execute(
        "SELECT current_attempt FROM library_startup_attempts WHERE library_id = ?",
        (lib_id,),
    )
    att_row = cur.fetchone()
    current_lib_attempt = att_row[0] if att_row else 1

    if expected_startup_attempt != current_lib_attempt or job_attempt != expected_startup_attempt:
        con.close()
        raise RuntimeError(
            f"stale startup attempt fencing: expected {expected_startup_attempt}, active {current_lib_attempt}"
        )

    cur.execute(
        """
        UPDATE document_jobs
        SET status = ?, stage = ?, error = ?, updated_at = ?
        WHERE job_id = ? AND status NOT IN ('cancelled', 'failed')
        """,
        (status, status, error, now, job_id),
    )
    con.commit()
    con.close()
    return {"ok": True, "jobId": job_id, "status": status}


@serialized_job_mutation
def mark_job_uncertain(
    db_path: Path,
    job_id: str,
    reason: str,
) -> dict:
    """Mark a job uncertain so paid calls are never silently repeated."""
    con = ensure_schema(db_path)
    cur = con.cursor()
    now = time.time()

    cur.execute(
        """
        UPDATE document_jobs
        SET is_uncertain = 1, status = 'paused', error = ?, updated_at = ?
        WHERE job_id = ? AND status NOT IN ('cancelled', 'completed', 'failed')
        """,
        (reason, now, job_id),
    )
    con.commit()
    con.close()
    return {"ok": True, "jobId": job_id, "isUncertain": True, "status": "paused"}


@serialized_job_mutation
def cancel_job(db_path: Path, job_id: str) -> dict:
    """Mark a job cancelled immediately."""
    con = ensure_schema(db_path)
    cur = con.cursor()
    now = time.time()

    cur.execute(
        """
        UPDATE document_jobs
        SET status = 'cancelled', stage = 'cancelled', updated_at = ?
        WHERE job_id = ? AND status NOT IN ('completed', 'failed')
        """,
        (now, job_id),
    )
    con.commit()
    con.close()
    return {"ok": True, "jobId": job_id, "status": "cancelled"}


def get_job(db_path: Path, job_id: str) -> dict | None:
    """Retrieve full details of one job."""
    if not db_path.is_file():
        return None
    con = open_db(db_path)
    cur = con.cursor()
    cur.execute(
        """
        SELECT job_id, library_id, document_id, revision_id, startup_attempt,
               stage, status, total_chunks, completed_chunks, current_chunk_index,
               token_estimate, tokens_used, is_uncertain, error, checkpoint_json,
               created_at, updated_at
        FROM document_jobs
        WHERE job_id = ?
        """,
        (job_id,),
    )
    row = cur.fetchone()
    con.close()
    if row is None:
        return None
    return {
        "jobId": row[0],
        "libraryId": row[1],
        "documentId": row[2],
        "revisionId": row[3],
        "startupAttempt": row[4],
        "stage": row[5],
        "status": row[6],
        "totalChunks": row[7],
        "completedChunks": row[8],
        "currentChunkIndex": row[9],
        "tokenEstimate": row[10],
        "tokensUsed": row[11],
        "isUncertain": bool(row[12]),
        "error": row[13],
        "checkpointJson": row[14],
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(row[15])),
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(row[16])),
    }


def list_jobs(db_path: Path, library_id: str) -> list[dict]:
    """List all jobs in one library."""
    if not db_path.is_file():
        return []
    con = open_db(db_path)
    cur = con.cursor()
    cur.execute(
        """
        SELECT job_id, library_id, document_id, revision_id, startup_attempt,
               stage, status, total_chunks, completed_chunks, current_chunk_index,
               token_estimate, tokens_used, is_uncertain, error, checkpoint_json,
               created_at, updated_at
        FROM document_jobs
        WHERE library_id = ?
        ORDER BY created_at DESC
        """,
        (library_id,),
    )
    rows = cur.fetchall()
    con.close()
    return [
        {
            "jobId": row[0],
            "libraryId": row[1],
            "documentId": row[2],
            "revisionId": row[3],
            "startupAttempt": row[4],
            "stage": row[5],
            "status": row[6],
            "totalChunks": row[7],
            "completedChunks": row[8],
            "currentChunkIndex": row[9],
            "tokenEstimate": row[10],
            "tokensUsed": row[11],
            "isUncertain": bool(row[12]),
            "error": row[13],
            "checkpointJson": row[14],
            "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(row[15])),
            "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(row[16])),
        }
        for row in rows
    ]


@serialized_job_mutation
def cancel_all_library_jobs(db_path: Path, library_id: str) -> dict:
    """Mark all active, queued, or paused jobs for a library as cancelled."""
    if not db_path.is_file():
        return {"ok": True, "cancelledCount": 0}
    con = open_db(db_path)
    cur = con.cursor()
    cur.execute(
        """
        UPDATE document_jobs
        SET status = 'cancelled', updated_at = ?
        WHERE library_id = ? AND status IN ('active', 'queued', 'paused')
        """,
        (time.time(), library_id),
    )
    count = cur.rowcount
    con.commit()
    con.close()
    return {"ok": True, "cancelledCount": count}
