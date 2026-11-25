import React, { useState, useEffect, useRef } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import {
  X,
  Share2,
  FolderOpen,
  Trash2,
  Upload,
  Search,
  Package,
  Download,
  CheckCircle2,
  ChevronDown,
  Check,
  ChevronLeft,
  ChevronRight,
  Sparkles
} from 'lucide-react';
import { InstanceConfig, Account, ModLoader } from '../App';
import { ModSearchHit, ModVersion, CurseForgeFile } from './ModBrowser';
import { ModDetailModal } from './ModDetailModal';

interface AdvancedInstanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  // If editing an existing instance
  editingInstance?: InstanceConfig | null;
  // If creating new
  initialCreateForm?: {
    name: string;
    game_version: string;
    loader: ModLoader;
    ram_mb: number;
    account_override_id?: string;
    banner_url?: string;
    color?: string;
  };
  accounts: Account[];
  currentAccount?: Account;
  onSaveInstance: (config: InstanceConfig) => Promise<void>;
  onDeleteInstance?: (id: string) => void;
  onShareInstance?: (inst: InstanceConfig) => void;
  showToast: (msg: string) => void;
}

export const AdvancedInstanceModal: React.FC<AdvancedInstanceModalProps> = ({
  isOpen,
  onClose,
  editingInstance,
  initialCreateForm,
  accounts,
  currentAccount,
  onSaveInstance,
  onDeleteInstance,
  onShareInstance,
  showToast,
}) => {
  const isEditing = !!editingInstance;

  // Tabs: 'settings' | 'mods' | 'browse'
  const [activeTab, setActiveTab] = useState<'settings' | 'mods' | 'browse'>('settings');

  // Form State
  const [form, setForm] = useState<{
    id: string;
    name: string;
    game_version: string;
    loader: ModLoader;
    ram_mb: number;
    account_override_id?: string;
    banner_url?: string;
    color?: string;
    crop_cover?: boolean;
  }>({
    id: editingInstance?.id || '',
    name: editingInstance?.name || initialCreateForm?.name || '',
    game_version: editingInstance?.game_version || initialCreateForm?.game_version || '1.21.1',
    loader: editingInstance?.loader || initialCreateForm?.loader || 'Vanilla',
    ram_mb: editingInstance?.ram_mb || initialCreateForm?.ram_mb || 4096,
    account_override_id: editingInstance?.account_override_id || initialCreateForm?.account_override_id || undefined,
    banner_url: editingInstance?.banner_url || initialCreateForm?.banner_url || undefined,
    color: editingInstance?.color || initialCreateForm?.color || undefined,
    crop_cover: editingInstance?.crop_cover ?? false,
  });

  // Custom Cosmos Floating Dropdowns States
  const [showGameVersionMenu, setShowGameVersionMenu] = useState(false);
  const [showLoaderMenu, setShowLoaderMenu] = useState(false);
  const [showAccountOverrideMenu, setShowAccountOverrideMenu] = useState(false);

  const gameVersionMenuRef = useRef<HTMLDivElement>(null);
  const loaderMenuRef = useRef<HTMLDivElement>(null);
  const accountOverrideMenuRef = useRef<HTMLDivElement>(null);
  const bannerFileInputRef = useRef<HTMLInputElement>(null);

  const [isFetchingRandomImage, setIsFetchingRandomImage] = useState(false);

  const handleBannerFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setForm((prev) => ({ ...prev, banner_url: reader.result as string }));
      }
    };
    reader.readAsDataURL(file);
  };

  const fetchRandomCover = async () => {
    setIsFetchingRandomImage(true);
    try {
      // 1. Check if user configured an Unsplash Access Key in Settings
      const unsplashConfig = await invoke<{ access_key: string; topics: string }>('get_unsplash_config').catch(() => ({
        access_key: '',
        topics: 'architecture,nature,wallpapers',
      }));

      // Alternate or mix: if user has an Unsplash Access Key and random coin flip hits Unsplash
      const hasUnsplashKey = !!unsplashConfig?.access_key?.trim();
      const preferUnsplash = hasUnsplashKey && Math.random() < 0.6; // 60% Unsplash, 40% Picsum to conserve API quota

      if (preferUnsplash) {
        try {
          const topics = unsplashConfig.topics || 'architecture,nature,wallpapers';
          const res = await fetch(
            `https://api.unsplash.com/photos/random?query=${encodeURIComponent(topics)}&orientation=landscape`,
            {
              headers: {
                Authorization: `Client-ID ${unsplashConfig.access_key.trim()}`,
              },
            }
          );
          if (res.ok) {
            const data = await res.json();
            const imageUrl = data?.urls?.regular || data?.urls?.full;
            if (imageUrl) {
              setForm((prev) => ({ ...prev, banner_url: imageUrl }));
              showToast('Cover loaded from Unsplash!');
              return;
            }
          }
        } catch (unsplashErr) {
          console.warn('Unsplash fetch error, falling back to Picsum:', unsplashErr);
        }
      }

      // High-res Photography CDN with unique random seed (fallback or mixed)
      const randomSeed = Math.floor(Math.random() * 1000000);
      const isPortrait = Math.random() > 0.5;
      const width = isPortrait ? 800 : 1200;
      const height = isPortrait ? 1200 : 800;
      const randomUrl = `https://picsum.photos/seed/${randomSeed}/${width}/${height}`;
      setForm((prev) => ({ ...prev, banner_url: randomUrl }));
      showToast('Loaded aesthetic photography cover!');
    } catch (e) {
      showToast(`Failed to load random image: ${e}`);
    } finally {
      setIsFetchingRandomImage(false);
    }
  };

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (gameVersionMenuRef.current && !gameVersionMenuRef.current.contains(e.target as Node)) {
        setShowGameVersionMenu(false);
      }
      if (loaderMenuRef.current && !loaderMenuRef.current.contains(e.target as Node)) {
        setShowLoaderMenu(false);
      }
      if (accountOverrideMenuRef.current && !accountOverrideMenuRef.current.contains(e.target as Node)) {
        setShowAccountOverrideMenu(false);
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Installed Mods State
  interface LocalModItem {
    filename: string;
    is_enabled: boolean;
    file_size: number;
  }
  const [installedMods, setInstalledMods] = useState<LocalModItem[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // In-modal Mod Browser State
  const [browserSource, setBrowserSource] = useState<'modrinth' | 'curseforge'>('modrinth');
  const [browseQuery, setBrowseQuery] = useState('');
  const [browseHits, setBrowseHits] = useState<ModSearchHit[]>([]);
  const [browseTotalHits, setBrowseTotalHits] = useState(0);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browsePage, setBrowsePage] = useState(1);
  const [installingProject, setInstallingProject] = useState<string | null>(null);
  const [selectedBrowseModDetail, setSelectedBrowseModDetail] = useState<ModSearchHit | null>(null);
  const lastSearchKeyRef = useRef<string>('');

  // Load installed mods if editing
  const loadInstalledMods = async (instId: string) => {
    if (!instId) return;
    try {
      const mods = await invoke<LocalModItem[]>('list_instance_mods', { instanceId: instId });
      setInstalledMods(mods);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (editingInstance) {
      setForm({
        id: editingInstance.id,
        name: editingInstance.name,
        game_version: editingInstance.game_version,
        loader: editingInstance.loader,
        ram_mb: editingInstance.ram_mb,
        account_override_id: editingInstance.account_override_id || undefined,
        banner_url: editingInstance.banner_url || undefined,
        color: editingInstance.color || undefined,
        crop_cover: editingInstance.crop_cover ?? false,
      });
      loadInstalledMods(editingInstance.id);
    } else {
      setForm({
        id: '',
        name: initialCreateForm?.name || '',
        game_version: initialCreateForm?.game_version || '1.21.1',
        loader: initialCreateForm?.loader || 'Vanilla',
        ram_mb: initialCreateForm?.ram_mb || 4096,
        account_override_id: initialCreateForm?.account_override_id || undefined,
        banner_url: initialCreateForm?.banner_url || undefined,
        color: initialCreateForm?.color || undefined,
        crop_cover: false,
      });
      setInstalledMods([]);
    }
  }, [editingInstance, initialCreateForm, isOpen]);

  // Search mods for browser tab
  const fetchBrowseMods = async (query: string, page: number = 1) => {
    setBrowseLoading(true);
    try {
      const limit = 20;
      const offset = (page - 1) * limit;
      const cleanLoader = form.loader && form.loader.toLowerCase() !== 'vanilla'
        ? form.loader.toLowerCase().replace(/[^a-z0-9]/g, '')
        : undefined;
      const versionParam = form.game_version || undefined;

      if (browserSource === 'modrinth') {
        const res = await invoke<{ hits: ModSearchHit[]; total_hits: number }>('search_modrinth_mods', {
          query,
          loader: cleanLoader || null,
          gameVersion: versionParam || null,
          limit,
          offset,
        });
        setBrowseHits(res.hits);
        setBrowseTotalHits(res.total_hits);
      } else {
        const res = await invoke<{ hits: ModSearchHit[]; total_hits: number }>('search_curseforge_mods', {
          query,
          gameVersion: versionParam || null,
          loader: cleanLoader || null,
          limit,
          index: offset,
        });
        setBrowseHits(res.hits);
        setBrowseTotalHits(res.total_hits);
      }
      setBrowsePage(page);
    } catch (err) {
      showToast(`Search failed: ${err}`);
    } finally {
      setBrowseLoading(false);
    }
  };

  const isVanilla = form.loader.toLowerCase() === 'vanilla';

  useEffect(() => {
    if (activeTab === 'browse') {
      // Don't search if vanilla
      if (isVanilla) {
        setBrowseHits([]);
        setBrowseTotalHits(0);
        return;
      }
      // If we already have hits for this query, provider, and loader, don't refetch
      const currentCacheKey = `${browseQuery.trim()}|${browserSource}|${form.loader}|${form.game_version}`;
      if (lastSearchKeyRef.current === currentCacheKey && browseHits.length > 0) {
        return;
      }

      const timer = setTimeout(() => {
        lastSearchKeyRef.current = currentCacheKey;
        fetchBrowseMods(browseQuery, 1);
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [browseQuery, browserSource, activeTab, form.loader, form.game_version, isVanilla]);

  if (!isOpen) return null;

  // Toggle mod
  const handleToggleMod = async (mod: LocalModItem) => {
    if (!form.id) return;
    try {
      await invoke('toggle_instance_mod', {
        instanceId: form.id,
        filename: mod.filename,
        enable: !mod.is_enabled,
      });
      await loadInstalledMods(form.id);
    } catch (err) {
      showToast(`Toggle failed: ${err}`);
    }
  };

  // Delete mod
  const handleDeleteMod = async (filename: string) => {
    if (!form.id) return;
    try {
      await invoke('delete_instance_mod', {
        instanceId: form.id,
        filename,
      });
      showToast(`Deleted ${filename}`);
      await loadInstalledMods(form.id);
    } catch (err) {
      showToast(`Delete failed: ${err}`);
    }
  };

  // Open mods folder
  const handleOpenFolder = async () => {
    if (!form.id) return;
    try {
      await invoke('open_instance_mods_folder', { instanceId: form.id });
    } catch (err) {
      showToast(`Could not open folder: ${err}`);
    }
  };

  // Open full instance directory / file explorer
  const handleOpenInstanceDirectory = async () => {
    if (!form.id) return;
    try {
      await invoke('open_instance_directory', { instanceId: form.id });
    } catch (err) {
      showToast(`Could not open directory: ${err}`);
    }
  };

  // File Picker to add mod directly
  const handlePickModFiles = async () => {
    if (!form.id) {
      showToast('Save instance first before adding local mods.');
      return;
    }
    try {
      const selected = await openDialog({
        multiple: true,
        filters: [{ name: 'Minecraft Mods', extensions: ['jar'] }],
      });
      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];
        for (const p of paths) {
          await invoke('install_mod_file_to_instance', {
            instanceId: form.id,
            srcPath: p,
          });
        }
        showToast(`Added ${paths.length} mod(s)`);
        await loadInstalledMods(form.id);
      }
    } catch (err) {
      showToast(`Failed to add mod: ${err}`);
    }
  };

  // Install Mod from browser tab
  const handleInstallBrowseMod = async (mod: ModSearchHit) => {
    if (!form.id) {
      showToast('Save instance first before installing mods.');
      return;
    }
    setInstallingProject(mod.project_id);
    try {
      const isCurseForge = mod.project_id.startsWith('cf-');
      if (isCurseForge) {
        const cfId = parseInt(mod.project_id.replace('cf-', ''), 10);
        const files = await invoke<CurseForgeFile[]>('get_curseforge_files', { modId: cfId });
        if (files.length === 0) {
          showToast(`No files found for ${mod.title}`);
          return;
        }
        const targetGv = form.game_version || '1.21.1';
        const targetLoader = form.loader !== 'Vanilla' ? form.loader.toLowerCase() : '';
        const compatibleFile =
          files.find((f) => {
            const matchVer = f.gameVersions.some((v) => v.includes(targetGv));
            const matchLoader = targetLoader ? f.gameVersions.some((v) => v.toLowerCase().includes(targetLoader)) : true;
            return matchVer && matchLoader && f.downloadUrl;
          }) || files.find((f) => f.downloadUrl) || files[0];

        if (!compatibleFile || !compatibleFile.downloadUrl) {
          showToast('Author restricted direct third-party downloads for this mod.');
          return;
        }

        await invoke('install_curseforge_mod', {
          instanceId: form.id,
          fileUrl: compatibleFile.downloadUrl,
          filename: compatibleFile.fileName,
        });
        showToast(`Added ${mod.title}!`);
      } else {
        const loaderParam = form.loader !== 'Vanilla' ? form.loader.toLowerCase() : 'neoforge';
        const versions = await invoke<ModVersion[]>('get_mod_versions', {
          projectId: mod.project_id,
          loader: loaderParam,
          gameVersion: form.game_version,
        });

        if (versions.length === 0) {
          showToast(`No compatible version found for ${form.name}`);
          return;
        }
        const latest = versions[0];
        const primary = latest.files.find((f) => f.primary) || latest.files[0];
        if (!primary) return;

        await invoke('install_mod_to_instance', {
          instanceId: form.id,
          fileUrl: primary.url,
          filename: primary.filename,
        });
        showToast(`Added ${mod.title}!`);
      }
      await loadInstalledMods(form.id);
    } catch (e) {
      showToast(`Install failed: ${e}`);
    } finally {
      setInstallingProject(null);
    }
  };

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!form.name.trim()) {
      showToast('Instance name is required.');
      return;
    }

    setIsSaving(true);
    try {
      const config: InstanceConfig = {
        id: form.id || '',
        name: form.name.trim(),
        game_version: form.game_version,
        loader: form.loader,
        ram_mb: form.ram_mb,
        account_override_id: form.account_override_id || null,
        created_at: editingInstance?.created_at || new Date().toISOString(),
        last_played_at: editingInstance?.last_played_at,
        banner_url: form.banner_url || undefined,
        color: form.color || undefined,
        crop_cover: form.crop_cover ?? false,
      };

      await onSaveInstance(config);
      onClose();
    } catch (err) {
      showToast(`Error saving: ${err}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-2xl flex items-center justify-center z-50 p-4 sm:p-6 md:p-8 animate-in fade-in duration-200">
      <div className="relative bg-[#0F0F0F] border border-white/[0.08] rounded-3xl w-full h-[92vh] max-w-6xl flex flex-col overflow-hidden shadow-2xl">
        {/* Top Header */}
        <div className="relative h-16 px-6 border-b border-white/[0.07] flex items-center justify-between shrink-0 bg-[#0C0C0C]/80">
          {/* Centered Navigation Tabs Pill */}
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1 bg-white/[0.04] p-1 rounded-2xl border border-white/[0.06] z-10">
            <button
              onClick={() => setActiveTab('settings')}
              className={`px-4 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                activeTab === 'settings' ? 'bg-white text-black shadow-sm' : 'text-white/50 hover:text-white'
              }`}
            >
              Configuration
            </button>
            <button
              onClick={() => !isVanilla && setActiveTab('mods')}
              disabled={isVanilla}
              title={isVanilla ? 'Mods not supported on Vanilla' : undefined}
              className={`px-4 py-1.5 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 ${
                isVanilla
                  ? 'opacity-30 cursor-not-allowed text-white/30'
                  : activeTab === 'mods'
                  ? 'bg-white text-black shadow-sm cursor-pointer'
                  : 'text-white/50 hover:text-white cursor-pointer'
              }`}
            >
              <span>Installed Mods</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${isVanilla ? 'bg-white/5 text-white/20' : activeTab === 'mods' ? 'bg-black/10 text-black' : 'bg-white/10 text-white/70'}`}>
                {isVanilla ? 0 : installedMods.length}
              </span>
            </button>
            <button
              onClick={() => !isVanilla && setActiveTab('browse')}
              disabled={isVanilla}
              title={isVanilla ? 'Mods not supported on Vanilla' : undefined}
              className={`px-4 py-1.5 rounded-xl text-xs font-medium transition-all ${
                isVanilla
                  ? 'opacity-30 cursor-not-allowed text-white/30'
                  : activeTab === 'browse'
                  ? 'bg-white text-black shadow-sm cursor-pointer'
                  : 'text-white/50 hover:text-white cursor-pointer'
              }`}
            >
              Add Mods
            </button>
          </div>

          {/* Right: Close Button */}
          <div className="ml-auto flex items-center z-10">
            <button
              onClick={onClose}
              className="size-8 rounded-full bg-white/[0.04] hover:bg-white/10 text-white/50 hover:text-white flex items-center justify-center transition-all cursor-pointer"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Tab 1: Configuration Settings */}
        {activeTab === 'settings' && (
          <div className="flex-1 overflow-y-auto p-8 space-y-6">
            <div className="max-w-3xl mx-auto space-y-6">
              {/* Card 1: General Properties */}
              <div className="p-6 rounded-3xl bg-white/[0.02] border border-white/[0.06] space-y-5">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-white/40">General Properties</h3>
                  <p className="text-xs text-white/60 mt-0.5">Instance identity, Minecraft version, and mod loader</p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-white/80 block">Instance Name</label>
                  <input
                    type="text"
                    required
                    placeholder="Enter instance name..."
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full bg-white/[0.04] border border-white/10 rounded-2xl px-4 py-2.5 text-xs text-white placeholder-white/30 outline-none focus:border-white/30"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Minecraft Version Cosmos Dropdown */}
                  <div className="relative" ref={gameVersionMenuRef}>
                    <label className="text-xs font-medium text-white/80 block mb-1.5">Minecraft Version</label>
                    <button
                      type="button"
                      onClick={() => setShowGameVersionMenu(!showGameVersionMenu)}
                      className="w-full bg-[#141414] border border-white/10 rounded-2xl px-4 py-2.5 text-xs text-white flex items-center justify-between hover:border-white/20 transition-all cursor-pointer"
                    >
                      <span>{form.game_version}</span>
                      <ChevronDown className={`size-3 text-white/40 transition-transform ${showGameVersionMenu ? 'rotate-180' : ''}`} />
                    </button>

                    {showGameVersionMenu && (
                      <div className="absolute left-0 top-full mt-1.5 w-full bg-[#121212]/95 border border-white/10 rounded-2xl p-1.5 shadow-2xl backdrop-blur-3xl z-50">
                        {['1.21.1', '1.21', '1.20.4', '1.20.1'].map((v) => {
                          const isSel = form.game_version === v;
                          return (
                            <button
                              key={v}
                              type="button"
                              onClick={() => {
                                setForm({ ...form, game_version: v });
                                setShowGameVersionMenu(false);
                              }}
                              className={`w-full flex items-center justify-between px-3.5 py-2 rounded-xl text-xs transition-colors cursor-pointer ${
                                isSel ? 'bg-white/10 text-white font-medium' : 'text-white/60 hover:text-white hover:bg-white/[0.04]'
                              }`}
                            >
                              <span>{v}</span>
                              {isSel && <Check className="size-3.5 text-white" />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Mod Loader Cosmos Dropdown */}
                  <div className="relative" ref={loaderMenuRef}>
                    <label className="text-xs font-medium text-white/80 block mb-1.5">Mod Loader</label>
                    <button
                      type="button"
                      onClick={() => setShowLoaderMenu(!showLoaderMenu)}
                      className="w-full bg-[#141414] border border-white/10 rounded-2xl px-4 py-2.5 text-xs text-white flex items-center justify-between hover:border-white/20 transition-all cursor-pointer"
                    >
                      <span>{form.loader}</span>
                      <ChevronDown className={`size-3 text-white/40 transition-transform ${showLoaderMenu ? 'rotate-180' : ''}`} />
                    </button>

                    {showLoaderMenu && (
                      <div className="absolute left-0 top-full mt-1.5 w-full bg-[#121212]/95 border border-white/10 rounded-2xl p-1.5 shadow-2xl backdrop-blur-3xl z-50">
                        {(['Vanilla', 'Fabric', 'NeoForge', 'Forge', 'Quilt'] as ModLoader[]).map((loaderName) => {
                          const isSel = form.loader === loaderName;
                          return (
                            <button
                              key={loaderName}
                              type="button"
                              onClick={() => {
                                setForm({ ...form, loader: loaderName });
                                setShowLoaderMenu(false);
                              }}
                              className={`w-full flex items-center justify-between px-3.5 py-2 rounded-xl text-xs transition-colors cursor-pointer ${
                                isSel ? 'bg-white/10 text-white font-medium' : 'text-white/60 hover:text-white hover:bg-white/[0.04]'
                              }`}
                            >
                              <span>{loaderName}</span>
                              {isSel && <Check className="size-3.5 text-white" />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Card 2: Appearance & Visuals */}
              <div className="p-6 rounded-3xl bg-white/[0.02] border border-white/[0.06] space-y-6">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-white/40">Appearance & Visuals</h3>
                  <p className="text-xs text-white/60 mt-0.5">Cover poster artwork, grid framing, and accent card colors</p>
                </div>

                {/* Banner Image URL or Local File Upload */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-white/80 block">Cover Banner Image</label>
                    {form.banner_url && (
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, banner_url: undefined })}
                        className="text-[11px] text-rose-400 hover:text-rose-300 transition-colors cursor-pointer"
                      >
                        Remove Cover
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-white/40">
                    Use a web image URL or upload a local file from disk to display a sharp-edged poster.
                  </p>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Paste image URL (https://... or data:image/...)"
                      value={form.banner_url || ''}
                      onChange={(e) => setForm({ ...form, banner_url: e.target.value || undefined })}
                      className="flex-1 bg-white/[0.04] border border-white/10 rounded-2xl px-4 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-white/30 font-mono"
                    />

                    <input
                      type="file"
                      ref={bannerFileInputRef}
                      onChange={handleBannerFileSelect}
                      accept="image/*"
                      className="hidden"
                    />

                    <button
                      type="button"
                      onClick={() => bannerFileInputRef.current?.click()}
                      className="px-4 py-2 rounded-2xl bg-white/[0.06] hover:bg-white/15 text-white/80 hover:text-white text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer shrink-0 border border-white/10"
                    >
                      <Upload className="size-3.5" />
                      <span>Upload File</span>
                    </button>

                    <button
                      type="button"
                      onClick={fetchRandomCover}
                      disabled={isFetchingRandomImage}
                      className="px-4 py-2 rounded-2xl bg-white text-black hover:bg-neutral-200 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shrink-0 shadow-sm disabled:opacity-50"
                    >
                      <Sparkles className="size-3.5" />
                      <span>{isFetchingRandomImage ? 'Fetching...' : 'Random Cover'}</span>
                    </button>
                  </div>

                  {form.banner_url && (
                    <div className="mt-3 flex items-start gap-4 p-3.5 rounded-2xl bg-white/[0.02] border border-white/[0.06]">
                      <div className={`rounded-xl overflow-hidden border border-white/20 relative shadow-md bg-neutral-900 shrink-0 ${
                        form.crop_cover ? 'h-32 w-28' : 'h-32 w-auto max-w-[150px]'
                      }`}>
                        <img
                          src={form.banner_url}
                          alt="Banner Preview"
                          className={`w-full h-full ${form.crop_cover ? 'object-cover' : 'object-contain'}`}
                          onError={(e) => {
                            (e.currentTarget as HTMLElement).style.display = 'none';
                          }}
                        />
                      </div>

                      <div className="flex-1 space-y-2">
                        <label className="text-xs font-medium text-white/80 block">Cover Layout Aspect Ratio</label>
                        <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-white/[0.04] border border-white/[0.06]">
                          <button
                            type="button"
                            onClick={() => setForm({ ...form, crop_cover: false })}
                            className={`py-1.5 px-2 text-xs font-medium rounded-lg transition-all cursor-pointer text-center ${
                              !form.crop_cover
                                ? 'bg-white text-black shadow-sm font-semibold'
                                : 'text-white/40 hover:text-white'
                            }`}
                          >
                            Natural / Masonry
                          </button>
                          <button
                            type="button"
                            onClick={() => setForm({ ...form, crop_cover: true })}
                            className={`py-1.5 px-2 text-xs font-medium rounded-lg transition-all cursor-pointer text-center ${
                              form.crop_cover
                                ? 'bg-white text-black shadow-sm font-semibold'
                                : 'text-white/40 hover:text-white'
                            }`}
                          >
                            Crop Uniform Grid
                          </button>
                        </div>
                        <p className="text-[11px] text-white/40 leading-relaxed">
                          {!form.crop_cover
                            ? 'Natural preserves the uncropped aspect ratio in the dynamic Cosmos masonry layout.'
                            : 'Uniform crops this card to the standard uniform grid height alongside other uniform cards.'}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Card Color / Swatch */}
                <div className="space-y-3 pt-4 border-t border-white/[0.05]">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-white/80 block">Card Color / Swatch</label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const h = Math.floor(Math.random() * 360);
                          const s = Math.floor(Math.random() * 40) + 50;
                          const l = Math.floor(Math.random() * 35) + 15;
                          const c = (1 - Math.abs(2 * (l / 100) - 1)) * (s / 100);
                          const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
                          const m = l / 100 - c / 2;
                          let r = 0, g = 0, b = 0;
                          if (h < 60) { r = c; g = x; b = 0; }
                          else if (h < 120) { r = x; g = c; b = 0; }
                          else if (h < 180) { r = 0; g = c; b = x; }
                          else if (h < 240) { r = 0; g = x; b = c; }
                          else if (h < 300) { r = x; g = 0; b = c; }
                          else { r = c; g = 0; b = x; }
                          const toHex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
                          const randomHex = `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
                          setForm({ ...form, color: randomHex });
                        }}
                        className="text-[11px] text-white/50 hover:text-white transition-colors cursor-pointer flex items-center gap-1"
                        title="Generate True Random Color"
                      >
                        <Sparkles className="size-3" />
                        <span>Random</span>
                      </button>
                      {form.color && (
                        <button
                          type="button"
                          onClick={() => setForm({ ...form, color: undefined })}
                          className="text-[11px] text-rose-400 hover:text-rose-300 transition-colors cursor-pointer"
                        >
                          Reset
                        </button>
                      )}
                      <span className="text-[10px] text-white/40 font-mono uppercase">{form.color || '#1E293B'}</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-white/40">
                    Background accent color used for the card or when no cover image is loaded.
                  </p>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {[
                      '#1E293B', // Slate
                      '#0F172A', // Midnight Slate
                      '#1E3A8A', // Navy Blue
                      '#0284C7', // Sky Cyan
                      '#0F766E', // Deep Teal
                      '#064E3B', // Emerald
                      '#4D7C0F', // Olive Moss
                      '#B45309', // Warm Amber
                      '#C2410C', // Rust Terracotta
                      '#B91C1C', // Crimson Red
                      '#831843', // Plum Rose
                      '#701A75', // Royal Fuchsia
                      '#312E81', // Midnight Indigo
                      '#262626', // Charcoal Neutral
                      '#E2E8F0', // Porcelain Light
                    ].map((col) => (
                      <button
                        key={col}
                        type="button"
                        onClick={() => setForm({ ...form, color: col })}
                        style={{ backgroundColor: col }}
                        className={`size-6 rounded-full border transition-transform cursor-pointer ${
                          form.color === col
                            ? 'border-white scale-110 shadow-md ring-2 ring-white/20'
                            : 'border-white/20 hover:scale-105'
                        }`}
                      />
                    ))}
                    {/* Custom Color Wheel Picker */}
                    <label className="relative size-6 rounded-full overflow-hidden border border-white/20 hover:scale-105 cursor-pointer flex items-center justify-center bg-gradient-to-tr from-pink-500 via-amber-400 to-cyan-500 shrink-0" title="Custom Color">
                      <input
                        type="color"
                        value={form.color || '#1E293B'}
                        onChange={(e) => setForm({ ...form, color: e.target.value })}
                        className="opacity-0 absolute inset-0 cursor-pointer size-full"
                      />
                    </label>
                  </div>
                </div>
              </div>

              {/* Hardware & Memory */}
              <div className="p-6 rounded-3xl bg-white/[0.02] border border-white/[0.06] space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-white/40">Memory & Java</h3>
                    <p className="text-xs text-white/70 mt-0.5">Allocate system RAM for this instance</p>
                  </div>
                  <span className="font-mono text-sm font-semibold text-white px-3 py-1 bg-white/10 rounded-xl">
                    {(form.ram_mb / 1024).toFixed(1)} GB RAM
                  </span>
                </div>

                <input
                  type="range"
                  min={2048}
                  max={16384}
                  step={1024}
                  value={form.ram_mb}
                  onChange={(e) => setForm({ ...form, ram_mb: Number(e.target.value) })}
                  className="w-full accent-white cursor-pointer"
                />

                <div className="flex justify-between text-[11px] text-white/30 font-mono">
                  <span>2 GB</span>
                  <span>4 GB (Default)</span>
                  <span>8 GB</span>
                  <span>16 GB</span>
                </div>
              </div>

              {/* Player Profile Override Cosmos Dropdown */}
              <div className="relative p-6 rounded-3xl bg-white/[0.02] border border-white/[0.06] space-y-3" ref={accountOverrideMenuRef}>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-white/40">Profile Override</h3>
                <p className="text-xs text-white/60">Choose which Minecraft account automatically signs in for this instance:</p>

                <button
                  type="button"
                  onClick={() => setShowAccountOverrideMenu(!showAccountOverrideMenu)}
                  className="w-full bg-[#141414] border border-white/10 rounded-2xl px-4 py-2.5 text-xs text-white flex items-center justify-between hover:border-white/20 transition-all cursor-pointer"
                >
                  <span className="truncate">
                    {form.account_override_id
                      ? accounts.find((a) => a.id === form.account_override_id)?.username || 'Selected Profile'
                      : `Use Global Default Profile (${currentAccount?.username || 'None'})`}
                  </span>
                  <ChevronDown className={`size-3 text-white/40 shrink-0 ml-2 transition-transform ${showAccountOverrideMenu ? 'rotate-180' : ''}`} />
                </button>

                {showAccountOverrideMenu && (
                  <div className="absolute left-6 right-6 top-full -mt-1 bg-[#121212]/95 border border-white/10 rounded-2xl p-1.5 shadow-2xl backdrop-blur-3xl z-50 max-h-52 overflow-y-auto">
                    <button
                      type="button"
                      onClick={() => {
                        setForm({ ...form, account_override_id: undefined });
                        setShowAccountOverrideMenu(false);
                      }}
                      className={`w-full flex items-center justify-between px-3.5 py-2 rounded-xl text-xs transition-colors cursor-pointer ${
                        !form.account_override_id ? 'bg-white/10 text-white font-medium' : 'text-white/60 hover:text-white hover:bg-white/[0.04]'
                      }`}
                    >
                      <span>Use Global Default Profile ({currentAccount?.username || 'None'})</span>
                      {!form.account_override_id && <Check className="size-3.5 text-white" />}
                    </button>

                    {accounts.map((acc) => {
                      const isSel = form.account_override_id === acc.id;
                      return (
                        <button
                          key={acc.id}
                          type="button"
                          onClick={() => {
                            setForm({ ...form, account_override_id: acc.id });
                            setShowAccountOverrideMenu(false);
                          }}
                          className={`w-full flex items-center justify-between px-3.5 py-2 rounded-xl text-xs transition-colors cursor-pointer ${
                            isSel ? 'bg-white/10 text-white font-medium' : 'text-white/60 hover:text-white hover:bg-white/[0.04]'
                          }`}
                        >
                          <span className="truncate">
                            {acc.username} <span className="text-white/40">({acc.account_type})</span>
                          </span>
                          {isSel && <Check className="size-3.5 text-white shrink-0 ml-1" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Installed Mods View */}
        {activeTab === 'mods' && (
          <div className="flex-1 overflow-y-auto p-8 space-y-6">
            <div className="max-w-4xl mx-auto space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white">Installed Mods</h3>
                  <p className="text-xs text-white/40">
                    {installedMods.length} mod(s) installed in <span className="font-mono text-white/60">{form.name}</span>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleOpenFolder}
                    className="px-3.5 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/15 text-white/80 hover:text-white text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer"
                  >
                    <FolderOpen className="size-3.5" />
                    <span>Open Folder</span>
                  </button>
                </div>
              </div>

              {/* Drag and Drop Zone */}
              <div
                onClick={handlePickModFiles}
                className="border-2 border-dashed border-white/10 hover:border-white/30 rounded-3xl p-8 flex flex-col items-center justify-center text-center space-y-2 cursor-pointer transition-all bg-white/[0.01] hover:bg-white/[0.03]"
              >
                <div className="size-10 rounded-2xl bg-white/[0.05] flex items-center justify-center text-white/50">
                  <Upload className="size-5" />
                </div>
                <p className="text-xs font-medium text-white/80">Click or Drag & Drop local `.jar` files here</p>
                <p className="text-[11px] text-white/40">Files will be instantly placed into this instance's mods directory</p>
              </div>

              {/* Mod List */}
              {installedMods.length === 0 ? (
                <div className="text-center py-12 text-xs text-white/30">
                  No mods installed yet. Browse online mods or add local files above.
                </div>
              ) : (
                <div className="grid gap-2">
                  {installedMods.map((m) => (
                    <div
                      key={m.filename}
                      className="flex items-center justify-between p-3.5 rounded-2xl bg-white/[0.03] border border-white/[0.06] hover:border-white/15 transition-all text-xs"
                    >
                      <div className="flex items-center gap-3 min-w-0 pr-4">
                        <Package className="size-4 text-white/40 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-white font-medium truncate">{m.filename}</p>
                          <p className="text-[10px] text-white/30 font-mono">
                            {(m.file_size / (1024 * 1024)).toFixed(2)} MB
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleToggleMod(m)}
                          className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-all cursor-pointer ${
                            m.is_enabled
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : 'bg-white/5 text-white/30 border border-white/10'
                          }`}
                        >
                          {m.is_enabled ? 'Enabled' : 'Disabled'}
                        </button>

                        <button
                          title="Delete Mod"
                          onClick={() => handleDeleteMod(m.filename)}
                          className="size-7 rounded-full bg-white/[0.04] hover:bg-rose-500/20 text-white/40 hover:text-rose-400 flex items-center justify-center transition-all cursor-pointer"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 3: Live Add Mods Browser */}
        {activeTab === 'browse' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Sticky Fixed Header for Search, Source Toggle, and Stats */}
            <div className="p-6 pb-4 border-b border-white/[0.06] bg-[#0C0C0C] space-y-4 shrink-0 z-10">
              <div className="max-w-5xl mx-auto space-y-4">
                <div className="flex items-center gap-3">
                  <div className="flex bg-white/[0.05] p-1 rounded-full border border-white/[0.08] shrink-0">
                    <button
                      onClick={() => setBrowserSource('modrinth')}
                      className={`px-3.5 py-1 text-xs font-semibold rounded-full transition-all cursor-pointer ${
                        browserSource === 'modrinth' ? 'bg-white text-black shadow-sm' : 'text-white/40 hover:text-white'
                      }`}
                    >
                      Modrinth
                    </button>
                    <button
                      onClick={() => setBrowserSource('curseforge')}
                      className={`px-3.5 py-1 text-xs font-semibold rounded-full transition-all cursor-pointer ${
                        browserSource === 'curseforge' ? 'bg-white text-black shadow-sm' : 'text-white/40 hover:text-white'
                      }`}
                    >
                      CurseForge
                    </button>
                  </div>

                  <div className="relative flex-1">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-3.5 text-white/30" />
                    <input
                      type="text"
                      placeholder={`Search ${browserSource === 'modrinth' ? 'Modrinth' : 'CurseForge'} mods compatible with ${form.loader} ${form.game_version}...`}
                      value={browseQuery}
                      onChange={(e) => setBrowseQuery(e.target.value)}
                      className="w-full bg-white/[0.04] border border-white/[0.08] rounded-full pl-9 pr-4 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-white/30"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-white/40">
                  <span>
                    Filtering for <strong className="text-white/80">{form.loader} {form.game_version}</strong>
                  </span>
                  <span>{browseTotalHits.toLocaleString()} mods found</span>
                </div>
              </div>
            </div>

            {/* Scrollable Mods List Area */}
            <div className="flex-1 overflow-y-auto p-6 md:p-8">
              <div className="max-w-5xl mx-auto space-y-6">
                {browseLoading ? (
                  <div className="py-24 text-center text-xs text-white/40">Searching mods...</div>
                ) : browseHits.length === 0 ? (
                  <div className="py-24 text-center text-xs text-white/30">No matching mods found.</div>
                ) : (
                  <>
                    <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
                      {browseHits.map((mod) => {
                        const isInstalled = installedMods.some((im) =>
                          im.filename.toLowerCase().includes(mod.slug.toLowerCase()) ||
                          im.filename.toLowerCase().includes(mod.title.toLowerCase().replace(/[^a-zA-Z0-9]/g, ''))
                        );
                        const isInstalling = installingProject === mod.project_id;

                        return (
                          <div
                            key={mod.project_id}
                            onClick={() => setSelectedBrowseModDetail(mod)}
                            className="p-4 rounded-2xl bg-white/[0.02] border border-white/[0.06] hover:border-white/15 flex items-start gap-3.5 transition-all cursor-pointer group"
                          >
                            {mod.icon_url ? (
                              <img src={mod.icon_url} alt="" className="size-11 rounded-xl object-cover bg-neutral-900 border border-white/10 shrink-0" />
                            ) : (
                              <div className="size-11 rounded-xl bg-white/[0.04] border border-white/10 flex items-center justify-center text-white/40 shrink-0">
                                <Package className="size-5" />
                              </div>
                            )}

                            <div className="min-w-0 flex-1 space-y-1">
                              <h4 className="text-xs font-semibold text-white truncate">{mod.title}</h4>
                              <p className="text-[11px] text-white/40 line-clamp-2 leading-relaxed">{mod.description}</p>
                              <div className="flex items-center gap-2 pt-1 text-[10px] text-white/30">
                                <span>by {mod.author}</span>
                                <span>•</span>
                                <span>{(mod.downloads / 1_000_000).toFixed(1)}M downloads</span>
                              </div>
                            </div>

                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleInstallBrowseMod(mod);
                              }}
                              disabled={isInstalling || isInstalled}
                              className={`px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 flex items-center gap-1.5 transition-all cursor-pointer ${
                                isInstalled
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                  : isInstalling
                                  ? 'bg-neutral-700 text-white animate-pulse'
                                  : 'bg-white text-black hover:bg-neutral-200'
                              }`}
                            >
                              {isInstalled ? (
                                <>
                                  <CheckCircle2 className="size-3.5" />
                                  <span>Added</span>
                                </>
                              ) : isInstalling ? (
                                <span>Adding...</span>
                              ) : (
                                <>
                                  <Download className="size-3.5" />
                                  <span>Add</span>
                                </>
                              )}
                            </button>
                          </div>
                        );
                      })}
                    </div>

                    {/* Next / Prev Page Controls */}
                    {Math.ceil(browseTotalHits / 20) > 1 && (
                      <div className="pt-6 border-t border-white/[0.06] flex items-center justify-between text-xs text-white/50">
                        <span>
                          Page {browsePage} of {Math.ceil(browseTotalHits / 20)}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            disabled={browsePage <= 1 || browseLoading}
                            onClick={() => fetchBrowseMods(browseQuery, browsePage - 1)}
                            className="size-8 rounded-full border border-white/10 bg-white/[0.04] hover:bg-white/15 disabled:opacity-30 disabled:hover:bg-white/[0.04] flex items-center justify-center transition-all cursor-pointer"
                          >
                            <ChevronLeft className="size-4" />
                          </button>
                          <button
                            disabled={browsePage >= Math.ceil(browseTotalHits / 20) || browseLoading}
                            onClick={() => fetchBrowseMods(browseQuery, browsePage + 1)}
                            className="size-8 rounded-full border border-white/10 bg-white/[0.04] hover:bg-white/15 disabled:opacity-30 disabled:hover:bg-white/[0.04] flex items-center justify-center transition-all cursor-pointer"
                          >
                            <ChevronRight className="size-4" />
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Bottom Action Footer */}
        <div className="h-16 px-6 border-t border-white/[0.07] flex items-center justify-between shrink-0 bg-[#0C0C0C]/80">
          <div className="flex items-center gap-2">
            {isEditing && (
              <button
                type="button"
                onClick={handleOpenInstanceDirectory}
                className="px-3.5 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/15 text-white/70 hover:text-white text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer"
                title="Open Instance Directory in File Explorer"
              >
                <FolderOpen className="size-3.5" />
                <span>Open Folder</span>
              </button>
            )}

            {isEditing && onShareInstance && (
              <button
                type="button"
                onClick={() => onShareInstance(editingInstance)}
                className="px-3.5 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/15 text-white/70 hover:text-white text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <Share2 className="size-3.5" />
                <span>Share Code</span>
              </button>
            )}

            {isEditing && onDeleteInstance && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onDeleteInstance(form.id);
                }}
                className="px-3 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 border border-rose-500/20 text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <Trash2 className="size-3.5" />
                <span>Delete</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium text-white/60 hover:text-white cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={handleSave}
              className="px-6 py-2 rounded-xl bg-white text-black text-xs font-semibold hover:bg-neutral-200 transition-all cursor-pointer shadow-md disabled:bg-neutral-700"
            >
              {isSaving ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Instance'}
            </button>
          </div>
        </div>

        {/* Expanded Mod Detail & Dependencies View inside Advanced Creator/Settings */}
        <ModDetailModal
          mod={selectedBrowseModDetail}
          onClose={() => setSelectedBrowseModDetail(null)}
          onInstall={(modToInstall) => {
            handleInstallBrowseMod(modToInstall);
          }}
          isInstalled={
            selectedBrowseModDetail
              ? installedMods.some(
                  (im) =>
                    im.filename.toLowerCase().includes(selectedBrowseModDetail.slug.toLowerCase()) ||
                    im.filename.toLowerCase().includes(selectedBrowseModDetail.title.toLowerCase().replace(/[^a-zA-Z0-9]/g, ''))
                )
              : false
          }
          isInstalling={selectedBrowseModDetail ? installingProject === selectedBrowseModDetail.project_id : false}
          targetInstanceName={form.name || 'Instance'}
        />
      </div>
    </div>
  );
};
