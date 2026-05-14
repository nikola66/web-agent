//! Local loopback HTTP server: static `dist/`, COOP header, `/api/proxy`, `/api/llm/*` reverse proxy.
//!
//! **Static root (`dist/`)**: resolved at runtime by the caller (see `lib.rs`). Typical layouts:
//! - Development: `src-tauri/../dist` after `npm run build`.
//! - Packaged app: `WEBAGENT_DIST_DIR`, or `../dist` next to the executable, or `../Resources/dist` on macOS bundles,
//!   or Tauri `Resource`/`dist` when `bundle.resources` ships the Vite output.

use axum::body::Body;
use axum::extract::Request;
use axum::http::header::{HeaderMap, HeaderName, HeaderValue};
use axum::http::{Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, post};
use axum::Router;
use futures_util::TryStreamExt;
use http_body_util::BodyExt;
use serde::Deserialize;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::set_header::SetResponseHeaderLayer;

const LLM_PREFIX: &str = "/api/llm/";

#[derive(Clone)]
pub struct ServerState {
    pub dist_dir: PathBuf,
    pub client: reqwest::Client,
    pub upstreams: Arc<HashMap<String, UpstreamTarget>>,
}

pub struct UpstreamTarget {
    pub origin: String,
    pub base_path: String,
}

pub async fn serve(listener: tokio::net::TcpListener, state: Arc<ServerState>) {
    let coop = SetResponseHeaderLayer::overriding(
        HeaderName::from_static("cross-origin-opener-policy"),
        HeaderValue::from_static("same-origin"),
    );
    let index_path = state.dist_dir.join("index.html");
    let static_files = ServeDir::new(&state.dist_dir)
        .not_found_service(ServeFile::new(index_path));
    let app = Router::new()
        .route("/api/proxy", post(cors_proxy))
        .route("/api/llm/{*rest}", any(llm_proxy))
        .fallback_service(static_files)
        .layer(coop)
        .with_state(state);
    let addr = listener.local_addr().unwrap_or_else(|_| SocketAddr::from(([127, 0, 0, 1], 0)));
    tracing::info!(%addr, "local static + proxy server listening");
    if let Err(e) = axum::serve(listener, app.into_make_service()).await {
        tracing::error!(?e, "axum serve ended");
    }
}

fn llm_cors_headers() -> HeaderMap {
    let mut h = HeaderMap::new();
    h.insert("access-control-allow-origin", HeaderValue::from_static("*"));
    h.insert(
        "access-control-allow-methods",
        HeaderValue::from_static("GET,POST,OPTIONS"),
    );
    h.insert(
        "access-control-allow-headers",
        HeaderValue::from_static(
            "authorization,content-type,http-referer,x-title,x-openrouter-title,x-webagent-session",
        ),
    );
    h.insert(
        "access-control-allow-private-network",
        HeaderValue::from_static("true"),
    );
    h
}

fn parse_llm_route(path: &str, upstreams: &HashMap<String, UpstreamTarget>) -> Option<(String, String)> {
    let suffix = path.strip_prefix(LLM_PREFIX)?;
    let mut parts = suffix.split('/').filter(|s| !s.is_empty());
    let provider = parts.next()?.to_string();
    let rest: Vec<&str> = parts.collect();
    if rest.is_empty() {
        return None;
    }
    if !upstreams.contains_key(&provider) {
        return None;
    }
    Some((provider, format!("/{}", rest.join("/"))))
}

fn rewrite_upstream_path(provider: &str, request_path: &str, u: &UpstreamTarget) -> Option<String> {
    let matched = format!("{LLM_PREFIX}{provider}");
    let tail = if let Some(t) = request_path.strip_prefix(&matched) {
        if t.starts_with('/') {
            t.to_string()
        } else if t.is_empty() {
            "/".to_string()
        } else {
            format!("/{t}")
        }
    } else {
        return None;
    };
    let base = u.base_path.trim_end_matches('/');
    Some(format!("{base}{tail}"))
}

async fn llm_proxy(
    axum::extract::State(state): axum::extract::State<Arc<ServerState>>,
    req: Request,
) -> Response {
    let path = req.uri().path().to_string();
    let method = req.method().clone();
    if method == Method::OPTIONS {
        return (StatusCode::NO_CONTENT, llm_cors_headers()).into_response();
    }
    let Some((provider, _rest)) = parse_llm_route(&path, &state.upstreams) else {
        let body = serde_json::json!({
            "error": "llm_provider_not_allowed",
            "allowedProviders": state.upstreams.keys().collect::<Vec<_>>(),
        });
        let mut h = llm_cors_headers();
        h.insert("content-type", HeaderValue::from_static("application/json"));
        return (StatusCode::FORBIDDEN, h, body.to_string()).into_response();
    };
    let Some(u) = state.upstreams.get(&provider) else {
        return (StatusCode::FORBIDDEN, llm_cors_headers()).into_response();
    };
    let Some(upstream_path) = rewrite_upstream_path(&provider, &path, u) else {
        return (StatusCode::BAD_GATEWAY, llm_cors_headers()).into_response();
    };
    let target = format!(
        "{}{}",
        u.origin.trim_end_matches('/'),
        upstream_path
    );
    forward_llm_request(&state, &provider, req, &target).await
}

