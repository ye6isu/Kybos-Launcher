use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JavaRuntimeInfo {
    pub path: PathBuf,
    pub major_version: u32,
    pub is_valid_for_modern_mc: bool, // Java >= 21
}

pub struct JavaProvisioner {
    runtime_dir: PathBuf,
}

impl JavaProvisioner {
    pub fn new(app_data_dir: &Path) -> Self {
        Self {
            runtime_dir: app_data_dir.join("runtime"),
        }
    }

    /// Tests a given java binary and attempts to extract its major version.
    pub fn detect_version(&self, java_bin: &Path) -> Result<u32, String> {
        let output = Command::new(java_bin)
            .arg("-version")
            .output()
            .map_err(|e| format!("Failed to execute java binary: {}", e))?;

        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let combined = format!("{}\n{}", stdout, stderr);

        // Parse versions e.g. "21.0.3" or "1.8.0_311"
        for line in combined.lines() {
            if line.contains("version") {
                if let Some(start) = line.find('"') {
                    if let Some(end) = line[start + 1..].find('"') {
                        let ver_str = &line[start + 1..start + 1 + end];
                        let parts: Vec<&str> = ver_str.split('.').collect();
                        if let Some(first) = parts.first() {
                            if *first == "1" {
                                if let Some(second) = parts.get(1) {
                                    if let Ok(v) = second.parse::<u32>() {
                                        return Ok(v);
                                    }
                                }
                            } else if let Ok(v) = first.parse::<u32>() {
                                return Ok(v);
                            }
                        }
                    }
                }
            }
        }

        Err("Could not parse Java version output".to_string())
    }

