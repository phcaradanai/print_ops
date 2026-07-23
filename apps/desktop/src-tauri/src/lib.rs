use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{Manager, Url};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const SERVER_URL: &str = "http://127.0.0.1:31415";
const SERVER_PORT: &str = "31415";

struct AppState {
    server_child: Mutex<Option<Child>>,
    runner_child: Mutex<Option<Child>>,
}

/// Directory used for diagnostic logs. Falls back to the exe directory when the
/// preferred location cannot be created.
fn log_dir(exe_dir: &Path) -> PathBuf {
    let dir = exe_dir.join("logs");
    if fs::create_dir_all(&dir).is_ok() {
        return dir;
    }
    exe_dir.to_path_buf()
}

fn log_line(log_path: &Path, msg: &str) {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(log_path) {
        let _ = writeln!(f, "[{secs}] {msg}");
    }
    println!("[PrintOps] {msg}");
}

/// Resolve the directory that actually holds the bundled resources.
///
/// Tauri copies bundle resources preserving their declared relative path, so
/// `resources/server.exe` in tauri.conf.json lands in `<resource_dir>/resources/`.
/// Dev runs and other layouts may place them directly in `<resource_dir>`, so
/// every plausible location is probed.
fn resolve_resource_dir(resource_dir: &Path, exe_dir: &Path) -> PathBuf {
    let candidates = [
        resource_dir.join("resources"),
        resource_dir.to_path_buf(),
        exe_dir.join("resources"),
        exe_dir.to_path_buf(),
    ];
    for c in &candidates {
        if c.join("server.exe").exists() {
            return c.clone();
        }
    }
    resource_dir.join("resources")
}

/// stdout/stderr sinks for a child process. Piped stdio with no reader deadlocks
/// the child once the pipe buffer fills, so output goes to a log file instead.
fn child_stdio(log_path: &Path) -> (Stdio, Stdio) {
    match File::create(log_path) {
        Ok(out) => match out.try_clone() {
            Ok(err) => (Stdio::from(out), Stdio::from(err)),
            Err(_) => (Stdio::from(out), Stdio::null()),
        },
        Err(_) => (Stdio::null(), Stdio::null()),
    }
}

/// Spawn a child, logging failure instead of panicking — a missing or broken
/// sidecar must not take the whole desktop app down.
fn spawn_child(mut cmd: Command, log: &Path, label: &str) -> Option<Child> {
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    match cmd.spawn() {
        Ok(child) => {
            log_line(log, &format!("{label} started (pid: {})", child.id()));
            Some(child)
        }
        Err(e) => {
            log_line(log, &format!("ERROR: failed to start {label}: {e}"));
            None
        }
    }
}

