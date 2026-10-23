//! Tauri window process: persist, resolve, relay, and bundle cache.

use crate::{
    forward_carrier_events, CacheBundleArgs, CacheBundleResult, DesktopShell, DownlinkEvent,
    RuntimeConfig,
};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{ipc::Channel, AppHandle, Manager, State};

/// Shared window-process state.
pub struct AppState(pub Arc<Mutex<DesktopShell>>);

fn map_err(error: impl ToString) -> String {
    error.to_string()
}

fn lock(state: &AppState) -> Result<std::sync::MutexGuard<'_, DesktopShell>, String> {
    state.0.lock().map_err(|error| error.to_string())
}

/**
 * Persist Node, Harness, and workspace settings.
 *
 * @param node_path - explicit real Node executable.
 * @param runtime_path - explicit Harness package root, manifest, or shim.
 * @param workspace_root - absolute workspace passed to the companion.
 */
#[tauri::command]
fn runtime_configure(
    node_path: Option<String>,
    runtime_path: Option<String>,
    workspace_root: Option<String>,
    state: State<'_, AppState>,
) -> Result<RuntimeConfig, String> {
    lock(&state)?
        .configure(&RuntimeConfig {
            node_path,
            runtime_path,
            workspace_root,
        })
        .map_err(map_err)
}

/// Read persisted settings, including `workspaceRoot`.
#[tauri::command]
fn runtime_get_config(state: State<'_, AppState>) -> Result<RuntimeConfig, String> {
    lock(&state)?.get_config().map_err(map_err)
}

/// Discover Node and run the bundled installed-runtime CLI.
#[tauri::command]
fn runtime_resolve(state: State<'_, AppState>) -> Result<crate::ResolvedRuntime, String> {
    lock(&state)?.resolve().map_err(map_err)
}

/**
 * Stop any live child, then spawn the resolved companion and attach `downlink`.
 *
 * @param downlink - Channel that receives tagged record and lifecycle events.
 */
#[tauri::command]
fn carrier_open(
    downlink: Channel<DownlinkEvent>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<crate::CarrierOpenResult, String> {
    let shared = Arc::clone(&state.0);
    let previous_dir;
    let result;
    {
        let mut shell = lock(&state)?;
        previous_dir = shell.current_generation_dir().map(PathBuf::from);
        result = shell.carrier_open().map_err(map_err)?;
    }
    if let Some(previous) = previous_dir {
        let _ = app.asset_protocol_scope().forbid_directory(previous, true);
    }
    let generation_id = result.generation_id.clone();
    forward_carrier_events(shared, generation_id, move |event| {
        downlink.send(event).is_ok()
    });
    Ok(result)
}

/**
 * Forward one already-serialized physical record uplink.
 *
 * @param line - JSON text without a trailing newline.
 */
#[tauri::command]
fn carrier_send(line: String, state: State<'_, AppState>) -> Result<(), String> {
    lock(&state)?.carrier_send(&line).map_err(map_err)
}

/**
 * Hash-copy one announced Client bundle and allow only its generation directory.
 *
 * @param source_path - absolute source path.
 * @param sha256 - expected digest of the source bytes.
 * @param graph_rev - ready-graph revision.
 * @param index - zero-based graph entry index.
 * @param id - bundle identifier.
 */
#[tauri::command]
fn cache_bundle(
    source_path: String,
    sha256: String,
    graph_rev: String,
    index: u32,
    id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<CacheBundleResult, String> {
    let mut shell = lock(&state)?;
    let previous = shell.current_generation_dir().map(PathBuf::from);
    let result = shell
        .cache_bundle_from_args(&CacheBundleArgs {
            source_path,
            sha256,
            graph_rev,
            index,
            id,
        })
        .map_err(map_err)?;
    if let Some(previous) = previous {
        if previous.to_string_lossy() != result.generation_dir {
            let _ = app.asset_protocol_scope().forbid_directory(previous, true);
        }
    }
    app.asset_protocol_scope()
        .allow_directory(&result.generation_dir, true)
        .map_err(map_err)?;
    Ok(result)
}

fn installed_runtime_cli(app: &AppHandle) -> Result<PathBuf, String> {
    let resource = app.path().resource_dir().map_err(map_err)?;
    let nested = resource.join("resources").join("installed-runtime-cli.js");
    if nested.is_file() {
        return Ok(nested);
    }
    let flat = resource.join("installed-runtime-cli.js");
    if flat.is_file() {
        return Ok(flat);
    }
    Err("bundled installed-runtime CLI is missing; build packages/boot/installed-runtime".into())
}

fn discover_bundled_resources(app: &AppHandle) -> crate::runtime::BundledResources {
    let resource = match app.path().resource_dir() {
        Ok(dir) => dir,
        Err(_) => return crate::runtime::BundledResources::default(),
    };
    let resources = resource.join("resources");
    let node_name = if cfg!(windows) { "node.exe" } else { "node" };
    let node = resources.join(node_name);
    let harness = resources.join("harness");
    crate::runtime::BundledResources {
        node: if node.is_file() { Some(node) } else { None },
        harness: if harness.join("package.json").is_file() {
            Some(harness)
        } else {
            None
        },
    }
}

fn dsh_home() -> PathBuf {
    std::env::var("DSH_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            std::env::var("HOME")
                .or_else(|_| std::env::var("USERPROFILE"))
                .map(PathBuf::from)
                .unwrap_or_else(|_| PathBuf::from("."))
                .join(".dsh")
        })
}

const DESKTOP_SHIPPED_BUNDLES: &[&str] = &[
    "@deepseek-ai/dsh-base",
    "@deepseek-ai/dsh-web-app",
    "@deepseek-ai/dsh-desktop-app",
];

const RETIRED_DESKTOP_BUNDLE: (&str, &str) =
    ("@deepseek-ai/dsh-client-app", "@deepseek-ai/dsh-web-app");

const STRIP_DESKTOP_BUNDLES: &[&str] = &[];

fn is_legacy_dsh_context_spec(spec: &str) -> bool {
    if spec == "0.74.0" {
        return false;
    }
    if spec.starts_with("0.36") || spec.starts_with("^0.36") || spec.starts_with("~0.36") {
        return true;
    }
    let clean = spec.trim_start_matches(|c| c == '^' || c == '~' || c == '>' || c == '=' || c == '<');
    let parts: Vec<&str> = clean.split('.').collect();
    if parts.len() >= 2 {
        if let (Ok(major), Ok(minor)) = (parts[0].parse::<u32>(), parts[1].parse::<u32>()) {
            if major == 0 && minor < 74 {
                return true;
            }
        }
    }
    true
}

const PROFILE_PATCH_TEMPLATE: &str = "\
# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; `!!js` expressions allowed).
[]
";

const PROFILE_PNPM_WORKSPACE: &str = "\
packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
";

/// Copy bundled presets from Resources/resources/presets/ to ~/.dsh/.agent-presets/
/// on first run (skip if destination already exists).
fn install_bundled_presets(app: &AppHandle) {
    let resource = match app.path().resource_dir() {
        Ok(dir) => dir,
        Err(_) => return,
    };
    let presets_src = resource.join("resources").join("presets");
    if !presets_src.is_dir() {
        return;
    }

    let dsh_home = dsh_home();
    let presets_dest = dsh_home.join(".agent-presets");

    let entries = match std::fs::read_dir(&presets_src) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        if !entry.path().is_dir() {
            continue;
        }
        let name = entry.file_name();
        let target = presets_dest.join(&name);
        if target.exists() {
            continue;
        }
        let _ = std::fs::create_dir_all(&presets_dest);
        let _ = copy_dir_recursive(&entry.path(), &target);
    }

    // Also seed locale:zh in settings.yaml if it doesn't exist
    let settings = dsh_home.join("settings.yaml");
    if !settings.exists() {
        let _ = std::fs::create_dir_all(&dsh_home);
        let _ = std::fs::write(&settings, "locale:\n  preference: zh\n");
    }
}

