# Minecraft Launcher: Complete Architecture, Mod Transfer & Rework Blueprint

This document records the findings, post-mortem insights, mod transfer mechanics, asset management, and complete rework architecture for the lightweight custom Minecraft launcher.

---

## 1. Mod Transfer & Sharing Engine: How It Works

### A. The Problem with Direct File Transfer
Transmitting gigabytes of `.jar` files directly over chat or share codes is slow, bandwidth-heavy, and often violates mod authors' redistribution licenses.

### B. The Cryptographic Hash Fingerprinting System
Instead of sending the physical files, the launcher uses a lightweight, deterministic indexing architecture:

```
Sender's Instance (/instances/Cobblemon/mods/)
  ├── Cobblemon-neoforge-1.21.1.jar ──> Computes SHA-512 Hash ──┐
  ├── jei-1.21.1-neoforge.jar       ──> Computes SHA-512 Hash ──┼──> Pack into JSON Manifest
  └── FerriteCore-neoforge.jar      ──> Computes SHA-512 Hash ──┘              │
                                                                               ▼
                                                                     Gzip + Base64 String
                                                                    "AGYMC:H4sIC..." (Share Code)
```

```
Recipient's Machine:
  Friend pastes "AGYMC:..."
         │
         ▼
  Decompresses Manifest & Reads:
  - Game Version: 1.21.1
  - Loader: NeoForge 21.1.80
  - RAM Allocation: 6144 MB
  - List of Mod Hashes (SHA-512)
         │
         ▼
  Queries Modrinth / CurseForge Hash API:
  "https://api.modrinth.com/v2/version_file/<sha512>"
         │
         ▼
  Official verified mod version recognized ──> Downloads matching .jar directly into friend's mods/
```

### C. Drag-and-Drop Local Mod Management
* Each instance is completely isolated.
* In the launcher's **Installed Mods** view, an **`[📁 Open Mods Folder]`** button opens Windows File Explorer directly to that specific instance's `mods/` directory.
* Users can drag and drop any `.jar` files in.
* The launcher detects new files upon refresh, displaying their file sizes and providing instant `[ENABLED]` / `[DISABLED]` toggles (which cleanly renames `.jar` $\leftrightarrow$ `.jar.disabled`).

---

## 2. Configurable Assets Location & Storage Control

In Minecraft, `client.jar` only contains game code and textures; all sounds, ambient audio, music, and language packs reside in an indexed assets tree (`assets/indexes/17.json` pointing to ~4,000 files in `assets/objects/`).

### Configurable Asset Paths
In global settings, users can choose:
1. **Standard / Default Location**:
   - Stores assets in the standard directory (`%APPDATA%/.minecraft/assets` or `%APPDATA%/AgyLauncher/assets`).
2. **Custom / Dedicated Asset Location**:
   - Allows users to point the assets folder to any drive or directory (e.g. `D:\MinecraftData\assets`).
   - Multiple instances share this single asset pool, saving disk space on the primary OS drive.
3. **Local Cache Reuse**:
   - The launcher checks if the asset object already exists on disk before downloading, eliminating redundant downloads.

---

## 3. Strict Folder Cleanup on Instance Deletion

> **CRITICAL REQUIREMENT**:
> When an instance is deleted by the user, the launcher **must completely delete the physical folder it was placed on**, leaving zero orphan files or directories behind.

### Deletion Rules:
* **Standard Instances**: If stored in the default instances path (e.g. `<instances_dir>/<instance_id>`), deleting the instance permanently removes that entire folder and its contents (`mods/`, `config/`, `saves/`, `resourcepacks/`, and `instance.json`).
* **Custom Path Instances**: If the user assigned a custom folder (e.g. `D:\Games\MyCustomPack`), deleting the instance recursively deletes that exact directory.
* **No Unwanted Re-seeding**: If the instance list becomes empty (0 instances), the launcher displays a clean empty shelf with only the `+ Create New Instance` card, without automatically re-creating mock instances.

---

## 4. Runtime & Architecture Post-Mortem

### A. Java 21 Requirement for Minecraft 1.20.5+ / 1.21.1
* Minecraft 1.21.1 requires **Java 21** (`class file version 65.0`).
* System `PATH` frequently defaults to legacy Java 8 (`class file version 52.0`), which causes `UnsupportedClassVersionError`.
* **Solution**: An automatic provisioner checks for local Java $\ge 21$; if absent, it downloads a self-contained, portable Azul Zulu or Eclipse Temurin JRE 21 into the launcher's `runtime/` directory.

### B. Loader Execution Profiles
* **Vanilla**: Runs `client.jar` + Mojang libraries with `net.minecraft.client.main.Main`.
* **Fabric**: Downloads loader libraries from `meta.fabricmc.net` and runs `net.fabricmc.loader.impl.launch.knot.KnotClient`.
* **NeoForge**: Runs the headless installer to extract client-patched classes for modern Forge/NeoForge.

---

## 5. Master Implementation Checklist for Rework

### Core Engine
- [ ] Implement SHA-512 mod scanning and Modrinth hash matching for share codes.
- [ ] Add `Open Mods Folder` button that invokes `explorer.exe` on the instance's `mods/` path.
- [ ] Implement asset index downloader with auto-reuse of existing `.minecraft/assets`.
- [ ] Add global asset path picker (default vs custom directory).
- [ ] Implement recursive physical folder deletion when an instance is removed.
- [ ] Implement portable Java 21 auto-provisioning.

### UI & Flow
- [ ] Quiet, clean editorial interface (spacious layout, subtle 1px borders, high contrast).
- [ ] Library Shelf showing only installed instances + a `+ New Instance` card.
- [ ] Dedicated Instance Workspace:
  - Big `[ PLAY NOW ]` button.
  - Per-instance RAM slider (independent for each instance).
  - Mod loader dropdown / pill selector (Vanilla, NeoForge, Fabric, Quilt).
  - Installed Mods list with toggles and folder opener.
  - Share tab with 1-click export/import.
- [ ] Settings drawer for global preferences, accounts, and window lifecycle (Hide on launch, Reopen on exit/crash).
