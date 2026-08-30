//! Node discovery and installed-runtime CLI invocation.

use serde::{Deserialize, Serialize};
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::persist::RuntimeConfig;
use crate::shell::ShellError;

/// How Node was selected before the version probe.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NodeDiscovery {
    /// `nodePath` from persisted config.
    Persisted(PathBuf),
    /// First real `node` / `node.exe` on PATH.
    Path(PathBuf),
}

/// Validated companion launch inputs from the installed-runtime CLI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedRuntime {
    /// Canonical real Node executable.
    pub node_path: String,
    /// Canonical installed Harness package root.
    pub package_root: String,
    /// Canonical desktop companion module.
    pub companion_entry: String,
    /// Installed Harness package version.
    pub runtime_version: String,
    /// User or PATH candidate used only to locate the package.
    pub discovery_path: String,
}

/// Bundled resource paths inside the .app for self-contained distribution.
#[derive(Debug, Clone, Default)]
pub struct BundledResources {
    /// Bundled Node.js binary (e.g. `.app/Contents/Resources/resources/node`).
    pub node: Option<PathBuf>,
    /// Bundled harness package root (e.g. `.app/Contents/Resources/resources/harness`).
    pub harness: Option<PathBuf>,
}

fn extension_is_shim(path: &Path) -> Option<&'static str> {
    match path.extension().and_then(OsStr::to_str).map(str::to_ascii_lowercase) {
        Some(ext) if ext == "cmd" => Some(".cmd"),
        Some(ext) if ext == "ps1" => Some(".ps1"),
        _ => None,
    }
}