/// Read the installed package version from a profile's `node_modules/<name>/package.json`.
fn read_installed_package_version(profile_dir: &Path, name: &str) -> Option<String> {
    let pkg_path = package_node_modules_dest(profile_dir, name).join("package.json");
    let raw = std::fs::read_to_string(&pkg_path).ok()?;
    let pkg = serde_json::from_str::<serde_json::Value>(&raw).ok()?;
    let pkg_name = pkg.get("name").and_then(|v| v.as_str())?;
    let pkg_version = pkg.get("version").and_then(|v| v.as_str())?;
    if pkg_name == name {
        Some(pkg_version.to_string())
    } else {
        None
    }
}

/// Rewrite leftover 0.1.1 desktop rows so a 0.1.2 companion can load.
/// `@deepseek-ai/dsh-client-app` becomes `@deepseek-ai/dsh-web-app`.
/// Legacy or unverified `dsh-context` is stripped from bundles and dependencies.
/// Modern `dsh-context` (0.74.0) is preserved if and only if both recorded
/// dependency and installed node_modules package version equal "0.74.0".
fn heal_desktop_profile_manifest_with_installed(
    manifest: &mut serde_json::Value,
    installed_context_version: Option<&str>,
) {
    let Some(object) = manifest.as_object_mut() else {
        return;
    };
    let dsh_context_spec = object
        .get("dependencies")
        .and_then(|d| d.get("dsh-context"))
        .and_then(|v| v.as_str());
    // Modern dsh-context requires BOTH recorded 0.74.0 AND installed 0.74.0
    let is_modern_dsh_context =
        dsh_context_spec == Some("0.74.0") && installed_context_version == Some("0.74.0");

    if let Some(deps) = object
        .get_mut("dependencies")
        .and_then(|value| value.as_object_mut())
    {
        for name in STRIP_DESKTOP_BUNDLES {
            deps.remove(*name);
        }
        deps.remove(RETIRED_DESKTOP_BUNDLE.0);
        if let Some(spec) = deps.get("dsh-context").and_then(|v| v.as_str()) {
            if is_legacy_dsh_context_spec(spec) {
                deps.remove("dsh-context");
            } else if spec == "0.74.0"
                && installed_context_version.is_some()
                && installed_context_version != Some("0.74.0")
            {
                // Disagreement between recorded 0.74.0 and installed version
                deps.remove("dsh-context");
            }
        }
    }
    let Some(bundles) = object
        .get_mut("dsh")
        .and_then(|dsh| dsh.as_object_mut())
        .and_then(|dsh| dsh.get_mut("profile"))
        .and_then(|profile| profile.as_object_mut())
        .and_then(|profile| profile.get_mut("bundles"))
        .and_then(|value| value.as_array_mut())
    else {
        return;
    };
    let mut next = Vec::new();
    let mut seen = std::collections::HashSet::<String>::new();
    for item in bundles.iter() {
        let Some(name) = item.as_str() else {
            continue;
        };
        if name == "dsh-context" && !is_modern_dsh_context {
            continue;
        }
        if STRIP_DESKTOP_BUNDLES.contains(&name) {
            continue;
        }
        let mapped = if name == RETIRED_DESKTOP_BUNDLE.0 {
            RETIRED_DESKTOP_BUNDLE.1
        } else {
            name
        };
        if seen.insert(mapped.to_string()) {
            next.push(serde_json::Value::String(mapped.to_string()));
        }
    }
    *bundles = next;
}

#[cfg(test)]
fn heal_desktop_profile_manifest(manifest: &mut serde_json::Value) {
    heal_desktop_profile_manifest_with_installed(manifest, None);
}

/// Heal an existing desktop profile manifest in place. Missing or unreadable
/// files are left untouched so first-launch copy can still create them.
fn heal_desktop_profile_file(profile_dir: &Path) -> std::io::Result<()> {
    let manifest_path = profile_dir.join("package.json");
    if !manifest_path.is_file() {
        return Ok(());
    }
    let raw = std::fs::read_to_string(&manifest_path)?;
    let mut manifest = serde_json::from_str::<serde_json::Value>(&raw)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
    let installed_context_version = read_installed_package_version(profile_dir, "dsh-context");
    heal_desktop_profile_manifest_with_installed(
        &mut manifest,
        installed_context_version.as_deref(),
    );
    let pretty = serde_json::to_string_pretty(&manifest)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
    std::fs::write(&manifest_path, format!("{pretty}\n"))
}

/// Name of the packaged payload revision file under `resources/`.
const SEED_REVISION_FILE: &str = "seed-rev.txt";

/// Name of the stamp a completed seed phase writes into the installed tree.
const SEED_STAMP_FILE: &str = ".dsh-seed-rev";

/// Outcome of one payload seed phase, reported once per launch in `companion.log`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SeedOutcome {
    /// The bundled tree was copied into the installed location.
    Reseeded,
    /// A copy or revision-stamp write failed; the phase is not complete.
    Failed,
    /// The installed copy already matches the announced revision.
    Skipped,
    /// The build staged no bundled tree.
    Absent,
}

