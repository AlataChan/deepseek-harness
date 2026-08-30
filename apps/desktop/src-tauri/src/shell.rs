//! Desktop shell state: persist, resolve, cache, and one live companion.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::mpsc::Receiver;

use crate::bundle_cache::{cache_bundle, BundleCacheRequest};
use crate::carrier::{spawn_companion, CarrierChild, CarrierEvent, ShutdownOutcome};
use crate::persist::{load_config, load_config_with_workspace_default, save_config, RuntimeConfig};
use crate::runtime::{discover_node, resolve_installed_runtime, BundledResources, ResolvedRuntime};
use crate::{CacheBundleArgs, CacheBundleResult};

/// Recoverable desktop-shell failure.
#[derive(Debug, thiserror::Error)]
pub enum ShellError {
    /// User-correctable configuration or discovery failure.
    #[error("{0}")]
    Config(String),
    /// Live relay closed after a physical-record violation.
    #[error("{reason}")]
    Closed { reason: String },
}

/// Directories currently allowed on the asset-protocol scope.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct AssetScope {
    allowed: Vec<PathBuf>,
}

impl AssetScope {
    /// Allow one generation directory and remember it.
    pub fn allow(&mut self, directory: PathBuf) {
        if !self.allowed.iter().any(|existing| existing == &directory) {
            self.allowed.push(directory);
        }
    }

    /// Revoke one generation directory.
    pub fn revoke(&mut self, directory: &Path) {
        self.allowed.retain(|existing| existing != directory);
    }

    /// Currently allowed generation directories.
    #[must_use]
    pub fn allowed(&self) -> &[PathBuf] {
        &self.allowed
    }
}

/// Result of `carrier_open`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CarrierOpenResult {
    /// Token for this companion generation.
    pub generation_id: String,
    /// Installed Harness version announced at resolve time.
    pub runtime_version: String,
    /// Workspace root passed to the child.
    pub workspace_root: String,
}

/// One desktop window's process-side state.
pub struct DesktopShell {
    config_dir: PathBuf,
    cache_root: PathBuf,
    cli_path: PathBuf,
    path_value: String,
    bundled: BundledResources,
    resolved: Option<ResolvedRuntime>,
    child: Option<CarrierChild>,
    events: Option<Receiver<CarrierEvent>>,
    generation_dir: Option<PathBuf>,
    /// Asset-protocol directories allowed for the current generation.
    pub asset_scope: AssetScope,
}

impl DesktopShell {
    /**
     * Construct an empty shell.
     *
     * @param config_dir - directory for `runtime-config.json`.
     * @param cache_root - application data directory that owns `bundle-cache/`.
     * @param cli_path - bundled installed-runtime CLI.
     * @param path_value - PATH used for Node discovery.
     * @param bundled - bundled resources (Node binary, harness package) for self-contained distribution.
     */
    #[must_use]
    pub fn new(config_dir: PathBuf, cache_root: PathBuf, cli_path: PathBuf, path_value: String, bundled: BundledResources) -> Self {
        Self {
            config_dir,
            cache_root,
            cli_path,
            path_value,
            bundled,
            resolved: None,
            child: None,
            events: None,
            generation_dir: None,
            asset_scope: AssetScope::default(),
        }
    }

    /// Persist settings and drop any cached resolve result.
    pub fn configure(&mut self, patch: &RuntimeConfig) -> Result<RuntimeConfig, ShellError> {
        let merged = save_config(&self.config_dir, patch)?;
        self.resolved = None;
        Ok(merged)
    }

    /// Read persisted settings, defaulting `workspaceRoot` to the user home.
    pub fn get_config(&self) -> Result<RuntimeConfig, ShellError> {
        load_config_with_workspace_default(&self.config_dir)
    }

    /**
     * Where the current companion generation's stderr is recorded.
     *
     * Beside the bundle cache in the app data directory, so a user can be asked
     * for one file after a failure they cannot otherwise describe.
     */
    #[must_use]
    pub fn companion_log_path(&self) -> PathBuf {
        self.cache_root.join("companion.log")
    }

