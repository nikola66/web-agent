//! Emits `OUT_DIR/provider_upstreams.rs` mirroring `readProviderUpstreams()` in `vite.config.ts`.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

fn main() {
    let manifest_dir = Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap()).to_path_buf();
    let roots = [
        manifest_dir.join("../src/capabilities/providers"),
        manifest_dir.join("../src/core/providers"),
    ];
    let mut out: BTreeMap<String, String> = BTreeMap::new();
    for root in &roots {
        let entries = match fs::read_dir(root) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let manifest_path = if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                root.join(entry.file_name()).join("manifest.json")
            } else if entry
                .file_name()
                .to_string_lossy()
                .ends_with(".json")
            {
                root.join(entry.file_name())
            } else {
                continue;
            };
            let raw = match fs::read_to_string(&manifest_path) {
                Ok(s) => s,
                Err(_) => continue,
            };
            let parsed: serde_json::Value = match serde_json::from_str(&raw) {
                Ok(v) => v,
                Err(_) => continue,
            };
            let id = parsed
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let upstream = parsed
                .pointer("/runtime/fallbackBaseUrl")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            if !id.is_empty() && !upstream.is_empty() && !out.contains_key(&id) {
                out.insert(id, upstream);
            }
        }
        println!("cargo:rerun-if-changed={}", root.display());
    }
    let out_dir = std::env::var("OUT_DIR").expect("OUT_DIR");
    let dest = Path::new(&out_dir).join("provider_upstreams.rs");
    let mut code = String::from(
        "pub fn static_provider_upstreams() -> &'static [(&'static str, &'static str)] {\n    &[\n",
    );
    for (id, url) in out {
        let id_esc = id.replace('\\', "\\\\").replace('"', "\\\"");
        let url_esc = url.replace('\\', "\\\\").replace('"', "\\\"");
        code.push_str(&format!("        (\"{id_esc}\", \"{url_esc}\"),\n"));
    }
    code.push_str("    ]\n}\n");
    fs::write(&dest, code).expect("write provider_upstreams.rs");
    tauri_build::build();
}
