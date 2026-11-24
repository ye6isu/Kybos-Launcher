use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ModLoader {
    #[serde(alias = "vanilla", alias = "Vanilla")]
    Vanilla,
    #[serde(alias = "fabric", alias = "Fabric")]
    Fabric,
    #[serde(alias = "neoforge", alias = "neo_forge", alias = "NeoForge", alias = "Neo_Forge")]
    NeoForge,
    #[serde(alias = "forge", alias = "Forge")]
    Forge,
    #[serde(alias = "quilt", alias = "Quilt")]
    Quilt,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModItem {
    pub filename: String,
    pub is_enabled: bool,
    pub file_size: u64,
    pub sha512: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstanceConfig {
    pub id: String,
    pub name: String,
    pub game_version: String,
    pub loader: ModLoader,
    pub loader_version: Option<String>,
    pub ram_mb: u32,
    pub custom_jvm_args: Option<String>,
    pub account_override_id: Option<String>, // If None, uses global active account
    pub banner_url: Option<String>,
    pub color: Option<String>,
    pub crop_cover: Option<bool>,
    pub created_at: String,
    pub last_played_at: Option<String>,
}

pub struct InstanceManager {
    base_instances_dir: PathBuf,
}

impl InstanceManager {
    pub fn new(base_dir: PathBuf) -> Self {
        Self {
            base_instances_dir: base_dir,
        }
    }

    pub fn instance_path(&self, instance_id: &str) -> PathBuf {
        self.base_instances_dir.join(instance_id)
    }

    pub fn list_instances(&self) -> Vec<InstanceConfig> {
        if !self.base_instances_dir.exists() {
            return Vec::new();
        }

        let mut instances = Vec::new();
        if let Ok(entries) = fs::read_dir(&self.base_instances_dir) {
            for entry in entries.flatten() {
                let config_file = entry.path().join("instance.json");
                if config_file.is_file() {
                    if let Ok(data) = fs::read_to_string(&config_file) {
                        if let Ok(config) = serde_json::from_str::<InstanceConfig>(&data) {
                            instances.push(config);
                        }
                    }
                }
            }
        }
        instances.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        instances
    }

    pub fn create_instance(&self, mut config: InstanceConfig) -> Result<InstanceConfig, String> {
        if config.id.trim().is_empty() {
            config.id = uuid::Uuid::new_v4().to_string();
        }
        let inst_dir = self.instance_path(&config.id);
        if inst_dir.exists() {
            return Err(format!("Instance directory already exists: {}", config.id));
        }

        // Create standard instance structure
        fs::create_dir_all(inst_dir.join("mods")).map_err(|e| e.to_string())?;
        fs::create_dir_all(inst_dir.join("config")).map_err(|e| e.to_string())?;
        fs::create_dir_all(inst_dir.join("saves")).map_err(|e| e.to_string())?;
        fs::create_dir_all(inst_dir.join("resourcepacks")).map_err(|e| e.to_string())?;

        let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
        fs::write(inst_dir.join("instance.json"), json).map_err(|e| e.to_string())?;

        Ok(config)
    }

    pub fn update_instance(&self, config: &InstanceConfig) -> Result<(), String> {
        let inst_dir = self.instance_path(&config.id);
        if !inst_dir.exists() {
            return Err(format!("Instance '{}' does not exist", config.id));
        }
        let json = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
        fs::write(inst_dir.join("instance.json"), json).map_err(|e| e.to_string())
    }

    /// Strict cleanup: recursively deletes the entire instance directory from disk (cross-platform).
    pub fn delete_instance(&self, instance_id: &str) -> Result<(), String> {
        let inst_dir = self.instance_path(instance_id);
        if !inst_dir.exists() {
            return Ok(());
        }
        fs::remove_dir_all(&inst_dir).map_err(|e| {
            format!(
                "Failed to recursively delete instance folder at {:?}: {}",
                inst_dir, e
            )
        })
    }

    pub fn list_mods(&self, instance_id: &str) -> Result<Vec<ModItem>, String> {
        let mods_dir = self.instance_path(instance_id).join("mods");
        if !mods_dir.exists() {
            return Ok(Vec::new());
        }

        let mut mods = Vec::new();
        let entries = fs::read_dir(&mods_dir).map_err(|e| e.to_string())?;

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    let is_jar = name.ends_with(".jar");
                    let is_disabled = name.ends_with(".jar.disabled");
                    if is_jar || is_disabled {
                        let metadata = entry.metadata().map_err(|e| e.to_string())?;
                        mods.push(ModItem {
                            filename: name.to_string(),
                            is_enabled: is_jar,
                            file_size: metadata.len(),
                            sha512: None,
                        });
                    }
                }
            }
        }
        mods.sort_by(|a, b| a.filename.to_lowercase().cmp(&b.filename.to_lowercase()));
        Ok(mods)
    }

    pub fn toggle_mod(&self, instance_id: &str, filename: &str, enable: bool) -> Result<String, String> {
        let mods_dir = self.instance_path(instance_id).join("mods");
        let current_path = mods_dir.join(filename);
        if !current_path.exists() {
            return Err(format!("Mod file '{}' not found", filename));
        }

        let new_name = if enable && filename.ends_with(".jar.disabled") {
            filename.trim_end_matches(".disabled").to_string()
        } else if !enable && filename.ends_with(".jar") {
            format!("{}.disabled", filename)
        } else {
            return Ok(filename.to_string());
        };

        let new_path = mods_dir.join(&new_name);
        fs::rename(current_path, new_path).map_err(|e| e.to_string())?;
        Ok(new_name)
    }

    /// Cross-platform folder opener: Windows (`explorer`), macOS (`open`), Linux (`xdg-open`).
    pub fn open_mods_folder(&self, instance_id: &str) -> Result<(), String> {
        let mods_dir = self.instance_path(instance_id).join("mods");
        if !mods_dir.exists() {
            fs::create_dir_all(&mods_dir).map_err(|e| e.to_string())?;
        }

        #[cfg(target_os = "windows")]
        {
            std::process::Command::new("explorer")
                .arg(&mods_dir)
                .spawn()
                .map_err(|e| e.to_string())?;
        }

        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("open")
                .arg(&mods_dir)
                .spawn()
                .map_err(|e| e.to_string())?;
        }

        #[cfg(target_os = "linux")]
        {
            std::process::Command::new("xdg-open")
                .arg(&mods_dir)
                .spawn()
                .map_err(|e| e.to_string())?;
        }

        Ok(())
    }
}
