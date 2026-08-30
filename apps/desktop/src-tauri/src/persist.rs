//! On-disk runtime settings that survive restart.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use crate::shell::ShellError;

/// Persisted Node, Harness, and workspace choices.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeConfig {
    /// Explicit real Node executable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub node_path: Option<String>,
    /// Explicit Harness package root, manifest, or recognized shim.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_path: Option<String>,
    /// Absolute workspace root passed to the companion.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_root: Option<String>,
}

fn config_path(dir: &Path) -> PathBuf {
    dir.join("runtime-config.json")
}

fn default_workspace_root() -> Option<String> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(|value| PathBuf::from(value).to_string_lossy().into_owned())
}

fn workspace_root_is_missing(config: &RuntimeConfig) -> bool {
    config.workspace_root.as_deref().is_none_or(|value| value.trim().is_empty())
}

/**
 * Read persisted settings and write the user home directory into `workspaceRoot`
 * when that field is empty.
 *
 * @param dir - directory that owns `runtime-config.json`.
 * @returns the merged settings, with `workspaceRoot` filled when it was empty.
 */
pub fn load_config_with_workspace_default(dir: &Path) -> Result<RuntimeConfig, ShellError> {
    let current = load_config(dir)?;
    if !workspace_root_is_missing(&current) {
        return Ok(current);
    }
    let home = default_workspace_root().ok_or_else(|| {
        ShellError::Config("workspaceRoot is not configured and the user home directory is unknown".into())
    })?;
    save_config(dir, &RuntimeConfig {
        workspace_root: Some(home),
        ..RuntimeConfig::default()
    })
}

/**
 * Read persisted settings, or an empty object when the file is absent.
 *
 * @param dir - directory that owns `runtime-config.json`.
 */
pub fn load_config(dir: &Path) -> Result<RuntimeConfig, ShellError> {
    let path = config_path(dir);
    if !path.is_file() {
        return Ok(RuntimeConfig::default());
    }
    let bytes = fs::read(&path)
        .map_err(|error| ShellError::Config(format!("runtime config is unreadable: {error}")))?;
    serde_json::from_slice(&bytes)
        .map_err(|error| ShellError::Config(format!("runtime config is not JSON: {error}")))
}

fn assign_optional(slot: &mut Option<String>, patch: &Option<String>) {
    let Some(value) = patch else { return };
    *slot = if value.trim().is_empty() { None } else { Some(value.clone()) };
}

/**
 * Merge and persist settings.
 *
 * @param dir - directory that owns `runtime-config.json`.
 * @param patch - fields to overwrite; omitted fields keep their previous values; an empty string clears that field.
 * @returns the merged persisted settings.
 */
pub fn save_config(dir: &Path, patch: &RuntimeConfig) -> Result<RuntimeConfig, ShellError> {
    let mut current = load_config(dir)?;
    assign_optional(&mut current.node_path, &patch.node_path);
    assign_optional(&mut current.runtime_path, &patch.runtime_path);
    assign_optional(&mut current.workspace_root, &patch.workspace_root);
    fs::create_dir_all(dir)
        .map_err(|error| ShellError::Config(format!("runtime config directory is not writable: {error}")))?;
    let bytes = serde_json::to_vec_pretty(&current)
        .map_err(|error| ShellError::Config(format!("runtime config encode failed: {error}")))?;
    fs::write(config_path(dir), bytes)
        .map_err(|error| ShellError::Config(format!("runtime config write failed: {error}")))?;
    Ok(current)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn round_trips_persisted_fields() {
        let dir = tempdir().expect("tempdir");
        let saved = save_config(dir.path(), &RuntimeConfig {
            node_path: Some("/usr/bin/node".into()),
            runtime_path: None,
            workspace_root: Some("/tmp/project".into()),
        }).expect("save");
        assert_eq!(saved.node_path.as_deref(), Some("/usr/bin/node"));
        assert_eq!(saved.workspace_root.as_deref(), Some("/tmp/project"));
        let loaded = load_config(dir.path()).expect("load");
        assert_eq!(loaded, saved);
    }

    #[test]
    fn writes_the_user_home_when_workspace_root_is_missing() {
        let dir = tempdir().expect("tempdir");
        let loaded = load_config_with_workspace_default(dir.path()).expect("default");
        let expected = default_workspace_root().expect("home");
        assert_eq!(loaded.workspace_root.as_deref(), Some(expected.as_str()));
        let reread = load_config(dir.path()).expect("reread");
        assert_eq!(reread.workspace_root.as_deref(), Some(expected.as_str()));
    }

    #[test]
    fn empty_patch_values_clear_persisted_fields() {
        let dir = tempdir().expect("tempdir");
        save_config(dir.path(), &RuntimeConfig {
            node_path: Some("/usr/bin/node".into()),
            runtime_path: Some("/tmp/old-dsh".into()),
            workspace_root: Some("/tmp/project".into()),
        }).expect("save");
        let cleared = save_config(dir.path(), &RuntimeConfig {
            node_path: Some(String::new()),
            runtime_path: Some(String::new()),
            workspace_root: Some("/tmp/kept".into()),
        }).expect("clear");
        assert_eq!(cleared.node_path, None);
        assert_eq!(cleared.runtime_path, None);
        assert_eq!(cleared.workspace_root.as_deref(), Some("/tmp/kept"));
    }
}
