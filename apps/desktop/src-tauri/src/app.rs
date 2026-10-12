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

const STRIP_DESKTOP_BUNDLES: &[&str] = &["dsh-context"];

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

/// Rewrite leftover 0.1.1 desktop rows so a 0.1.2 companion can load.
fn heal_desktop_profile_manifest(manifest: &mut serde_json::Value) {
    let Some(object) = manifest.as_object_mut() else {
        return;
    };
    if let Some(deps) = object
        .get_mut("dependencies")
        .and_then(|value| value.as_object_mut())
    {
        for name in STRIP_DESKTOP_BUNDLES {
            deps.remove(*name);
        }
        deps.remove(RETIRED_DESKTOP_BUNDLE.0);
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

/// Heal an existing desktop profile manifest in place. Missing or unreadable
/// files are left untouched so first-launch copy can still create them.
fn heal_desktop_profile_file(profile_dir: &Path) {
    let manifest_path = profile_dir.join("package.json");
    if !manifest_path.is_file() {
        return;
    }
    let Ok(raw) = std::fs::read_to_string(&manifest_path) else {
        return;
    };
    let Ok(mut manifest) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return;
    };
    heal_desktop_profile_manifest(&mut manifest);
    let pretty = serde_json::to_string_pretty(&manifest).unwrap_or(raw);
    let _ = std::fs::write(&manifest_path, format!("{pretty}\n"));
}

/// Name of the packaged payload revision file under `resources/`.
const SEED_REVISION_FILE: &str = "seed-rev.txt";

/// Name of the stamp a completed seed phase writes into the installed tree.
const SEED_STAMP_FILE: &str = ".dsh-seed-rev";

/// Outcome of one payload seed phase, reported once per launch in `companion.log`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SeedOutcome {
    /// The bundled tree was copied into the installed location.
    Reseeded,
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

/// Whether the installed desktop profile can be reused for `revision`: its
/// stamp matches, its manifest parses and lists every bundled package, and
/// both profile template files exist.
fn desktop_profile_seeded(profile_dir: &Path, bundled: &[String], revision: Option<&str>) -> bool {
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
    if !bundled.iter().all(|name| dependencies.contains_key(name)) {
        return false;
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
fn install_bundled_profile_plugins(app: &AppHandle, revision: Option<&str>) -> SeedOutcome {
    let Ok(resource) = app.path().resource_dir() else {
        return SeedOutcome::Absent;
    };
    let src_root = resource.join("resources").join("profile-plugins");
    if !src_root.is_dir() {
        return SeedOutcome::Absent;
    }
    let profile_dir = dsh_home().join("profiles").join("desktop");
    heal_desktop_profile_file(&profile_dir);
    let plugins = bundled_profile_plugin_dirs(&src_root)
        .into_iter()
        .filter_map(|src| package_json_name(&src).map(|name| (name, src)))
        .collect::<Vec<_>>();
    let bundled = plugins
        .iter()
        .map(|(name, _)| name.clone())
        .collect::<Vec<_>>();
    if desktop_profile_seeded(&profile_dir, &bundled, revision) {
        return SeedOutcome::Skipped;
    }
    let mut failed = false;
    for (name, src) in &plugins {
        if install_one_profile_plugin(&profile_dir, name, src).is_err() {
            failed = true;
        }
    }
    if !failed {
        if let Some(revision) = revision {
            let _ = std::fs::create_dir_all(&profile_dir);
            let _ = write_stamp(&profile_dir.join(SEED_STAMP_FILE), revision);
        }
    }
    SeedOutcome::Reseeded
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

/// npm package name from a plugin directory's package.json (scoped names included).
fn package_json_name(src: &Path) -> Option<String> {
    let raw = std::fs::read_to_string(src.join("package.json")).ok()?;
    let value: serde_json::Value = serde_json::from_str(&raw).ok()?;
    value.get("name")?.as_str().map(str::to_owned)
}

/// `node_modules/<name>` including scoped `@scope/name` children.
fn package_node_modules_dest(profile_dir: &Path, name: &str) -> PathBuf {
    name.split('/')
        .fold(profile_dir.join("node_modules"), |acc, part| acc.join(part))
}

fn install_one_profile_plugin(profile_dir: &Path, name: &str, src: &Path) -> std::io::Result<()> {
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
        heal_desktop_profile_manifest(&mut existing);
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
        if created || first_install {
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
    if !failed {
        if let Some(revision) = revision {
            let _ = std::fs::create_dir_all(&dest_root);
            let _ = write_stamp(&dest_root.join(SEED_STAMP_FILE), revision);
        }
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
                install_bundled_profile_plugins(app.app_handle(), seed_revision.as_deref());
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
        let bundled = vec!["@scope/plugin".to_string()];
        let profile = dir.path().join("profiles").join("desktop");
        // Missing destination: nothing is installed yet.
        assert!(!desktop_profile_seeded(&profile, &bundled, Some(REVISION)));
        write_profile(dir.path(), Some(REVISION), &["@scope/plugin"]);
        // Matching revision on a complete profile.
        assert!(desktop_profile_seeded(&profile, &bundled, Some(REVISION)));
        // Missing announced revision: the payload cannot be trusted.
        assert!(!desktop_profile_seeded(&profile, &bundled, None));
        // Stale stamp: a changed payload must copy again.
        assert!(!desktop_profile_seeded(
            &profile,
            &bundled,
            Some(OTHER_REVISION)
        ));
        // Missing profile manifest.
        std::fs::remove_file(profile.join("package.json")).expect("remove manifest");
        assert!(!desktop_profile_seeded(&profile, &bundled, Some(REVISION)));
        // Manifest without the bundled dependency.
        write_profile(dir.path(), Some(REVISION), &[]);
        assert!(!desktop_profile_seeded(&profile, &bundled, Some(REVISION)));
        // Missing profile template file.
        write_profile(dir.path(), Some(REVISION), &["@scope/plugin"]);
        std::fs::remove_file(profile.join("cordis.patch.yml")).expect("remove patch layer");
        assert!(!desktop_profile_seeded(&profile, &bundled, Some(REVISION)));
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
        assert!(!desktop_profile_seeded(&profile, &[], Some(REVISION)));
        assert!(write_stamp(&profile.join(SEED_STAMP_FILE), REVISION).is_err());
    }
}
