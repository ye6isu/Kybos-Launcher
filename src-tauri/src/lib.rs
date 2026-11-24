pub mod accounts;
pub mod assets;
pub mod curseforge;
pub mod downloader;
pub mod importer;
pub mod instances;
pub mod java_runtime;
pub mod launcher;
pub mod mod_share;
pub mod modrinth;
pub mod ms_auth;

use accounts::{Account, AccountStore, AccountType};
use curseforge::CurseForgeClient;
use downloader::MinecraftDownloader;
use importer::ShareImporter;
use instances::{InstanceConfig, InstanceManager, ModItem, ModLoader};
use java_runtime::JavaProvisioner;
use launcher::MinecraftLauncher;
use mod_share::ShareManifest;
use modrinth::{ModVersion, ModrinthClient};
use ms_auth::{DeviceCodeResponse, MicrosoftAuth};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};

pub struct AppState {
    pub instances_dir: PathBuf,
    pub data_dir: PathBuf,
    pub account_store: Mutex<AccountStore>,
}

// ---------------- Accounts Commands ----------------
#[tauri::command]
fn get_accounts(state: State<'_, AppState>) -> Result<AccountStore, String> {
    let store = state.account_store.lock().unwrap();
    Ok(store.clone())
}

#[tauri::command]
fn add_offline_account(
    username: String,
    state: State<'_, AppState>,
) -> Result<Account, String> {
    let mut store = state.account_store.lock().unwrap();
    let account = Account {
        id: uuid::Uuid::new_v4().to_string(),
        username: username.clone(),
        account_type: AccountType::Offline,
        uuid: uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_DNS, username.as_bytes()).to_string(),
        access_token: None,
        refresh_token: None,
        skin_url: None,
        skin_model: Some("classic".to_string()),
        added_at: chrono::Utc::now().to_rfc3339(),
    };
    store.add_or_update(account.clone());
    let path = state.data_dir.join("accounts.json");
    store.save(&path)?;
    Ok(account)
}

#[tauri::command]
fn update_account_skin(
    account_id: String,
    skin_url: String,
    skin_model: Option<String>,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let mut store = state.account_store.lock().unwrap();
    let changed = store.set_skin(&account_id, skin_url, skin_model);
    if changed {
        let path = state.data_dir.join("accounts.json");
        store.save(&path)?;
    }
    Ok(changed)
}

#[tauri::command]
async fn start_microsoft_login() -> Result<DeviceCodeResponse, String> {
    MicrosoftAuth::request_device_code().await
}

#[tauri::command]
async fn check_microsoft_login(
    device_code: String,
    state: State<'_, AppState>,
) -> Result<Option<Account>, String> {
    if let Some(token_res) = MicrosoftAuth::poll_for_token(&device_code).await? {
        // Step 1: Xbox Live Auth
        let xbl = MicrosoftAuth::authenticate_xbox_live(&token_res.access_token).await?;
        let uhs = xbl
            .display_claims
            .xui
            .first()
            .map(|x| x.uhs.clone())
            .ok_or_else(|| "Failed to get Xbox user hash (uhs)".to_string())?;

        // Step 2: XSTS Auth
        let xsts = MicrosoftAuth::authenticate_xsts(&xbl.token).await?;

        // Step 3: Minecraft Services Auth
        let mc_auth = MicrosoftAuth::authenticate_minecraft(&uhs, &xsts.token).await?;

        // Step 4: Fetch Minecraft Profile & Skin
        let profile = MicrosoftAuth::fetch_minecraft_profile(&mc_auth.access_token).await?;

        let active_skin = profile.skins.as_ref().and_then(|s| {
            s.iter().find(|skin| skin.state == "ACTIVE").or_else(|| s.first())
        });

        let skin_url = active_skin.map(|s| s.url.clone());
        let skin_model = active_skin.and_then(|s| s.variant.clone()).or_else(|| Some("classic".to_string()));

        let account = Account {
            id: uuid::Uuid::new_v4().to_string(),
            username: profile.name,
            account_type: AccountType::Microsoft,
            uuid: profile.id,
            access_token: Some(mc_auth.access_token),
            refresh_token: token_res.refresh_token,
            skin_url,
            skin_model,
            added_at: chrono::Utc::now().to_rfc3339(),
        };

        let mut store = state.account_store.lock().unwrap();
        store.add_or_update(account.clone());
        let path = state.data_dir.join("accounts.json");
        store.save(&path)?;

        return Ok(Some(account));
    }

    Ok(None)
}

