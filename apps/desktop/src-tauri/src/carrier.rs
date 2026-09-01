//! Companion process spawn and line relay.

use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;
use std::time::{Duration, Instant};

use uuid::Uuid;

use crate::record::validate_physical_line;
use crate::shell::ShellError;
use crate::CONTROL_SHUTDOWN_LINE;

/// Downlink or lifecycle notification from a live companion.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CarrierEvent {
    /// One validated physical record, forwarded unchanged.
    Record(String),
    /// Relay closed after a physical-record violation.
    Closed { reason: String },
    /// Companion process exited.
    ChildExit { code: Option<i32> },
}

/// How a replacement `carrier_open` finished the previous child.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShutdownOutcome {
    /// Child exited before the 5 s deadline.
    Exited,
    /// Child was killed after the deadline.
    Killed,
}

/// One spawned companion and its uplink stdin.
#[derive(Debug)]
pub struct CarrierChild {
    /// Generation token returned to the WebView.
    pub generation_id: String,
    child: Child,
    stdin: Option<ChildStdin>,
}

/**
 * Spawn `node companion --workspace-root <root>` with piped stdio and no shell.
 *
 * @param node_path - real Node executable.
 * @param companion_entry - installed desktop companion module.
 * @param workspace_root - absolute workspace passed as `--workspace-root`.
 * @param events - downlink and lifecycle events.
 * @param log_path - file the companion's stderr is appended to, when the caller
 *   has a writable location for it. A window process has no terminal, so
 *   without this a companion that dies mid-session leaves the user with only
 *   the shell's downstream `Broken pipe`, which names the symptom and not the
 *   cause. Existing `None` arguments are this log path, not app-data.
 * @param app_data_dir - absolute Tauri app-data directory; exported as
 *   `OCTOPUS_APP_DATA`.
 * @param sidecar_home - absolute sidecar runtime root; exported as
 *   `OCTOPUS_SIDECAR_HOME`.
 */
pub fn spawn_companion(
    node_path: &Path,
    companion_entry: &Path,
    workspace_root: &str,
    events: Sender<CarrierEvent>,
    log_path: Option<PathBuf>,
    app_data_dir: &Path,
    sidecar_home: &Path,
) -> Result<CarrierChild, ShellError> {
    let app_data_dir = require_absolute_path(app_data_dir, "OCTOPUS_APP_DATA")?;
    let sidecar_home = require_absolute_path(sidecar_home, "OCTOPUS_SIDECAR_HOME")?;
    let mut child = Command::new(node_path)
        .arg(companion_entry)
        .arg("--workspace-root")
        .arg(workspace_root)
        .env("OCTOPUS_APP_DATA", &app_data_dir)
        .env("OCTOPUS_SIDECAR_HOME", &sidecar_home)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| ShellError::Config(format!("companion spawn failed: {error}")))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| ShellError::Config("companion stdin was not piped".into()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| ShellError::Config("companion stdout was not piped".into()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| ShellError::Config("companion stderr was not piped".into()))?;
    let generation_id = Uuid::new_v4().to_string();
    let stdout_log = log_path.clone();
    let stdout_generation = generation_id.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        // Named because each way this loop ends produces the same downstream
        // symptom — a companion that goes away — while meaning something
        // different: the child closed stdout, it wrote an illegal record, or
        // this shell dropped the receiver and stopped listening.
        let mut ending = "child closed stdout";
        for line in reader.lines() {
            let Ok(line) = line else {
                ending = "stdout read error";
                break;
            };
            match validate_physical_line(&line) {
                Ok(()) => {
                    if events.send(CarrierEvent::Record(line)).is_err() {
                        ending = "shell dropped the event receiver";
                        break;
                    }
                }
                Err(violation) => {
                    let _ = events.send(CarrierEvent::Closed {
                        reason: violation.reason().into(),
                    });
                    ending = "child wrote an invalid physical record";
                    break;
                }
            }
        }
        if let Some(path) = stdout_log {
            if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
                let _ = writeln!(
                    file,
                    "--- generation {stdout_generation} stdout relay ended: {ending} ---"
                );
            }
        }
    });
    let log_generation = generation_id.clone();
    thread::spawn(move || {
        // Appended, never truncated: a replacement generation spawns while the
        // failed one's diagnostic is the only record of why it died, and
        // truncating per spawn erases exactly the evidence the log exists for.
        // Generations are separated by a header so the order stays readable.
        let mut sink = log_path.and_then(|path| {
            path.parent().map(std::fs::create_dir_all);
            OpenOptions::new()
                .create(true)
                .append(true)
                .open(&path)
                .ok()
        });
        if let Some(file) = sink.as_mut() {
            let _ = writeln!(
                file,
                "--- companion generation {log_generation} started ---"
            );
            let _ = file.flush();
        }
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            eprintln!("dsh-desktop companion: {line}");
            if let Some(file) = sink.as_mut() {
                let _ = writeln!(file, "{line}");
                let _ = file.flush();
            }
        }
        if let Some(file) = sink.as_mut() {
            let _ = writeln!(
                file,
                "--- companion generation {log_generation} stderr closed ---"
            );
            let _ = file.flush();
        }
    });
    Ok(CarrierChild {
        generation_id,
        child,
        stdin: Some(stdin),
    })
}

