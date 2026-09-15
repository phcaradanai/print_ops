use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{atomic::{AtomicBool, Ordering}, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use serde::{Deserialize, Serialize};
use tauri::{Manager, Url};

#[cfg(windows)]
use std::os::windows::io::AsRawHandle;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
#[cfg(windows)]
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_BREAKAWAY_OK, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(windows)]
const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;

#[cfg(windows)]
struct SidecarJob(HANDLE);

#[cfg(windows)]
unsafe impl Send for SidecarJob {}
#[cfg(windows)]
unsafe impl Sync for SidecarJob {}

#[cfg(windows)]
impl Drop for SidecarJob {
    fn drop(&mut self) {
        unsafe { CloseHandle(self.0) };
    }
}

#[cfg(windows)]
static SIDECAR_JOB: OnceLock<Result<SidecarJob, String>> = OnceLock::new();

#[cfg(windows)]
fn sidecar_job() -> Result<&'static SidecarJob, String> {
    SIDECAR_JOB
        .get_or_init(|| unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() {
                return Err(format!(
                    "CreateJobObjectW failed: {}",
                    std::io::Error::last_os_error()
                ));
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags =
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_BREAKAWAY_OK;
            let configured = SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of_val(&info) as u32,
            );
            if configured == 0 {
                let error = std::io::Error::last_os_error();
                CloseHandle(handle);
                return Err(format!("SetInformationJobObject failed: {error}"));
            }
            Ok(SidecarJob(handle))
        })
        .as_ref()
        .map_err(Clone::clone)
}