impl SeedOutcome {
    /// Log word for this outcome.
    fn label(self) -> &'static str {
        match self {
            Self::Reseeded => "reseeded",
            Self::Failed => "reseed-failed",
            Self::Skipped => "skipped",
            Self::Absent => "absent",
        }
    }
}

/// Read the packaged payload revision; missing, empty, or malformed content is `None`.
fn read_seed_revision(app: &AppHandle) -> Option<String> {
    let resource = app.path().resource_dir().ok()?;
    let text = std::fs::read_to_string(resource.join("resources").join(SEED_REVISION_FILE)).ok()?;
    let text = text.trim();
    is_seed_revision(text).then(|| text.to_string())
}

/// Whether `text` is exactly the 64 lowercase hex characters both build scripts write.
fn is_seed_revision(text: &str) -> bool {
    text.len() == 64
        && text
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// Whether one installed stamp names `revision`; a symlinked stamp is never trusted.
fn stamp_matches(stamp: &Path, revision: &str) -> bool {
    match std::fs::symlink_metadata(stamp) {
        Ok(metadata) if metadata.file_type().is_symlink() => false,
        Ok(_) => std::fs::read_to_string(stamp)
            .map(|text| text.trim() == revision)
            .unwrap_or(false),
        Err(_) => false,
    }
}

/// Write one completed phase's stamp; a symlinked stamp is refused, not followed.
fn write_stamp(stamp: &Path, revision: &str) -> std::io::Result<()> {
    if std::fs::symlink_metadata(stamp)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            format!("seed stamp {} is a symlink", stamp.display()),
        ));
    }
    std::fs::write(stamp, format!("{revision}\n"))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ValidatedPlugin {
    pub(crate) name: String,
    pub(crate) version: String,
    pub(crate) default_enabled: bool,
    pub(crate) dir: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ValidatedInventory {
    pub(crate) plugins: Vec<ValidatedPlugin>,
}

/// Validate the entire profile-plugins inventory under `src_root`:
/// 1. `plugins.json` exists, is valid JSON, has `schemaVersion: 1`.
/// 2. `plugins` is a non-empty object where each entry has non-empty `version`
///    and boolean `defaultEnabled`.
/// 3. Each plugin directory exists on disk, has valid `package.json` with matching
///    name and matching declared version.
/// 4. Every physical plugin directory under `src_root` is declared in `plugins.json`.
fn validate_resource_inventory(src_root: &Path) -> Result<ValidatedInventory, String> {
    let manifest_path = src_root.join("plugins.json");
    let manifest_raw = std::fs::read_to_string(&manifest_path)
        .map_err(|err| format!("missing or unreadable {}: {err}", manifest_path.display()))?;
    let plugins_manifest: serde_json::Value = serde_json::from_str(&manifest_raw)
        .map_err(|err| format!("invalid JSON in {}: {err}", manifest_path.display()))?;

    let schema_version = plugins_manifest
        .get("schemaVersion")
        .and_then(|v| v.as_u64());
    if schema_version != Some(1) {
        return Err(format!(
            "{}: missing or unsupported schemaVersion (expected 1)",
            manifest_path.display()
        ));
    }

    let expected_plugins = plugins_manifest
        .get("plugins")
        .and_then(|v| v.as_object())
        .ok_or_else(|| format!("{}: missing 'plugins' object", manifest_path.display()))?;

    if expected_plugins.is_empty() {
        return Err(format!("{}: 'plugins' object is empty", manifest_path.display()));
    }

    let mut validated = Vec::new();
    let mut expected_names = std::collections::HashSet::new();

    for (name, entry) in expected_plugins {
        expected_names.insert(name.clone());
        let entry_obj = entry.as_object().ok_or_else(|| {
            format!("seed: plugin {name} entry is not an object")
        })?;
        let version = entry_obj
            .get("version")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| format!("seed: plugin {name} missing non-empty string 'version'"))?;
        let default_enabled = entry_obj
            .get("defaultEnabled")
            .and_then(|v| v.as_bool())
            .ok_or_else(|| format!("seed: plugin {name} missing boolean 'defaultEnabled'"))?;

        let plugin_dir = name
            .split('/')
            .fold(src_root.to_path_buf(), |acc, part| acc.join(part));
        if !plugin_dir.is_dir() {
            return Err(format!(
                "seed: plugin directory missing at {}",
                plugin_dir.display()
            ));
        }
        let pkg_path = plugin_dir.join("package.json");
        let pkg_raw = std::fs::read_to_string(&pkg_path)
            .map_err(|err| format!("seed: missing package.json at {}: {err}", pkg_path.display()))?;
        let pkg_json: serde_json::Value = serde_json::from_str(&pkg_raw)
            .map_err(|err| format!("seed: malformed package.json at {}: {err}", pkg_path.display()))?;
        let pkg_name = pkg_json.get("name").and_then(|v| v.as_str()).unwrap_or("");
        if pkg_name != name {
            return Err(format!(
                "seed: package.json name '{pkg_name}' does not match inventory name '{name}'"
            ));
        }
        let pkg_version = pkg_json.get("version").and_then(|v| v.as_str()).unwrap_or("");
        if pkg_version != version {
            return Err(format!(
                "seed: package.json version '{pkg_version}' does not match inventory version '{version}' for {name}"
            ));
        }

        validated.push(ValidatedPlugin {
            name: name.clone(),
            version: version.to_string(),
            default_enabled,
            dir: plugin_dir,
        });
    }

    // Ensure no uninventoried packages exist under src_root
    let physical_dirs = bundled_profile_plugin_dirs(src_root);
    for dir in physical_dirs {
        let pkg_path = dir.join("package.json");
        if !pkg_path.is_file() {
            return Err(format!(
                "seed: packaged plugin missing package.json at {}",
                dir.display()
            ));
        }
        let pkg_raw = std::fs::read_to_string(&pkg_path)
            .map_err(|err| format!("seed: unreadable package.json at {}: {err}", pkg_path.display()))?;
        let pkg_json: serde_json::Value = serde_json::from_str(&pkg_raw)
            .map_err(|err| format!("seed: malformed package.json in packaged dir {}: {err}", dir.display()))?;
        let name = pkg_json.get("name").and_then(|v| v.as_str()).unwrap_or("");
        if !expected_names.contains(name) {
            return Err(format!(
                "seed: packaged plugin '{name}' at {} is not declared in plugins.json",
                dir.display()
            ));
        }
    }

    Ok(ValidatedInventory { plugins: validated })
}

