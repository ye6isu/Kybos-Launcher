use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionManifest {
    pub latest: LatestVersions,
    pub versions: Vec<VersionEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LatestVersions {
    pub release: String,
    pub snapshot: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionEntry {
    pub id: String,
    #[serde(rename = "type")]
    pub version_type: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionPackage {
    pub id: String,
    pub downloads: Downloads,
    pub libraries: Vec<Library>,
    #[serde(rename = "mainClass")]
    pub main_class: String,
    #[serde(rename = "assetIndex")]
    pub asset_index: AssetIndexRef,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetIndexRef {
    pub id: String,
    pub sha1: String,
    pub size: u64,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Downloads {
    pub client: DownloadArtifact,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadArtifact {
    pub sha1: String,
    pub size: u64,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Library {
    pub name: String,
    pub downloads: Option<LibraryDownloads>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryDownloads {
    pub artifact: Option<LibraryArtifact>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryArtifact {
    pub path: String,
    pub sha1: String,
    pub size: u64,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetIndex {
    pub objects: HashMap<String, AssetObject>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetObject {
    pub hash: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FabricLoaderProfile {
    #[serde(rename = "mainClass")]
    pub main_class: String,
    pub arguments: Option<FabricArguments>,
    pub libraries: Vec<FabricLibrary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FabricArguments {
    pub jvm: Option<Vec<String>>,
    pub game: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FabricLibrary {
    pub name: String,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrismNeoForgeProfile {
    #[serde(rename = "mainClass")]
    pub main_class: String,
    pub libraries: Vec<PrismLibrary>,
    #[serde(rename = "mavenFiles")]
    pub maven_files: Option<Vec<PrismLibrary>>,
    #[serde(rename = "minecraftArguments")]
    pub minecraft_arguments: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrismLibrary {
    pub name: String,
    pub downloads: Option<PrismLibraryDownloads>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrismLibraryDownloads {
    pub artifact: Option<PrismArtifact>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrismArtifact {
    pub path: Option<String>,
    pub sha1: Option<String>,
    pub size: Option<u64>,
    pub url: String,
}

pub struct MinecraftDownloader {
    client: reqwest::Client,
}

impl MinecraftDownloader {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::builder()
                .user_agent("KybosLauncher/0.1.0")
                .build()
                .unwrap(),
        }
    }

    pub async fn fetch_version_manifest(&self) -> Result<VersionManifest, String> {
        let url = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
        let resp = self.client.get(url).send().await.map_err(|e| e.to_string())?;
        resp.json::<VersionManifest>().await.map_err(|e| e.to_string())
    }

    pub async fn fetch_version_package(&self, version_id: &str) -> Result<VersionPackage, String> {
        let manifest = self.fetch_version_manifest().await?;
        let entry = manifest
            .versions
            .into_iter()
            .find(|v| v.id == version_id)
            .ok_or_else(|| format!("Minecraft version '{}' not found in manifest", version_id))?;

        let resp = self.client.get(&entry.url).send().await.map_err(|e| e.to_string())?;
        resp.json::<VersionPackage>().await.map_err(|e| e.to_string())
    }

    /// Downloads the client.jar for the given version
    pub async fn download_client_jar(
        &self,
        package: &VersionPackage,
        versions_dir: &Path,
    ) -> Result<PathBuf, String> {
        let target_dir = versions_dir.join(&package.id);
        fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
        let jar_path = target_dir.join(format!("{}.jar", package.id));

        if jar_path.is_file() {
            // Already downloaded
            return Ok(jar_path);
        }

        let resp = self
            .client
            .get(&package.downloads.client.url)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
        let mut file = File::create(&jar_path).map_err(|e| e.to_string())?;
        file.write_all(&bytes).map_err(|e| e.to_string())?;

        Ok(jar_path)
    }

    /// Downloads missing libraries into `libraries/`
    pub async fn download_libraries(
        &self,
        package: &VersionPackage,
        libraries_dir: &Path,
    ) -> Result<Vec<PathBuf>, String> {
        let mut paths = Vec::new();

        for lib in &package.libraries {
            if let Some(ref dls) = lib.downloads {
                if let Some(ref art) = dls.artifact {
                    let lib_path = libraries_dir.join(&art.path);
                    paths.push(lib_path.clone());

                    if !lib_path.is_file() {
                        if let Some(parent) = lib_path.parent() {
                            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                        }

                        if let Ok(resp) = self.client.get(&art.url).send().await {
                            if let Ok(bytes) = resp.bytes().await {
                                if let Ok(mut f) = File::create(&lib_path) {
                                    f.write_all(&bytes).ok();
                                }
                            }
                        }
                    }
                }
            }
        }

        Ok(paths)
    }

    /// Downloads and indexes game assets, reusing existing files from `.minecraft/assets`
    pub async fn sync_assets<F>(
        &self,
        package: &VersionPackage,
        assets_dir: &Path,
        mut on_progress: F,
    ) -> Result<(), String>
    where
        F: FnMut(&str, f64),
    {
        let indexes_dir = assets_dir.join("indexes");
        let objects_dir = assets_dir.join("objects");
        fs::create_dir_all(&indexes_dir).map_err(|e| e.to_string())?;
        fs::create_dir_all(&objects_dir).map_err(|e| e.to_string())?;

        on_progress("Synchronizing Minecraft game asset index...", 60.0);

        // 1. Download index json
        let index_file = indexes_dir.join(format!("{}.json", package.asset_index.id));
        let index_content = if !index_file.is_file() {
            let resp = self
                .client
                .get(&package.asset_index.url)
                .send()
                .await
                .map_err(|e| e.to_string())?;
            let text = resp.text().await.map_err(|e| e.to_string())?;
            fs::write(&index_file, &text).map_err(|e| e.to_string())?;
            text
        } else {
            fs::read_to_string(&index_file).map_err(|e| e.to_string())?
        };

        let asset_index = serde_json::from_str::<AssetIndex>(&index_content)
            .map_err(|e| format!("Failed to parse asset index: {}", e))?;

        // Check local .minecraft/assets for deduplication
        let mut fallback_objects: Option<PathBuf> = None;
        #[cfg(target_os = "windows")]
        if let Ok(appdata) = std::env::var("APPDATA") {
            let p = PathBuf::from(appdata).join(".minecraft").join("assets").join("objects");
            if p.is_dir() {
                fallback_objects = Some(p);
            }
        }
        #[cfg(target_os = "linux")]
        if let Ok(home) = std::env::var("HOME") {
            let p = PathBuf::from(home).join(".minecraft").join("assets").join("objects");
            if p.is_dir() {
                fallback_objects = Some(p);
            }
        }
        #[cfg(target_os = "macos")]
        if let Ok(home) = std::env::var("HOME") {
            let p = PathBuf::from(home).join("Library/Application Support/minecraft/assets/objects");
            if p.is_dir() {
                fallback_objects = Some(p);
            }
        }

        let total_objects = asset_index.objects.len();
        let mut count = 0;

        // 2. Sync objects concurrently in batches
        let objects_list: Vec<(String, AssetObject)> = asset_index.objects.into_iter().collect();
        for chunk in objects_list.chunks(30) {
            let mut tasks = Vec::new();

            for (_name, obj) in chunk {
                if obj.hash.len() < 2 {
                    continue;
                }
                let sub = obj.hash[..2].to_string();
                let hash = obj.hash.clone();
                let dest_path = objects_dir.join(&sub).join(&hash);

                if dest_path.is_file() {
                    continue;
                }

                // Copy from existing .minecraft if available (instant deduplication)
                if let Some(ref fb) = fallback_objects {
                    let existing = fb.join(&sub).join(&hash);
                    if existing.is_file() {
                        fs::create_dir_all(dest_path.parent().unwrap()).ok();
                        if fs::copy(&existing, &dest_path).is_ok() {
                            continue;
                        }
                    }
                }

                let client = self.client.clone();
                tasks.push(async move {
                    let url = format!(
                        "https://resources.download.minecraft.net/{}/{}",
                        sub, hash
                    );
                    if let Ok(resp) = client.get(&url).send().await {
                        if let Ok(bytes) = resp.bytes().await {
                            if let Some(p) = dest_path.parent() {
                                fs::create_dir_all(p).ok();
                            }
                            if let Ok(mut f) = File::create(&dest_path) {
                                f.write_all(&bytes).ok();
                            }
                        }
                    }
                });
            }

            if !tasks.is_empty() {
                for task in tasks {
                    task.await;
                }
            }

            count += chunk.len();
            let pct = 60.0 + (count as f64 / total_objects as f64) * 38.0;
            on_progress(
                &format!("Syncing Minecraft assets ({} / {})...", count, total_objects),
                pct.min(99.0),
            );
        }

        on_progress("Assets ready.", 100.0);
        Ok(())
    }

    /// Fetches Fabric profile and downloads required loader libraries
    pub async fn download_fabric_loader<F>(
        &self,
        game_version: &str,
        libraries_dir: &Path,
        mut on_progress: F,
    ) -> Result<(String, Vec<PathBuf>, Vec<String>), String>
    where
        F: FnMut(&str, f64),
    {
        on_progress("Resolving Fabric loader metadata...", 10.0);
        let list_url = format!("https://meta.fabricmc.net/v2/versions/loader/{}", game_version);
        let resp = self
            .client
            .get(&list_url)
            .send()
            .await
            .map_err(|e| format!("Failed to fetch Fabric versions: {}", e))?;

        let versions_json: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Invalid Fabric versions JSON: {}", e))?;

        let loader_version = versions_json
            .as_array()
            .and_then(|arr| arr.first())
            .and_then(|item| item["loader"]["version"].as_str())
            .ok_or_else(|| format!("No Fabric loader found for Minecraft {}", game_version))?;

        on_progress(&format!("Fetching Fabric profile ({})", loader_version), 25.0);
        let profile_url = format!(
            "https://meta.fabricmc.net/v2/versions/loader/{}/{}/profile/json",
            game_version, loader_version
        );

        let profile_resp = self
            .client
            .get(&profile_url)
            .send()
            .await
            .map_err(|e| format!("Failed to fetch Fabric profile: {}", e))?;

        let profile = profile_resp
            .json::<FabricLoaderProfile>()
            .await
            .map_err(|e| format!("Failed to parse Fabric profile: {}", e))?;

        let mut paths = Vec::new();
        let total = profile.libraries.len();

        for (idx, lib) in profile.libraries.iter().enumerate() {
            let parts: Vec<&str> = lib.name.split(':').collect();
            if parts.len() < 3 {
                continue;
            }
            let group = parts[0].replace('.', "/");
            let artifact = parts[1];
            let version = parts[2];
            let jar_name = format!("{}-{}.jar", artifact, version);
            let rel_path = format!("{}/{}/{}/{}", group, artifact, version, jar_name);
            let local_path = libraries_dir.join(&rel_path);

            paths.push(local_path.clone());

            if !local_path.is_file() {
                let base_url = lib
                    .url
                    .as_deref()
                    .unwrap_or("https://libraries.minecraft.net/");
                let download_url = format!("{}{}", base_url, rel_path);

                if let Some(parent) = local_path.parent() {
                    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }

                if let Ok(r) = self.client.get(&download_url).send().await {
                    if let Ok(bytes) = r.bytes().await {
                        if let Ok(mut f) = File::create(&local_path) {
                            f.write_all(&bytes).ok();
                        }
                    }
                }
            }

            let pct = 30.0 + ((idx + 1) as f64 / total as f64) * 65.0;
            on_progress(&format!("Downloading Fabric library: {}", artifact), pct);
        }

        let jvm_args = profile
            .arguments
            .and_then(|a| a.jvm)
            .unwrap_or_default();

        on_progress("Fabric loader ready.", 100.0);
        Ok((profile.main_class, paths, jvm_args))
    }

    /// Fetches NeoForge profile and downloads ForgeWrapper + bootstrap libraries
    pub async fn download_neoforge_loader<F>(
        &self,
        game_version: &str,
        libraries_dir: &Path,
        mut on_progress: F,
    ) -> Result<(String, Vec<PathBuf>, PathBuf, Vec<String>, String), String>
    where
        F: FnMut(&str, f64),
    {
        on_progress("Resolving NeoForge metadata...", 10.0);
        let index_url = "https://raw.githubusercontent.com/PrismLauncher/meta-launcher/master/net.neoforged/index.json";
        let resp = self
            .client
            .get(index_url)
            .send()
            .await
            .map_err(|e| format!("Failed to fetch NeoForge index: {}", e))?;

        let index_json: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse NeoForge index: {}", e))?;

        let versions = index_json
            .get("versions")
            .and_then(|v| v.as_array())
            .or_else(|| index_json.as_array())
            .ok_or_else(|| "Invalid NeoForge index format".to_string())?;

        let target_version = versions
            .iter()
            .find(|v| {
                v.get("requires")
                    .and_then(|r| r.as_array())
                    .map(|reqs| {
                        reqs.iter().any(|req| {
                            req.get("equals")
                                .and_then(|e| e.as_str())
                                .map(|s| s == game_version)
                                .unwrap_or(false)
                        })
                    })
                    .unwrap_or(false)
            })
            .and_then(|v| v.get("version").and_then(|s| s.as_str()))
            .ok_or_else(|| format!("No NeoForge build found for Minecraft {}", game_version))?;

        on_progress(&format!("Fetching NeoForge profile ({})", target_version), 25.0);
        let profile_url = format!(
            "https://raw.githubusercontent.com/PrismLauncher/meta-launcher/master/net.neoforged/{}.json",
            target_version
        );

        let prof_resp = self
            .client
            .get(&profile_url)
            .send()
            .await
            .map_err(|e| format!("Failed to fetch NeoForge profile: {}", e))?;

        let profile = prof_resp
            .json::<PrismNeoForgeProfile>()
            .await
            .map_err(|e| format!("Failed to parse NeoForge profile: {}", e))?;

        let mut paths = Vec::new();
        let total = profile.libraries.len();

        for (idx, lib) in profile.libraries.iter().enumerate() {
            if let Some(ref dls) = lib.downloads {
                if let Some(ref art) = dls.artifact {
                    let rel_path = if let Some(ref p) = art.path {
                        p.clone()
                    } else {
                        // Derive path from maven coordinates
                        let parts: Vec<&str> = lib.name.split(':').collect();
                        if parts.len() >= 3 {
                            let grp = parts[0].replace('.', "/");
                            let art_name = parts[1];
                            let ver = parts[2];
                            let jar = format!("{}-{}.jar", art_name, ver);
                            format!("{}/{}/{}/{}", grp, art_name, ver, jar)
                        } else {
                            continue;
                        }
                    };

                    let local_path = libraries_dir.join(&rel_path);
                    paths.push(local_path.clone());

                    if !local_path.is_file() {
                        if let Some(p) = local_path.parent() {
                            fs::create_dir_all(p).ok();
                        }
                        if let Ok(r) = self.client.get(&art.url).send().await {
                            if let Ok(bytes) = r.bytes().await {
                                if let Ok(mut f) = File::create(&local_path) {
                                    f.write_all(&bytes).ok();
                                }
                            }
                        }
                    }
                }
            }

            let pct = 30.0 + ((idx + 1) as f64 / total as f64) * 55.0;
            on_progress(&format!("Downloading NeoForge library ({}/{})", idx + 1, total), pct);
        }

        // Download all processor libraries from mavenFiles (required by ForgeWrapper to generate patched client)
        if let Some(ref maven_files) = profile.maven_files {
            let mf_total = maven_files.len();
            for (m_idx, m_file) in maven_files.iter().enumerate() {
                if let Some(ref dls) = m_file.downloads {
                    if let Some(ref art) = dls.artifact {
                        let rel_path = if let Some(ref p) = art.path {
                            p.clone()
                        } else {
                            let parts: Vec<&str> = m_file.name.split(':').collect();
                            if parts.len() >= 3 {
                                let grp = parts[0].replace('.', "/");
                                let art_name = parts[1];
                                let ver = parts[2];
                                let classifier = if parts.len() >= 4 {
                                    format!("-{}", parts[3])
                                } else {
                                    String::new()
                                };
                                let jar = format!("{}{}.jar", art_name, classifier);
                                format!("{}/{}/{}/{}", grp, art_name, ver, jar)
                            } else {
                                continue;
                            }
                        };

                        let local_path = libraries_dir.join(&rel_path);
                        if !local_path.is_file() {
                            if let Some(p) = local_path.parent() {
                                fs::create_dir_all(p).ok();
                            }
                            if let Ok(r) = self.client.get(&art.url).send().await {
                                if let Ok(bytes) = r.bytes().await {
                                    if let Ok(mut f) = File::create(&local_path) {
                                        f.write_all(&bytes).ok();
                                    }
                                }
                            }
                        }
                    }
                }

                let pct = 85.0 + ((m_idx + 1) as f64 / mf_total as f64) * 10.0;
                on_progress(&format!("Syncing NeoForge processor files ({}/{})", m_idx + 1, mf_total), pct);
            }
        }

        // Locate installer jar from mavenFiles
        let (installer_name, installer_art) = profile
            .maven_files
            .as_ref()
            .and_then(|files| {
                files
                    .iter()
                    .find(|m| m.name.contains(":installer"))
                    .and_then(|m| {
                        m.downloads
                            .as_ref()
                            .and_then(|d| d.artifact.as_ref())
                            .map(|a| (m.name.clone(), a))
                    })
            })
            .ok_or_else(|| "NeoForge installer artifact not found in profile".to_string())?;

        let installer_rel_path = if let Some(ref p) = installer_art.path {
            p.clone()
        } else {
            let parts: Vec<&str> = installer_name.split(':').collect();
            if parts.len() >= 4 {
                let grp = parts[0].replace('.', "/");
                let art_name = parts[1];
                let ver = parts[2];
                let classifier = parts[3];
                format!("{}/{}/{}/{}-{}-{}.jar", grp, art_name, ver, art_name, ver, classifier)
            } else {
                format!("net/neoforged/neoforge/{0}/neoforge-{0}-installer.jar", target_version)
            }
        };

        let installer_path = libraries_dir.join(&installer_rel_path);
        if !installer_path.is_file() {
            on_progress("Downloading NeoForge core installer...", 90.0);
            if let Some(p) = installer_path.parent() {
                fs::create_dir_all(p).ok();
            }
            let resp = self
                .client
                .get(&installer_art.url)
                .send()
                .await
                .map_err(|e| format!("Failed to download NeoForge installer: {}", e))?;
            let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
            let mut f = File::create(&installer_path).map_err(|e| e.to_string())?;
            f.write_all(&bytes).map_err(|e| e.to_string())?;
        }

        let mut game_args = Vec::new();
        if let Some(ref mc_args) = profile.minecraft_arguments {
            let split_args: Vec<&str> = mc_args.split_whitespace().collect();
            if let Some(pos) = split_args.iter().position(|&a| a == "--fml.neoForgeVersion") {
                for &arg in &split_args[pos..] {
                    game_args.push(arg.to_string());
                }
            }
        }

        on_progress("NeoForge loader ready.", 100.0);
        Ok((profile.main_class, paths, installer_path, game_args, target_version.to_string()))
    }
}
