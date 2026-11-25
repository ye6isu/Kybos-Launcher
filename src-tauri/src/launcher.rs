use crate::accounts::Account;
use crate::instances::InstanceConfig;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

pub struct MinecraftLauncher;

impl MinecraftLauncher {
    /// Builds and executes the Minecraft launch command
    pub fn launch(
        java_bin: &Path,
        instance: &InstanceConfig,
        instance_dir: &Path,
        client_jar: &Path,
        libraries: &[PathBuf],
        assets_dir: &Path,
        asset_index_id: &str,
        account: &Account,
        main_class: &str,
        extra_jvm_args: &[String],
        extra_game_args: &[String],
    ) -> Result<Child, String> {
        let mut cmd = Command::new(java_bin);

        // Hide command prompt window on Windows (CREATE_NO_WINDOW = 0x08000000)
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000);

        // 1. RAM Allocation arguments (-Xms, -Xmx)
        cmd.arg(format!("-Xms{}M", instance.ram_mb / 2));
        cmd.arg(format!("-Xmx{}M", instance.ram_mb));

        // 2. Extra JVM args (from Fabric / NeoForge profile)
        for arg in extra_jvm_args {
            cmd.arg(arg);
        }

        // 3. Custom JVM args if provided by user
        if let Some(ref extra_args) = instance.custom_jvm_args {
            for arg in extra_args.split_whitespace() {
                cmd.arg(arg);
            }
        }

        // 4. Construct Classpath
        // Separator: ';' on Windows, ':' on Unix
        #[cfg(target_os = "windows")]
        let cp_sep = ";";
        #[cfg(not(target_os = "windows"))]
        let cp_sep = ":";

        let mut cp_entries = Vec::new();
        for lib in libraries {
            if lib.is_file() {
                cp_entries.push(lib.to_string_lossy().to_string());
            }
        }
        cp_entries.push(client_jar.to_string_lossy().to_string());

        let classpath = cp_entries.join(cp_sep);
        cmd.arg("-cp").arg(classpath);

        // 5. Main class
        cmd.arg(main_class);

        // 6. Minecraft Game Arguments
        cmd.arg("--username").arg(&account.username);
        cmd.arg("--version").arg(&instance.game_version);
        cmd.arg("--gameDir").arg(instance_dir);
        cmd.arg("--assetsDir").arg(assets_dir);
        cmd.arg("--assetIndex").arg(asset_index_id);
        cmd.arg("--uuid").arg(&account.uuid);
        cmd.arg("--accessToken").arg(account.access_token.as_deref().unwrap_or("0"));
        cmd.arg("--userType").arg(match account.account_type {
            crate::accounts::AccountType::Microsoft => "msa",
            crate::accounts::AccountType::Offline => "legacy",
        });
        cmd.arg("--versionType").arg("Kybos");

        // 7. Extra Game arguments (from loader profile, e.g. --fml.* flags)
        for arg in extra_game_args {
            cmd.arg(arg);
        }

        // Working directory inside instance root
        cmd.current_dir(instance_dir);

        // Pipe stdout and stderr so launcher can monitor logs in background without opening console windows
        cmd.stdout(Stdio::piped())
           .stderr(Stdio::piped());

        cmd.spawn().map_err(|e| format!("Failed to spawn Minecraft process: {}", e))
    }
}
