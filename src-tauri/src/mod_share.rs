use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha512};
use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModFingerprint {
    pub filename: String,
    pub sha512: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShareManifest {
    pub format_version: u32,
    pub name: String,
    pub game_version: String,
    pub loader: String,
    pub loader_version: Option<String>,
    pub ram_mb: u32,
    pub mods: Vec<ModFingerprint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModrinthVersionFile {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub version_number: String,
    pub files: Vec<ModrinthFileDetail>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModrinthFileDetail {
    pub url: String,
    pub filename: String,
    pub primary: bool,
    pub size: u64,
}

pub fn compute_sha512(path: &Path) -> Result<(String, u64), String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha512::new();
    let mut buffer = [0u8; 65536]; // 64KB read chunks
    let mut total_bytes = 0u64;

    loop {
        let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
        total_bytes += n as u64;
    }

    let hash_result = format!("{:x}", hasher.finalize());
    Ok((hash_result, total_bytes))
}

pub fn create_share_code(manifest: &ShareManifest) -> Result<String, String> {
    let json = serde_json::to_string(manifest).map_err(|e| e.to_string())?;
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
    let compressed = encoder.finish().map_err(|e| e.to_string())?;
    let b64 = BASE64.encode(compressed);
    Ok(format!("KYBOS:{}", b64))
}

pub fn decode_share_code(share_code: &str) -> Result<ShareManifest, String> {
    let raw = share_code.trim();
    let b64_payload = if let Some(stripped) = raw.strip_prefix("KYBOS:") {
        stripped
    } else if let Some(stripped) = raw.strip_prefix("AGYMC:") {
        stripped
    } else {
        raw
    };

    let compressed = BASE64.decode(b64_payload).map_err(|e| format!("Base64 decode failed: {}", e))?;
    let mut decoder = GzDecoder::new(&compressed[..]);
    let mut json_str = String::new();
    decoder.read_to_string(&mut json_str).map_err(|e| format!("Gzip decode failed: {}", e))?;
    serde_json::from_str::<ShareManifest>(&json_str).map_err(|e| format!("Invalid manifest JSON: {}", e))
}

pub async fn query_modrinth_hash(sha512: &str) -> Result<Option<ModrinthVersionFile>, String> {
    let client = reqwest::Client::builder()
        .user_agent("KybosLauncher/0.1.0")
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("https://api.modrinth.com/v2/version_file/{}", sha512);
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }

    if !resp.status().is_success() {
        return Err(format!("Modrinth API error: status {}", resp.status()));
    }

    let version_info = resp.json::<ModrinthVersionFile>().await.map_err(|e| e.to_string())?;
    Ok(Some(version_info))
}