async fn forward_llm_request(
    state: &ServerState,
    provider: &str,
    req: Request,
    target: &str,
) -> Response {
    let method = req.method().clone();
    let mut reqwest_headers = reqwest::header::HeaderMap::new();
    for (k, v) in req.headers().iter() {
        let name = k.as_str().to_lowercase();
        if matches!(
            name.as_str(),
            "host" | "connection" | "content-length" | "transfer-encoding"
        ) {
            continue;
        }
        if let Ok(name) = reqwest::header::HeaderName::try_from(k.as_str()) {
            if let Ok(val) = reqwest::header::HeaderValue::from_bytes(v.as_bytes()) {
                reqwest_headers.insert(name, val);
            }
        }
    }
    if provider == "openrouter" {
        let has_auth = reqwest_headers.contains_key(reqwest::header::AUTHORIZATION);
        if !has_auth {
            if let Ok(key) = std::env::var("OPENROUTER_API_KEY") {
                let key = key.trim();
                if !key.is_empty() {
                    let _ = reqwest_headers.insert(
                        reqwest::header::AUTHORIZATION,
                        reqwest::header::HeaderValue::from_str(&format!("Bearer {key}"))
                            .unwrap_or_else(|_| reqwest::header::HeaderValue::from_static("")),
                    );
                }
            }
        }
    }
    let body_bytes = match BodyExt::collect(req.into_body()).await {
        Ok(col) => col.to_bytes(),
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };
    let rb = state
        .client
        .request(method, target)
        .headers(reqwest_headers)
        .body(body_bytes);
    let upstream = match rb.send().await {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(?e, "llm upstream request failed");
            return StatusCode::BAD_GATEWAY.into_response();
        }
    };
    let axum_status = StatusCode::from_u16(upstream.status().as_u16())
        .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let mut res = Response::builder().status(axum_status);
    for (k, v) in upstream.headers().iter() {
        let name = k.as_str().to_lowercase();
        if matches!(
            name.as_str(),
            "connection" | "transfer-encoding" | "keep-alive"
        ) {
            continue;
        }
        if let Ok(hn) = HeaderName::try_from(k.as_str()) {
            if let Ok(hv) = HeaderValue::from_bytes(v.as_bytes()) {
                res = res.header(hn, hv);
            }
        }
    }
    for (name, value) in llm_cors_headers().iter() {
        res = res.header(name, value);
    }
    let stream = upstream
        .bytes_stream()
        .map_err(|e: reqwest::Error| std::io::Error::other(e.to_string()));
    match res.body(Body::from_stream(stream)) {
        Ok(resp) => resp,
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

#[derive(Deserialize)]
struct CorsProxyBody {
    #[serde(default)]
    method: String,
    url: String,
    #[serde(default)]
    headers: serde_json::Value,
    #[serde(default)]
    body: Option<serde_json::Value>,
}

async fn cors_proxy(
    axum::extract::State(state): axum::extract::State<Arc<ServerState>>,
    req: Request,
) -> Response {
    let mut headers = HeaderMap::new();
    headers.insert("access-control-allow-origin", HeaderValue::from_static("*"));
    headers.insert(
        "access-control-allow-methods",
        HeaderValue::from_static("POST,OPTIONS"),
    );
    headers.insert(
        "access-control-allow-headers",
        HeaderValue::from_static("content-type"),
    );
    headers.insert(
        "access-control-allow-private-network",
        HeaderValue::from_static("true"),
    );
    if *req.method() == Method::OPTIONS {
        return (StatusCode::NO_CONTENT, headers).into_response();
    }
    if *req.method() != Method::POST {
        return (StatusCode::METHOD_NOT_ALLOWED, headers).into_response();
    }
    let body_bytes = match BodyExt::collect(req.into_body()).await {
        Ok(col) => col.to_bytes(),
        Err(_) => return (StatusCode::BAD_REQUEST, headers).into_response(),
    };
    let parsed: CorsProxyBody = match serde_json::from_slice(&body_bytes) {
        Ok(p) => p,
        Err(e) => {
            headers.insert("content-type", HeaderValue::from_static("application/json"));
            return (
                StatusCode::BAD_REQUEST,
                headers,
                serde_json::json!({"error": e.to_string()}).to_string(),
            )
                .into_response();
        }
    };
    let method = match parsed.method.to_uppercase().parse::<reqwest::Method>() {
        Ok(m) => m,
        Err(_) => reqwest::Method::GET,
    };
    let mut rh = reqwest::header::HeaderMap::new();
    if let serde_json::Value::Object(map) = parsed.headers {
        for (k, v) in map {
            if let Ok(name) = reqwest::header::HeaderName::try_from(k.as_str()) {
                if let Some(s) = v.as_str() {
                    if let Ok(val) = reqwest::header::HeaderValue::from_str(s) {
                        rh.insert(name, val);
                    }
                }
            }
        }
    }
    let body_opt = parsed.body.and_then(|b| match b {
        serde_json::Value::String(s) => Some(s),
        serde_json::Value::Null => None,
        other => Some(other.to_string()),
    });
    let mut rb = state.client.request(method, &parsed.url).headers(rh);
    if let Some(b) = body_opt {
        rb = rb.body(b);
    }
    let upstream = match rb.send().await {
        Ok(r) => r,
        Err(e) => {
            headers.insert("content-type", HeaderValue::from_static("application/json"));
            return (
                StatusCode::BAD_GATEWAY,
                headers,
                serde_json::json!({"error": e.to_string()}).to_string(),
            )
                .into_response();
        }
    };
    let status = upstream.status();
    let ct = upstream
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    let response_body = match upstream.text().await {
        Ok(t) => t,
        Err(e) => {
            headers.insert("content-type", HeaderValue::from_static("application/json"));
            return (
                StatusCode::BAD_GATEWAY,
                headers,
                serde_json::json!({"error": e.to_string()}).to_string(),
            )
                .into_response();
        }
    };
    let payload = serde_json::json!({
        "status": status.as_u16(),
        "statusText": status.canonical_reason().unwrap_or(""),
        "body": response_body,
        "contentType": ct,
    });
    headers.insert("content-type", HeaderValue::from_static("application/json"));
    let code = StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::OK);
    (code, headers, payload.to_string()).into_response()
}