#[tauri::command]
fn set_active_account(account_id: String, state: State<'_, AppState>) -> Result<bool, String> {
    let mut store = state.account_store.lock().unwrap();
    let changed = store.set_active(&account_id);
    if changed {
        let path = state.data_dir.join("accounts.json");
        store.save(&path)?;
    }
    Ok(changed)
}

#[tauri::command]
fn remove_account(account_id: String, state: State<'_, AppState>) -> Result<bool, String> {
    let mut store = state.account_store.lock().unwrap();
    let removed = store.remove(&account_id);
    if removed {
        let path = state.data_dir.join("accounts.json");
        store.save(&path)?;
    }
    Ok(removed)
}

// ---------------- Instance Commands ----------------
#[tauri::command]
fn list_instances(state: State<'_, AppState>) -> Result<Vec<InstanceConfig>, String> {
    let manager = InstanceManager::new(state.instances_dir.clone());
    Ok(manager.list_instances())
}

#[tauri::command]
fn create_instance(
    config: InstanceConfig,
    state: State<'_, AppState>,
) -> Result<InstanceConfig, String> {
    let manager = InstanceManager::new(state.instances_dir.clone());
    manager.create_instance(config)
}

#[tauri::command]
fn update_instance(
    config: InstanceConfig,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let manager = InstanceManager::new(state.instances_dir.clone());
    manager.update_instance(&config)
}

#[tauri::command]
fn delete_instance(
    instance_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let manager = InstanceManager::new(state.instances_dir.clone());
    manager.delete_instance(&instance_id)
}