/// Whether the installed desktop profile can be reused for `revision`: its
/// stamp matches, its manifest parses and lists every bundled package from the
/// validated inventory, each bundled package is installed with the exact expected
/// version under `node_modules/`, and both profile template files exist.
fn desktop_profile_seeded(
    profile_dir: &Path,
    inventory: &ValidatedInventory,
    revision: Option<&str>,
) -> bool {
    let Some(revision) = revision else {
        return false;
    };
    if !stamp_matches(&profile_dir.join(SEED_STAMP_FILE), revision) {
        return false;
    }
    let Ok(raw) = std::fs::read_to_string(profile_dir.join("package.json")) else {
        return false;
    };
    let Ok(manifest) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return false;
    };
    let Some(dependencies) = manifest
        .get("dependencies")
        .and_then(|value| value.as_object())
    else {
        return false;
    };
    for plugin in &inventory.plugins {
        if dependencies.get(&plugin.name).and_then(|v| v.as_str()) != Some(&plugin.version) {
            return false;
        }
        let installed_pkg_path =
            package_node_modules_dest(profile_dir, &plugin.name).join("package.json");
        let Ok(pkg_raw) = std::fs::read_to_string(&installed_pkg_path) else {
            return false;
        };
        let Ok(pkg_json) = serde_json::from_str::<serde_json::Value>(&pkg_raw) else {
            return false;
        };
        if pkg_json.get("name").and_then(|v| v.as_str()) != Some(&plugin.name) {
            return false;
        }
        if pkg_json.get("version").and_then(|v| v.as_str()) != Some(&plugin.version) {
            return false;
        }
    }
    profile_dir.join("cordis.patch.yml").is_file()
        && profile_dir.join("pnpm-workspace.yaml").is_file()
}

/// Whether every bundled skill is installed under its name with its `SKILL.md`.
fn bundled_skills_seeded(skills_dir: &Path, bundled: &[String], revision: Option<&str>) -> bool {
    let Some(revision) = revision else {
        return false;
    };
    stamp_matches(&skills_dir.join(SEED_STAMP_FILE), revision)
        && bundled
            .iter()
            .all(|name| skills_dir.join(name).join("SKILL.md").is_file())
}

/// Copy each Resources/resources/profile-plugins package into the live desktop
/// profile. Dest is `node_modules/<package.json name>` (scoped names included).
/// First install appends the bundle; a later refresh does not put back a
/// bundle the user removed. A revision stamp on a complete profile skips the
/// copy; every launch also heals leftover `dsh-client-app` and `dsh-context`
/// rows so a 0.1.1 profile can boot on 0.1.2.
pub(crate) fn install_bundled_profile_plugins_in(
    profile_dir: &Path,
    src_root: Option<&Path>,
    revision: Option<&str>,
) -> Result<SeedOutcome, Box<dyn std::error::Error>> {
    // 1. Safety heal runs FIRST. If healing fails (unreadable/unwritable), fail startup immediately!
    if let Err(err) = heal_desktop_profile_file(profile_dir) {
        eprintln!("seed: heal_desktop_profile_file failed: {err}");
        return Err(Box::new(err));
    }
    let Some(src_root) = src_root else {
        return Ok(SeedOutcome::Absent);
    };
    if !src_root.is_dir() {
        return Ok(SeedOutcome::Absent);
    }
    // 2. Validate entire resource inventory BEFORE any skip or mutation!
    let inventory = match validate_resource_inventory(src_root) {
        Ok(inv) => inv,
        Err(err) => {
            eprintln!("seed: validate_resource_inventory failed: {err}");
            return Ok(SeedOutcome::Failed);
        }
    };
    // 3. Derived completeness check
    if desktop_profile_seeded(profile_dir, &inventory, revision) {
        return Ok(SeedOutcome::Skipped);
    }
    // 4. Install each plugin from validated inventory
    let mut failed = false;
    for plugin in &inventory.plugins {
        if install_one_profile_plugin(
            profile_dir,
            &plugin.name,
            &plugin.dir,
            plugin.default_enabled,
        )
        .is_err()
        {
            failed = true;
        }
    }
    if failed {
        return Ok(SeedOutcome::Failed);
    }
    if let Some(revision) = revision {
        if let Err(error) = write_stamp(&profile_dir.join(SEED_STAMP_FILE), revision) {
            eprintln!("seed: profile revision stamp failed: {error}");
            return Ok(SeedOutcome::Failed);
        }
    }
    Ok(SeedOutcome::Reseeded)
}

fn install_bundled_profile_plugins(
    app: &AppHandle,
    revision: Option<&str>,
) -> Result<SeedOutcome, Box<dyn std::error::Error>> {
    let profile_dir = dsh_home().join("profiles").join("desktop");
    let resource = app.path().resource_dir().ok();
    let src_root = resource.map(|r| r.join("resources").join("profile-plugins"));
    install_bundled_profile_plugins_in(&profile_dir, src_root.as_deref(), revision)
}

/// Run the production profile installer through the test-only carrier harness.
#[cfg(feature = "harness")]
pub fn seed_profile_for_harness(
    profile_dir: &Path,
    src_root: &Path,
    revision: &str,
) -> Result<&'static str, Box<dyn std::error::Error>> {
    if !is_seed_revision(revision) {
        return Err("invalid seed revision".into());
    }
    install_bundled_profile_plugins_in(profile_dir, Some(src_root), Some(revision))
        .map(SeedOutcome::label)
}

/// Profile-plugin directories under Resources, including scoped `@scope/name` children.
fn bundled_profile_plugin_dirs(src_root: &Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let Ok(entries) = std::fs::read_dir(src_root) else {
        return dirs;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let file_name = entry.file_name();
        let Some(name) = file_name.to_str() else {
            continue;
        };
        if name.starts_with('@') {
            let Ok(children) = std::fs::read_dir(&path) else {
                continue;
            };
            for child in children.flatten() {
                let child_path = child.path();
                if child_path.is_dir() && child_path.join("package.json").is_file() {
                    dirs.push(child_path);
                }
            }
            continue;
        }
        if path.join("package.json").is_file() {
            dirs.push(path);
        }
    }
    dirs
}


/// `node_modules/<name>` including scoped `@scope/name` children.
fn package_node_modules_dest(profile_dir: &Path, name: &str) -> PathBuf {
    name.split('/')
        .fold(profile_dir.join("node_modules"), |acc, part| acc.join(part))
}

