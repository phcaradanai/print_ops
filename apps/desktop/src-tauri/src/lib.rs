use std::net::TcpStream;
use std::time::Duration;
use tauri::Manager;
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let resource_dir = app.path().resource_dir()
                .expect("failed to resolve resource dir");

            let api_exe = resource_dir.join("resources/server.exe");
            let runner_exe = resource_dir.join("resources/printops-runner.exe");
            let static_dir = resource_dir.join("resources/static");
            let wasm_path = resource_dir.join("resources/sql-wasm.wasm");

            // Start API server (standalone exe - no Node.js required)
            let api_exe_clone = api_exe.clone();
            let static_dir_clone = static_dir.clone();
            let wasm_path_clone = wasm_path.clone();
            std::thread::spawn(move || {
                let mut child = match std::process::Command::new(&api_exe_clone)
                    .env("PORT", "3001")
                    .env("HOST", "127.0.0.1")
                    .env("JWT_SECRET", "printops-installer-secret-2026")
                    .env("PRINTOPS_DEV_API_KEY", "printops-dev-apikey-2026")
                    .env("STATIC_DIR", static_dir_clone.to_string_lossy().as_ref())
                    .env("SQL_WASM_PATH", wasm_path_clone.to_string_lossy().as_ref())
                    .spawn()
                {
                    Ok(c) => {
                        println!("[PrintOps] API server started (PID: {})", c.id());
                        c
                    }
                    Err(e) => {
                        eprintln!("[PrintOps] FATAL: Failed to start API server: {}", e);
                        return;
                    }
                };
                let _ = child.wait();
                eprintln!("[PrintOps] API server process exited unexpectedly");
            });

            // Wait for API server to be ready (health check via TCP)
            println!("[PrintOps] Waiting for API server on 127.0.0.1:3001...");
            let start = std::time::Instant::now();
            let timeout = Duration::from_secs(30);
            let mut api_ready = false;
            loop {
                match TcpStream::connect_timeout(
                    &"127.0.0.1:3001".parse().unwrap(),
                    Duration::from_secs(1),
                ) {
                    Ok(_) => {
                        println!("[PrintOps] API server is ready");
                        api_ready = true;
                        break;
                    }
                    Err(_) => {
                        if start.elapsed() > timeout {
                            eprintln!("[PrintOps] WARNING: API server did not start within 30s — continuing anyway");
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(500));
                    }
                }
            }

            // Start Runner in background (non-critical: app still works without it)
            if runner_exe.exists() {
                // Force "windows" discovery mode — avoids "auto"→"fake" fallback on unsupported OS
                let discovery_mode = std::env::var("PRINTOPS_DISCOVERY_MODE")
                    .unwrap_or_else(|_| "windows".to_string());

                // Log file for runner diagnostics (console output is hidden in Windows release builds)
                let log_dir = resource_dir.join("logs");
                let _ = std::fs::create_dir_all(&log_dir);
                let runner_log = log_dir.join("runner.log");
                let runner_err_log = log_dir.join("runner-error.log");

                let runner_exe_clone = runner_exe.clone();
                let runner_log_clone = runner_log.clone();
                let runner_err_clone = runner_err_log.clone();
                std::thread::spawn(move || {
                    // Shorter delay (0.5s instead of 2s) — API is already confirmed ready
                    std::thread::sleep(Duration::from_millis(500));

                    let log_file = std::fs::File::create(&runner_log_clone)
                        .expect("failed to create runner log file");
                    let err_file = std::fs::File::create(&runner_err_clone)
                        .expect("failed to create runner error log file");

                    println!("[PrintOps] Starting runner (discovery={}, log={})...",
                        discovery_mode, runner_log_clone.display());
                    let mut child = match std::process::Command::new(&runner_exe_clone)
                        .arg("run")
                        .env("PRINTOPS_API_BASE_URL", "http://127.0.0.1:3001")
                        .env("PRINTOPS_RUNNER_NAME", "desktop-runner")
                        .env("PRINTOPS_DISCOVERY_MODE", &discovery_mode)
                        .env("PRINTOPS_EXECUTOR_MODE", "windows-spooler")
                        .env("PRINTOPS_POLL_INTERVAL_MS", "2000")
                        .env("PRINTOPS_HEARTBEAT_INTERVAL_MS", "15000")
                        .env("PRINTOPS_DISCOVERY_INTERVAL_MS", "15000")
                        .env("PRINTOPS_DEV_EMAIL", "admin@printerops.local")
                        .env("PRINTOPS_DEV_PASSWORD", "dev-password")
                        .stdout(std::process::Stdio::from(log_file))
                        .stderr(std::process::Stdio::from(err_file))
                        .spawn()
                    {
                        Ok(c) => {
                            println!("[PrintOps] Runner started (PID: {}, log: {})", c.id(), runner_log_clone.display());
                            c
                        }
                        Err(e) => {
                            eprintln!("[PrintOps] WARNING: Failed to start runner: {} (app will continue without printer support)", e);
                            return;
                        }
                    };
                    let status = child.wait();
                    match status {
                        Ok(s) => eprintln!("[PrintOps] Runner exited with status: {:?}", s),
                        Err(e) => eprintln!("[PrintOps] Runner process error: {}", e),
                    }
                });
            } else {
                eprintln!("[PrintOps] INFO: Runner binary not found at {:?} — printer discovery/printing disabled", runner_exe);
                eprintln!("[PrintOps] INFO: Build the Go runner: cd apps/runner-go && go build -o printops-runner.exe ./cmd/printops-runner/");
            }

            // App opens the webview regardless of runner status
            if api_ready {
                println!("[PrintOps] Desktop app ready — opening dashboard");
            } else {
                eprintln!("[PrintOps] WARNING: API not confirmed ready — dashboard may show connection error");
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}