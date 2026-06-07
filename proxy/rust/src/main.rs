use base64::{engine::general_purpose, Engine as _};
use rouille::{Request, Response};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::env;
use std::io::Read;
use url::Url;

const DEFAULT_ALLOWED_ORIGINS: &[&str] = &[
    "https://elpa.gnu.org",
    "https://melpa.org",
    "https://stable.melpa.org",
];

const BLOCKED_HEADERS: &[&str] = &[
    "connection",
    "content-length",
    "cookie",
    "host",
    "origin",
    "referer",
    "sec-fetch-dest",
    "sec-fetch-mode",
    "sec-fetch-site",
    "transfer-encoding",
];

#[derive(Deserialize)]
struct HeaderPair(String, String);

#[derive(Deserialize)]
#[serde(untagged)]
enum HeadersInput {
    Pairs(Vec<HeaderPair>),
    Object(HashMap<String, String>),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FetchRequest {
    url: String,
    method: Option<String>,
    headers: Option<HeadersInput>,
    body: Option<String>,
    body_base64: Option<String>,
}

#[derive(Serialize)]
struct ResponseHeader {
    name: String,
    value: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FetchResponse {
    url: String,
    status: u16,
    status_text: String,
    headers: Vec<ResponseHeader>,
    body_base64: String,
}

fn allowed_origins() -> HashSet<String> {
    match env::var("WASMACS_PROXY_ALLOWED_ORIGINS") {
        Ok(raw) if !raw.trim().is_empty() => raw
            .split(',')
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty())
            .collect(),
        _ => DEFAULT_ALLOWED_ORIGINS
            .iter()
            .map(|item| item.to_string())
            .collect(),
    }
}

fn assert_allowed_url(raw: &str) -> Result<Url, String> {
    let target = Url::parse(raw).map_err(|_| "invalid URL".to_string())?;
    if target.scheme() != "http" && target.scheme() != "https" {
        return Err(format!("unsupported URL scheme: {}", target.scheme()));
    }
    let origin = match target.port() {
        Some(port) => format!(
            "{}://{}:{}",
            target.scheme(),
            target.host_str().unwrap_or(""),
            port
        ),
        None => format!("{}://{}", target.scheme(), target.host_str().unwrap_or("")),
    };
    if !allowed_origins().contains(&origin) {
        return Err(format!("URL origin is not allowed: {}", origin));
    }
    Ok(target)
}

fn normalize_headers(headers: Option<HeadersInput>) -> Vec<(String, String)> {
    let blocked: HashSet<&str> = BLOCKED_HEADERS.iter().copied().collect();
    let pairs = match headers {
        Some(HeadersInput::Pairs(values)) => {
            values.into_iter().map(|pair| (pair.0, pair.1)).collect()
        }
        Some(HeadersInput::Object(values)) => values.into_iter().collect(),
        None => Vec::new(),
    };
    pairs
        .into_iter()
        .filter_map(|(name, value)| {
            let lowered = name.to_lowercase();
            if lowered.is_empty() || blocked.contains(lowered.as_str()) {
                None
            } else {
                Some((lowered, value))
            }
        })
        .collect()
}

fn request_body(payload: &FetchRequest, method: &str) -> Result<Option<Vec<u8>>, String> {
    if method == "GET" || method == "HEAD" {
        return Ok(None);
    }
    if let Some(value) = &payload.body_base64 {
        return general_purpose::STANDARD
            .decode(value)
            .map(Some)
            .map_err(|error| error.to_string());
    }
    Ok(payload.body.as_ref().map(|value| value.as_bytes().to_vec()))
}

fn json_response(status: u16, payload: serde_json::Value) -> Response {
    Response::json(&payload)
        .with_status_code(status)
        .with_additional_header("Cache-Control", "no-store")
}

fn handle_proxy(request: &Request) -> Response {
    if request.method() != "POST" {
        return Response::text("method not allowed")
            .with_status_code(405)
            .with_additional_header("Allow", "POST");
    }

    let mut body = String::new();
    if let Err(error) = request
        .data()
        .unwrap()
        .take(16 * 1024 * 1024)
        .read_to_string(&mut body)
    {
        return json_response(400, serde_json::json!({ "error": error.to_string() }));
    }
    let payload: FetchRequest = match serde_json::from_str(&body) {
        Ok(value) => value,
        Err(error) => return json_response(400, serde_json::json!({ "error": error.to_string() })),
    };
    let target = match assert_allowed_url(&payload.url) {
        Ok(value) => value,
        Err(error) => return json_response(400, serde_json::json!({ "error": error })),
    };
    let method = payload
        .method
        .clone()
        .unwrap_or_else(|| "GET".to_string())
        .to_uppercase();
    let body = match request_body(&payload, &method) {
        Ok(value) => value,
        Err(error) => return json_response(400, serde_json::json!({ "error": error })),
    };

    let agent = ureq::AgentBuilder::new().build();
    let mut upstream_request = agent.request(&method, target.as_str());
    for (name, value) in normalize_headers(payload.headers) {
        upstream_request = upstream_request.set(&name, &value);
    }
    let upstream = match body {
        Some(bytes) => upstream_request.send_bytes(&bytes),
        None => upstream_request.call(),
    };
    let upstream = match upstream {
        Ok(value) => value,
        Err(ureq::Error::Status(_, value)) => value,
        Err(error) => return json_response(400, serde_json::json!({ "error": error.to_string() })),
    };
    let status = upstream.status();
    let status_text = upstream.status_text().to_string();
    let url = upstream.get_url().to_string();
    let headers = upstream
        .headers_names()
        .into_iter()
        .filter_map(|name| {
            upstream.header(&name).map(|value| ResponseHeader {
                name: name.to_lowercase(),
                value: value.to_string(),
            })
        })
        .collect();
    let mut body = Vec::new();
    if let Err(error) = upstream.into_reader().read_to_end(&mut body) {
        return json_response(400, serde_json::json!({ "error": error.to_string() }));
    }

    let response = FetchResponse {
        url,
        status,
        status_text,
        headers,
        body_base64: general_purpose::STANDARD.encode(body),
    };
    Response::json(&response)
        .with_status_code(200)
        .with_additional_header("Cache-Control", "no-store")
}

fn main() {
    let port = env::var("PORT").unwrap_or_else(|_| "8787".to_string());
    let address = format!("127.0.0.1:{}", port);
    println!("wasmacs fetch proxy listening at http://{}/", address);
    rouille::start_server(address, move |request| handle_proxy(request));
}