    /// Discover Node and run the installed-runtime CLI.
    pub fn resolve(&mut self) -> Result<ResolvedRuntime, ShellError> {
        let config = load_config(&self.config_dir)?;
        let discovered = discover_node(&config, &self.path_value, &self.bundled, |node| {
            let output = std::process::Command::new(node)
                .arg("--version")
                .output()
                .map_err(|error| ShellError::Config(format!("node --version failed: {error}")))?;
            Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
        })?;
        let node_path = match discovered {
            crate::runtime::NodeDiscovery::Persisted(path) | crate::runtime::NodeDiscovery::Path(path) => path,
        };
        let origin = std::env::current_exe().unwrap_or_default();
        let resolved = resolve_installed_runtime(&node_path, &self.cli_path, &config, &origin, &self.bundled)?;
        self.resolved = Some(resolved.clone());
        Ok(resolved)
    }

    /// Stop a live child, revoke its cache directory, and spawn a replacement.
    pub fn carrier_open(&mut self) -> Result<CarrierOpenResult, ShellError> {
        let resolved = self.resolved.clone().ok_or_else(|| {
            ShellError::Config("runtime_resolve must succeed before carrier_open".into())
        })?;
        let config = load_config_with_workspace_default(&self.config_dir)?;
        let workspace_root = config.workspace_root.clone().ok_or_else(|| {
            ShellError::Config("workspaceRoot is not configured".into())
        })?;
        self.stop_child()?;
        let (tx, rx) = std::sync::mpsc::channel();
        let child = spawn_companion(
            Path::new(&resolved.node_path),
            Path::new(&resolved.companion_entry),
            &workspace_root,
            tx,
            Some(self.companion_log_path()),
        )?;
        let result = CarrierOpenResult {
            generation_id: child.generation_id.clone(),
            runtime_version: resolved.runtime_version,
            workspace_root,
        };
        self.child = Some(child);
        self.events = Some(rx);
        Ok(result)
    }

    /// Forward one already-serialized record uplink.
    pub fn carrier_send(&mut self, line: &str) -> Result<(), ShellError> {
        let child = self.child.as_mut().ok_or_else(|| {
            ShellError::Config("carrier_send requires a live carrier_open".into())
        })?;
        child.send_line(line)
    }

    /// Copy one verified bundle and allow only its generation directory.
    pub fn cache_bundle(
        &mut self,
        source_path: &Path,
        sha256: &str,
        graph_rev: &str,
        index: u32,
        id: &str,
    ) -> Result<CacheBundleResult, ShellError> {
        let cached = cache_bundle(&self.cache_root, BundleCacheRequest {
            source_path,
            sha256,
            graph_rev,
            index,
            id,
        })?;
        if let Some(previous) = self.generation_dir.take() {
            if previous != cached.generation_dir {
                self.asset_scope.revoke(&previous);
                let _ = std::fs::remove_dir_all(&previous);
            }
        }
        self.asset_scope.allow(cached.generation_dir.clone());
        self.generation_dir = Some(cached.generation_dir.clone());
        Ok(CacheBundleResult {
            src: cached.src,
            destination: cached.destination.to_string_lossy().into_owned(),
            generation_dir: cached.generation_dir.to_string_lossy().into_owned(),
            allowed: self.asset_scope.allowed().iter()
                .map(|path| path.to_string_lossy().into_owned())
                .collect(),
        })
    }

    /**
     * Cache from the invoke argument object.
     *
     * @param args - absolute source, digest, and graph identity.
     */
    pub fn cache_bundle_from_args(&mut self, args: &CacheBundleArgs) -> Result<CacheBundleResult, ShellError> {
        self.cache_bundle(
            Path::new(&args.source_path),
            &args.sha256,
            &args.graph_rev,
            args.index,
            &args.id,
        )
    }

