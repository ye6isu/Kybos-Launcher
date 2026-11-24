use crate::instances::{InstanceConfig, InstanceManager, ModLoader};
use crate::mod_share::{decode_share_code, query_modrinth_hash, ShareManifest};
use std::fs::{self, File};
use std::io::Write;
use std::path::Path;

pub struct ShareImporter;

impl ShareImporter {
    /// Imports a share code into a brand new instance and downloads all verified mods from Modrinth
    pub async fn import_instance(
        share_code: &str,
        instances_dir: &Path,
    ) -> Result<InstanceConfig, String> {
        let manifest: ShareManifest = decode_share_code(share_code)?;

        let loader = match manifest.loader.to_lowercase().as_str() {
            "fabric" => ModLoader::Fabric,
            "neoforge" => ModLoader::NeoForge,
            "forge" => ModLoader::Forge,
            "quilt" => ModLoader::Quilt,
            _ => ModLoader::Vanilla,
        };

        let new_id = uuid::Uuid::new_v4().to_string();
        let config = InstanceConfig {
            id: new_id.clone(),
            name: format!("{} (Imported)", manifest.name),
            game_version: manifest.game_version,
            loader,
            loader_version: manifest.loader_version,
            ram_mb: manifest.ram_mb,
            custom_jvm_args: None,
            account_override_id: None,
            banner_url: None,
            color: None,
            crop_cover: None,
            created_at: chrono::Utc::now().to_rfc3339(),
            last_played_at: None,
        };

        let manager = InstanceManager::new(instances_dir.to_path_buf());
        manager.create_instance(config.clone())?;

        let mods_dir = manager.instance_path(&new_id).join("mods");
        fs::create_dir_all(&mods_dir).map_err(|e| e.to_string())?;

        let client = reqwest::Client::builder()
            .user_agent("KybosLauncher/0.1.0")
            .build()
            .map_err(|e| e.to_string())?;

        // Resolve each fingerprint via Modrinth Hash API and download matching official .jar
        for mod_item in manifest.mods {
            if let Ok(Some(version_info)) = query_modrinth_hash(&mod_item.sha512).await {
                // Find primary file or matching filename
                if let Some(file_detail) = version_info.files.iter().find(|f| f.primary).or_else(|| version_info.files.first()) {
                    let target_path = mods_dir.join(&file_detail.filename);
                    if let Ok(resp) = client.get(&file_detail.url).send().await {
                        if let Ok(bytes) = resp.bytes().await {
                            if let Ok(mut f) = File::create(&target_path) {
                                f.write_all(&bytes).ok();
                            }
                        }
                    }
                }
            }
        }

        Ok(config)
    }
}