fn kill_child(slot: &Mutex<Option<Child>>, log: &Path, label: &str) {
    if let Ok(mut guard) = slot.lock() {
        if let Some(mut child) = guard.take() {
            log_line(log, &format!("Shutting down {label}..."));
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // This must be the first plugin registered. A second Desktop launch is
        // routed back to this process instead of spawning another API/runner
        // pair against the same sql.js database.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let exe_dir = std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(Path::to_path_buf))
                .unwrap_or_else(|| PathBuf::from("."));
            let logs = log_dir(&exe_dir);
            let app_log = logs.join("desktop.log");

            // Any remaining panic must leave a trace: with
            // windows_subsystem = "windows" the process has no console.
            {
                let panic_log = app_log.clone();
                std::panic::set_hook(Box::new(move |info| {
                    log_line(&panic_log, &format!("PANIC: {info}"));
                }));
            }

            let resource_dir = app
                .path()
                .resource_dir()
                .unwrap_or_else(|_| exe_dir.clone());
            let res_dir = resolve_resource_dir(&resource_dir, &exe_dir);

            let server_exe = res_dir.join("server.exe");
            let runner_exe = res_dir.join("printops-runner.exe");
            let wasm_path = res_dir.join("sql-wasm.wasm");

            log_line(&app_log, "--- PrintOps desktop starting ---");
            log_line(
                &app_log,
                &format!("resource_dir: {}", resource_dir.display()),
            );
            log_line(
                &app_log,
                &format!("resolved res_dir: {}", res_dir.display()),
            );
            log_line(
                &app_log,
                &format!(
                    "server.exe: {} (exists: {})",
                    server_exe.display(),
                    server_exe.exists()
                ),
            );
            log_line(
                &app_log,
                &format!(
                    "printops-runner.exe: {} (exists: {})",
                    runner_exe.display(),
                    runner_exe.exists()
                ),
            );

            // Database lives in the per-user app data dir so the app still works
            // when installed to a read-only location.
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| res_dir.clone());
            let _ = fs::create_dir_all(&data_dir);
            let db_path = data_dir.join("printops.db");
            log_line(&app_log, &format!("db path: {}", db_path.display()));

            // ── Start API server ──
            let server_child = if server_exe.exists() {
                let (out, err) = child_stdio(&logs.join("desktop-server.log"));
                let mut cmd = Command::new(&server_exe);
                // Store settings, paper profiles, and registered printers in
                // the per-user database above. This survives app restarts and
                // desktop upgrades because it is outside the install folder.
                cmd.current_dir(&res_dir)
                    .env("PORT", SERVER_PORT)
                    .env("DB_MODE", "sqlite")
                    .env("PRINTOPS_LOCAL_WORKER", "true")
                    .env("PRINTOPS_DB_PATH", &db_path)
                    .env("SQL_WASM_PATH", &wasm_path)
                    .env(
                        "PRINTOPS_HTML_PRINT_HELPER",
                        res_dir.join("print-helper").join("printops-html-print.exe"),
                    )
                    .stdin(Stdio::null())
                    .stdout(out)
                    .stderr(err);
                spawn_child(cmd, &app_log, "server.exe")
            } else {
                log_line(&app_log, "ERROR: server.exe not found — API will not start");
                None
            };

            // ── Start runner (optional: the dashboard still loads without it) ──
            let runner_child = if runner_exe.exists() {
                let (out, err) = child_stdio(&logs.join("desktop-runner.log"));
                let mut cmd = Command::new(&runner_exe);
                cmd.arg("run")
                    .current_dir(&res_dir)
                    .env("PRINTOPS_API_BASE_URL", SERVER_URL)
                    .env("PRINTOPS_RUNNER_NAME", "desktop-runner")
                    .env("PRINTOPS_DISCOVERY_MODE", "windows")
                    .env("PRINTOPS_EXECUTOR_MODE", "windows-spooler")
                    .env("PRINTOPS_POLL_INTERVAL_MS", "2000")
                    // Discovery only: the API executes jobs in-process via its
                    // TypeScript WindowsSpoolerAdapter, so leaving job polling
                    // on here would let the Go runner claim the same queue
                    // and double-print (it also cannot execute against this
                    // IPP/GDI printer via raw WritePrinter).
                    .env("PRINTOPS_JOBS_ENABLED", "false")
                    .env("PRINTOPS_DEV_EMAIL", "admin@printerops.local")
                    .env("PRINTOPS_DEV_PASSWORD", "dev-password")
                    .stdin(Stdio::null())
                    .stdout(out)
                    .stderr(err);
                spawn_child(cmd, &app_log, "printops-runner.exe")
            } else {
                log_line(
                    &app_log,
                    "WARNING: printops-runner.exe not found — no printer discovery",
                );
                None
            };

            app.manage(AppState {
                server_child: Mutex::new(server_child),
                runner_child: Mutex::new(runner_child),
            });

            // The config window is created before `setup` runs, so its first load
            // races the server startup. Poll health off the main thread and
            // navigate once the API answers, keeping the UI responsive meanwhile.
            let handle = app.handle().clone();
            let health_log = app_log.clone();
            std::thread::spawn(move || {
                let health_url = format!("{SERVER_URL}/health");
                let deadline = std::time::Instant::now() + Duration::from_secs(60);
                let mut healthy = false;
                while std::time::Instant::now() < deadline {
                    match ureq::get(&health_url)
                        .timeout(Duration::from_secs(2))
                        .call()
                    {
                        Ok(resp) if resp.status() == 200 => {
                            healthy = true;
                            break;
                        }
                        _ => std::thread::sleep(Duration::from_millis(500)),
                    }
                }

                if !healthy {
                    log_line(
                        &health_log,
                        "ERROR: server health check timed out after 60s",
                    );
                    return;
                }
                log_line(&health_log, "Server is healthy");

                match (handle.get_webview_window("main"), Url::parse(SERVER_URL)) {
                    (Some(window), Ok(url)) => match window.navigate(url) {
                        Ok(()) => log_line(&health_log, "Webview navigated to app"),
                        Err(e) => log_line(&health_log, &format!("ERROR: navigate failed: {e}")),
                    },
                    _ => log_line(&health_log, "ERROR: main window not found"),
                }
            });

            log_line(&app_log, "Desktop ready");
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let app = window.app_handle();
                let log = std::env::current_exe()
                    .ok()
                    .and_then(|p| p.parent().map(Path::to_path_buf))
                    .map(|d| log_dir(&d).join("desktop.log"))
                    .unwrap_or_else(|| PathBuf::from("desktop.log"));
                if let Some(state) = app.try_state::<AppState>() {
                    kill_child(&state.runner_child, &log, "runner");
                    kill_child(&state.server_child, &log, "server");
                }
            }
        })
        .invoke_handler(tauri::generate_handler![])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
