use tauri::Manager;
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let resource_dir = app.path().resource_dir()
                .expect("failed to resolve resource dir");

            let api_exe = resource_dir.join("apps/api/dist/server.exe");
            let runner_exe = resource_dir.join("apps/runner-go/printops-runner.exe");

            // Start API server (standalone exe — no Node.js required)
            let api_exe_clone = api_exe.clone();
            std::thread::spawn(move || {
                let mut child = match std::process::Command::new(&api_exe_clone)
                    .env("PORT", "3001")
                    .env("HOST", "127.0.0.1")
                    .env("JWT_SECRET", "printops-installer-secret-2026")
                    .env("PRINTOPS_DEV_API_KEY", "printops-dev-apikey-2026")
                    .spawn()
                {
                    Ok(c) => {
                        println!("PrintOps API started (PID: {})", c.id());
                        c
                    }
                    Err(e) => {
                        eprintln!("Failed to start PrintOps API: {}", e);
                        return;
                    }
                };
                let _ = child.wait();
            });

            // Start Runner in background if binary exists
            if runner_exe.exists() {
                std::thread::spawn(move || {
                    let mut child = match std::process::Command::new(&runner_exe)
                        .env("API_URL", "http://127.0.0.1:3001")
                        .env("RUNNER_NAME", "desktop-runner")
                        .env("SUPPORTED_PROTOCOLS", "fake")
                        .env("DISCOVERY_ADAPTER", "fake")
                        .env("POLL_INTERVAL_MS", "2000")
                        .env("HEARTBEAT_INTERVAL_MS", "10000")
                        .env("DISCOVERY_INTERVAL_MS", "60000")
                        .env("RUNNER_DEV_EMAIL", "admin@printerops.local")
                        .env("RUNNER_DEV_PASSWORD", "dev-password")
                        .spawn()
                    {
                        Ok(c) => {
                            println!("PrintOps Runner started (PID: {})", c.id());
                            c
                        }
                        Err(e) => {
                            eprintln!("Failed to start PrintOps Runner: {}", e);
                            return;
                        }
                    };
                    let _ = child.wait();
                });
            } else {
                eprintln!("Runner binary not found at: {:?}", runner_exe);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