    /// Live companion generation token, if a child is running.
    #[must_use]
    pub fn current_generation(&self) -> Option<&str> {
        self.child.as_ref().map(|child| child.generation_id.as_str())
    }

    /// Generation directory last allowed on the asset-protocol scope.
    #[must_use]
    pub fn current_generation_dir(&self) -> Option<&Path> {
        self.generation_dir.as_deref()
    }

    /// Install a resolve result without running the CLI (tests only).
    #[cfg(test)]
    pub fn set_resolved_for_tests(&mut self, resolved: ResolvedRuntime) {
        self.resolved = Some(resolved);
    }

    /// Drain pending downlink events.
    pub fn take_events(&mut self) -> Vec<CarrierEvent> {
        let mut events = Vec::new();
        if let Some(rx) = self.events.as_ref() {
            while let Ok(event) = rx.try_recv() {
                events.push(event);
            }
        }
        if let Some(child) = self.child.as_mut() {
            if let Ok(Some(code)) = child.try_wait() {
                // An exit code in the same file as the stderr it belongs to is
                // what distinguishes a crash from a silent kill: a companion
                // killed by a signal writes nothing, so the code is the only
                // record that it died at all.
                self.append_companion_log(&format!("--- companion exited with code {code} ---"));
                events.push(CarrierEvent::ChildExit { code: Some(code) });
            }
        }
        events
    }

