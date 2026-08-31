//! NDJSON stand-in for the Tauri invoke + Channel surface.

use dsh_desktop::{forward_carrier_events, CacheBundleArgs, DesktopShell, RuntimeConfig};
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Debug, Deserialize)]
struct HarnessRequest {
    id: u64,
    cmd: String,
    #[serde(default)]
    args: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigureArgs {
    node_path: Option<String>,
    runtime_path: Option<String>,
    workspace_root: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SendArgs {
    line: String,
}

fn env_dir(name: &str, default: PathBuf) -> PathBuf {
    std::env::var_os(name).map(PathBuf::from).unwrap_or(default)
}

fn write_line(out: &Mutex<std::io::Stdout>, value: &Value) -> Result<(), String> {
    let mut guard = out.lock().map_err(|error| error.to_string())?;
    writeln!(guard, "{value}").map_err(|error| error.to_string())?;
    guard.flush().map_err(|error| error.to_string())
}

fn reply_ok(out: &Mutex<std::io::Stdout>, id: u64, result: Value) -> Result<(), String> {
    write_line(out, &json!({ "id": id, "ok": true, "result": result }))
}

fn reply_err(out: &Mutex<std::io::Stdout>, id: u64, error: impl ToString) -> Result<(), String> {
    write_line(
        out,
        &json!({ "id": id, "ok": false, "error": error.to_string() }),
    )
}

fn dispatch(
    shell: &Arc<Mutex<DesktopShell>>,
    out: &Arc<Mutex<std::io::Stdout>>,
    request: HarnessRequest,
) -> Result<(), String> {
    let mut guard = shell.lock().map_err(|error| error.to_string())?;
    match request.cmd.as_str() {
        "runtime_configure" => {
            let args: ConfigureArgs =
                serde_json::from_value(request.args).map_err(|error| error.to_string())?;
            match guard.configure(&RuntimeConfig {
                node_path: args.node_path,
                runtime_path: args.runtime_path,
                workspace_root: args.workspace_root,
            }) {
                Ok(config) => reply_ok(
                    out,
                    request.id,
                    serde_json::to_value(config).map_err(|error| error.to_string())?,
                ),
                Err(error) => reply_err(out, request.id, error),
            }
        }
        "runtime_get_config" => match guard.get_config() {
            Ok(config) => reply_ok(
                out,
                request.id,
                serde_json::to_value(config).map_err(|error| error.to_string())?,
            ),
            Err(error) => reply_err(out, request.id, error),
        },
        "runtime_resolve" => match guard.resolve() {
            Ok(resolved) => reply_ok(
                out,
                request.id,
                serde_json::to_value(resolved).map_err(|error| error.to_string())?,
            ),
            Err(error) => reply_err(out, request.id, error),
        },
        "carrier_open" => match guard.carrier_open() {
            Ok(result) => {
                let generation_id = result.generation_id.clone();
                let payload = serde_json::to_value(&result).map_err(|error| error.to_string())?;
                drop(guard);
                let shared = Arc::clone(shell);
                let out_events = Arc::clone(out);
                forward_carrier_events(shared, generation_id, move |event| {
                    serde_json::to_value(&event)
                        .ok()
                        .and_then(|value| write_line(&out_events, &value).ok())
                        .is_some()
                });
                reply_ok(out, request.id, payload)
            }
            Err(error) => reply_err(out, request.id, error),
        },
        "carrier_send" => {
            let args: SendArgs =
                serde_json::from_value(request.args).map_err(|error| error.to_string())?;
            match guard.carrier_send(&args.line) {
                Ok(()) => reply_ok(out, request.id, Value::Null),
                Err(error) => reply_err(out, request.id, error),
            }
        }
        "cache_bundle" => {
            let args: CacheBundleArgs =
                serde_json::from_value(request.args).map_err(|error| error.to_string())?;
            match guard.cache_bundle_from_args(&args) {
                Ok(result) => reply_ok(
                    out,
                    request.id,
                    serde_json::to_value(result).map_err(|error| error.to_string())?,
                ),
                Err(error) => reply_err(out, request.id, error),
            }
        }
        other => reply_err(out, request.id, format!("unknown command: {other}")),
    }
}

fn main() {
    let home = env_dir(
        "DSH_DESKTOP_HARNESS_HOME",
        std::env::current_dir()
            .expect("cwd")
            .join(".dsh-desktop-harness"),
    );
    let config_dir = env_dir("DSH_DESKTOP_HARNESS_CONFIG", home.join("config"));
    let cache_root = env_dir("DSH_DESKTOP_HARNESS_CACHE", home.join("cache"));
    let cli_path = env_dir(
        "DSH_DESKTOP_HARNESS_CLI",
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/installed-runtime-cli.js"),
    );
    let path_value = std::env::var("PATH").unwrap_or_default();
    std::fs::create_dir_all(&config_dir).expect("create harness config dir");
    std::fs::create_dir_all(&cache_root).expect("create harness cache dir");
    let shell = Arc::new(Mutex::new(DesktopShell::new(
        config_dir,
        cache_root,
        cli_path,
        path_value,
        dsh_desktop::runtime::BundledResources::default(),
    )));
    let out = Arc::new(Mutex::new(std::io::stdout()));
    let stdin = std::io::stdin();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(line) if !line.is_empty() => line,
            Ok(_) => continue,
            Err(error) => {
                eprintln!("carrier-harness stdin: {error}");
                break;
            }
        };
        let request: HarnessRequest = match serde_json::from_str(&line) {
            Ok(request) => request,
            Err(error) => {
                let _ = write_line(&out, &json!({ "ok": false, "error": error.to_string() }));
                continue;
            }
        };
        if let Err(error) = dispatch(&shell, &out, request) {
            eprintln!("carrier-harness: {error}");
            break;
        }
    }
}