#[cfg(windows)]
fn assign_sidecar_to_job(child: &Child) -> Result<(), String> {
    let job = sidecar_job()?;
    let assigned = unsafe { AssignProcessToJobObject(job.0, child.as_raw_handle() as HANDLE) };
    if assigned == 0 {
        return Err(format!(
            "AssignProcessToJobObject failed: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(())
}

const SERVER_URL: &str = "http://127.0.0.1:31415";
const SERVER_PORT: &str = "31415";
const DESKTOP_DISCOVERY_RUNNER_JOBS_ENABLED: bool = false;
const NATS_SETTINGS_FILE: &str = "nats-settings.json";
const JWT_SECRET_FILE: &str = "jwt-secret.txt";
const RUNNER_BOOTSTRAP_SECRET_FILE: &str = "runner-bootstrap-secret.txt";
const OTA_UPDATER_STATE_FILE: &str = "ota/updater-state.json";
const OTA_ARTIFACT_STATE_FILE: &str = "ota/staged-artifact.json";
const OTA_UPDATER_REQUEST_DIR: &str = "ota/requests";
const OTA_UPDATER_BINARY_FILE: &str = "ota/printops-updater.exe";
const OTA_HEALTH_TOKEN_FILE: &str = "ota-health-token.txt";

// These are compile-time build metadata overrides used only by the isolated
// scripts/ota-native-acceptance-build.mjs profile. Normal production builds
// inherit the Cargo version and schema 7 exactly as before; no runtime
// environment variable can change either value.
const DESKTOP_APP_VERSION: &str =
    match option_env!("PRINTOPS_BUILD_VERSION") {
        Some(value) => value,
        None => env!("CARGO_PKG_VERSION"),
    };
const DESKTOP_DB_SCHEMA_VERSION: &str =
    match option_env!("PRINTOPS_BUILD_DB_SCHEMA_VERSION") {
        Some(value) => value,
        None => "7",
    };
const NATIVE_ACCEPTANCE_BUILD: bool = option_env!("PRINTOPS_OTA_NATIVE_ACCEPTANCE_BUILD").is_some();

fn native_acceptance_data_root() -> Option<PathBuf> {
    if !NATIVE_ACCEPTANCE_BUILD {
        return None;
    }
    std::env::var_os("PRINTOPS_OTA_NATIVE_DATA_ROOT")
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NatsSettings {
    enabled: bool,
    url: String,
    client_id: String,
    subject_prefix: String,
}

fn validate_nats_settings(settings: &NatsSettings) -> Result<(), String> {
    if !settings.enabled {
        return Ok(());
    }
    if settings.url.trim().is_empty() {
        return Err("NATS URL is required when NATS is enabled".into());
    }
    if !settings.url.trim().starts_with("nats://") {
        return Err("NATS URL must start with nats://".into());
    }
    if !is_nats_token(&settings.client_id) {
        return Err("Client ID may contain only letters, digits, _ and -".into());
    }
    if !is_nats_subject_prefix(&settings.subject_prefix) {
        return Err("Subject prefix must contain literal NATS tokens separated by dots".into());
    }
    Ok(())
}

fn is_nats_token(value: &str) -> bool {
    !value.is_empty() && value.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn is_nats_subject_prefix(value: &str) -> bool {
    !value.is_empty() && value.split('.').all(is_nats_token)
}

fn nats_settings_path(data_dir: &Path) -> PathBuf {
    data_dir.join(NATS_SETTINGS_FILE)
}

fn load_nats_settings(data_dir: &Path, log: &Path) -> NatsSettings {
    let path = nats_settings_path(data_dir);
    match fs::read_to_string(&path) {
        Ok(raw) => match serde_json::from_str::<NatsSettings>(&raw) {
            Ok(settings) if validate_nats_settings(&settings).is_ok() => settings,
            Ok(_) | Err(_) => {
                log_line(log, "WARNING: ignoring invalid local NATS settings");
                NatsSettings::default()
            }
        },
        Err(_) => NatsSettings::default(),
    }
}

/// Writes export content to a path the user already picked via the native save
/// dialog. No fs-plugin scope is needed: the dialog itself is the consent step.
#[tauri::command]
fn write_export_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|err| err.to_string())
}

#[tauri::command]
fn get_nats_settings(app: tauri::AppHandle) -> Result<NatsSettings, String> {
    let data_dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
    let log = log_dir(&data_dir).join("desktop.log");
    Ok(load_nats_settings(&data_dir, &log))
}

fn jwt_secret_path(data_dir: &Path) -> PathBuf {
    data_dir.join(JWT_SECRET_FILE)
}

fn runner_bootstrap_secret_path(data_dir: &Path) -> PathBuf {
    data_dir.join(RUNNER_BOOTSTRAP_SECRET_FILE)
}

/// Generates a cryptographically secure per-installation secret using the
/// operating system random source.
fn generate_random_hex_secret() -> String {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).expect("operating system random source unavailable");
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Loads the persisted per-installation JWT secret, generating and saving one
/// on first run. Reusing the same secret across restarts keeps existing
/// dashboard login sessions valid; only a corrupted/missing file regenerates
/// it (which invalidates outstanding sessions, not a security concern for a
/// single-workstation counter app).
fn load_or_create_jwt_secret(data_dir: &Path, log: &Path) -> String {
    let path = jwt_secret_path(data_dir);
    if let Ok(existing) = fs::read_to_string(&path) {
        let trimmed = existing.trim();
        if trimmed.len() >= 32 {
            return trimmed.to_string();
        }
    }
    let secret = generate_random_hex_secret();
    let temporary = path.with_extension("txt.tmp");
    let persisted = fs::write(&temporary, &secret).and_then(|_| fs::rename(&temporary, &path));
    if persisted.is_err() {
        log_line(
            log,
            "WARNING: could not persist the generated JWT secret to disk; a new one will be \
             generated next launch, invalidating any open dashboard sessions",
        );
    } else {
        log_line(log, "Generated per-installation JWT signing secret");
    }
    secret
}

fn load_or_create_runner_bootstrap_secret(data_dir: &Path, log: &Path) -> String {
    let path = runner_bootstrap_secret_path(data_dir);
    if let Ok(existing) = fs::read_to_string(&path) {
        let trimmed = existing.trim();
        if trimmed.len() >= 32 {
            return trimmed.to_string();
        }
    }
    let secret = generate_random_hex_secret();
    let temporary = path.with_extension("txt.tmp");
    if fs::write(&temporary, &secret).and_then(|_| fs::rename(&temporary, &path)).is_err() {
        log_line(log, "WARNING: could not persist runner bootstrap secret");
    } else {
        log_line(log, "Generated per-installation runner bootstrap secret");
    }
    secret
}

fn load_or_create_ota_health_token(data_dir: &Path, log: &Path) -> String {
    let path = data_dir.join(OTA_HEALTH_TOKEN_FILE);
    if let Ok(existing) = fs::read_to_string(&path) {
        let trimmed = existing.trim();
        if trimmed.len() >= 32 {
            return trimmed.to_string();
        }
    }
    let token = generate_random_hex_secret();
    let temporary = path.with_extension("txt.tmp");
    if fs::write(&temporary, &token).and_then(|_| fs::rename(&temporary, &path)).is_err() {
        log_line(log, "WARNING: could not persist the OTA local health token");
    } else {
        log_line(log, "Generated per-installation OTA local health token");
    }
    token
}

/// Everything `save_nats_settings` needs to rebuild the API server's launch
/// command later, without redoing directory-resolution logic or drifting out
/// of sync with the equivalent block in `setup()`.
struct ServerPaths {
    res_dir: PathBuf,
    db_path: PathBuf,
    wasm_path: PathBuf,
    logs_dir: PathBuf,
    app_log: PathBuf,
    jwt_secret: String,
    runner_bootstrap_secret: String,
    updater_path: PathBuf,
    updater_state_path: PathBuf,
    updater_request_dir: PathBuf,
    artifact_state_path: PathBuf,
    install_root: PathBuf,
    desktop_path: PathBuf,
    ota_health_token: String,
    ota_public_key: Option<String>,
}

/// Builds the `server.exe` launch command for the given NATS settings. Used
/// both at initial startup and whenever NATS settings are saved and the
/// server needs to be restarted with the new environment.
fn build_server_command(paths: &ServerPaths, nats_settings: &NatsSettings) -> Command {
    let (out, err) = child_stdio(&paths.logs_dir.join("desktop-server.log"));
    let mut cmd = Command::new(paths.res_dir.join("server.exe"));
    // Store settings, paper profiles, and registered printers in the
    // per-user database above. This survives app restarts and desktop
    // upgrades because it is outside the install folder.
    cmd.current_dir(&paths.res_dir)
        .env("PORT", SERVER_PORT)
        .env("HOST", "127.0.0.1")
        .env("DB_MODE", "sqlite")
        .env("PRINTOPS_RUNTIME_MODE", "packaged-windows-desktop")
        .env("PRINTOPS_LOCAL_WORKER", "true")
        // pkg sets this marker on children it launches. The API server is
        // itself a pkg executable, so do not leak the old server's marker
        // through the updater into the newly installed server.
        .env_remove("PKG_EXECPATH")
        .env(
            "PRINTOPS_DISCOVERY_RUNNER_JOBS_ENABLED",
            DESKTOP_DISCOVERY_RUNNER_JOBS_ENABLED.to_string(),
        )
        .env("PRINTOPS_DB_PATH", &paths.db_path)
        .env("PRINTOPS_LOG_DIR", &paths.logs_dir)
        .env("PRINTOPS_APP_VERSION", DESKTOP_APP_VERSION)
        .env("PRINTOPS_GIT_COMMIT", env!("PRINTOPS_GIT_COMMIT"))
        .env("PRINTOPS_DB_SCHEMA_VERSION", DESKTOP_DB_SCHEMA_VERSION)
        .env("SQL_WASM_PATH", &paths.wasm_path)
        .env("JWT_SECRET", &paths.jwt_secret)
        .env("PRINTOPS_RUNNER_BOOTSTRAP_SECRET", &paths.runner_bootstrap_secret)
        .env("PRINTOPS_OTA_UPDATER_PATH", &paths.updater_path)
        .env("PRINTOPS_OTA_UPDATER_STATE_PATH", &paths.updater_state_path)
        .env("PRINTOPS_OTA_UPDATER_REQUEST_DIR", &paths.updater_request_dir)
        .env("PRINTOPS_OTA_ARTIFACT_STATE_PATH", &paths.artifact_state_path)
        .env("PRINTOPS_OTA_INSTALL_ROOT", &paths.install_root)
        .env("PRINTOPS_OTA_DESKTOP_PATH", &paths.desktop_path)
        .env("PRINTOPS_DESKTOP_PID", std::process::id().to_string())
        .env("PRINTOPS_OTA_API_URL", SERVER_URL)
        .env("PRINTOPS_OTA_HEALTH_TOKEN", &paths.ota_health_token)
        .env(
            "PRINTOPS_HTML_PRINT_HELPER",
            paths.res_dir.join("print-helper").join("printops-html-print.exe"),
        )
        .stdin(Stdio::null())
        .stdout(out)
        .stderr(err);
    if nats_settings.enabled {
        cmd.env("PRINTOPS_NATS_URL", &nats_settings.url)
            .env("PRINTOPS_NATS_CLIENT_ID", &nats_settings.client_id)
            .env("PRINTOPS_NATS_SUBJECT_PREFIX", &nats_settings.subject_prefix);
    } else {
        // Do not inherit accidental machine-level NATS variables.
        cmd.env_remove("NATS_URL")
            .env_remove("PRINTOPS_NATS_URL")
            .env_remove("PRINTOPS_NATS_CLIENT_ID")
            .env_remove("PRINTOPS_NATS_SUBJECT_PREFIX")
            .env_remove("PRINTOPS_NATS_DURABLE");
    }
    if let Some(public_key) = &paths.ota_public_key {
        cmd.env("PRINTOPS_OTA_PUBLIC_KEY", public_key);
    }
    cmd
}

fn build_runner_command(paths: &ServerPaths) -> Command {
    let (out, err) = child_stdio(&paths.logs_dir.join("desktop-runner.log"));
    let mut cmd = Command::new(paths.res_dir.join("printops-runner.exe"));
    cmd.arg("run")
        .current_dir(&paths.res_dir)
        .env("PRINTOPS_API_BASE_URL", SERVER_URL)
        .env("PRINTOPS_RUNNER_NAME", "desktop-runner")
        .env("PRINTOPS_DISCOVERY_MODE", "windows")
        .env("PRINTOPS_EXECUTOR_MODE", "windows-spooler")
        .env_remove("PKG_EXECPATH")
        .env("PRINTOPS_POLL_INTERVAL_MS", "2000")
        .env(
            "PRINTOPS_JOBS_ENABLED",
            DESKTOP_DISCOVERY_RUNNER_JOBS_ENABLED.to_string(),
        )
        .env(
            "PRINTOPS_RUNNER_BOOTSTRAP_SECRET",
            &paths.runner_bootstrap_secret,
        )
        .stdin(Stdio::null())
        .stdout(out)
        .stderr(err);
    cmd
}

/// Polls the API's health endpoint until it responds 200 or `timeout` elapses.
/// Returns whether it became healthy in time.
fn wait_for_server_health(timeout: Duration) -> bool {
    let deadline = std::time::Instant::now() + timeout;
    let health_url = format!("{SERVER_URL}/health");
    while std::time::Instant::now() < deadline {
        if let Ok(resp) = ureq::get(&health_url).timeout(Duration::from_secs(2)).call() {
            if resp.status() == 200 {
                return true;
            }
        }
        std::thread::sleep(Duration::from_millis(300));
    }
    false
}

#[tauri::command]
fn save_nats_settings(app: tauri::AppHandle, settings: NatsSettings) -> Result<(), String> {
    validate_nats_settings(&settings)?;
    let data_dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
    fs::create_dir_all(&data_dir).map_err(|err| err.to_string())?;
    let path = nats_settings_path(&data_dir);
    let temporary = path.with_extension("json.tmp");
    let json = serde_json::to_vec_pretty(&settings).map_err(|err| err.to_string())?;
    fs::write(&temporary, json).map_err(|err| err.to_string())?;
    fs::rename(&temporary, &path).map_err(|err| err.to_string())?;

    let state = app.state::<AppState>();
    let app_log = state.paths.app_log.clone();
    log_line(&app_log, "NATS settings saved; restarting the API server in-process to apply");

    // Deliberately do NOT call `app.restart()` here. Relaunching the whole
    // Tauri process races with `tauri_plugin_single_instance`: the freshly
    // spawned process can be detected as a "second instance" of the OLD
    // process (which may not have released its instance lock yet), forward
    // its argv to it, and exit immediately — without ever reaching `setup()`
    // to read the just-saved NATS settings. The result is the OLD,
    // unconfigured `server.exe` silently surviving forever, which is exactly
    // the "saved NATS settings but they never take effect" bug. Restarting
    // only the child server process, inside this same already-running app,
    // sidesteps that race entirely: there is no second process launch.
    kill_child(&state.server_child, &app_log, "server (applying new NATS settings)");

    let cmd = build_server_command(&state.paths, &settings);
    let new_child = spawn_child(cmd, &app_log, "server.exe");
    let started = new_child.is_some();
    if let Ok(mut guard) = state.server_child.lock() {
        *guard = new_child;
    }
    if !started {
        return Err("Failed to restart the API server with the new NATS settings".into());
    }

    if wait_for_server_health(Duration::from_secs(20)) {
        log_line(&app_log, "Server restarted and healthy with new NATS settings");
        Ok(())
    } else {
        log_line(&app_log, "ERROR: server restarted but did not become healthy in time");
        Err("API server restarted but did not become healthy in time".into())
    }
}

struct AppState {
    server_child: Mutex<Option<Child>>,
    runner_child: Mutex<Option<Child>>,
    shutdown: ShutdownGuard,
    paths: ServerPaths,
}

/// `ExitRequested` and `Exit` can both fire during one close operation. The
/// cleanup needs to run before Tauri destroys its event-loop state, and exactly
/// once so the sidecars cannot survive an app update or be killed twice.
#[derive(Default)]
struct ShutdownGuard(AtomicBool);

impl ShutdownGuard {
    fn begin(&self) -> bool {
        self.0
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }

    fn started(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}

/// Directory used for diagnostic logs. Logs are mutable application data too,
/// so never fall back to the immutable install directory.
fn log_dir(exe_dir: &Path) -> PathBuf {
    let mut candidates = Vec::new();
    if let Some(base) = std::env::var_os("LOCALAPPDATA") {
        candidates.push(PathBuf::from(base).join("PrintOps").join("logs"));
    }
    if let Some(base) = std::env::var_os("APPDATA") {
        candidates.push(PathBuf::from(base).join("PrintOps").join("logs"));
    }
    candidates.push(std::env::temp_dir().join("PrintOps").join("logs"));

    for dir in candidates {
        let absolute_dir = fs::canonicalize(&dir).unwrap_or_else(|_| dir.clone());
        let absolute_exe = fs::canonicalize(exe_dir).unwrap_or_else(|_| exe_dir.to_path_buf());
        if absolute_dir == absolute_exe || absolute_dir.starts_with(&absolute_exe) {
            continue;
        }
        if fs::create_dir_all(&dir).is_ok() {
            return dir;
        }
    }

    // The system temp directory is the last-resort location and is still
    // outside the application install root.
    std::env::temp_dir()
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

/// Keep the running updater outside the install tree. The NSIS artifact may
/// update the bundled `resources/printops-updater.exe` itself, so executing
/// that resource directly would leave the file locked during replacement.
fn prepare_ota_updater(source: &Path, destination: &Path, log: &Path) -> PathBuf {
    if !source.exists() {
        log_line(log, &format!("ERROR: OTA updater resource is missing: {}", source.display()));
        return source.to_path_buf();
    }
    if let Some(parent) = destination.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let temporary = destination.with_extension("exe.tmp");
    let _ = fs::remove_file(&temporary);
    // On Windows rename does not replace an existing file. At normal startup
    // no updater worker is using this copy; if removal is denied (for example,
    // a recovery worker is still alive), the existing copy remains the safe
    // fallback below.
    if destination.exists() {
        let _ = fs::remove_file(destination);
    }
    let copied = fs::copy(source, &temporary)
        .and_then(|_| fs::rename(&temporary, destination));
    match copied {
        Ok(_) => {
            log_line(log, &format!("Prepared external OTA updater outside install tree: {}", destination.display()));
            destination.to_path_buf()
        }
        Err(error) => {
            let _ = fs::remove_file(&temporary);
            if destination.exists() {
                log_line(
                    log,
                    &format!(
                        "WARNING: could not refresh OTA updater copy ({error}); using existing {}",
                        destination.display()
                    ),
                );
                destination.to_path_buf()
            } else {
                log_line(
                    log,
                    &format!(
                        "WARNING: could not copy OTA updater outside install tree ({error}); using bundled resource"
                    ),
                );
                source.to_path_buf()
            }
        }
    }
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
        Ok(mut child) => {
            #[cfg(windows)]
            if let Err(error) = assign_sidecar_to_job(&child) {
                log_line(
                    log,
                    &format!("ERROR: failed to contain {label} in desktop job: {error}"),
                );
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            log_line(log, &format!("{label} started (pid: {})", child.id()));
            Some(child)
        }
        Err(e) => {
            log_line(log, &format!("ERROR: failed to start {label}: {e}"));
            None
        }
    }
}

fn ota_recovery_is_stale(state_path: &Path) -> bool {
    let Ok(raw) = fs::read_to_string(state_path) else { return false };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else { return false };
    let phase = value.get("phase").and_then(serde_json::Value::as_str).unwrap_or("");
    if !matches!(
        phase,
        "RECEIVED"
            | "VERIFYING"
            | "WAITING_FOR_SHUTDOWN"
            | "BACKING_UP"
            | "INSTALLING"
            | "STARTING"
            | "HEALTH_CHECK"
            | "ROLLING_BACK"
    ) {
        return false;
    }
    fs::metadata(state_path)
        .and_then(|metadata| metadata.modified())
        .and_then(|modified| modified.elapsed().map_err(std::io::Error::other))
        .map(|age| age >= Duration::from_secs(30))
        .unwrap_or(false)
}

/// Runs before sidecars are started so an updater that was interrupted while
/// replacing the install tree can restore the last known-good tree. The
/// updater is intentionally not assigned to the Desktop job object: it must
/// outlive this process while it terminates and relaunches Desktop.
fn launch_stale_ota_recovery(
    updater_path: &Path,
    state_path: &Path,
    install_root: &Path,
    log: &Path,
) -> bool {
    if !updater_path.exists() || !ota_recovery_is_stale(state_path) {
        return false;
    }
    let mut command = Command::new(updater_path);
    command
        .arg("recover")
        .arg("--state")
        .arg(state_path)
        .arg("--desktop-pid")
        .arg(std::process::id().to_string())
        .current_dir(install_root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW | CREATE_BREAKAWAY_FROM_JOB);
    match command.spawn() {
        Ok(child) => {
            log_line(log, &format!("stale OTA recovery handed off to updater (pid: {})", child.id()));
            true
        }
        Err(error) => {
            log_line(log, &format!("ERROR: could not start stale OTA recovery: {error}"));
            false
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

fn restart_exited_child(
    slot: &Mutex<Option<Child>>,
    log: &Path,
    label: &str,
    build: impl FnOnce() -> Command,
) {
    let Ok(mut guard) = slot.lock() else { return };
    let exited = match guard.as_mut() {
        Some(child) => match child.try_wait() {
            Ok(Some(status)) => {
                log_line(log, &format!("ERROR: {label} exited unexpectedly ({status}); restarting"));
                true
            }
            Ok(None) => false,
            Err(error) => {
                log_line(log, &format!("ERROR: could not inspect {label}: {error}; restarting"));
                true
            }
        },
        None => true,
    };
    if exited {
        *guard = spawn_child(build(), log, label);
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
        .plugin(tauri_plugin_dialog::init())
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
            let data_dir = if let Some(path) = native_acceptance_data_root() {
                if !path.is_absolute() {
                    let error = format!(
                        "native acceptance data root must be absolute: {}",
                        path.display(),
                    );
                    log_line(&app_log, &format!("ERROR: {error}"));
                    return Err(error.into());
                }
                log_line(
                    &app_log,
                    &format!("using isolated native acceptance data root: {}", path.display()),
                );
                path
            } else {
                match app.path().app_data_dir() {
                    Ok(path) => path,
                    Err(error) => {
                        log_line(
                            &app_log,
                            &format!("ERROR: cannot resolve the per-user app-data directory: {error}"),
                        );
                        return Err(Box::new(error));
                    }
                }
            };
            if data_dir == exe_dir || data_dir.starts_with(&exe_dir) {
                let error = format!(
                    "refusing to use an app-data directory inside the install root: {}",
                    data_dir.display(),
                );
                log_line(&app_log, &format!("ERROR: {error}"));
                return Err(error.into());
            }
            let _ = fs::create_dir_all(&data_dir);
            let ota_dir = data_dir.join("ota");
            let _ = fs::create_dir_all(&ota_dir);
            let db_path = data_dir.join("printops.db");
            log_line(&app_log, &format!("db path: {}", db_path.display()));
            let nats_settings = load_nats_settings(&data_dir, &app_log);
            if nats_settings.enabled {
                log_line(
                    &app_log,
                    &format!(
                        "NATS intake enabled for client {} on subject {}.{}",
                        nats_settings.client_id,
                        nats_settings.subject_prefix,
                        nats_settings.client_id,
                    ),
                );
            }

            // A real per-installation secret, persisted once and reused
            // across restarts — replaces the API's hardcoded fallback secret
            // so dashboard/runner JWTs cannot be forged with a value that is
            // public in source control.
            let jwt_secret = load_or_create_jwt_secret(&data_dir, &app_log);
            let runner_bootstrap_secret =
                load_or_create_runner_bootstrap_secret(&data_dir, &app_log);
            let ota_health_token = load_or_create_ota_health_token(&data_dir, &app_log);
            let desktop_path = std::env::current_exe().unwrap_or_else(|_| exe_dir.join("printerops-desktop.exe"));
            let bundled_updater_path = res_dir.join("printops-updater.exe");
            let updater_path = prepare_ota_updater(
                &bundled_updater_path,
                &data_dir.join(OTA_UPDATER_BINARY_FILE),
                &app_log,
            );
            let ota_public_key = fs::read_to_string(res_dir.join("ota-public-key.txt"))
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty() && value != "unconfigured");

            let server_paths = ServerPaths {
                res_dir: res_dir.clone(),
                db_path: db_path.clone(),
                wasm_path: wasm_path.clone(),
                logs_dir: logs.clone(),
                app_log: app_log.clone(),
                jwt_secret,
                runner_bootstrap_secret,
                updater_path,
                updater_state_path: data_dir.join(OTA_UPDATER_STATE_FILE),
                updater_request_dir: data_dir.join(OTA_UPDATER_REQUEST_DIR),
                artifact_state_path: data_dir.join(OTA_ARTIFACT_STATE_FILE),
                install_root: exe_dir.clone(),
                desktop_path,
                ota_health_token,
                ota_public_key,
            };

            if launch_stale_ota_recovery(
                &server_paths.updater_path,
                &server_paths.updater_state_path,
                &server_paths.install_root,
                &app_log,
            ) {
                // The recovery worker must replace/relaunch this Desktop
                // process before any sidecar can open the partially updated
                // resource tree.
                std::process::exit(0);
            }

            // ── Start API server ──
            let server_child = if server_exe.exists() {
                let cmd = build_server_command(&server_paths, &nats_settings);
                spawn_child(cmd, &app_log, "server.exe")
            } else {
                log_line(&app_log, "ERROR: server.exe not found — API will not start");
                None
            };

            // ── Start runner (optional: the dashboard still loads without it) ──
            let runner_child = if runner_exe.exists() {
                spawn_child(
                    build_runner_command(&server_paths),
                    &app_log,
                    "printops-runner.exe",
                )
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
                shutdown: ShutdownGuard::default(),
                paths: server_paths,
            });

            // Sidecars are product processes, not fire-and-forget helpers.
            // Detect an unexpected exit and restart the exact packaged command.
            // ShutdownGuard prevents resurrection during a normal app exit.
            let supervisor_handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(2));
                let Some(state) = supervisor_handle.try_state::<AppState>() else { return };
                if state.shutdown.started() {
                    return;
                }
                let nats_settings = state
                    .paths
                    .db_path
                    .parent()
                    .map(|data_dir| load_nats_settings(data_dir, &state.paths.app_log))
                    .unwrap_or_default();
                if state.paths.res_dir.join("server.exe").exists() {
                    restart_exited_child(
                        &state.server_child,
                        &state.paths.app_log,
                        "server.exe",
                        || build_server_command(&state.paths, &nats_settings),
                    );
                }
                if state.paths.res_dir.join("printops-runner.exe").exists() {
                    restart_exited_child(
                        &state.runner_child,
                        &state.paths.app_log,
                        "printops-runner.exe",
                        || build_runner_command(&state.paths),
                    );
                }
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
        .invoke_handler(tauri::generate_handler![
            get_nats_settings,
            save_nats_settings,
            write_export_file
        ])
        // Do not use WindowEvent::Destroyed here. On Windows it runs after the
        // Tao event-loop state has started moving and can panic before the
        // spawned server/runner are terminated, leaving their .exe files locked
        // and blocking an NSIS update.
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app: &tauri::AppHandle, event| {
            if matches!(event, tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit) {
                let log = std::env::current_exe()
                    .ok()
                    .and_then(|p| p.parent().map(Path::to_path_buf))
                    .map(|d| log_dir(&d).join("desktop.log"))
                    .unwrap_or_else(|| PathBuf::from("desktop.log"));
                if let Some(state) = app.try_state::<AppState>() {
                    if state.shutdown.begin() {
                        log_line(&log, "Desktop exit requested; stopping sidecars before shutdown...");
                        kill_child(&state.runner_child, &log, "runner");
                        kill_child(&state.server_child, &log, "server");
                        log_line(&log, "Sidecars stopped");
                    }
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::{
        generate_random_hex_secret, load_or_create_jwt_secret, validate_nats_settings,
        NatsSettings, ShutdownGuard,
    };

    #[test]
    fn shutdown_guard_runs_cleanup_only_once() {
        let guard = ShutdownGuard::default();

        assert!(guard.begin());
        assert!(!guard.begin());
    }

    #[test]
    fn nats_settings_require_url_and_safe_client_id_when_enabled() {
        assert!(validate_nats_settings(&NatsSettings {
            enabled: true,
            url: "nats://nats.example:4222".into(),
            client_id: "pharmacy-counter-01".into(),
            subject_prefix: "medisync.print.intake".into(),
        })
        .is_ok());

        assert!(validate_nats_settings(&NatsSettings {
            enabled: true,
            url: "".into(),
            client_id: "pharmacy-counter-01".into(),
            subject_prefix: "medisync.print.intake".into(),
        })
        .is_err());

        assert!(validate_nats_settings(&NatsSettings {
            enabled: true,
            url: "nats://nats.example:4222".into(),
            client_id: "counter.*".into(),
            subject_prefix: "medisync.print.intake".into(),
        })
        .is_err());
    }

    #[test]
    fn generated_jwt_secret_is_a_64_char_hex_string() {
        let secret = generate_random_hex_secret();
        assert_eq!(secret.len(), 64);
        assert!(secret.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn successive_generated_secrets_differ() {
        // Not a cryptographic guarantee, just confirms the generator isn't
        // producing a constant (e.g. from an always-zero entropy source).
        let a = generate_random_hex_secret();
        let b = generate_random_hex_secret();
        assert_ne!(a, b);
    }

    #[test]
    fn jwt_secret_is_created_once_and_reused_across_calls() {
        let dir = std::env::temp_dir().join(format!(
            "printops-jwt-secret-test-{}-{}",
            std::process::id(),
            generate_random_hex_secret()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let log = dir.join("test.log");

        let first = load_or_create_jwt_secret(&dir, &log);
        let second = load_or_create_jwt_secret(&dir, &log);
        assert_eq!(first, second, "secret must persist across restarts, not regenerate every launch");
        assert_eq!(first.len(), 64);

        std::fs::remove_dir_all(&dir).ok();
    }
}
