use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageSettings {
    pub custom_assets_dir: Option<PathBuf>,
    pub custom_instances_dir: Option<PathBuf>,
    pub custom_java_dir: Option<PathBuf>,
    pub hide_on_launch: bool,
    pub reopen_on_exit: bool,
}

impl Default for StorageSettings {
    fn default() -> Self {
        Self {
            custom_assets_dir: None,
            custom_instances_dir: None,
            custom_java_dir: None,
            hide_on_launch: true,
            reopen_on_exit: true,
        }
    }
}

pub struct AssetManager {
    default_dir: PathBuf,
}

impl AssetManager {
    pub fn new(app_data_dir: &Path) -> Self {
        Self {
            default_dir: app_data_dir.join("assets"),
        }
    }

    pub fn resolve_assets_dir<'a>(&'a self, settings: &'a StorageSettings) -> &'a Path {
        if let Some(ref custom) = settings.custom_assets_dir {
            custom.as_path()
        } else {
            self.default_dir.as_path()
        }
    }

    /// Cross-platform asset reuse:
    /// Windows: `%APPDATA%/.minecraft/assets`
    /// Linux: `~/.minecraft/assets`
    /// macOS: `~/Library/Application Support/minecraft/assets`
    pub fn find_cached_object(&self, hash: &str, settings: &StorageSettings) -> Option<PathBuf> {
        if hash.len() < 2 {
            return None;
        }
        let sub = &hash[..2];

        // 1. Check configured active assets dir
        let active_dir = self.resolve_assets_dir(settings);
        let path = active_dir.join("objects").join(sub).join(hash);
        if path.is_file() {
            return Some(path);
        }

        // 2. Check platform-native default .minecraft/assets
        #[cfg(target_os = "windows")]
        if let Ok(appdata) = std::env::var("APPDATA") {
            let p = PathBuf::from(appdata).join(".minecraft").join("assets").join("objects").join(sub).join(hash);
            if p.is_file() {
                return Some(p);
            }
        }

        #[cfg(target_os = "linux")]
        if let Ok(home) = std::env::var("HOME") {
            let p = PathBuf::from(home).join(".minecraft").join("assets").join("objects").join(sub).join(hash);
            if p.is_file() {
                return Some(p);
            }
        }

        #[cfg(target_os = "macos")]
        if let Ok(home) = std::env::var("HOME") {
            let p = PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join("minecraft")
                .join("assets")
                .join("objects")
                .join(sub)
                .join(hash);
            if p.is_file() {
                return Some(p);
            }
        }

        None
    }
}