    /// Finds a suitable Java 21+ binary:
    /// 1. Portable runtime in Kybos `runtime/`
    /// 2. Custom java path if provided
    /// 3. System `java` on PATH if version >= 21
    pub fn find_or_recommend_java(&self, custom_path: Option<&Path>) -> Option<JavaRuntimeInfo> {
        // 1. Check custom path if configured
        if let Some(path) = custom_path {
            if let Ok(v) = self.detect_version(path) {
                return Some(JavaRuntimeInfo {
                    path: path.to_path_buf(),
                    major_version: v,
                    is_valid_for_modern_mc: v >= 21,
                });
            }
        }

        // 2. Check bundled / downloaded portable runtime in runtime/java-21
        let portable_dir = self.runtime_dir.join("java-21");
        #[cfg(target_os = "windows")]
        let direct_bin = portable_dir.join("bin").join("java.exe");
        #[cfg(not(target_os = "windows"))]
        let direct_bin = portable_dir.join("bin").join("java");

        if direct_bin.is_file() {
            if let Ok(v) = self.detect_version(&direct_bin) {
                return Some(JavaRuntimeInfo {
                    path: direct_bin,
                    major_version: v,
                    is_valid_for_modern_mc: v >= 21,
                });
            }
        }

        // Sometimes extracted into a nested jdk-21.* subfolder
        if portable_dir.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&portable_dir) {
                for entry in entries.flatten() {
                    let sub_p = entry.path();
                    #[cfg(target_os = "windows")]
                    let cand = sub_p.join("bin").join("java.exe");
                    #[cfg(not(target_os = "windows"))]
                    let cand = sub_p.join("bin").join("java");
                    if cand.is_file() {
                        if let Ok(v) = self.detect_version(&cand) {
                            return Some(JavaRuntimeInfo {
                                path: cand,
                                major_version: v,
                                is_valid_for_modern_mc: v >= 21,
                            });
                        }
                    }
                }
            }
        }

        // 3. Check system java
        let system_bin = PathBuf::from("java");
        if let Ok(v) = self.detect_version(&system_bin) {
            return Some(JavaRuntimeInfo {
                path: system_bin,
                major_version: v,
                is_valid_for_modern_mc: v >= 21,
            });
        }

        None
    }

    /// Automatically downloads and unpacks portable OpenJDK 21 into `runtime/java-21`
    pub async fn auto_provision_java_21<F>(&self, mut on_progress: F) -> Result<PathBuf, String>
    where
        F: FnMut(&str, f64), // (status_message, percentage_0_to_100)
    {
        let target_dir = self.runtime_dir.join("java-21");
        std::fs::create_dir_all(&self.runtime_dir).map_err(|e| e.to_string())?;

        on_progress("Connecting to Java runtime repository...", 5.0);

        // Adoptium Temurin 21 GA binary URL for active OS/arch
        #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
        let download_url = "https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse";
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        let download_url = "https://api.adoptium.net/v3/binary/latest/21/ga/mac/aarch64/jdk/hotspot/normal/eclipse";
        #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
        let download_url = "https://api.adoptium.net/v3/binary/latest/21/ga/mac/x64/jdk/hotspot/normal/eclipse";
        #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
        let download_url = "https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jdk/hotspot/normal/eclipse";
        #[cfg(not(any(
            all(target_os = "windows", target_arch = "x86_64"),
            all(target_os = "macos", target_arch = "aarch64"),
            all(target_os = "macos", target_arch = "x86_64"),
            all(target_os = "linux", target_arch = "x86_64")
        )))]
        return Err("Unsupported OS or architecture for automated Java provisioning. Please install Java 21 manually.".to_string());

        let client = reqwest::Client::builder()
            .user_agent("KybosLauncher/0.1.0")
            .build()
            .map_err(|e| e.to_string())?;

        let resp = client
            .get(download_url)
            .send()
            .await
            .map_err(|e| format!("Failed to download Java 21 runtime: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("Adoptium server returned status {}", resp.status()));
        }

        let total_size = resp.content_length().unwrap_or(45_000_000);
        on_progress("Downloading portable Java 21 runtime...", 15.0);

        use tokio_stream::StreamExt;
        let mut stream = resp.bytes_stream();
        let mut downloaded_bytes = Vec::with_capacity(total_size as usize);

        while let Some(chunk_result) = stream.next().await {
            let chunk = chunk_result.map_err(|e| format!("Error downloading chunk: {}", e))?;
            downloaded_bytes.extend_from_slice(&chunk);
            let pct = 15.0 + (downloaded_bytes.len() as f64 / total_size as f64) * 65.0;
            on_progress(
                &format!(
                    "Downloading Java 21 ({:.1} / {:.1} MB)...",
                    downloaded_bytes.len() as f64 / 1_048_576.0,
                    total_size as f64 / 1_048_576.0
                ),
                pct.min(80.0),
            );
        }

        on_progress("Unpacking Java 21 archive...", 85.0);
        let cursor = std::io::Cursor::new(downloaded_bytes);

        // Unpack zip archive into target_dir
        let mut archive = zip::ZipArchive::new(cursor).map_err(|e| format!("Failed parsing Java 21 zip archive: {}", e))?;
        let file_count = archive.len();
        for i in 0..file_count {
            let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
            let outpath = match file.enclosed_name() {
                Some(path) => target_dir.join(path),
                None => continue,
            };

            let is_dir = file.name().map(|n| n.ends_with('/')).unwrap_or(false);
            if is_dir {
                std::fs::create_dir_all(&outpath).ok();
            } else {
                if let Some(p) = outpath.parent() {
                    if !p.exists() {
                        std::fs::create_dir_all(p).ok();
                    }
                }
                let mut outfile = std::fs::File::create(&outpath).map_err(|e| e.to_string())?;
                std::io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
            }

            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Some(mode) = file.unix_mode() {
                    std::fs::set_permissions(&outpath, std::fs::Permissions::from_mode(mode)).ok();
                }
            }

            if i % 100 == 0 || i == file_count - 1 {
                let extract_pct = 85.0 + (i as f64 / file_count as f64) * 14.0;
                on_progress("Extracting Java 21 files...", extract_pct);
            }
        }

        on_progress("Verifying Java installation...", 100.0);

        // Return located binary
        if let Some(info) = self.find_or_recommend_java(None) {
            Ok(info.path)
        } else {
            Err("Extracted Java 21 but could not verify valid java executable".to_string())
        }
    }
}
