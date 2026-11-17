const APP_COMMANDS: &[&str] = &["write_export_file", "get_nats_settings", "save_nats_settings", "enroll_control_device"];

fn parse_current_schema_version(manifest_dir: &std::path::Path) -> String {
    let schema_path = manifest_dir
        .join("..")
        .join("..")
        .join("api")
        .join("src")
        .join("infra")
        .join("db")
        .join("sqlite.schema.ts");
    println!("cargo:rerun-if-changed=../../api/src/infra/db/sqlite.schema.ts");
    let source = std::fs::read_to_string(&schema_path).unwrap_or_else(|err| {
        panic!(
            "failed to read {} for CURRENT_SCHEMA_VERSION: {err}",
            schema_path.display()
        )
    });
    for line in source.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("export const CURRENT_SCHEMA_VERSION") {
            if let Some((_, rhs)) = rest.split_once('=') {
                let value = rhs.trim().trim_end_matches(';').trim();
                if !value.is_empty() && value.chars().all(|ch| ch.is_ascii_digit()) {
                    let parsed: u32 = value
                        .parse()
                        .expect("CURRENT_SCHEMA_VERSION must be a valid u32");
                    assert!(parsed > 0, "CURRENT_SCHEMA_VERSION must be at least 1");
                    return parsed.to_string();
                }
            }
        }
    }
    panic!(
        "could not find `export const CURRENT_SCHEMA_VERSION = <N>;` in {}",
        schema_path.display()
    );
}

fn main() {
    println!("cargo:rerun-if-env-changed=PRINTOPS_BUILD_VERSION");
    println!("cargo:rerun-if-env-changed=PRINTOPS_BUILD_DB_SCHEMA_VERSION");
    println!("cargo:rerun-if-env-changed=PRINTOPS_OTA_NATIVE_ACCEPTANCE_BUILD");
    let manifest_dir = std::path::PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is not set"),
    );
    let schema_version = parse_current_schema_version(&manifest_dir);
    println!("cargo:rustc-env=PRINTOPS_SOURCE_DB_SCHEMA_VERSION={schema_version}");
    let commit = std::process::Command::new("git")
        .args(["rev-parse", "HEAD"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "unknown".to_string());
    println!("cargo:rustc-env=PRINTOPS_GIT_COMMIT={commit}");
    println!("cargo:rerun-if-changed=../../../.git/HEAD");
    if let Some(reference) = std::process::Command::new("git")
        .args(["symbolic-ref", "-q", "HEAD"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        println!("cargo:rerun-if-changed=../../../.git/{reference}");
    }
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(APP_COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
