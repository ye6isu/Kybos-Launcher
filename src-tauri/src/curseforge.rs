use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::Write;
use std::path::Path;

const CURSEFORGE_API_KEY: &str = "$2a$10$bL4bIL5pUWqfcO7KQtnMReakwtfHbNKh6v1uTpKlzhwoueEJQnPnm"; // Standard Eternal public launcher API key

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CurseForgeSearchResponse {
    pub data: Vec<CurseForgeMod>,
    pub pagination: Option<CurseForgePagination>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CurseForgePagination {
    pub index: u32,
    #[serde(rename = "pageSize")]
    pub page_size: u32,
    #[serde(rename = "resultCount")]
    pub result_count: u32,
    #[serde(rename = "totalCount")]
    pub total_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CurseForgeSearchResult {
    pub hits: Vec<crate::modrinth::ModrinthSearchHit>,
    pub total_hits: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CurseForgeMod {
    pub id: u64,
    pub name: String,
    pub summary: String,
    pub slug: String,
    #[serde(rename = "downloadCount")]
    pub download_count: f64,
    pub logo: Option<CurseForgeLogo>,
    pub authors: Vec<CurseForgeAuthor>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CurseForgeLogo {
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CurseForgeAuthor {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CurseForgeFilesResponse {
    pub data: Vec<CurseForgeFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CurseForgeFile {
    pub id: u64,
    #[serde(rename = "displayName")]
    pub display_name: String,
    #[serde(rename = "fileName")]
    pub file_name: String,
    #[serde(rename = "downloadUrl")]
    pub download_url: Option<String>,
    #[serde(rename = "fileLength")]
    pub file_length: u64,
    #[serde(rename = "gameVersions")]
    pub game_versions: Vec<String>,
    #[serde(default)]
    pub dependencies: Vec<CurseForgeFileDependency>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CurseForgeFileDependency {
    #[serde(rename = "modId")]
    pub mod_id: u64,
    #[serde(rename = "relationType")]
    pub relation_type: u32, // 1: EmbeddedLibrary, 2: OptionalDependency, 3: RequiredDependency, 4: Tool, 5: Incompatible, 6: Include
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CurseForgeModResponse {
    pub data: CurseForgeModFull,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CurseForgeScreenshot {
    pub id: Option<u64>,
    pub title: Option<String>,
    pub description: Option<String>,
    #[serde(rename = "thumbnailUrl")]
    pub thumbnail_url: Option<String>,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CurseForgeModFull {
    pub id: u64,
    pub name: String,
    pub summary: String,
    pub slug: String,
    #[serde(rename = "downloadCount")]
    pub download_count: f64,
    pub logo: Option<CurseForgeLogo>,
    pub authors: Vec<CurseForgeAuthor>,
    pub links: Option<CurseForgeLinks>,
    #[serde(default)]
    pub screenshots: Vec<CurseForgeScreenshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CurseForgeLinks {
    #[serde(rename = "websiteUrl")]
    pub website_url: Option<String>,
    #[serde(rename = "wikiUrl")]
    pub wiki_url: Option<String>,
    #[serde(rename = "issuesUrl")]
    pub issues_url: Option<String>,
    #[serde(rename = "sourceUrl")]
    pub source_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CurseForgeDescriptionResponse {
    pub data: String,
}

pub struct CurseForgeClient {
    client: reqwest::Client,
    api_key: String,
}

impl CurseForgeClient {
    pub fn new() -> Self {
        Self::with_key(CURSEFORGE_API_KEY.to_string())
    }

    pub fn with_key(key: String) -> Self {
        let clean_key = if key.trim().is_empty() {
            CURSEFORGE_API_KEY.to_string()
        } else {
            key.trim().to_string()
        };
        Self {
            client: reqwest::Client::builder()
                .user_agent("KybosLauncher/0.1.0")
                .build()
                .unwrap(),
            api_key: clean_key,
        }
    }

    /// Search mods on CurseForge
    pub async fn search_mods(
        &self,
        query: &str,
        game_version: Option<&str>,
        loader: Option<&str>,
        limit: u32,
        index: u32,
    ) -> Result<CurseForgeSearchResult, String> {
        // CurseForge API requires pageSize to be between 1 and 50
        let effective_limit = limit.clamp(1, 50);

        let mut url = format!(
            "https://api.curseforge.com/v1/mods/search?gameId=432&classId=6&pageSize={}&index={}&sortField=6&sortOrder=desc",
            effective_limit, index
        );

        if !query.trim().is_empty() {
            url.push_str(&format!("&searchFilter={}", urlencoding::encode(query.trim())));
        }

        if let Some(gv) = game_version {
            if !gv.trim().is_empty() {
                url.push_str(&format!("&gameVersion={}", gv.trim()));
            }
        }

        if let Some(l) = loader {
            let loader_type = match l.to_lowercase().replace('_', "").as_str() {
                "forge" => Some(1),
                "fabric" => Some(4),
                "quilt" => Some(5),
                "neoforge" => Some(6),
                _ => None,
            };
            if let Some(lt) = loader_type {
                url.push_str(&format!("&modLoaderType={}", lt));
            }
        }

        let resp = self
            .client
            .get(&url)
            .header("x-api-key", &self.api_key)
            .send()
            .await
            .map_err(|e| format!("CurseForge network error: {}", e))?;

        let status = resp.status();
        let body_text = resp
            .text()
            .await
            .map_err(|e| format!("Failed to read CurseForge response: {}", e))?;

        if !status.is_success() {
            if status.as_u16() == 403 {
                return Err("CurseForge API key is invalid or access was restricted (403 Forbidden).".to_string());
            }
            return Err(format!("CurseForge returned error {}: {}", status, body_text));
        }

        let res = serde_json::from_str::<CurseForgeSearchResponse>(&body_text)
            .map_err(|e| format!("CurseForge search decode error: {}. Response: {}", e, body_text.chars().take(200).collect::<String>()))?;

        let total_hits = res
            .pagination
            .as_ref()
            .and_then(|p| p.total_count)
            .unwrap_or(res.data.len() as u64);

        let hits = res
            .data
            .into_iter()
            .map(|m| crate::modrinth::ModrinthSearchHit {
                project_id: format!("cf-{}", m.id),
                title: m.name,
                description: m.summary,
                icon_url: m.logo.map(|l| l.url),
                author: m.authors.first().map(|a| a.name.clone()).unwrap_or_else(|| "Unknown".to_string()),
                downloads: m.download_count as u64,
                follows: 0,
                slug: m.slug,
                loaders: None,
                versions: None,
            })
            .collect();

        Ok(CurseForgeSearchResult { hits, total_hits })
    }

    /// Fetches files for a CurseForge mod
    pub async fn get_mod_files(&self, mod_id: u64) -> Result<Vec<CurseForgeFile>, String> {
        let url = format!("https://api.curseforge.com/v1/mods/{}/files", mod_id);
        let resp = self
            .client
            .get(&url)
            .header("x-api-key", &self.api_key)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        let res = resp.json::<CurseForgeFilesResponse>().await.map_err(|e| e.to_string())?;
        Ok(res.data)
    }

    /// Downloads and installs a CurseForge mod file
    pub async fn install_file(
        &self,
        file_url: &str,
        filename: &str,
        dest_dir: &Path,
    ) -> Result<String, String> {
        fs::create_dir_all(dest_dir).map_err(|e| e.to_string())?;
        let target_path = dest_dir.join(filename);

        let resp = self
            .client
            .get(file_url)
            .header("x-api-key", CURSEFORGE_API_KEY)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
        let mut file = File::create(&target_path).map_err(|e| e.to_string())?;
        file.write_all(&bytes).map_err(|e| e.to_string())?;

        Ok(filename.to_string())
    }

    /// Fetches mod details by ID
    pub async fn get_mod(&self, mod_id: u64) -> Result<CurseForgeModFull, String> {
        let url = format!("https://api.curseforge.com/v1/mods/{}", mod_id);
        let resp = self
            .client
            .get(&url)
            .header("x-api-key", &self.api_key)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        let res = resp.json::<CurseForgeModResponse>().await.map_err(|e| e.to_string())?;
        Ok(res.data)
    }

    /// Fetches full HTML description
    pub async fn get_description(&self, mod_id: u64) -> Result<String, String> {
        let url = format!("https://api.curseforge.com/v1/mods/{}/description", mod_id);
        let resp = self
            .client
            .get(&url)
            .header("x-api-key", &self.api_key)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        let res = resp.json::<CurseForgeDescriptionResponse>().await.map_err(|e| e.to_string())?;
        Ok(res.data)
    }
}
