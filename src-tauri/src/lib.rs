mod generated {
    include!(concat!(env!("OUT_DIR"), "/provider_upstreams.rs"));
}
mod server;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};

fn upstream_map() -> HashMap<String, server::UpstreamTarget> {
    let mut m = HashMap::new();
    for (id, url) in generated::static_provider_upstreams() {
        let Ok(parsed) = url::Url::parse(url) else {
            continue;
        };
        let scheme = parsed.scheme().to_string();
        let host = parsed.host_str().unwrap_or("").to_string();
        let origin = match parsed.port() {
            Some(p) => format!("{scheme}://{host}:{p}"),
            None => format!("{scheme}://{host}"),
        };
        let mut base_path = parsed.path().to_string();
        while base_path.ends_with('/') && base_path.len() > 1 {
            base_path.pop();
        }
        m.insert(
            id.to_string(),
            server::UpstreamTarget { origin, base_path },
        );
    }
    m
}

/// Resolve the Vite `dist/` directory (must contain `index.html`).
fn resolve_dist_dir(handle: &AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    if let Ok(p) = handle.path().resolve("dist", BaseDirectory::Resource) {
        if p.join("index.html").is_file() {
            return Ok(p);
        }
    }
    if let Ok(dir) = std::env::var("WEBAGENT_DIST_DIR") {
        let p = PathBuf::from(dir.trim());
        if p.join("index.html").is_file() {
            return Ok(p);
        }
    }
    let exe = std::env::current_exe()?;
    let Some(exe_dir) = exe.parent() else {
        return Err("current_exe has no parent".into());
    };
    let candidates = [
        exe_dir.join("../dist"),
        exe_dir.join("../Resources/dist"),
        exe_dir.join("dist"),
    ];
    for p in candidates {
        if p.join("index.html").is_file() {
            return Ok(p.canonicalize().unwrap_or(p));
        }
    }
    Err(
        "dist/index.html not found. Run `npm run build`, set WEBAGENT_DIST_DIR, or bundle `dist/` into app resources."
            .into(),
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .try_init();

    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            let dist = resolve_dist_dir(&handle)?;
            let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
            listener.set_nonblocking(true)?;
            let port = listener.local_addr()?.port();
            let tokio_listener = tokio::net::TcpListener::from_std(listener)?;
            let state = Arc::new(server::ServerState {
                dist_dir: dist,
                client: reqwest::Client::builder()
                    .use_rustls_tls()
                    .build()
                    .map_err(|e| -> Box<dyn std::error::Error> { e.to_string().into() })?,
                upstreams: Arc::new(upstream_map()),
            });
            let serve_state = state.clone();
            tauri::async_runtime::spawn(async move {
                server::serve(tokio_listener, serve_state).await;
            });
            let url: url::Url = format!("http://127.0.0.1:{port}/")
                .parse()
                .map_err(|e: url::ParseError| -> Box<dyn std::error::Error> { e.to_string().into() })?;
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("Web Agent")
                .inner_size(1200.0, 800.0)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