    /**
     * Append one shell-side line to the companion log.
     *
     * Failure is silent by construction: a diagnostic that can itself break the
     * session is worse than a missing line, and the caller has no recovery.
     * @param line - the text to record.
     */
    fn append_companion_log(&self, line: &str) {
        use std::io::Write as _;
        let path = self.companion_log_path();
        let Some(parent) = path.parent() else { return };
        let _ = std::fs::create_dir_all(parent);
        if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
            let _ = writeln!(file, "{line}");
        }
    }

    fn stop_child(&mut self) -> Result<Option<ShutdownOutcome>, ShellError> {
        self.events = None;
        let Some(child) = self.child.take() else { return Ok(None) };
        // Recorded because a shell-initiated replacement and a companion that
        // died on its own are indistinguishable downstream: both leave the
        // Webview writing into a closed pipe.
        self.append_companion_log(&format!(
            "--- shell is replacing companion generation {} ---",
            child.generation_id,
        ));
        if let Some(directory) = self.generation_dir.take() {
            self.asset_scope.revoke(&directory);
            let _ = std::fs::remove_dir_all(&directory);
        }
        Ok(Some(child.shutdown()?))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn carrier_open_requires_resolve() {
        let dir = tempdir().expect("tempdir");
        let mut shell = DesktopShell::new(
            dir.path().to_path_buf(),
            dir.path().to_path_buf(),
            dir.path().join("missing-cli.js"),
            String::new(),
            BundledResources::default(),
        );
        let error = shell.carrier_open().expect_err("unresolved");
        assert!(error.to_string().contains("runtime_resolve"));
    }

    #[test]
    fn cache_bundle_allows_only_the_current_generation_directory() {
        let dir = tempdir().expect("tempdir");
        let mut shell = DesktopShell::new(
            dir.path().to_path_buf(),
            dir.path().to_path_buf(),
            dir.path().join("cli.js"),
            String::new(),
            BundledResources::default(),
        );
        let source = dir.path().join("a.js");
        fs::write(&source, b"export {}\n").expect("write");
        let hash = crate::bundle_cache::sha256_bytes(b"export {}\n");
        let first = shell.cache_bundle(&source, &hash, "rev-a", 0, "ui").expect("first");
        assert_eq!(shell.asset_scope.allowed(), [PathBuf::from(&first.generation_dir)]);
        let second = shell.cache_bundle(&source, &hash, "rev-b", 0, "ui").expect("second");
        assert_eq!(shell.asset_scope.allowed(), [PathBuf::from(&second.generation_dir)]);
        assert!(!PathBuf::from(first.generation_dir).exists());
        assert_eq!(second.allowed, [second.generation_dir.clone()]);
    }

    fn write_alive_fixture(dir: &std::path::Path) -> PathBuf {
        let path = dir.join("alive.mjs");
        fs::write(&path, r#"
process.stdin.resume();
process.stdin.on('end', () => process.exit(0));
"#).expect("write fixture");
        path
    }

    fn write_exit_fixture(dir: &std::path::Path, code: i32) -> PathBuf {
        let path = dir.join("exit.mjs");
        fs::write(&path, format!(
            "process.stdout.write('{{\"type\":\"control/ready\"}}\\n'); process.exit({code});\n"
        )).expect("write fixture");
        path
    }

    fn node_path() -> PathBuf {
        PathBuf::from(std::env::var_os("CARGO_NODE").unwrap_or_else(|| "node".into()))
    }

    fn resolved_fixture(companion_entry: &std::path::Path) -> ResolvedRuntime {
        ResolvedRuntime {
            node_path: node_path().to_string_lossy().into_owned(),
            package_root: "/tmp/pkg".into(),
            companion_entry: companion_entry.to_string_lossy().into_owned(),
            runtime_version: "0.0.1-test".into(),
            discovery_path: node_path().to_string_lossy().into_owned(),
        }
    }

    #[test]
    fn carrier_open_replaces_a_live_child_after_waiting_for_exit() {
        let dir = tempdir().expect("tempdir");
        let fixture = write_alive_fixture(dir.path());
        crate::persist::save_config(dir.path(), &RuntimeConfig {
            workspace_root: Some("/tmp/project".into()),
            ..RuntimeConfig::default()
        }).expect("config");
        let mut shell = DesktopShell::new(
            dir.path().to_path_buf(),
            dir.path().to_path_buf(),
            dir.path().join("cli.js"),
            String::new(),
            BundledResources::default(),
        );
        shell.set_resolved_for_tests(resolved_fixture(&fixture));
        let first = shell.carrier_open().expect("first open");
        let second = shell.carrier_open().expect("second open");
        assert_ne!(first.generation_id, second.generation_id);
        assert_eq!(second.runtime_version, "0.0.1-test");
        assert_eq!(second.workspace_root, "/tmp/project");
    }

    #[test]
    fn child_exit_reports_a_lifecycle_transition() {
        let dir = tempdir().expect("tempdir");
        let fixture = write_exit_fixture(dir.path(), 7);
        crate::persist::save_config(dir.path(), &RuntimeConfig {
            workspace_root: Some("/tmp/project".into()),
            ..RuntimeConfig::default()
        }).expect("config");
        let mut shell = DesktopShell::new(
            dir.path().to_path_buf(),
            dir.path().to_path_buf(),
            dir.path().join("cli.js"),
            String::new(),
            BundledResources::default(),
        );
        shell.set_resolved_for_tests(resolved_fixture(&fixture));
        shell.carrier_open().expect("open");
        let started = std::time::Instant::now();
        let events = loop {
            let events = shell.take_events();
            if events.iter().any(|event| matches!(event, CarrierEvent::ChildExit { .. })) {
                break events;
            }
            assert!(started.elapsed() < std::time::Duration::from_secs(5), "child exit was not reported");
            std::thread::sleep(std::time::Duration::from_millis(20));
        };
        assert!(events.contains(&CarrierEvent::Record(r#"{"type":"control/ready"}"#.into())));
        assert!(events.contains(&CarrierEvent::ChildExit { code: Some(7) }));
    }

    #[test]
    fn client_tree_has_no_workspace_command() {
        let needle = concat!("workspace", "_set");
        for source in [
            include_str!("main.rs"),
            include_str!("app.rs"),
            include_str!("bin/carrier-harness.rs"),
        ] {
            assert!(!source.contains(needle), "command {needle} must not be registered");
        }
    }
}
