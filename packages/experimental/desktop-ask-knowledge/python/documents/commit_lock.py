"""Cross-process, reentrant short commit lock for one library's durable mutations."""
from contextlib import contextmanager
from functools import wraps
from pathlib import Path
import os
import threading

_local = threading.local()
_mutex = threading.RLock()


@contextmanager
def commit_lock(vault: Path):
    """Serialize admission, cancellation, startup fencing and wiki publication."""
    path = vault.resolve() / '.octopus-kb' / 'document-commit.lock'
    with _mutex:
        held = getattr(_local, 'held', {})
        key = str(path)
        if key in held:
            yield
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
        try:
            if os.name == 'nt':
                import msvcrt
                if os.fstat(fd).st_size == 0:
                    os.write(fd, b'0')
                os.lseek(fd, 0, os.SEEK_SET)
                msvcrt.locking(fd, msvcrt.LK_LOCK, 1)
            else:
                import fcntl
                fcntl.flock(fd, fcntl.LOCK_EX)
            held[key] = True
            _local.held = held
            try:
                yield
            finally:
                del held[key]
                if os.name == 'nt':
                    os.lseek(fd, 0, os.SEEK_SET)
                    msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(fd, fcntl.LOCK_UN)
        finally:
            os.close(fd)


def serialized_job_mutation(fn):
    """Lock job operations whose first argument is documents.sqlite."""
    @wraps(fn)
    def wrapped(db_path, *args, **kwargs):
        with commit_lock(Path(db_path).parent.parent):
            return fn(db_path, *args, **kwargs)
    return wrapped