// ---------------- Mods Management Commands ----------------
#[tauri::command]
fn list_instance_mods(
    instance_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<ModItem>, String> {
    let manager = InstanceManager::new(state.instances_dir.clone());
    manager.list_mods(&instance_id)
}

#[tauri::command]
fn toggle_instance_mod(
    instance_id: String,
    filename: String,
    enable: bool,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let manager = InstanceManager::new(state.instances_dir.clone());
    manager.toggle_mod(&instance_id, &filename, enable)
}

#[tauri::command]
fn open_instance_mods_folder(
    instance_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let manager = InstanceManager::new(state.instances_dir.clone());
    manager.open_mods_folder(&instance_id)
}

// ---------------- Launch Command ----------------
#[tauri::command]
async fn launch_instance(
    instance_id: String,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let manager = InstanceManager::new(state.instances_dir.clone());
    let instances = manager.list_instances();
    let instance = instances
        .into_iter()
        .find(|i| i.id == instance_id)
        .ok_or_else(|| "Instance not found".to_string())?;

    let instance_dir = manager.instance_path(&instance_id);

    // Resolve Account
    let account = {
        let store = state.account_store.lock().unwrap();
        if let Some(ref override_id) = instance.account_override_id {
            store.accounts.iter().find(|a| a.id == *override_id).cloned()
        } else if let Some(ref active_id) = store.active_account_id {
            store.accounts.iter().find(|a| a.id == *active_id).cloned()
        } else {
            store.accounts.first().cloned()
        }
    }.ok_or_else(|| "No player account available to launch".to_string())?;

    // Resolve Java 21 Runtime (or auto-provision OpenJDK 21 if missing)
    let java_prov = JavaProvisioner::new(&state.data_dir);
    let java_path = if let Some(info) = java_prov.find_or_recommend_java(None) {
        info.path
    } else {
        // Auto-provision portable Java 21 into runtime/java-21 with live progress events
        let emitter_handle = app_handle.clone();
        java_prov
            .auto_provision_java_21(|status, percentage| {
                let _ = emitter_handle.emit(
                    "game-install-progress",
                    serde_json::json!({
                        "title": "Installing Java 21 Runtime",
                        "status": status,
                        "percentage": percentage
                    }),
                );
            })
            .await
            .map_err(|e| format!("Failed to automatically install Java 21 runtime: {}", e))?
    };

    let downloader = MinecraftDownloader::new();
    let pkg = downloader.fetch_version_package(&instance.game_version).await?;

    let versions_dir = state.data_dir.join("versions");
    let libraries_dir = state.data_dir.join("libraries");
    let assets_dir = state.data_dir.join("assets");

    // 1. Download Client Jar
    let client_jar = downloader.download_client_jar(&pkg, &versions_dir).await?;

    // 2. Download Libraries
    let mut libraries = downloader.download_libraries(&pkg, &libraries_dir).await?;

    // 3. Resolve Mod Loader (Fabric / NeoForge / Quilt)
    let mut main_class = pkg.main_class.clone();
    let mut extra_jvm_args = Vec::new();
    let mut extra_game_args = Vec::new();

    match instance.loader {
        ModLoader::Fabric | ModLoader::Quilt => {
            let emitter_loader = app_handle.clone();
            let (f_main, f_libs, f_jvm) = downloader
                .download_fabric_loader(&instance.game_version, &libraries_dir, |status, percentage| {
                    let _ = emitter_loader.emit(
                        "game-install-progress",
                        serde_json::json!({
                            "title": "Installing Fabric Loader",
                            "status": status,
                            "percentage": percentage
                        }),
                    );
                })
                .await?;
            main_class = f_main;
            extra_jvm_args = f_jvm;
            for lib in f_libs {
                if !libraries.contains(&lib) {
                    libraries.push(lib);
                }
            }
        }
        ModLoader::NeoForge | ModLoader::Forge => {
            let emitter_loader = app_handle.clone();
            let (neo_main, neo_libs, installer_jar, neo_game_args) = downloader
                .download_neoforge_loader(&instance.game_version, &libraries_dir, |status, percentage| {
                    let _ = emitter_loader.emit(
                        "game-install-progress",
                        serde_json::json!({
                            "title": "Installing NeoForge Loader",
                            "status": status,
                            "percentage": percentage
                        }),
                    );
                })
                .await?;
            main_class = neo_main;
            extra_game_args = neo_game_args;

            // ForgeWrapper system properties
            extra_jvm_args.push(format!("-Dforgewrapper.librariesDir={}", libraries_dir.display()));
            extra_jvm_args.push(format!("-Dforgewrapper.installer={}", installer_jar.display()));
            extra_jvm_args.push(format!("-Dforgewrapper.minecraft={}", client_jar.display()));

            for lib in neo_libs {
                if !libraries.contains(&lib) {
                    libraries.push(lib);
                }
            }
        }
        ModLoader::Vanilla => {}
    }

    // 4. Sync Assets (reusing existing from .minecraft/assets or downloading concurrently)
    let emitter_handle_assets = app_handle.clone();
    downloader
        .sync_assets(&pkg, &assets_dir, |status, percentage| {
            let _ = emitter_handle_assets.emit(
                "game-install-progress",
                serde_json::json!({
                    "title": "Synchronizing Game Assets",
                    "status": status,
                    "percentage": percentage
                }),
            );
        })
        .await?;

    // 5. Launch Minecraft Process
    let child = MinecraftLauncher::launch(
        &java_path,
        &instance,
        &instance_dir,
        &client_jar,
        &libraries,
        &assets_dir,
        &pkg.asset_index.id,
        &account,
        &main_class,
        &extra_jvm_args,
        &extra_game_args,
    )?;

    Ok(format!("Minecraft started with PID {}", child.id()))
}
#[tauri::command]
fn export_instance_share_code(
    instance_id: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let manager = InstanceManager::new(state.instances_dir.clone());
    let instances = manager.list_instances();
    let instance = instances
        .into_iter()
        .find(|i| i.id == instance_id)
        .ok_or_else(|| "Instance not found".to_string())?;

    let mods_dir = manager.instance_path(&instance_id).join("mods");
    let mut fingerprints = Vec::new();

    if mods_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&mods_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                        if name.ends_with(".jar") {
                            if let Ok((sha, size)) = mod_share::compute_sha512(&path) {
                                fingerprints.push(mod_share::ModFingerprint {
                                    filename: name.to_string(),
                                    sha512: sha,
                                    size_bytes: size,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    let manifest = ShareManifest {
        format_version: 1,
        name: instance.name,
        game_version: instance.game_version,
        loader: format!("{:?}", instance.loader),
        loader_version: instance.loader_version,
        ram_mb: instance.ram_mb,
        mods: fingerprints,
    };

    mod_share::create_share_code(&manifest)
}

#[tauri::command]
async fn import_instance_from_share_code(
    share_code: String,
    state: State<'_, AppState>,
) -> Result<InstanceConfig, String> {
    ShareImporter::import_instance(&share_code, &state.instances_dir).await
}

#[tauri::command]
fn parse_share_code(share_code: String) -> Result<ShareManifest, String> {
    mod_share::decode_share_code(&share_code)
}

#[tauri::command]
async fn resolve_mod_from_hash(sha512: String) -> Result<Option<mod_share::ModrinthVersionFile>, String> {
    mod_share::query_modrinth_hash(&sha512).await
}

#[tauri::command]
fn open_path_in_explorer(path: String) -> Result<(), String> {
    let p = std::path::PathBuf::from(&path);
    if !p.exists() {
        std::fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&p)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&p)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&p)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn get_storage_paths(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "windows")]
    let default_assets = std::env::var("APPDATA")
        .map(|a| format!("{}\\.minecraft\\assets", a))
        .unwrap_or_else(|_| state.data_dir.join("assets").to_string_lossy().to_string());

    #[cfg(target_os = "linux")]
    let default_assets = std::env::var("HOME")
        .map(|h| format!("{}/.minecraft/assets", h))
        .unwrap_or_else(|_| state.data_dir.join("assets").to_string_lossy().to_string());

    #[cfg(target_os = "macos")]
    let default_assets = std::env::var("HOME")
        .map(|h| format!("{}/Library/Application Support/minecraft/assets", h))
        .unwrap_or_else(|_| state.data_dir.join("assets").to_string_lossy().to_string());

    Ok(serde_json::json!({
        "instances_dir": state.instances_dir.to_string_lossy().to_string(),
        "assets_dir": default_assets,
        "data_dir": state.data_dir.to_string_lossy().to_string(),
    }))
}

// ---------------- Modrinth Browser Commands ----------------
#[tauri::command]
async fn search_modrinth_mods(
    query: String,
    loader: Option<String>,
    game_version: Option<String>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<modrinth::ModrinthSearchResponse, String> {
    let client = ModrinthClient::new();
    client
        .search_mods(
            &query,
            loader.as_deref(),
            game_version.as_deref(),
            limit.unwrap_or(25),
            offset.unwrap_or(0),
        )
        .await
}

#[tauri::command]
async fn get_mod_versions(
    project_id: Option<String>,
    project_id_or_slug: Option<String>,
    loader: Option<String>,
    game_version: Option<String>,
) -> Result<Vec<ModVersion>, String> {
    let target_id = project_id
        .or(project_id_or_slug)
        .ok_or_else(|| "Missing project ID or slug".to_string())?;
    let client = ModrinthClient::new();
    client
        .fetch_project_versions(&target_id, loader.as_deref(), game_version.as_deref())
        .await
}

#[tauri::command]
async fn install_mod_to_instance(
    instance_id: String,
    file_url: String,
    filename: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let manager = InstanceManager::new(state.instances_dir.clone());
    let mods_dir = manager.instance_path(&instance_id).join("mods");
    let client = ModrinthClient::new();
    client.install_mod(&file_url, &filename, &mods_dir).await
}

#[tauri::command]
async fn install_mod_file_to_instance(
    instance_id: String,
    src_path: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let p = std::path::PathBuf::from(&src_path);
    if !p.exists() || !p.is_file() {
        return Err("Source file does not exist".to_string());
    }

    let file_name = p
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Invalid file name".to_string())?;

    if !file_name.ends_with(".jar") && !file_name.ends_with(".jar.disabled") {
        return Err("Only .jar mod files are supported".to_string());
    }

    let manager = InstanceManager::new(state.instances_dir.clone());
    let mods_dir = manager.instance_path(&instance_id).join("mods");
    std::fs::create_dir_all(&mods_dir).map_err(|e| e.to_string())?;

    let dest = mods_dir.join(file_name);
    std::fs::copy(&p, &dest).map_err(|e| e.to_string())?;

    Ok(file_name.to_string())
}

#[tauri::command]
async fn delete_instance_mod(
    instance_id: String,
    filename: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let manager = InstanceManager::new(state.instances_dir.clone());
    let mod_path = manager.instance_path(&instance_id).join("mods").join(&filename);
    if mod_path.exists() {
        std::fs::remove_file(mod_path).map_err(|e| e.to_string())?;
        Ok(true)
    } else {
        Ok(false)
    }
}

// ---------------- CurseForge Browser Commands ----------------
fn get_curseforge_client(state: &State<'_, AppState>) -> CurseForgeClient {
    let config_file = state.data_dir.join("storage.json");
    if config_file.exists() {
        if let Ok(content) = std::fs::read_to_string(&config_file) {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(key) = val.get("curseforge_api_key").and_then(|k| k.as_str()) {
                    return CurseForgeClient::with_key(key.to_string());
                }
            }
        }
    }
    CurseForgeClient::new()
}

#[tauri::command]
async fn search_curseforge_mods(
    query: String,
    game_version: Option<String>,
    loader: Option<String>,
    limit: Option<u32>,
    index: Option<u32>,
    state: State<'_, AppState>,
) -> Result<curseforge::CurseForgeSearchResult, String> {
    let client = get_curseforge_client(&state);
    client
        .search_mods(
            &query,
            game_version.as_deref(),
            loader.as_deref(),
            limit.unwrap_or(25),
            index.unwrap_or(0),
        )
        .await
}

#[tauri::command]
async fn get_curseforge_files(
    mod_id: u64,
    state: State<'_, AppState>,
) -> Result<Vec<curseforge::CurseForgeFile>, String> {
    let client = get_curseforge_client(&state);
    client.get_mod_files(mod_id).await
}

#[tauri::command]
async fn install_curseforge_mod(
    instance_id: String,
    file_url: String,
    filename: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let manager = InstanceManager::new(state.instances_dir.clone());
    let mods_dir = manager.instance_path(&instance_id).join("mods");
    let client = get_curseforge_client(&state);
    client.install_file(&file_url, &filename, &mods_dir).await
}

#[tauri::command]
async fn get_modrinth_project(
    project_id_or_slug: String,
) -> Result<modrinth::ModrinthProjectDetails, String> {
    let client = ModrinthClient::new();
    client.get_project(&project_id_or_slug).await
}

#[tauri::command]
async fn get_modrinth_dependencies(
    project_id_or_slug: String,
) -> Result<modrinth::ModrinthProjectDependencies, String> {
    let client = ModrinthClient::new();
    client.get_project_dependencies(&project_id_or_slug).await
}

#[tauri::command]
async fn get_curseforge_mod(
    mod_id: u64,
    state: State<'_, AppState>,
) -> Result<curseforge::CurseForgeModFull, String> {
    let client = get_curseforge_client(&state);
    client.get_mod(mod_id).await
}

#[tauri::command]
async fn get_curseforge_description(
    mod_id: u64,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let client = get_curseforge_client(&state);
    client.get_description(mod_id).await
}

#[tauri::command]
fn set_storage_path(
    path_type: String, // "instances" or "assets"
    new_path: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let p = PathBuf::from(&new_path);
    if !p.exists() {
        std::fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    }

    let config_file = state.data_dir.join("storage.json");
    let mut current_config: serde_json::Value = if config_file.exists() {
        let content = std::fs::read_to_string(&config_file).unwrap_or_else(|_| "{}".to_string());
        serde_json::from_str(&content).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    if path_type == "instances" {
        current_config["instances_dir"] = serde_json::json!(new_path);
    } else if path_type == "assets" {
        current_config["assets_dir"] = serde_json::json!(new_path);
    }

    std::fs::write(&config_file, serde_json::to_string_pretty(&current_config).unwrap()).ok();

    get_storage_paths(state)
}

#[tauri::command]
fn set_curseforge_api_key(
    api_key: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let config_file = state.data_dir.join("storage.json");
    let mut current_config: serde_json::Value = if config_file.exists() {
        let content = std::fs::read_to_string(&config_file).unwrap_or_else(|_| "{}".to_string());
        serde_json::from_str(&content).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    current_config["curseforge_api_key"] = serde_json::json!(api_key.trim());
    std::fs::write(&config_file, serde_json::to_string_pretty(&current_config).unwrap()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_curseforge_api_key(
    state: State<'_, AppState>,
) -> Result<String, String> {
    let config_file = state.data_dir.join("storage.json");
    if config_file.exists() {
        if let Ok(content) = std::fs::read_to_string(&config_file) {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(key) = val.get("curseforge_api_key").and_then(|k| k.as_str()) {
                    return Ok(key.to_string());
                }
            }
        }
    }
    Ok("".to_string())
}

#[tauri::command]
fn set_unsplash_config(
    access_key: String,
    topics: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let config_file = state.data_dir.join("storage.json");
    let mut current_config: serde_json::Value = if config_file.exists() {
        let content = std::fs::read_to_string(&config_file).unwrap_or_else(|_| "{}".to_string());
        serde_json::from_str(&content).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    current_config["unsplash_access_key"] = serde_json::json!(access_key.trim());
    current_config["unsplash_topics"] = serde_json::json!(topics.trim());
    std::fs::write(&config_file, serde_json::to_string_pretty(&current_config).unwrap()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_unsplash_config(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let config_file = state.data_dir.join("storage.json");
    if config_file.exists() {
        if let Ok(content) = std::fs::read_to_string(&config_file) {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                let key = val.get("unsplash_access_key").and_then(|k| k.as_str()).unwrap_or("");
                let topics = val.get("unsplash_topics").and_then(|k| k.as_str()).unwrap_or("architecture,nature,wallpapers");
                return Ok(serde_json::json!({
                    "access_key": key,
                    "topics": topics
                }));
            }
        }
    }
    Ok(serde_json::json!({
        "access_key": "",
        "topics": "architecture,nature,wallpapers"
    }))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("./kybos_data"));

            let instances_dir = app_data.join("instances");
            std::fs::create_dir_all(&instances_dir).ok();

            let account_store = AccountStore::load_or_default(&app_data.join("accounts.json"));

            app.manage(AppState {
                instances_dir,
                data_dir: app_data,
                account_store: Mutex::new(account_store),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_accounts,
            add_offline_account,
            set_active_account,
            remove_account,
            list_instances,
            create_instance,
            update_instance,
            delete_instance,
            list_instance_mods,
            toggle_instance_mod,
            open_instance_mods_folder,
            export_instance_share_code,
            parse_share_code,
            resolve_mod_from_hash,
            update_account_skin,
            launch_instance,
            import_instance_from_share_code,
            start_microsoft_login,
            check_microsoft_login,
            open_path_in_explorer,
            get_storage_paths,
            set_storage_path,
            search_modrinth_mods,
            get_mod_versions,
            install_mod_to_instance,
            search_curseforge_mods,
            get_curseforge_files,
            install_curseforge_mod,
            install_mod_file_to_instance,
            delete_instance_mod,
            get_modrinth_project,
            get_modrinth_dependencies,
            get_curseforge_mod,
            get_curseforge_description,
            set_curseforge_api_key,
            get_curseforge_api_key,
            set_unsplash_config,
            get_unsplash_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
