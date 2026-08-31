//! Shared desktop-shell logic used by the Tauri window and the carrier harness.

pub mod app;
pub mod bundle_cache;
pub mod carrier;
pub mod persist;
pub mod record;
pub mod runtime;
pub mod shell;

pub use app::run;
pub use bundle_cache::{asset_src, cache_bundle, BundleCacheRequest, CachedBundle};
pub use carrier::{spawn_companion, CarrierChild, CarrierEvent, ShutdownOutcome};
pub use persist::{load_config, save_config, RuntimeConfig};
pub use record::{validate_physical_line, RecordViolation, MAX_WIRE_RECORD_BYTES};
pub use runtime::{discover_node, resolve_installed_runtime, NodeDiscovery, ResolvedRuntime};
pub use shell::{CarrierOpenResult, DesktopShell, ShellError};

use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

/// Shutdown record written to a live companion before the 5 s kill deadline.
pub const CONTROL_SHUTDOWN_LINE: &str =
    r#"{"type":"wire/message","encoded":"{\"type\":\"control/shutdown\"}"}"#;

/// Arguments for `cache_bundle`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheBundleArgs {
    /// Absolute source path of the announced artifact.
    pub source_path: String,
    /// Expected SHA-256 hex of the source bytes.
    pub sha256: String,
    /// Ready-graph revision used as the generation directory name.
    pub graph_rev: String,
    /// Zero-based entry index in the ready graph.
    pub index: u32,
    /// Bundle identifier hashed into the file name.
    pub id: String,
}

/// Result of a successful `cache_bundle`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheBundleResult {
    /// WebView `convertFileSrc` equivalent for the cached file.
    pub src: String,
    /// Absolute cached file path.
    pub destination: String,
    /// Generation directory allowed on the asset-protocol scope.
    pub generation_dir: String,
    /// Directories currently allowed on the asset-protocol scope.
    pub allowed: Vec<String>,
}

/// Tagged downlink payload shared by the Tauri Channel and the harness stdout.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum DownlinkEvent {
    /// One validated physical record, forwarded unchanged.
    #[serde(rename = "record")]
    Record { line: String },
    /// Relay closed after a physical-record violation.
    #[serde(rename = "closed")]
    Closed { reason: String },
    /// Companion process exited.
    #[serde(rename = "child-exit")]
    ChildExit { code: Option<i32> },
}

impl From<CarrierEvent> for DownlinkEvent {
    fn from(event: CarrierEvent) -> Self {
        match event {
            CarrierEvent::Record(line) => Self::Record { line },
            CarrierEvent::Closed { reason } => Self::Closed { reason },
            CarrierEvent::ChildExit { code } => Self::ChildExit { code },
        }
    }
}

/**
 * Forward live carrier events until the generation is replaced or the sink fails.
 *
 * @param shell - shared shell that owns the event queue.
 * @param generation_id - generation this sink is attached to.
 * @param emit - returns `false` when the sink is gone.
 */
pub fn forward_carrier_events(
    shell: Arc<Mutex<DesktopShell>>,
    generation_id: String,
    mut emit: impl FnMut(DownlinkEvent) -> bool + Send + 'static,
) {
    thread::spawn(move || loop {
        let events = {
            let Ok(mut guard) = shell.lock() else { return };
            if guard.current_generation() != Some(generation_id.as_str()) {
                return;
            }
            guard.take_events()
        };
        if events.is_empty() {
            thread::sleep(Duration::from_millis(15));
            continue;
        }
        for event in events {
            let stop = matches!(
                event,
                CarrierEvent::Closed { .. } | CarrierEvent::ChildExit { .. }
            );
            if !emit(DownlinkEvent::from(event)) {
                return;
            }
            if stop {
                return;
            }
        }
    });
}

#[cfg(test)]
mod spec_tests {
    use serde_json::json;

    #[test]
    fn asset_protocol_starts_enabled_and_empty() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("tauri.conf.json");
        assert_eq!(
            conf["app"]["security"]["assetProtocol"]["enable"],
            json!(true)
        );
        assert_eq!(conf["app"]["security"]["assetProtocol"]["scope"], json!([]));
    }

    #[test]
    fn webview_csp_forbids_eval_and_inline_scripts() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("tauri.conf.json");
        let csp = conf["app"]["security"]["csp"].as_str().expect("csp");
        let script = csp
            .split(';')
            .map(str::trim)
            .find(|part| part.starts_with("script-src"))
            .expect("script-src");
        assert!(!script.contains("unsafe-eval"));
        assert!(!script.contains("unsafe-inline"));
    }

    #[test]
    fn registered_commands_are_exactly_the_six_shell_commands() {
        let app = include_str!("app.rs");
        let harness = include_str!("bin/carrier-harness.rs");
        for command in [
            "runtime_configure",
            "runtime_get_config",
            "runtime_resolve",
            "carrier_open",
            "carrier_send",
            "cache_bundle",
        ] {
            assert!(app.contains(command), "{command} missing from app.rs");
            assert!(
                harness.contains(command),
                "{command} missing from carrier-harness"
            );
        }
        let needle = concat!("workspace", "_set");
        assert!(!app.contains(needle));
        assert!(!harness.contains(needle));
    }
}