impl CarrierChild {
    /**
     * Write one already-serialized physical record uplink.
     *
     * @param line - JSON text without a trailing newline.
     */
    pub fn send_line(&mut self, line: &str) -> Result<(), ShellError> {
        validate_physical_line(line).map_err(|violation| ShellError::Closed {
            reason: violation.reason().into(),
        })?;
        let stdin = self
            .stdin
            .as_mut()
            .ok_or_else(|| ShellError::Config("companion stdin is closed".into()))?;
        writeln!(stdin, "{line}").map_err(|error| {
            ShellError::Config(format!("companion stdin write failed: {error}"))
        })?;
        stdin.flush().map_err(|error| {
            ShellError::Config(format!("companion stdin flush failed: {error}"))
        })?;
        Ok(())
    }

    /**
     * Write `control/shutdown`, wait up to 5 s, then kill.
     *
     * @returns whether the child exited or was killed.
     */
    pub fn shutdown(mut self) -> Result<ShutdownOutcome, ShellError> {
        if let Some(mut stdin) = self.stdin.take() {
            let _ = writeln!(stdin, "{CONTROL_SHUTDOWN_LINE}");
            let _ = stdin.flush();
        }
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            match self.child.try_wait() {
                Ok(Some(_)) => return Ok(ShutdownOutcome::Exited),
                Ok(None) if Instant::now() >= deadline => {
                    let _ = self.child.kill();
                    let _ = self.child.wait();
                    return Ok(ShutdownOutcome::Killed);
                }
                Ok(None) => thread::sleep(Duration::from_millis(20)),
                Err(error) => {
                    return Err(ShellError::Config(format!(
                        "companion wait failed: {error}"
                    )))
                }
            }
        }
    }

    /// Non-blocking poll of a child that has already ended.
    pub fn try_wait(&mut self) -> Result<Option<i32>, ShellError> {
        match self.child.try_wait() {
            Ok(Some(status)) => Ok(status.code()),
            Ok(None) => Ok(None),
            Err(error) => Err(ShellError::Config(format!(
                "companion wait failed: {error}"
            ))),
        }
    }
}

