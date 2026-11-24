use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::Write;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModSearchResult {
    pub project_id: String,
    pub title: String,
    pub description: String,
    pub icon_url: Option<String>,
    pub author: String,
    pub downloads: u64,
    pub follows: u64,
    pub slug: String,
    pub loaders: Vec<String>,
    pub versions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModrinthSearchResponse {
    pub hits: Vec<ModrinthSearchHit>,
    pub total_hits: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModrinthSearchHit {
    pub project_id: String,
    pub title: String,
    pub description: String,
    pub icon_url: Option<String>,
    pub author: String,
    pub downloads: u64,
    pub follows: u64,
    pub slug: String,
    pub loaders: Option<Vec<String>>,
    pub versions: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModVersion {
    pub id: String,
    pub name: String,
    pub version_number: String,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
    pub files: Vec<ModVersionFile>,
    #[serde(default)]
    pub dependencies: Vec<ModrinthVersionDependency>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModrinthVersionDependency {
    pub version_id: Option<String>,
    pub project_id: Option<String>,
    pub file_name: Option<String>,
    pub dependency_type: String, // "required", "optional", "incompatible", "embedded"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModrinthGalleryItem {
    pub url: String,
    pub featured: bool,
    pub title: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModrinthProjectDetails {
    pub id: String,
    pub slug: String,
    pub title: String,
    pub description: String,
    pub body: Option<String>,
    pub icon_url: Option<String>,
    pub downloads: u64,
    pub followers: u64,
    pub categories: Vec<String>,
    pub loaders: Vec<String>,
    pub versions: Vec<String>,
    pub source_url: Option<String>,
    pub issues_url: Option<String>,
    pub wiki_url: Option<String>,
    pub discord_url: Option<String>,
    #[serde(default)]
    pub gallery: Vec<ModrinthGalleryItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModrinthDependencyProject {
    pub id: String,
    pub slug: String,
    pub title: String,
    pub description: String,
    pub icon_url: Option<String>,
    #[serde(default)]
    pub downloads: u64,
    #[serde(default)]
    pub followers: u64,
    #[serde(default)]
    pub loaders: Vec<String>,
    #[serde(default)]
    pub versions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModrinthProjectDependencies {
    pub projects: Vec<ModrinthDependencyProject>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModVersionFile {
    pub url: String,
    pub filename: String,
    pub primary: bool,
    pub size: u64,
}

pub struct ModrinthClient {
    client: reqwest::Client,
}

impl ModrinthClient {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::builder()
                .user_agent("KybosLauncher/0.1.0")
                .build()
                .unwrap(),
        }
    }

    /// Search mods with optional loader, game_version, limit, and offset for pagination
    pub async fn search_mods(
        &self,
        query: &str,
        loader: Option<&str>,
        game_version: Option<&str>,
        limit: u32,
        offset: u32,
    ) -> Result<ModrinthSearchResponse, String> {
        let mut facets = Vec::new();
        facets.push(r#"["project_type:mod"]"#.to_string());

        if let Some(l) = loader {
            let clean = l.to_lowercase().replace('_', "");
            let normalized_loader = match clean.as_str() {
                "neoforge" => "neoforge",
                "fabric" => "fabric",
                "forge" => "forge",
                "quilt" => "quilt",
                other => other,
            };
            facets.push(format!(r#"["categories:{}"]"#, normalized_loader));
        }

        if let Some(gv) = game_version {
            facets.push(format!(r#"["versions:{}"]"#, gv));
        }

        let facets_str = format!("[{}]", facets.join(","));
        let url = format!(
            "https://api.modrinth.com/v2/search?query={}&facets={}&limit={}&offset={}",
            urlencoding::encode(query),
            urlencoding::encode(&facets_str),
            limit,
            offset
        );

        let resp = self.client.get(&url).send().await.map_err(|e| e.to_string())?;
        resp.json::<ModrinthSearchResponse>().await.map_err(|e| e.to_string())
    }

    /// Fetches project versions compatible with a loader and game version
    pub async fn fetch_project_versions(
        &self,
        project_id_or_slug: &str,
        loader: Option<&str>,
        game_version: Option<&str>,
    ) -> Result<Vec<ModVersion>, String> {
        let mut url = format!(
            "https://api.modrinth.com/v2/project/{}/version",
            project_id_or_slug
        );

        let mut query_params = Vec::new();
        if let Some(l) = loader {
            let clean = l.to_lowercase().replace('_', "");
            let normalized = match clean.as_str() {
                "neoforge" => "neoforge",
                "fabric" => "fabric",
                "forge" => "forge",
                "quilt" => "quilt",
                other => other,
            };
            query_params.push(format!(r#"loaders=["{}"]"#, normalized));
        }
        if let Some(gv) = game_version {
            query_params.push(format!(r#"game_versions=["{}"]"#, gv));
        }

        if !query_params.is_empty() {
            url.push('?');
            url.push_str(&query_params.join("&"));
        }

        let resp = self.client.get(&url).send().await.map_err(|e| e.to_string())?;
        resp.json::<Vec<ModVersion>>().await.map_err(|e| e.to_string())
    }

    /// Installs a mod file into an instance's mods folder
    pub async fn install_mod(
        &self,
        file_url: &str,
        filename: &str,
        instance_mods_dir: &Path,
    ) -> Result<String, String> {
        fs::create_dir_all(instance_mods_dir).map_err(|e| e.to_string())?;
        let target_path = instance_mods_dir.join(filename);

        let resp = self.client.get(file_url).send().await.map_err(|e| e.to_string())?;
        let bytes = resp.bytes().await.map_err(|e| e.to_string())?;

        let mut file = File::create(&target_path).map_err(|e| e.to_string())?;
        file.write_all(&bytes).map_err(|e| e.to_string())?;

        Ok(filename.to_string())
    }

    /// Fetches full project details including markdown body
    pub async fn get_project(&self, project_id_or_slug: &str) -> Result<ModrinthProjectDetails, String> {
        let url = format!("https://api.modrinth.com/v2/project/{}", project_id_or_slug);
        let resp = self.client.get(&url).send().await.map_err(|e| e.to_string())?;
        resp.json::<ModrinthProjectDetails>().await.map_err(|e| e.to_string())
    }

    /// Fetches project dependencies
    pub async fn get_project_dependencies(&self, project_id_or_slug: &str) -> Result<ModrinthProjectDependencies, String> {
        let url = format!("https://api.modrinth.com/v2/project/{}/dependencies", project_id_or_slug);
        let resp = self.client.get(&url).send().await.map_err(|e| e.to_string())?;
        resp.json::<ModrinthProjectDependencies>().await.map_err(|e| e.to_string())
    }
}