fn install_one_profile_plugin(
    profile_dir: &Path,
    name: &str,
    src: &Path,
    default_enabled: bool,
) -> std::io::Result<()> {
    std::fs::create_dir_all(profile_dir)?;
    let manifest_path = profile_dir.join("package.json");
    let created = !manifest_path.is_file();
    let mut manifest = if created {
        serde_json::json!({
            "name": "dsh-profile-desktop",
            "private": true,
            "dependencies": {},
            "dsh": { "profile": { "bundles": DESKTOP_SHIPPED_BUNDLES } }
        })
    } else {
        let raw = std::fs::read_to_string(&manifest_path)?;
        let mut existing = serde_json::from_str(&raw)
            .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
        let installed_context_version = read_installed_package_version(profile_dir, "dsh-context");
        heal_desktop_profile_manifest_with_installed(
            &mut existing,
            installed_context_version.as_deref(),
        );
        let pretty = serde_json::to_string_pretty(&existing)
            .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
        std::fs::write(&manifest_path, format!("{pretty}\n"))?;
        existing
    };
    let dest = package_node_modules_dest(profile_dir, name);
    if dest
        .symlink_metadata()
        .map(|meta| meta.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            format!("profile plugin dest {} is a symlink", dest.display()),
        ));
    }
    let first_install = !dest.join("package.json").is_file();
    if dest.exists() {
        let _ = std::fs::remove_dir_all(&dest);
    }
    copy_dir_recursive(src, &dest)?;
    let version = std::fs::read_to_string(dest.join("package.json"))
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|value| {
            value
                .get("version")
                .and_then(|v| v.as_str())
                .map(str::to_owned)
        })
        .unwrap_or_else(|| "0.0.0".into());
    if let Some(object) = manifest.as_object_mut() {
        object.insert("private".into(), serde_json::json!(true));
        let dependencies = object
            .entry("dependencies")
            .or_insert_with(|| serde_json::json!({}));
        if let Some(deps) = dependencies.as_object_mut() {
            deps.insert(name.to_string(), serde_json::Value::String(version));
        }
        if (created || first_install) && default_enabled {
            let bundles = object
                .entry("dsh")
                .or_insert_with(|| serde_json::json!({}))
                .as_object_mut()
                .and_then(|dsh| {
                    dsh.entry("profile")
                        .or_insert_with(|| serde_json::json!({}))
                        .as_object_mut()
                })
                .map(|profile| {
                    profile
                        .entry("bundles")
                        .or_insert_with(|| serde_json::json!([]))
                });
            if let Some(serde_json::Value::Array(list)) = bundles {
                let already = list.iter().any(|item| item.as_str() == Some(name));
                if !already {
                    list.push(serde_json::Value::String(name.to_string()));
                }
            }
        }
    }
    std::fs::write(
        &manifest_path,
        format!(
            "{}\n",
            serde_json::to_string_pretty(&manifest).unwrap_or_else(|_| "{}".into())
        ),
    )?;
    let patch_path = profile_dir.join("cordis.patch.yml");
    if !patch_path.is_file() {
        std::fs::write(patch_path, PROFILE_PATCH_TEMPLATE)?;
    }
    let workspace_path = profile_dir.join("pnpm-workspace.yaml");
    if !workspace_path.is_file() {
        std::fs::write(workspace_path, PROFILE_PNPM_WORKSPACE)?;
    }
    Ok(())
}

/// Copy each Resources/resources/bundled-skills package into ~/.dsh/skills so
/// every workspace can load fork-shipped skills (user-dsh, rank 400). A
/// revision stamp skips the copy while every installed skill keeps its
/// `SKILL.md`. Preserves local `.rate-limit-state.json` across refreshes.
fn install_bundled_skills(app: &AppHandle, revision: Option<&str>) -> SeedOutcome {
    let Ok(resource) = app.path().resource_dir() else {
        return SeedOutcome::Absent;
    };
    let src_root = resource.join("resources").join("bundled-skills");
    if !src_root.is_dir() {
        return SeedOutcome::Absent;
    }
    let Ok(entries) = std::fs::read_dir(&src_root) else {
        return SeedOutcome::Absent;
    };
    let skills = entries
        .flatten()
        .filter_map(|entry| {
            let src = entry.path();
            if !src.is_dir() || !src.join("SKILL.md").is_file() {
                return None;
            }
            entry
                .file_name()
                .to_str()
                .map(|name| (name.to_string(), src))
        })
        .collect::<Vec<_>>();
    let dest_root = dsh_home().join("skills");
    let bundled = skills
        .iter()
        .map(|(name, _)| name.clone())
        .collect::<Vec<_>>();
    if bundled_skills_seeded(&dest_root, &bundled, revision) {
        return SeedOutcome::Skipped;
    }
    let mut failed = false;
    for (name, src) in &skills {
        let dest = dest_root.join(name);
        let state_backup = dest.join(".rate-limit-state.json");
        let saved_state = std::fs::read(&state_backup).ok();
        if dest.exists() {
            let _ = std::fs::remove_dir_all(&dest);
        }
        if copy_dir_recursive(src, &dest).is_err() {
            failed = true;
            continue;
        }
        if let Some(bytes) = saved_state {
            let _ = std::fs::write(dest.join(".rate-limit-state.json"), bytes);
        }
    }
    if failed {
        return SeedOutcome::Failed;
    }
    if let Some(revision) = revision {
        let _ = std::fs::create_dir_all(&dest_root);
        let _ = write_stamp(&dest_root.join(SEED_STAMP_FILE), revision);
    }
    SeedOutcome::Reseeded
}

/// Append this launch's seed decision to the companion log.
fn log_seed_decision(
    path: &Path,
    revision: Option<&str>,
    plugins: SeedOutcome,
    skills: SeedOutcome,
) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) else {
        return;
    };
    let _ = writeln!(
        file,
        "--- desktop payload seed (revision {}): profile-plugins {}, bundled-skills {} ---",
        revision.unwrap_or("absent"),
        plugins.label(),
        skills.label()
    );
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