impl Drop for CarrierChild {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Collect events from a spawn for tests.
#[must_use]
pub fn event_channel() -> (Sender<CarrierEvent>, Receiver<CarrierEvent>) {
    mpsc::channel()
}

/**
 * Reject empty or relative paths so companion env cannot silently fall back.
 * @param path - candidate directory.
 * @param name - environment variable the path will be exported as.
 * @returns the same path when it is absolute.
 */
fn require_absolute_path(path: &Path, name: &str) -> Result<PathBuf, ShellError> {
    if path.as_os_str().is_empty() || !path.is_absolute() {
        return Err(ShellError::Config(format!(
            "{name} must be an absolute path"
        )));
    }
    Ok(path.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::record::MAX_WIRE_RECORD_BYTES;
    use std::fs;
    use std::path::PathBuf;
    use tempfile::tempdir;

    fn write_fixture(dir: &std::path::Path, source: &str) -> PathBuf {
        let path = dir.join("fixture.mjs");
        fs::write(&path, source).expect("write fixture");
        path
    }

    fn node_path() -> PathBuf {
        PathBuf::from(std::env::var_os("CARGO_NODE").unwrap_or_else(|| "node".into()))
    }

    #[test]
    fn forwards_records_in_arrival_order_without_inspecting_fields() {
        let dir = tempdir().expect("tempdir");
        let fixture = write_fixture(
            dir.path(),
            r#"
import { createInterface } from 'node:readline';
const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  process.stdout.write(line + '\n');
  process.stdout.write('{"type":"control/ready"}\n');
});
"#,
        );
        let (tx, rx) = event_channel();
        let mut child = spawn_companion(
            &node_path(),
            &fixture,
            "/tmp/project",
            tx,
            None,
            dir.path(),
            dir.path(),
        )
        .expect("spawn");
        child
            .send_line(r#"{"type":"control/hello"}"#)
            .expect("hello");
        let first = rx.recv_timeout(Duration::from_secs(5)).expect("hello echo");
        let second = rx.recv_timeout(Duration::from_secs(5)).expect("ready");
        assert_eq!(
            first,
            CarrierEvent::Record(r#"{"type":"control/hello"}"#.into())
        );
        assert_eq!(
            second,
            CarrierEvent::Record(r#"{"type":"control/ready"}"#.into())
        );
        let _ = child.shutdown();
    }

    #[test]
    fn closes_the_relay_when_the_child_writes_an_oversize_line() {
        let dir = tempdir().expect("tempdir");
        let oversized = format!("\"{}\"", "x".repeat(MAX_WIRE_RECORD_BYTES));
        let fixture = write_fixture(
            dir.path(),
            &format!("process.stdout.write({oversized:?} + '\\n');\n"),
        );
        let (tx, rx) = event_channel();
        let child = spawn_companion(
            &node_path(),
            &fixture,
            "/tmp/project",
            tx,
            None,
            dir.path(),
            dir.path(),
        )
        .expect("spawn");
        let event = rx.recv_timeout(Duration::from_secs(5)).expect("close");
        assert_eq!(
            event,
            CarrierEvent::Closed {
                reason: crate::record::RecordViolation::Oversize.reason().into()
            }
        );
        let _ = child.shutdown();
    }

    #[test]
    fn records_companion_stderr_to_the_log_path() {
        let dir = tempdir().expect("tempdir");
        let fixture = write_fixture(
            dir.path(),
            "process.stderr.write('fatal load failure: boom\\n');\n",
        );
        let log = dir.path().join("logs").join("companion.log");
        let (tx, _rx) = event_channel();
        let child = spawn_companion(
            &node_path(),
            &fixture,
            "/tmp/project",
            tx,
            Some(log.clone()),
            dir.path(),
            dir.path(),
        )
        .expect("spawn");
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut recorded = String::new();
        while Instant::now() < deadline {
            if let Ok(text) = fs::read_to_string(&log) {
                if text.contains("boom") {
                    recorded = text;
                    break;
                }
            }
            thread::sleep(Duration::from_millis(25));
        }
        assert!(
            recorded.contains("fatal load failure: boom"),
            "log was {recorded:?}"
        );
        let _ = child.shutdown();
    }

    #[test]
    fn spawn_failure_is_a_structured_error() {
        let error = spawn_companion(
            Path::new("/definitely-missing-node-binary"),
            Path::new("/definitely-missing-companion.js"),
            "/tmp/project",
            event_channel().0,
            None,
            Path::new("/tmp"),
            Path::new("/tmp"),
        )
        .expect_err("missing node");
        assert!(matches!(error, ShellError::Config(_)));
        assert!(error.to_string().contains("spawn failed"));
    }

    #[test]
    fn exports_absolute_app_data_and_sidecar_home() {
        let dir = tempdir().expect("tempdir");
        let fixture = write_fixture(
            dir.path(),
            r#"
const app = process.env.OCTOPUS_APP_DATA ?? '';
const sidecar = process.env.OCTOPUS_SIDECAR_HOME ?? '';
process.stdout.write(JSON.stringify({ type: 'control/ready', app, sidecar }) + '\n');
"#,
        );
        let (tx, rx) = event_channel();
        let app_data = dir.path().join("app-data");
        let sidecar = dir.path().join("kb-runtime");
        fs::create_dir_all(&app_data).expect("app-data");
        fs::create_dir_all(&sidecar).expect("sidecar");
        let child = spawn_companion(
            &node_path(),
            &fixture,
            "/tmp/project",
            tx,
            None,
            &app_data,
            &sidecar,
        )
        .expect("spawn");
        let event = rx.recv_timeout(Duration::from_secs(5)).expect("ready");
        let CarrierEvent::Record(line) = event else {
            panic!("expected record, got {event:?}");
        };
        let parsed: serde_json::Value = serde_json::from_str(&line).expect("json");
        assert_eq!(parsed["app"], app_data.to_string_lossy().as_ref());
        assert_eq!(parsed["sidecar"], sidecar.to_string_lossy().as_ref());
        let _ = child.shutdown();
    }

    #[test]
    fn rejects_relative_app_data_dir() {
        let error = spawn_companion(
            Path::new("/definitely-missing-node-binary"),
            Path::new("/definitely-missing-companion.js"),
            "/tmp/project",
            event_channel().0,
            None,
            Path::new("relative-app-data"),
            Path::new("/tmp"),
        )
        .expect_err("relative app-data");
        assert!(error.to_string().contains("OCTOPUS_APP_DATA"));
    }
}