fn find_on_path(name: &str, path_value: &str) -> Option<PathBuf> {
    for directory in std::env::split_paths(path_value) {
        let candidate = directory.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn supported_node_version(version: &str) -> bool {
    let trimmed = version.trim().trim_start_matches('v');
    let mut parts = trimmed.split('.');
    let major = parts.next().and_then(|part| part.parse::<u32>().ok());
    let minor = parts.next().and_then(|part| part.parse::<u32>().ok());
    match (major, minor) {
        (Some(22), Some(minor)) => minor >= 19,
        (Some(major), _) => major >= 24,
        _ => false,
    }
}

/**
 * Select a real Node executable and confirm `node --version`.
 *
 * Resolution order: bundled binary (self-contained distribution) → persisted
 * `nodePath` from settings → first real `node` on PATH.
 *
 * @param config - persisted `nodePath`, if any.
 * @param path_value - PATH used when `nodePath` is absent.
 * @param bundled - bundled resources inside the app (may have a Node binary).
 * @param probe - version command; tests inject a stub.
 */
pub fn discover_node(
    config: &RuntimeConfig,
    path_value: &str,
    bundled: &BundledResources,
    probe: impl Fn(&Path) -> Result<String, ShellError>,
) -> Result<NodeDiscovery, ShellError> {
    let selected = if let Some(ref bundled_node) = bundled.node {
        if bundled_node.is_file() {
            bundled_node.clone()
        } else if let Some(persisted) = config.node_path.as_deref() {
            PathBuf::from(persisted)
        } else {
            let name = if cfg!(windows) { "node.exe" } else { "node" };
            find_on_path(name, path_value).ok_or_else(|| {
                ShellError::Config("Node executable was not found; configure nodePath or add real Node to PATH".into())
            })?
        }
    } else if let Some(persisted) = config.node_path.as_deref() {
        PathBuf::from(persisted)
    } else {
        let name = if cfg!(windows) { "node.exe" } else { "node" };
        find_on_path(name, path_value).ok_or_else(|| {
            ShellError::Config("Node executable was not found; configure nodePath or add real Node to PATH".into())
        })?
    };
    if let Some(ext) = extension_is_shim(&selected) {
        return Err(ShellError::Config(format!(
            "Node executable must be a real binary, not a {ext} shim: {}",
            selected.display()
        )));
    }
    if !selected.is_file() && config.node_path.is_some() {
        return Err(ShellError::Config(format!(
            "Node executable does not exist or is not a file: {}",
            selected.display()
        )));
    }
    let version = probe(&selected)?;
    if !supported_node_version(&version) {
        return Err(ShellError::Config(format!(
            "Node {version} is not compatible with Harness (^22.19.0 or >=24.0.0)"
        )));
    }
    if config.node_path.is_some() {
        Ok(NodeDiscovery::Persisted(selected))
    } else {
        Ok(NodeDiscovery::Path(selected))
    }
}

fn declares_desktop_companion(manifest: &Path) -> bool {
    let Ok(bytes) = fs::read(manifest) else { return false };
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) else { return false };
    let name = value.get("name").and_then(serde_json::Value::as_str).unwrap_or("");
    if name != "@deepseek-ai/dsh" && name != "@alatastudio/dsh" {
        return false;
    }
    matches!(
        value.pointer("/dsh/companions/desktop").and_then(serde_json::Value::as_str),
        Some(entry) if !entry.is_empty()
    )
}

/**
 * Walk from the running executable to `apps/cli` in the checkout that built it.
 *
 * @param origin_exe - `current_exe` or a test stand-in.
 */
pub fn checkout_runtime_root(origin_exe: &Path) -> Option<PathBuf> {
    let mut current = if origin_exe.is_dir() {
        origin_exe.to_path_buf()
    } else {
        origin_exe.parent()?.to_path_buf()
    };
    for _ in 0..20 {
        let package = current.join("apps").join("cli");
        if declares_desktop_companion(&package.join("package.json")) {
            return Some(package);
        }
        current = current.parent()?.to_path_buf();
    }
    None
}

fn effective_runtime_path(config: &RuntimeConfig, origin_exe: &Path, bundled: &BundledResources) -> Option<PathBuf> {
    if let Some(ref bundled_harness) = bundled.harness {
        if declares_desktop_companion(&bundled_harness.join("package.json")) {
            return Some(bundled_harness.clone());
        }
    }
    if let Some(persisted) = config.runtime_path.as_deref().filter(|value| !value.trim().is_empty()) {
        return Some(PathBuf::from(persisted));
    }
    checkout_runtime_root(origin_exe)
}

/**
 * Run the installed-runtime CLI and parse one JSON object.
 *
 * @param node_path - real Node executable.
 * @param cli_path - bundled `lib/cli.js`.
 * @param config - optional runtimePath forwarded to the CLI.
 * @param origin_exe - running executable; used to find this checkout's `apps/cli`.
 * @param bundled - bundled resources inside the app.
 */
pub fn resolve_installed_runtime(
    node_path: &Path,
    cli_path: &Path,
    config: &RuntimeConfig,
    origin_exe: &Path,
    bundled: &BundledResources,
) -> Result<ResolvedRuntime, ShellError> {
    let mut command = Command::new(node_path);
    command.arg(cli_path)
        .arg("--companion")
        .arg("desktop")
        .arg("--accepted")
        .arg("@deepseek-ai/dsh")
        .arg("--accepted")
        .arg("@alatastudio/dsh")
        .arg("--node-path")
        .arg(node_path);
    if let Some(runtime_path) = effective_runtime_path(config, origin_exe, bundled) {
        command.arg("--runtime-path").arg(runtime_path);
    }
    let output = command.output().map_err(|error| {
        ShellError::Config(format!("installed-runtime CLI failed to start: {error}"))
    })?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout.lines().next().unwrap_or("");
    if !output.status.success() {
        let parsed = serde_json::from_str::<serde_json::Value>(line).ok();
        let from_json = parsed
            .as_ref()
            .and_then(|value| value.get("error"))
            .and_then(serde_json::Value::as_str);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let detail = from_json
            .map(str::to_owned)
            .or_else(|| (!line.is_empty()).then(|| line.to_owned()))
            .or_else(|| {
                let trimmed = stderr.trim();
                (!trimmed.is_empty()).then(|| trimmed.to_owned())
            })
            .unwrap_or_else(|| "no output".to_owned());
        let message = match output.status.code() {
            Some(code) => format!("installed-runtime CLI failed: {detail} (exit {code})"),
            None => format!("installed-runtime CLI failed: {detail}"),
        };
        return Err(ShellError::Config(message));
    }
    serde_json::from_str(line).map_err(|error| {
        ShellError::Config(format!("installed-runtime CLI returned invalid JSON: {error}"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn refuses_a_cmd_node_path() {
        let error = discover_node(
            &RuntimeConfig {
                node_path: Some("C:\\\\Program Files\\\\nodejs\\\\node.cmd".into()),
                ..RuntimeConfig::default()
            },
            "",
            &BundledResources::default(),
            |_| Ok("v24.1.0".into()),
        ).expect_err("cmd shim");
        assert!(error.to_string().contains(".cmd"));
    }

    #[test]
    fn accepts_an_executable_that_prints_a_supported_version() {
        let dir = tempdir().expect("tempdir");
        let node = dir.path().join(if cfg!(windows) { "node.exe" } else { "node" });
        fs::write(&node, "").expect("write node");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&node, fs::Permissions::from_mode(0o755)).expect("chmod");
        }
        let discovered = discover_node(
            &RuntimeConfig {
                node_path: Some(node.to_string_lossy().into_owned()),
                ..RuntimeConfig::default()
            },
            "",
            &BundledResources::default(),
            |path| {
                assert_eq!(path, node);
                Ok("v24.1.0".into())
            },
        ).expect("discover");
        assert_eq!(discovered, NodeDiscovery::Persisted(node));
    }

    #[test]
    fn refuses_a_ps1_node_path() {
        let error = discover_node(
            &RuntimeConfig {
                node_path: Some("C:\\\\Program Files\\\\nodejs\\\\node.ps1".into()),
                ..RuntimeConfig::default()
            },
            "",
            &BundledResources::default(),
            |_| Ok("v24.1.0".into()),
        ).expect_err("ps1 shim");
        assert!(error.to_string().contains(".ps1"));
    }

    #[test]
    fn resolve_installed_runtime_passes_separated_argv() {
        let dir = tempdir().expect("tempdir");
        let cli = dir.path().join("cli.mjs");
        fs::write(&cli, r#"
const nodePathFlag = process.argv.indexOf('--node-path');
const out = {
  nodePath: process.execPath,
  packageRoot: '/tmp/pkg',
  companionEntry: '/tmp/companion.js',
  runtimeVersion: '0.0.1',
  discoveryPath: nodePathFlag >= 0 ? process.argv[nodePathFlag + 1] : '',
};
if (process.argv.includes('--companion') && process.argv.includes('desktop')) {
  process.stdout.write(JSON.stringify(out) + '\n');
} else {
  process.exit(2);
}
"#).expect("write cli");
        let node = PathBuf::from(std::env::var_os("CARGO_NODE").unwrap_or_else(|| "node".into()));
        let resolved = resolve_installed_runtime(
            &node,
            &cli,
            &RuntimeConfig::default(),
            Path::new(""),
            &BundledResources::default(),
        ).expect("resolve");
        assert_eq!(resolved.runtime_version, "0.0.1");
        assert_eq!(resolved.companion_entry, "/tmp/companion.js");
    }

    #[test]
    fn resolve_installed_runtime_names_stderr_when_stdout_is_empty() {
        let dir = tempdir().expect("tempdir");
        let cli = dir.path().join("cli.mjs");
        fs::write(&cli, "process.stderr.write('package not found\\n'); process.exit(1);\n")
            .expect("write cli");
        let node = PathBuf::from(std::env::var_os("CARGO_NODE").unwrap_or_else(|| "node".into()));
        let error = resolve_installed_runtime(
            &node,
            &cli,
            &RuntimeConfig::default(),
            Path::new(""),
            &BundledResources::default(),
        ).expect_err("cli fail");
        let text = error.to_string();
        assert!(text.contains("package not found"), "{text}");
        assert!(text.contains("exit 1"), "{text}");
    }

    fn stage_checkout(dir: &Path) -> PathBuf {
        let package = dir.join("apps").join("cli");
        fs::create_dir_all(package.join("lib")).expect("cli dir");
        fs::write(package.join("package.json"), r#"{
  "name": "@deepseek-ai/dsh",
  "version": "0.1.1-rc.5",
  "dsh": { "companions": { "desktop": "./lib/desktop-companion.js" } }
}"#).expect("manifest");
        let exe = dir.join("apps").join("desktop").join("src-tauri").join("target").join("release").join("dsh-desktop");
        fs::create_dir_all(exe.parent().expect("exe parent")).expect("exe dir");
        fs::write(&exe, "").expect("exe");
        exe
    }

    #[test]
    fn checkout_runtime_root_finds_apps_cli_from_a_nested_binary() {
        let dir = tempdir().expect("tempdir");
        let exe = stage_checkout(dir.path());
        let found = checkout_runtime_root(&exe).expect("checkout");
        assert_eq!(found, dir.path().join("apps").join("cli"));
    }

    #[test]
    fn checkout_runtime_root_ignores_a_package_without_desktop() {
        let dir = tempdir().expect("tempdir");
        let package = dir.path().join("apps").join("cli");
        fs::create_dir_all(&package).expect("cli dir");
        fs::write(package.join("package.json"), r#"{
  "name": "@alatastudio/dsh",
  "version": "0.1.1-rc.5",
  "dsh": { "companions": { "vscode": "./lib/vscode-companion.js" } }
}"#).expect("manifest");
        let exe = dir.path().join("apps").join("desktop").join("dsh-desktop");
        fs::create_dir_all(exe.parent().expect("exe parent")).expect("exe dir");
        fs::write(&exe, "").expect("exe");
        assert_eq!(checkout_runtime_root(&exe), None);
    }

    #[test]
    fn resolve_installed_runtime_uses_the_checkout_when_runtime_path_is_empty() {
        let dir = tempdir().expect("tempdir");
        let exe = stage_checkout(dir.path());
        let cli = dir.path().join("cli.mjs");
        fs::write(&cli, r#"
const flag = process.argv.indexOf('--runtime-path');
const out = {
  nodePath: process.execPath,
  packageRoot: flag >= 0 ? process.argv[flag + 1] : '',
  companionEntry: '/tmp/companion.js',
  runtimeVersion: '0.0.1',
  discoveryPath: flag >= 0 ? process.argv[flag + 1] : 'PATH',
};
process.stdout.write(JSON.stringify(out) + '\n');
"#).expect("write cli");
        let node = PathBuf::from(std::env::var_os("CARGO_NODE").unwrap_or_else(|| "node".into()));
        let resolved = resolve_installed_runtime(
            &node,
            &cli,
            &RuntimeConfig::default(),
            &exe,
            &BundledResources::default(),
        ).expect("resolve");
        assert_eq!(PathBuf::from(&resolved.package_root), dir.path().join("apps").join("cli"));
    }
}