/// Start the desktop window process.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let cache_root = app.path().app_data_dir()?;
            std::fs::create_dir_all(&config_dir)?;
            std::fs::create_dir_all(&cache_root)?;
            let cli_path = installed_runtime_cli(app.app_handle())?;
            let path_value = std::env::var("PATH").unwrap_or_default();
            let bundled = discover_bundled_resources(app.app_handle());
            let seed_revision = read_seed_revision(app.app_handle());
            install_bundled_presets(app.app_handle());
            let plugins =
                install_bundled_profile_plugins(app.app_handle(), seed_revision.as_deref())?;
            let skills = install_bundled_skills(app.app_handle(), seed_revision.as_deref());
            log_seed_decision(
                &cache_root.join("companion.log"),
                seed_revision.as_deref(),
                plugins,
                skills,
            );
            app.manage(AppState(Arc::new(Mutex::new(DesktopShell::new(
                config_dir, cache_root, cli_path, path_value, bundled,
            )))));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            runtime_configure,
            runtime_get_config,
            runtime_resolve,
            carrier_open,
            carrier_send,
            cache_bundle,
        ])
        .run(tauri::generate_context!())
        .expect("error while running octopus_DSH desktop");
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    const REVISION: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const OTHER_REVISION: &str = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

    /**
     * Write one complete desktop profile.
     *
     * @param root - tempdir root.
     * @param stamp - seed revision to stamp, or `None`.
     * @param dependencies - package names the manifest lists.
     */
    fn write_profile(root: &Path, stamp: Option<&str>, dependencies: &[&str]) {
        let profile = root.join("profiles").join("desktop");
        std::fs::create_dir_all(&profile).expect("profile dir");
        let deps = dependencies
            .iter()
            .map(|name| {
                (
                    (*name).to_string(),
                    serde_json::Value::String("1.0.0".into()),
                )
            })
            .collect::<serde_json::Map<String, serde_json::Value>>();
        let manifest = serde_json::json!({
            "name": "dsh-profile-desktop",
            "private": true,
            "dependencies": deps,
        });
        std::fs::write(profile.join("package.json"), manifest.to_string()).expect("manifest");
        for name in dependencies {
            let installed = package_node_modules_dest(&profile, name);
            std::fs::create_dir_all(&installed).expect("installed package dir");
            std::fs::write(
                installed.join("package.json"),
                format!("{{ \"name\": \"{name}\", \"version\": \"1.0.0\" }}\n"),
            )
            .expect("installed package manifest");
        }
        std::fs::write(profile.join("cordis.patch.yml"), "[]\n").expect("patch layer");
        std::fs::write(profile.join("pnpm-workspace.yaml"), "packages:\n  - .\n")
            .expect("pnpm workspace");
        if let Some(value) = stamp {
            std::fs::write(profile.join(SEED_STAMP_FILE), format!("{value}\n")).expect("stamp");
        }
    }

    #[test]
    fn seed_revision_text_requires_64_lowercase_hex() {
        assert!(is_seed_revision(REVISION));
        assert!(!is_seed_revision(""));
        assert!(!is_seed_revision(&REVISION.to_uppercase()));
        assert!(!is_seed_revision(&REVISION[..63]));
        assert!(!is_seed_revision(&format!("{REVISION}g")));
        assert!(!is_seed_revision(
            "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"
        ));
    }

    #[test]
    fn profile_seed_decision_requires_revision_stamp_and_complete_profile() {
        let dir = tempdir().expect("tempdir");
        let inventory = ValidatedInventory {
            plugins: vec![ValidatedPlugin {
                name: "@scope/plugin".to_string(),
                version: "1.0.0".to_string(),
                default_enabled: true,
                dir: PathBuf::from("/mock/dir"),
            }],
        };
        let profile = dir.path().join("profiles").join("desktop");
        // Missing destination: nothing is installed yet.
        assert!(!desktop_profile_seeded(&profile, &inventory, Some(REVISION)));
        write_profile(dir.path(), Some(REVISION), &["@scope/plugin"]);
        // Matching revision on a complete profile.
        assert!(desktop_profile_seeded(&profile, &inventory, Some(REVISION)));
        // Missing announced revision: the payload cannot be trusted.
        assert!(!desktop_profile_seeded(&profile, &inventory, None));
        // Stale stamp: a changed payload must copy again.
        assert!(!desktop_profile_seeded(
            &profile,
            &inventory,
            Some(OTHER_REVISION)
        ));
        // Missing profile manifest.
        std::fs::remove_file(profile.join("package.json")).expect("remove manifest");
        assert!(!desktop_profile_seeded(&profile, &inventory, Some(REVISION)));
        // Manifest without the bundled dependency.
        write_profile(dir.path(), Some(REVISION), &[]);
        assert!(!desktop_profile_seeded(&profile, &inventory, Some(REVISION)));
        // Missing profile template file.
        write_profile(dir.path(), Some(REVISION), &["@scope/plugin"]);
        std::fs::remove_file(profile.join("cordis.patch.yml")).expect("remove patch layer");
        assert!(!desktop_profile_seeded(&profile, &inventory, Some(REVISION)));
        // Installed package removed after the copy (hand deletion, quarantine):
        // the stamp survives, so the installed copy itself must be checked.
        write_profile(dir.path(), Some(REVISION), &["@scope/plugin"]);
        std::fs::remove_dir_all(package_node_modules_dest(&profile, "@scope/plugin"))
            .expect("remove installed package");
        assert!(!desktop_profile_seeded(&profile, &inventory, Some(REVISION)));
    }

    #[test]
    fn bundled_skill_seed_requires_stamp_and_every_skill_md() {
        let dir = tempdir().expect("tempdir");
        let skills = dir.path().join("skills");
        let bundled = vec!["wechat".to_string()];
        assert!(!bundled_skills_seeded(&skills, &bundled, Some(REVISION)));
        std::fs::create_dir_all(skills.join("wechat")).expect("skill dir");
        std::fs::write(skills.join(SEED_STAMP_FILE), format!("{REVISION}\n")).expect("stamp");
        // The stamp alone is not enough while a bundled skill is missing.
        assert!(!bundled_skills_seeded(&skills, &bundled, Some(REVISION)));
        std::fs::write(skills.join("wechat").join("SKILL.md"), "# skill\n").expect("skill file");
        assert!(bundled_skills_seeded(&skills, &bundled, Some(REVISION)));
        std::fs::remove_file(skills.join("wechat").join("SKILL.md")).expect("remove skill");
        assert!(!bundled_skills_seeded(&skills, &bundled, Some(REVISION)));
    }

    #[cfg(unix)]
    #[test]
    fn seed_stamp_symlink_is_never_trusted() {
        let dir = tempdir().expect("tempdir");
        write_profile(dir.path(), None, &[]);
        let profile = dir.path().join("profiles").join("desktop");
        let target = dir.path().join("elsewhere");
        std::fs::write(&target, format!("{REVISION}\n")).expect("target");
        std::os::unix::fs::symlink(&target, profile.join(SEED_STAMP_FILE)).expect("symlink");
        let inventory = ValidatedInventory { plugins: vec![] };
        assert!(!desktop_profile_seeded(&profile, &inventory, Some(REVISION)));
        assert!(write_stamp(&profile.join(SEED_STAMP_FILE), REVISION).is_err());
    }

    #[test]
    fn heal_manifest_handles_legacy_and_modern_dsh_context() {
        // Case 1: Legacy 0.36.0 in bundles -> stripped from bundles and dependencies
        let mut legacy = serde_json::json!({
            "dependencies": {
                "dsh-context": "0.36.0",
                "@deepseek-ai/dsh-client-app": "0.1.1"
            },
            "dsh": {
                "profile": {
                    "bundles": [
                        "@deepseek-ai/dsh-base",
                        "@deepseek-ai/dsh-client-app",
                        "dsh-context"
                    ]
                }
            }
        });
        heal_desktop_profile_manifest(&mut legacy);
        let bundles = legacy["dsh"]["profile"]["bundles"].as_array().unwrap();
        assert_eq!(
            bundles,
            &vec![
                serde_json::json!("@deepseek-ai/dsh-base"),
                serde_json::json!("@deepseek-ai/dsh-web-app"),
            ]
        );
        assert!(legacy["dependencies"].get("dsh-context").is_none());

        // Case 2: Modern 0.74.0 toggled ON with matching installed 0.74.0 -> preserved
        let mut modern_on = serde_json::json!({
            "dependencies": {
                "dsh-context": "0.74.0"
            },
            "dsh": {
                "profile": {
                    "bundles": [
                        "@deepseek-ai/dsh-base",
                        "@deepseek-ai/dsh-web-app",
                        "dsh-context"
                    ]
                }
            }
        });
        heal_desktop_profile_manifest_with_installed(&mut modern_on, Some("0.74.0"));
        let bundles_on = modern_on["dsh"]["profile"]["bundles"].as_array().unwrap();
        assert_eq!(
            bundles_on,
            &vec![
                serde_json::json!("@deepseek-ai/dsh-base"),
                serde_json::json!("@deepseek-ai/dsh-web-app"),
                serde_json::json!("dsh-context"),
            ]
        );
        assert_eq!(
            modern_on["dependencies"].get("dsh-context"),
            Some(&serde_json::json!("0.74.0"))
        );

        // Case 2b: Modern 0.74.0 recorded but installed version is 0.36.0 (disagreement) -> stripped from bundles & deps
        let mut modern_disagrees = modern_on.clone();
        heal_desktop_profile_manifest_with_installed(&mut modern_disagrees, Some("0.36.0"));
        let bundles_disagrees = modern_disagrees["dsh"]["profile"]["bundles"].as_array().unwrap();
        assert_eq!(
            bundles_disagrees,
            &vec![
                serde_json::json!("@deepseek-ai/dsh-base"),
                serde_json::json!("@deepseek-ai/dsh-web-app"),
            ]
        );
        assert!(modern_disagrees["dependencies"].get("dsh-context").is_none());

        // Case 2c: Modern 0.74.0 recorded but installed version is missing (None) -> stripped from bundles
        let mut modern_missing_installed = modern_on.clone();
        heal_desktop_profile_manifest_with_installed(&mut modern_missing_installed, None);
        let bundles_missing = modern_missing_installed["dsh"]["profile"]["bundles"].as_array().unwrap();
        assert_eq!(
            bundles_missing,
            &vec![
                serde_json::json!("@deepseek-ai/dsh-base"),
                serde_json::json!("@deepseek-ai/dsh-web-app"),
            ]
        );

        // Case 3: Modern 0.74.0 kept OFF with matching installed 0.74.0 -> preserved in dependencies
        let mut modern_off = serde_json::json!({
            "dependencies": {
                "dsh-context": "0.74.0"
            },
            "dsh": {
                "profile": {
                    "bundles": [
                        "@deepseek-ai/dsh-base",
                        "@deepseek-ai/dsh-web-app"
                    ]
                }
            }
        });
        heal_desktop_profile_manifest_with_installed(&mut modern_off, Some("0.74.0"));
        let bundles_off = modern_off["dsh"]["profile"]["bundles"].as_array().unwrap();
        assert_eq!(
            bundles_off,
            &vec![
                serde_json::json!("@deepseek-ai/dsh-base"),
                serde_json::json!("@deepseek-ai/dsh-web-app"),
            ]
        );
        assert_eq!(
            modern_off["dependencies"].get("dsh-context"),
            Some(&serde_json::json!("0.74.0"))
        );

        // Case 4: Legacy range ^0.36.0 or unrecorded selection -> stripped
        let mut legacy_range = serde_json::json!({
            "dependencies": {
                "dsh-context": "^0.36.0"
            },
            "dsh": {
                "profile": {
                    "bundles": [
                        "@deepseek-ai/dsh-base",
                        "dsh-context"
                    ]
                }
            }
        });
        heal_desktop_profile_manifest(&mut legacy_range);
        assert_eq!(
            legacy_range["dsh"]["profile"]["bundles"].as_array().unwrap(),
            &vec![serde_json::json!("@deepseek-ai/dsh-base")]
        );
        assert!(legacy_range["dependencies"].get("dsh-context").is_none());
    }

    #[test]
    fn install_bundled_profile_plugins_in_fails_startup_when_heal_write_fails() {
        let dir = tempdir().expect("tempdir");
        let profile = dir.path().join("profiles").join("desktop");
        std::fs::create_dir_all(&profile).expect("create profile dir");
        let manifest_path = profile.join("package.json");
        std::fs::write(&manifest_path, "not-json").expect("write invalid json");

        let outcome = install_bundled_profile_plugins_in(&profile, None, Some(REVISION));
        // Must return an Err so setup aborts instead of continuing companion launch
        assert!(outcome.is_err());
    }

    #[test]
    fn install_bundled_profile_plugins_in_validates_inventory_and_mismatched_packages() {
        let dir = tempdir().expect("tempdir");
        let profile = dir.path().join("profiles").join("desktop");
        let resources = dir.path().join("resources").join("profile-plugins");
        std::fs::create_dir_all(&resources).expect("create resources dir");

        // Subcase A: missing plugins.json -> returns Ok(SeedOutcome::Failed)
        let outcome = install_bundled_profile_plugins_in(&profile, Some(&resources), Some(REVISION));
        assert_eq!(outcome.unwrap(), SeedOutcome::Failed);

        // Subcase B: plugins.json with missing defaultEnabled -> returns Ok(SeedOutcome::Failed)
        let manifest = serde_json::json!({
            "schemaVersion": 1,
            "plugins": {
                "dsh-context": {
                    "version": "0.74.0"
                }
            }
        });
        std::fs::write(resources.join("plugins.json"), manifest.to_string()).expect("write plugins.json");
        let outcome = install_bundled_profile_plugins_in(&profile, Some(&resources), Some(REVISION));
        assert_eq!(outcome.unwrap(), SeedOutcome::Failed);

        // Subcase C: inventory claims 0.74.0 but directory package.json contains 0.36.0 -> returns Ok(SeedOutcome::Failed)
        let plugin_dir = resources.join("dsh-context");
        std::fs::create_dir_all(&plugin_dir).expect("plugin dir");
        std::fs::write(
            plugin_dir.join("package.json"),
            "{\"name\": \"dsh-context\", \"version\": \"0.36.0\"}\n",
        ).expect("write 0.36.0 pkg");
        let valid_manifest = serde_json::json!({
            "schemaVersion": 1,
            "plugins": {
                "dsh-context": {
                    "version": "0.74.0",
                    "defaultEnabled": false
                }
            }
        });
        std::fs::write(resources.join("plugins.json"), valid_manifest.to_string()).expect("write valid plugins.json");
        let outcome = install_bundled_profile_plugins_in(&profile, Some(&resources), Some(REVISION));
        assert_eq!(outcome.unwrap(), SeedOutcome::Failed);

        // Subcase D: matching directory and inventory -> succeeds with Reseeded
        std::fs::write(
            plugin_dir.join("package.json"),
            "{\"name\": \"dsh-context\", \"version\": \"0.74.0\"}\n",
        ).expect("write 0.74.0 pkg");
        let outcome = install_bundled_profile_plugins_in(&profile, Some(&resources), Some(REVISION));
        assert_eq!(outcome.unwrap(), SeedOutcome::Reseeded);

        // Subcase E: after seeding with stamp, calling again returns Skipped
        let outcome_skip = install_bundled_profile_plugins_in(&profile, Some(&resources), Some(REVISION));
        assert_eq!(outcome_skip.unwrap(), SeedOutcome::Skipped);

        // Subcase F: if installed version is tampered/downgraded to 0.36.0, stamp matching does NOT skip
        let installed_pkg = package_node_modules_dest(&profile, "dsh-context").join("package.json");
        std::fs::write(&installed_pkg, "{\"name\": \"dsh-context\", \"version\": \"0.36.0\"}\n").expect("downgrade installed");
        let outcome_tampered = install_bundled_profile_plugins_in(&profile, Some(&resources), Some(REVISION));
        // It must NOT skip; it must repair and return Reseeded
        assert_eq!(outcome_tampered.unwrap(), SeedOutcome::Reseeded);
    }

    #[test]
    fn revision_refresh_preserves_context_selection_and_rejects_stamp_failure() {
        let dir = tempdir().expect("tempdir");
        let profile = dir.path().join("profile");
        let resources = dir.path().join("resources");
        let plugin = resources.join("dsh-context");
        std::fs::create_dir_all(&plugin).unwrap();
        std::fs::write(
            plugin.join("package.json"),
            r#"{"name":"dsh-context","version":"0.74.0"}"#,
        )
        .unwrap();
        std::fs::write(resources.join("plugins.json"),
            r#"{"schemaVersion":1,"plugins":{"dsh-context":{"version":"0.74.0","defaultEnabled":false}}}"#).unwrap();
        assert_eq!(
            install_bundled_profile_plugins_in(&profile, Some(&resources), Some(REVISION)).unwrap(),
            SeedOutcome::Reseeded
        );
        for enabled in [true, false] {
            let path = profile.join("package.json");
            let mut manifest: serde_json::Value =
                serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
            manifest["dsh"]["profile"]["bundles"] = if enabled {
                serde_json::json!(["dsh-context"])
            } else {
                serde_json::json!([])
            };
            std::fs::write(&path, manifest.to_string()).unwrap();
            write_stamp(&profile.join(SEED_STAMP_FILE), REVISION).unwrap();
            std::fs::write(plugin.join("payload-marker"), enabled.to_string()).unwrap();
            assert_eq!(
                install_bundled_profile_plugins_in(
                    &profile,
                    Some(&resources),
                    Some(OTHER_REVISION)
                )
                .unwrap(),
                SeedOutcome::Reseeded
            );
            assert!(stamp_matches(
                &profile.join(SEED_STAMP_FILE),
                OTHER_REVISION
            ));
            let after: serde_json::Value =
                serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
            assert_eq!(
                after["dsh"]["profile"]["bundles"]
                    .as_array()
                    .unwrap()
                    .contains(&serde_json::json!("dsh-context")),
                enabled
            );
            assert_eq!(
                std::fs::read_to_string(profile.join("node_modules/dsh-context/payload-marker"))
                    .unwrap(),
                enabled.to_string()
            );
        }
        std::fs::remove_file(profile.join(SEED_STAMP_FILE)).unwrap();
        std::fs::create_dir(profile.join(SEED_STAMP_FILE)).unwrap();
        assert_eq!(
            install_bundled_profile_plugins_in(&profile, Some(&resources), Some(REVISION)).unwrap(),
            SeedOutcome::Failed
        );
    }

    #[test]
    fn install_one_profile_plugin_respects_default_enabled() {
        let dir = tempdir().expect("tempdir");
        let profile = dir.path().join("profiles").join("desktop");
        let plugin_src = dir.path().join("plugin-src");
        std::fs::create_dir_all(&plugin_src).expect("create plugin src");
        std::fs::write(
            plugin_src.join("package.json"),
            "{\"name\": \"dsh-context\", \"version\": \"0.74.0\"}\n",
        )
        .expect("write plugin package.json");

        // First install with default_enabled: false
        install_one_profile_plugin(&profile, "dsh-context", &plugin_src, false)
            .expect("install disabled");
        let manifest: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(profile.join("package.json")).expect("read manifest"),
        )
        .expect("parse manifest");
        assert_eq!(
            manifest["dependencies"].get("dsh-context"),
            Some(&serde_json::json!("0.74.0"))
        );
        let bundles = manifest["dsh"]["profile"]["bundles"].as_array().unwrap();
        assert!(!bundles.contains(&serde_json::json!("dsh-context")));

        // Re-installing when user toggled it ON must preserve ON
        let mut toggled_on = manifest.clone();
        toggled_on["dsh"]["profile"]["bundles"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!("dsh-context"));
        std::fs::write(
            profile.join("package.json"),
            serde_json::to_string_pretty(&toggled_on).unwrap(),
        )
        .expect("write manifest");

        install_one_profile_plugin(&profile, "dsh-context", &plugin_src, false)
            .expect("reinstall");
        let reinstalled: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(profile.join("package.json")).expect("read manifest"),
        )
        .expect("parse manifest");
        let reinstalled_bundles = reinstalled["dsh"]["profile"]["bundles"].as_array().unwrap();
        assert!(reinstalled_bundles.contains(&serde_json::json!("dsh-context")));
    }
}
