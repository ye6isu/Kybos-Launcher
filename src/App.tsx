import React, { useState, useEffect, useRef } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  Plus,
  Search,
  Settings,
  Share2,
  FolderOpen,
  Play,
  Check,
  Trash2,
  X,
  ChevronDown,
  Layers,
  Copy,
  Laptop,
  ShieldCheck,
  Users,
  ArrowRight,
  Upload,
  HardDrive,
  Shirt,
  ExternalLink,
  Loader2,
  Package,
  Sparkles,
  KeyRound
} from 'lucide-react';
import { SkinPreview3D } from './components/SkinPreview3D';
import { SkinAvatar } from './components/SkinAvatar';
import { ModBrowser } from './components/ModBrowser';
import { AdvancedInstanceModal } from './components/AdvancedInstanceModal';

export interface Account {
  id: string;
  username: string;
  account_type: 'microsoft' | 'offline';
  uuid: string;
  skin_url?: string;
  skin_model?: string;
  added_at: string;
}

export interface AccountStore {
  active_account_id?: string;
  accounts: Account[];
}

export type ModLoader = 'Vanilla' | 'Fabric' | 'NeoForge' | 'Forge' | 'Quilt';

export interface InstanceConfig {
  id: string;
  name: string;
  game_version: string;
  loader: ModLoader;
  loader_version?: string;
  ram_mb: number;
  custom_jvm_args?: string;
  account_override_id?: string | null;
  banner_url?: string;
  color?: string;
  crop_cover?: boolean;
  created_at: string;
  last_played_at?: string;
}

export interface ModItem {
  filename: string;
  is_enabled: boolean;
  file_size: number;
}

export interface StoragePaths {
  instances_dir: string;
  assets_dir: string;
  data_dir: string;
}

export function App() {
  const [instances, setInstances] = useState<InstanceConfig[]>([]);
  const [accounts, setAccounts] = useState<AccountStore>({ accounts: [] });
  const [storagePaths, setStoragePaths] = useState<StoragePaths | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentView, setCurrentView] = useState<'instances' | 'mods'>('instances');

  const [showAccountDropdown, setShowAccountDropdown] = useState(false);
  const [showGameVersionMenu, setShowGameVersionMenu] = useState(false);
  const [showLoaderMenu, setShowLoaderMenu] = useState(false);
  const [showAccountOverrideMenu, setShowAccountOverrideMenu] = useState(false);

  const gameVersionMenuRef = useRef<HTMLDivElement>(null);
  const loaderMenuRef = useRef<HTMLDivElement>(null);
  const accountOverrideMenuRef = useRef<HTMLDivElement>(null);

  // Click-outside listener for creation dropdowns
  useEffect(() => {
    const handleCreationOutside = (e: MouseEvent) => {
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
    window.addEventListener('mousedown', handleCreationOutside);
    return () => window.removeEventListener('mousedown', handleCreationOutside);
  }, []);
  const accountDropdownRef = useRef<HTMLDivElement>(null);

  // Microsoft OAuth Flow States
  const [msLoginModal, setMsLoginModal] = useState<{
    open: boolean;
    userCode: string;
    verificationUri: string;
    deviceCode: string;
    expiresIn: number;
    interval: number;
  } | null>(null);
  const [isMsAuthenticating, setIsMsAuthenticating] = useState(false);
  const [showAccountManager, setShowAccountManager] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsActiveTab, setSettingsActiveTab] = useState<'storage' | 'apis' | 'about'>('storage');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAdvancedModal, setShowAdvancedModal] = useState<{
    open: boolean;
    instance?: InstanceConfig | null;
  }>({ open: false, instance: null });
  const [showSkinModal, setShowSkinModal] = useState<Account | null>(null);
  const [showShareModal, setShowShareModal] = useState<{ open: boolean; instance?: InstanceConfig; code?: string }>({ open: false });
  const [selectedInstance, setSelectedInstance] = useState<InstanceConfig | null>(null);
  const [instanceMods, setInstanceMods] = useState<ModItem[]>([]);
  const [newOfflineName, setNewOfflineName] = useState('');

  // Custom In-App Modal Dialogs (replacing native alert/confirm popups)
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    message: string;
    confirmText?: string;
    danger?: boolean;
    onConfirm: () => void;
  } | null>(null);

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Skin Changer States
  const [skinPreviewData, setSkinPreviewData] = useState<string>('');
  const [skinModelChoice, setSkinModelChoice] = useState<'classic' | 'slim'>('classic');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [launchingInstanceId, setLaunchingInstanceId] = useState<string | null>(null);
  const [installProgress, setInstallProgress] = useState<{
    title: string;
    status: string;
    percentage: number;
  } | null>(null);
  const [bannerAspectRatios, setBannerAspectRatios] = useState<Record<string, number>>({});

  const handleImageLoad = (instId: string, e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = e.currentTarget;
    if (naturalWidth && naturalHeight) {
      const ratio = naturalWidth / naturalHeight;
      setBannerAspectRatios((prev) => ({ ...prev, [instId]: ratio }));
    }
  };
  const [creationTab, setCreationTab] = useState<'scratch' | 'import'>('scratch');
  const [importShareCode, setImportShareCode] = useState('');
  const [isImporting, setIsImporting] = useState(false);

  const [createForm, setCreateForm] = useState<{
    name: string;
    game_version: string;
    loader: ModLoader;
    ram_mb: number;
    account_override_id?: string;
    color?: string;
  }>({
    name: '',
    game_version: '1.21.1',
    loader: 'Vanilla',
    ram_mb: 4096,
    color: '#1E293B',
  });

  // Global Mod Search Header States (synced with ModBrowser)
  const [modSource, setModSource] = useState<'modrinth' | 'curseforge'>('modrinth');
  const [modQuery, setModQuery] = useState('');
  const [modTargetInstanceId, setModTargetInstanceId] = useState<string>('');
  const [modPageSize, setModPageSize] = useState<25 | 50 | 100>(25);

  // Custom CurseForge API Key in Settings
  const [curseforgeApiKey, setCurseforgeApiKey] = useState('');
  const [isSavingCfKey, setIsSavingCfKey] = useState(false);

  // Unsplash Editorial Cover Settings
  const [unsplashAccessKey, setUnsplashAccessKey] = useState('');
  const [unsplashTopics, setUnsplashTopics] = useState('architecture,nature,wallpapers');
  const [isSavingUnsplash, setIsSavingUnsplash] = useState(false);

  // Helper for contrast text color on Pantone / Swatch cards
  const getContrastColor = (hexColor?: string): 'text-white' | 'text-neutral-900' => {
    if (!hexColor) return 'text-white';
    const hex = hexColor.replace('#', '');
    if (hex.length < 6) return 'text-white';
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.55 ? 'text-neutral-900' : 'text-white';
  };

  // Disable right-click context menu throughout launcher
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    window.addEventListener('contextmenu', handleContextMenu);
    return () => window.removeEventListener('contextmenu', handleContextMenu);
  }, []);

  const loadData = async () => {
    try {
      const accs = await invoke<AccountStore>('get_accounts');
      setAccounts(accs);
      const insts = await invoke<InstanceConfig[]>('list_instances');
      setInstances(insts);
      const paths = await invoke<StoragePaths>('get_storage_paths');
      setStoragePaths(paths);
      const cfKey = await invoke<string>('get_curseforge_api_key').catch(() => '');
      setCurseforgeApiKey(cfKey);
      const unsplashConf = await invoke<{ access_key: string; topics: string }>('get_unsplash_config').catch(() => ({
        access_key: '',
        topics: 'architecture,nature,wallpapers',
      }));
      setUnsplashAccessKey(unsplashConf?.access_key || '');
      setUnsplashTopics(unsplashConf?.topics || 'architecture,nature,wallpapers');
      setIsLoaded(true);
    } catch (e) {
      console.error('Failed to load data:', e);
      setIsLoaded(true);
    }
  };

  useEffect(() => {
    loadData();

    // Listen for launcher provisioning & game asset download progress events from backend
    const unlistenPromise = listen<{ title?: string; status: string; percentage: number }>('game-install-progress', (event) => {
      setInstallProgress({
        title: event.payload.title || 'Preparing Minecraft',
        status: event.payload.status,
        percentage: event.payload.percentage,
      });
      if (event.payload.percentage >= 100) {
        setTimeout(() => setInstallProgress(null), 1500);
      }
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  // Click-outside listener to close the profile dropdown menu
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        accountDropdownRef.current &&
        !accountDropdownRef.current.contains(e.target as Node)
      ) {
        setShowAccountDropdown(false);
      }
    };
    if (showAccountDropdown) {
      window.addEventListener('mousedown', handleOutsideClick);
    }
    return () => window.removeEventListener('mousedown', handleOutsideClick);
  }, [showAccountDropdown]);

  // Microsoft OAuth Polling Effect
  useEffect(() => {
    if (!msLoginModal || !msLoginModal.open) return;

    let isCancelled = false;
    const intervalMs = Math.max((msLoginModal.interval || 5) * 1000, 3000);

    const pollTimer = setInterval(async () => {
      if (isCancelled) return;
      try {
        const result = await invoke<Account | null>('check_microsoft_login', {
          deviceCode: msLoginModal.deviceCode,
        });

        if (result && !isCancelled) {
          clearInterval(pollTimer);
          setMsLoginModal(null);
          showToast(`Welcome, ${result.username}! Account linked.`);
          await loadData();
        }
      } catch (err) {
        console.error('Polling check failed:', err);
      }
    }, intervalMs);

    return () => {
      isCancelled = true;
      clearInterval(pollTimer);
    };
  }, [msLoginModal]);

  const startMicrosoftLoginFlow = async () => {
    setIsMsAuthenticating(true);
    try {
      const codeResp = await invoke<{
        device_code: string;
        user_code: string;
        verification_uri: string;
        expires_in: number;
        interval: number;
        message: string;
      }>('start_microsoft_login');

      setMsLoginModal({
        open: true,
        userCode: codeResp.user_code,
        verificationUri: codeResp.verification_uri,
        deviceCode: codeResp.device_code,
        expiresIn: codeResp.expires_in,
        interval: codeResp.interval,
      });

      // Try opening the verification URL in system browser
      try {
        await invoke('open_path_in_explorer', { path: codeResp.verification_uri });
      } catch {
        // Fallback: window.open
        window.open(codeResp.verification_uri, '_blank');
      }
    } catch (err) {
      showToast(`Microsoft login failed to initiate: ${err}`);
    } finally {
      setIsMsAuthenticating(false);
    }
  };

  const currentAccount = accounts.accounts.find((a) => a.id === accounts.active_account_id) || accounts.accounts[0];

  const handleSaveAdvancedInstance = async (config: InstanceConfig) => {
    try {
      if (config.id) {
        await invoke('update_instance', { config });
        showToast('Instance updated!');
      } else {
        await invoke('create_instance', { config });
        showToast('Instance created!');
      }
      setShowAdvancedModal({ open: false, instance: null });
      await loadData();
    } catch (err) {
      showToast(`Error saving instance: ${err}`);
      throw err;
    }
  };

  const handleLaunchInstance = async (id: string, _name: string) => {
    setLaunchingInstanceId(id);
    try {
      const res = await invoke<string>('launch_instance', { instanceId: id });
      showToast(res);
    } catch (err) {
      showToast(`Launch error: ${err}`);
      setInstallProgress(null);
    } finally {
      setLaunchingInstanceId(null);
    }
  };

  const handleImportInstance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importShareCode.trim()) return;

    setIsImporting(true);
    try {
      await invoke('import_instance_from_share_code', { shareCode: importShareCode.trim() });
      setShowCreateModal(false);
      setImportShareCode('');
      showToast('Instance imported successfully!');
      await loadData();
    } catch (err) {
      showToast(`Import failed: ${err}`);
    } finally {
      setIsImporting(false);
    }
  };

  const handleCreateInstance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.name.trim()) return;

    try {
      await invoke('create_instance', {
        config: {
          id: '',
          name: createForm.name,
          game_version: createForm.game_version,
          loader: createForm.loader,
          ram_mb: createForm.ram_mb,
          account_override_id: createForm.account_override_id || null,
          banner_url: null,
          color: createForm.color || '#1E293B',
          created_at: new Date().toISOString(),
          last_played_at: null,
        },
      });
      setShowCreateModal(false);
      setCreateForm({ name: '', game_version: '1.21.1', loader: 'Vanilla', ram_mb: 4096, color: '#1E293B' });
      showToast('Instance created!');
      await loadData();
    } catch (err) {
      showToast(`Error creating instance: ${err}`);
    }
  };

  const handleDeleteInstance = (id: string) => {
    setConfirmDialog({
      open: true,
      title: 'Delete Instance',
      message: 'Permanently delete this instance? Its folder, configuration, and mods will be completely removed from disk.',
      confirmText: 'Delete Permanently',
      danger: true,
      onConfirm: async () => {
        try {
          await invoke('delete_instance', { instanceId: id });
          if (selectedInstance?.id === id) setSelectedInstance(null);
          showToast('Instance deleted.');
          await loadData();
        } catch (err) {
          showToast(`Error deleting instance: ${err}`);
        }
        setConfirmDialog(null);
      },
    });
  };

  const handleOpenModsFolder = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await invoke('open_instance_mods_folder', { instanceId: id });
    } catch (err) {
      showToast(`Could not open folder: ${err}`);
    }
  };

  const handleOpenFolder = async (path: string) => {
    try {
      await invoke('open_path_in_explorer', { path });
    } catch (err) {
      showToast(`Could not open folder: ${err}`);
    }
  };

  const handleSelectCustomPath = async (pathType: 'instances' | 'assets') => {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: pathType === 'instances' ? 'Select Instances Directory' : 'Select Assets Directory',
      });

      if (selected && typeof selected === 'string') {
        const updated = await invoke<StoragePaths>('set_storage_path', {
          pathType,
          newPath: selected,
        });
        setStoragePaths(updated);
        showToast('Storage path updated successfully!');
      }
    } catch (err) {
      showToast(`Failed to select directory: ${err}`);
    }
  };

  const handleShareInstance = async (inst: InstanceConfig, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      const code = await invoke<string>('export_instance_share_code', { instanceId: inst.id });
      setShowShareModal({ open: true, instance: inst, code });
    } catch (err) {
      showToast(`Could not generate share code: ${err}`);
    }
  };

  const handleSelectInstance = async (inst: InstanceConfig) => {
    setSelectedInstance(inst);
    try {
      const mods = await invoke<ModItem[]>('list_instance_mods', { instanceId: inst.id });
      setInstanceMods(mods);
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleMod = async (mod: ModItem) => {
    if (!selectedInstance) return;
    try {
      await invoke('toggle_instance_mod', {
        instanceId: selectedInstance.id,
        filename: mod.filename,
        enable: !mod.is_enabled,
      });
      const mods = await invoke<ModItem[]>('list_instance_mods', { instanceId: selectedInstance.id });
      setInstanceMods(mods);
    } catch (err) {
      showToast(`Toggle failed: ${err}`);
    }
  };

  const handleAddOfflineAccount = async (nameToAdd?: string) => {
    const name = (nameToAdd || newOfflineName).trim();
    if (!name) return;
    try {
      await invoke('add_offline_account', { username: name });
      setNewOfflineName('');
      showToast(`Account @${name} added.`);
      await loadData();
    } catch (err) {
      showToast(`Failed to add account: ${err}`);
    }
  };

  const handleRemoveAccount = (id: string) => {
    setConfirmDialog({
      open: true,
      title: 'Remove Profile',
      message: 'Remove this account from Kybos Launcher?',
      confirmText: 'Remove Profile',
      danger: true,
      onConfirm: async () => {
        try {
          await invoke('remove_account', { accountId: id });
          showToast('Account removed.');
          await loadData();
        } catch (err) {
          showToast(`Failed to remove account: ${err}`);
        }
        setConfirmDialog(null);
      },
    });
  };

  const handleSetActiveAccount = async (id: string) => {
    try {
      await invoke('set_active_account', { accountId: id });
      await loadData();
    } catch (err) {
      showToast(`Failed to set active account: ${err}`);
    }
  };

  const handleOpenSkinModal = (acc: Account) => {
    setShowSkinModal(acc);
    setSkinPreviewData(acc.skin_url || '');
    setSkinModelChoice((acc.skin_model as 'classic' | 'slim') || 'classic');
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setSkinPreviewData(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveSkin = async () => {
    if (!showSkinModal || !skinPreviewData) return;
    try {
      await invoke('update_account_skin', {
        accountId: showSkinModal.id,
        skinUrl: skinPreviewData,
        skinModel: skinModelChoice,
      });
      setShowSkinModal(null);
      setSkinPreviewData('');
      showToast('Custom skin saved successfully!');
      await loadData();
    } catch (err) {
      showToast(`Failed to update skin: ${err}`);
    }
  };

  const handleUpdateOverride = async (accountId?: string) => {
    if (!selectedInstance) return;
    const updated: InstanceConfig = { ...selectedInstance, account_override_id: accountId || null };
    try {
      await invoke('update_instance', { config: updated });
      setSelectedInstance(updated);
      await loadData();
    } catch (err) {
      showToast(`Failed to update account: ${err}`);
    }
  };

  const filteredInstances = instances.filter((inst) => {
    return inst.name.toLowerCase().includes(searchQuery.toLowerCase()) || inst.game_version.includes(searchQuery);
  });

  // Responsive Masonry Column balancing:
  // Detects viewport width to know number of columns (1 to 5).
  // Then greedily distributes instances into whichever column currently has the smallest accumulated height.
  const [columnCount, setColumnCount] = useState(5);

  useEffect(() => {
    const updateColumns = () => {
      const width = window.innerWidth;
      if (width >= 1536) setColumnCount(5);      // 2xl
      else if (width >= 1024) setColumnCount(4); // lg
      else if (width >= 768) setColumnCount(3);  // md
      else if (width >= 640) setColumnCount(2);  // sm
      else setColumnCount(1);
    };

    updateColumns();
    window.addEventListener('resize', updateColumns);
    return () => window.removeEventListener('resize', updateColumns);
  }, []);

  // Balanced Column Distribution
  const masonryColumns = React.useMemo(() => {
    const cols: InstanceConfig[][] = Array.from({ length: columnCount }, () => []);
    const colHeights: number[] = Array.from({ length: columnCount }, () => 0);

    // Approximate card height units based on aspect ratio or fixed h-64 (256px)
    // Assume base column width ~ 280px
    filteredInstances.forEach((inst) => {
      const hasBanner = !!inst.banner_url;
      const ratio = bannerAspectRatios[inst.id];
      const shouldCropUniform = !!inst.crop_cover;

      let estHeight = 256; // Standard card height in px (h-64)
      if (hasBanner && !shouldCropUniform && ratio && ratio > 0) {
        // height = width / ratio
        estHeight = Math.max(160, Math.min(500, Math.round(280 / ratio)));
      }

      // Find the column index with the minimum accumulated height
      let minColIndex = 0;
      let minHeight = colHeights[0];
      for (let i = 1; i < columnCount; i++) {
        if (colHeights[i] < minHeight) {
          minHeight = colHeights[i];
          minColIndex = i;
        }
      }

      cols[minColIndex].push(inst);
      colHeights[minColIndex] += estHeight + 20; // 20px for gap-5
    });

    return cols;
  }, [filteredInstances, columnCount, bannerAspectRatios]);

  // Onboarding screen when 0 accounts exist
  if (isLoaded && accounts.accounts.length === 0) {
    return (
      <div className="h-screen w-screen bg-[#070707] text-[#FAFAFA] flex flex-col items-center justify-center p-8 select-none">
        <div className="max-w-md w-full border border-white/[0.08] bg-[#0E0E0E] rounded-3xl p-8 space-y-8 shadow-2xl backdrop-blur-2xl text-center">
          <div className="size-10 bg-white text-black flex items-center justify-center font-bold text-base rounded-[8px] shadow-md tracking-tighter mx-auto">
            KY
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight text-white">Welcome to Kybos</h1>
            <p className="text-xs text-white/40 leading-relaxed">
              To launch Minecraft and manage your instances, add your Minecraft account or start with an offline profile.
            </p>
          </div>

          <div className="space-y-3 pt-2">
            <button
              onClick={startMicrosoftLoginFlow}
              disabled={isMsAuthenticating}
              className="w-full py-3 px-4 rounded-2xl bg-white text-black hover:bg-neutral-200 text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md active:scale-98 disabled:opacity-50"
            >
              {isMsAuthenticating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ShieldCheck className="size-4" />
              )}
              <span>{isMsAuthenticating ? 'Starting...' : 'Sign in with Microsoft'}</span>
            </button>

            <div className="pt-4 border-t border-white/[0.06] space-y-2 text-left">
              <label className="text-[11px] font-medium text-white/50 block">Or create an Offline Dev profile</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Player username..."
                  value={newOfflineName}
                  onChange={(e) => setNewOfflineName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddOfflineAccount()}
                  className="flex-1 bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-white/30"
                />
                <button
                  onClick={() => handleAddOfflineAccount()}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-medium flex items-center gap-1.5 transition-all"
                >
                  <span>Continue</span>
                  <ArrowRight className="size-3" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-screen w-screen flex-col bg-[#070707] text-[#FAFAFA] font-sans select-none overflow-hidden antialiased">
      {/* Cosmos Navigation Bar */}
      <header className="relative h-16 px-6 bg-[#070707] flex items-center justify-between shrink-0 z-30">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2.5 cursor-pointer">
            <div className="size-7 bg-white text-black flex items-center justify-center font-bold text-xs rounded-[6px] shadow-sm tracking-tighter">
              KY
            </div>
            <span className="font-semibold text-sm tracking-tight text-white/95">Kybos</span>
          </div>

          {/* Cosmos Minimal Text Navigation */}
          <nav className="flex items-center gap-5 ml-2">
            <button
              onClick={() => setCurrentView('instances')}
              className={`text-xs font-semibold tracking-tight transition-colors cursor-pointer ${
                currentView === 'instances' ? 'text-white' : 'text-white/40 hover:text-white/80'
              }`}
            >
              Instance
            </button>
            <button
              onClick={() => setCurrentView('mods')}
              className={`text-xs font-semibold tracking-tight transition-colors cursor-pointer ${
                currentView === 'mods' ? 'text-white' : 'text-white/40 hover:text-white/80'
              }`}
            >
              Mods
            </button>
          </nav>
        </div>

        {/* Center: Search Bar - Exactly Centered at left-1/2 -translate-x-1/2 with w-80 max-w-sm */}
        <div className="absolute left-1/2 -translate-x-1/2 w-80 max-w-sm">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-3.5 text-white/30" />
          {currentView === 'instances' ? (
            <input
              type="text"
              placeholder="Search instances, versions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-full pl-9 pr-4 py-1.5 text-xs text-white placeholder-white/30 outline-none focus:border-white/30 transition-all text-center focus:text-left"
            />
          ) : (
            <input
              type="text"
              placeholder={`Search ${modSource === 'modrinth' ? 'Modrinth' : 'CurseForge'} mods...`}
              value={modQuery}
              onChange={(e) => setModQuery(e.target.value)}
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-full pl-9 pr-4 py-1.5 text-xs text-white placeholder-white/30 outline-none focus:border-white/30 transition-all text-center focus:text-left"
            />
          )}
        </div>

        {/* Right: Actions & Profile */}
        <div className="flex items-center gap-3">
          {currentView === 'instances' && (
            <button
              onClick={() => {
                setCreateForm({
                  name: '',
                  game_version: '1.21.1',
                  loader: 'Vanilla',
                  ram_mb: 4096,
                  color: '#1E293B',
                  account_override_id: undefined,
                });
                setShowCreateModal(true);
              }}
              className="inline-flex items-center gap-1.5 bg-white text-black text-xs font-medium px-4 py-1.5 rounded-full hover:bg-neutral-200 transition-all cursor-pointer active:scale-98 shadow-sm"
            >
              <Plus className="size-3.5" />
              <span>Create</span>
            </button>
          )}

          <div className="relative" ref={accountDropdownRef}>
            <button
              onClick={() => setShowAccountDropdown(!showAccountDropdown)}
              className="flex items-center gap-2 pl-1.5 pr-3 py-1 rounded-full bg-white/[0.05] border border-white/[0.08] hover:border-white/20 transition-all cursor-pointer"
            >
              {currentAccount ? (
                <SkinAvatar
                  skinUrl={currentAccount.skin_url}
                  uuid={currentAccount.uuid}
                  username={currentAccount.username}
                  size={24}
                />
              ) : (
                <div className="size-6 rounded-full bg-neutral-800 flex items-center justify-center">
                  <Laptop className="size-3 text-white/50" />
                </div>
              )}
              <span className="text-xs font-medium text-white/80 max-w-[90px] truncate">
                {currentAccount ? currentAccount.username : 'No Profile'}
              </span>
              <ChevronDown className="size-3 text-white/40" />
            </button>

            {/* Cosmos Floating Dropdown Menu */}
            {showAccountDropdown && (
              <div className="absolute right-0 mt-2 w-76 bg-[#121212]/95 border border-white/[0.1] rounded-2xl p-2 shadow-2xl backdrop-blur-3xl z-50 animate-in fade-in zoom-in-95 duration-100">
                <div className="px-3 py-2.5 border-b border-white/[0.06] mb-1 flex items-center justify-between">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <SkinAvatar
                      skinUrl={currentAccount?.skin_url}
                      uuid={currentAccount?.uuid}
                      username={currentAccount?.username}
                      size={32}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white truncate">
                        {currentAccount ? currentAccount.username : 'Guest'}
                      </p>
                      <span className="inline-block px-1.5 py-0.2 bg-white/10 rounded text-[9px] text-white/60 capitalize">
                        {currentAccount?.account_type}
                      </span>
                    </div>
                  </div>

                  {currentAccount && (
                    <button
                      title="Change Skin"
                      onClick={() => {
                        setShowAccountDropdown(false);
                        handleOpenSkinModal(currentAccount);
                      }}
                      className="size-7 rounded-full bg-white/[0.05] hover:bg-white/15 text-white/60 hover:text-white flex items-center justify-center transition-all cursor-pointer"
                    >
                      <Shirt className="size-3.5" />
                    </button>
                  )}
                </div>

                <div className="max-h-48 overflow-y-auto py-1">
                  <p className="px-3 py-1 text-[10px] font-semibold tracking-wider uppercase text-white/30">Switch Profile</p>
                  {accounts.accounts.map((acc) => (
                    <button
                      key={acc.id}
                      onClick={() => handleSetActiveAccount(acc.id)}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs text-left hover:bg-white/[0.06] transition-all text-white/80 cursor-pointer"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <SkinAvatar
                          skinUrl={acc.skin_url}
                          uuid={acc.uuid}
                          username={acc.username}
                          size={20}
                        />
                        <span className="truncate">{acc.username}</span>
                      </div>
                      {acc.id === currentAccount?.id && <Check className="size-3.5 text-white" />}
                    </button>
                  ))}
                </div>

                <div className="border-t border-white/[0.06] pt-1 mt-1 space-y-0.5">
                  <button
                    onClick={() => {
                      setShowAccountDropdown(false);
                      setShowAccountManager(true);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-white/70 hover:text-white hover:bg-white/[0.06] transition-all cursor-pointer"
                  >
                    <Users className="size-3.5" />
                    <span>Manage Accounts</span>
                  </button>

                  <button
                    onClick={() => {
                      setShowAccountDropdown(false);
                      setShowSettingsModal(true);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-white/70 hover:text-white hover:bg-white/[0.06] transition-all cursor-pointer"
                  >
                    <Settings className="size-3.5" />
                    <span>Settings & Storage</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area: Both Views kept mounted with hidden class to preserve scroll and state */}
      <div className={`flex-1 flex overflow-hidden ${currentView === 'mods' ? 'flex' : 'hidden'}`}>
        <ModBrowser
          instances={instances}
          selectedInstanceId={modTargetInstanceId || selectedInstance?.id}
          onSelectInstance={(id) => setModTargetInstanceId(id)}
          source={modSource}
          query={modQuery}
          pageSize={modPageSize}
          onSourceChange={setModSource}
          onPageSizeChange={setModPageSize}
          onModInstalled={() => {
            loadData();
            if (selectedInstance) {
              handleSelectInstance(selectedInstance);
            }
          }}
          showToast={showToast}
        />
      </div>

      <div className={`flex-1 flex overflow-hidden relative ${currentView === 'instances' ? 'flex' : 'hidden'}`}>
        {filteredInstances.length > 0 ? (
          <main className="flex-1 overflow-y-auto px-6 py-6">
            <div className="w-full">
              {/* Balanced Cosmos Masonry Layout:
                  Instances are dynamically assigned to whichever column currently has the least height.
                  If you have 5 instances in fullscreen, each occupies its own column across all 5 columns.
                  Subsequent taller/shorter instances fill the shortest column first for balanced alignment. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-5 items-start">
                {masonryColumns.map((colInstances, colIdx) => (
                  <div key={colIdx} className="flex flex-col gap-5 min-w-0">
                    {colInstances.map((inst) => {
                      const isSelected = selectedInstance?.id === inst.id;
                      const overrideAccount = accounts.accounts.find((a) => a.id === inst.account_override_id);
                      const contrastTextColor = getContrastColor(inst.color);
                      const hasCustomColor = !!inst.color;
                      const hasBanner = !!inst.banner_url;
                      const customRatio = bannerAspectRatios[inst.id];
                      const shouldCropUniform = !!inst.crop_cover;

                      return (
                        <div
                          key={inst.id}
                          onClick={() => handleLaunchInstance(inst.id, inst.name)}
                          style={{
                            backgroundColor: hasCustomColor && !hasBanner ? inst.color : undefined,
                            aspectRatio: hasBanner && !shouldCropUniform && customRatio ? `${customRatio}` : undefined,
                          }}
                          className={`group relative flex flex-col justify-between border transition-all duration-300 cursor-pointer overflow-hidden p-6 ${
                            hasBanner
                              ? shouldCropUniform
                                ? 'h-64 rounded-lg border-white/10 hover:border-white/30 bg-[#0E0E0E]'
                                : 'rounded-lg border-white/10 hover:border-white/30 bg-[#0E0E0E]'
                              : 'h-64 rounded-3xl border-white/[0.08] hover:border-white/25'
                          } ${
                            isSelected ? 'ring-2 ring-white/50 shadow-xl' : 'hover:shadow-lg'
                          } ${!hasCustomColor && !hasBanner ? 'bg-[#0E0E0E]' : ''}`}
                        >
                          {/* Banner Image Cover - respects natural aspect ratio unless crop_cover is selected */}
                          {hasBanner && (
                            <div className="absolute inset-0 z-0">
                              <img
                                src={inst.banner_url}
                                alt=""
                                onLoad={(e) => handleImageLoad(inst.id, e)}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                              />
                            </div>
                          )}

                          <div className="flex items-start justify-between z-10">
                            <h2 className={`text-xl font-bold tracking-tight leading-snug drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] ${hasBanner ? 'text-white' : contrastTextColor}`}>
                              {inst.name}
                            </h2>

                            {overrideAccount && (
                              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-black/40 text-white backdrop-blur-md border border-white/20 shadow-md">
                                <SkinAvatar
                                  skinUrl={overrideAccount.skin_url}
                                  uuid={overrideAccount.uuid}
                                  username={overrideAccount.username}
                                  size={14}
                                />
                                <span>@{overrideAccount.username}</span>
                              </div>
                            )}
                          </div>

                          <div className="absolute inset-0 bg-radial from-white/[0.02] to-transparent pointer-events-none" />

                          {/* Bottom area: Clean and simple (just name when unhovered); shows rounded icon buttons on hover */}
                          <div className="flex items-end justify-end z-10 min-h-[36px]">
                            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                              <button
                                title="Share Instance"
                                onClick={(e) => handleShareInstance(inst, e)}
                                className="size-9 rounded-full border border-white/20 bg-black/40 hover:bg-black/60 text-white flex items-center justify-center transition-all cursor-pointer backdrop-blur-md active:scale-95 shadow-md"
                              >
                                <Share2 className="size-4" />
                              </button>

                              <button
                                title="Settings & Mods"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShowAdvancedModal({ open: true, instance: inst });
                                }}
                                className="size-9 rounded-full border border-white/20 bg-black/40 hover:bg-black/60 text-white flex items-center justify-center transition-all cursor-pointer backdrop-blur-md active:scale-95 shadow-md"
                              >
                                <Settings className="size-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </main>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center justify-center text-center max-w-sm space-y-4">
              <div className="size-14 rounded-2xl bg-white/[0.03] flex items-center justify-center mx-auto text-white/40">
                <Layers className="size-7" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-medium text-white/90">No instances found</h3>
                <p className="text-xs text-white/40">
                  {searchQuery ? 'Try matching another search query' : 'Create your first Minecraft profile to start playing.'}
                </p>
              </div>
              {!searchQuery && (
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-white text-black text-xs font-medium rounded-full hover:bg-neutral-200 transition-all cursor-pointer active:scale-95 shadow-sm"
                >
                  <Plus className="size-3.5" />
                  <span>Create Instance</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Selected Instance Detail Workspace Drawer */}
        {selectedInstance && (
          <aside className="w-96 border-l border-white/[0.07] bg-[#0A0A0A] p-6 flex flex-col justify-between shrink-0 overflow-y-auto z-20">
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-white tracking-tight">{selectedInstance.name}</h3>
                  <p className="text-xs text-white/40 mt-0.5">
                    {selectedInstance.loader} {selectedInstance.game_version}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedInstance(null)}
                  className="size-7 rounded-full bg-white/[0.05] hover:bg-white/10 text-white/50 hover:text-white flex items-center justify-center transition-all cursor-pointer"
                >
                  <X className="size-3.5" />
                </button>
              </div>

              <button
                disabled={launchingInstanceId === selectedInstance.id}
                onClick={() => handleLaunchInstance(selectedInstance.id, selectedInstance.name)}
                className={`w-full py-3 text-xs font-semibold rounded-2xl transition-all flex items-center justify-center gap-2 shadow-lg active:scale-98 cursor-pointer ${
                  launchingInstanceId === selectedInstance.id
                    ? 'bg-neutral-700 text-white animate-pulse'
                    : 'bg-white text-black hover:bg-neutral-200'
                }`}
              >
                <Play className="size-4 fill-current" />
                <span>{launchingInstanceId === selectedInstance.id ? 'LAUNCHING...' : 'PLAY NOW'}</span>
              </button>

              <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-white/70">Launch Account</label>
                  <span className="text-[10px] text-white/30">Instance Override</span>
                </div>
                <select
                  value={selectedInstance.account_override_id || ''}
                  onChange={(e) => handleUpdateOverride(e.target.value || undefined)}
                  className="w-full bg-neutral-900 border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none cursor-pointer"
                >
                  <option value="">Default (Current: {currentAccount?.username || 'None'})</option>
                  {accounts.accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.username} ({acc.account_type})
                    </option>
                  ))}
                </select>
              </div>

              <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] space-y-3">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-medium text-white/70">RAM Allocation</span>
                  <span className="font-mono text-white/90">{(selectedInstance.ram_mb / 1024).toFixed(1)} GB</span>
                </div>
                <input
                  type="range"
                  min={2048}
                  max={16384}
                  step={1024}
                  value={selectedInstance.ram_mb}
                  onChange={(e) => {
                    const ram = Number(e.target.value);
                    const updated = { ...selectedInstance, ram_mb: ram };
                    setSelectedInstance(updated);
                    invoke('update_instance', { config: updated });
                  }}
                  className="w-full accent-white"
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-white/70">Installed Mods ({instanceMods.length})</span>
                  <button
                    onClick={() => handleOpenModsFolder(selectedInstance.id)}
                    className="text-[11px] text-white/50 hover:text-white flex items-center gap-1 transition-all cursor-pointer"
                  >
                    <FolderOpen className="size-3" />
                    <span>Open Folder</span>
                  </button>
                </div>

                <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
                  {instanceMods.length === 0 ? (
                    <div className="text-center py-6 border border-dashed border-white/[0.06] rounded-xl text-xs text-white/30">
                      No mods installed. Drag `.jar` files into the folder.
                    </div>
                  ) : (
                    instanceMods.map((mod) => (
                      <div
                        key={mod.filename}
                        className="flex items-center justify-between p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.04] text-xs"
                      >
                        <span className="truncate max-w-[180px] text-white/80">{mod.filename}</span>
                        <button
                          onClick={() => handleToggleMod(mod)}
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-all cursor-pointer ${
                            mod.is_enabled
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : 'bg-white/5 text-white/30 border border-white/10'
                          }`}
                        >
                          {mod.is_enabled ? 'ENABLED' : 'DISABLED'}
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="pt-6 border-t border-white/[0.07]">
              <button
                onClick={() => handleDeleteInstance(selectedInstance.id)}
                className="w-full py-2.5 rounded-xl border border-rose-500/20 bg-rose-500/5 hover:bg-rose-500/10 text-rose-400 text-xs font-medium transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="size-3.5" />
                <span>Delete Instance Permanently</span>
              </button>
            </div>
          </aside>
        )}
      </div>

      {/* Account Manager Modal */}
      {showAccountManager && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xl flex items-center justify-center z-50 p-4">
          <div className="bg-[#111111] border border-white/10 rounded-3xl max-w-lg w-full p-6 space-y-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <h3 className="text-base font-semibold text-white">Manage Accounts</h3>
                <p className="text-xs text-white/40">Add Microsoft or Offline accounts and switch active profiles.</p>
              </div>
              <button onClick={() => setShowAccountManager(false)} className="text-white/40 hover:text-white cursor-pointer">
                <X className="size-4" />
              </button>
            </div>

            {/* Quick Add Actions */}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={startMicrosoftLoginFlow}
                disabled={isMsAuthenticating}
                className="p-3 rounded-2xl bg-white/[0.04] border border-white/[0.08] hover:border-white/20 text-left transition-all cursor-pointer disabled:opacity-50"
              >
                {isMsAuthenticating ? (
                  <Loader2 className="size-4 text-emerald-400 mb-1.5 animate-spin" />
                ) : (
                  <ShieldCheck className="size-4 text-emerald-400 mb-1.5" />
                )}
                <p className="text-xs font-medium text-white">Microsoft Account</p>
                <p className="text-[10px] text-white/40 mt-0.5">Xbox Live & Official</p>
              </button>

              <div className="p-3 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex flex-col justify-between">
                <div>
                  <Laptop className="size-4 text-white/50 mb-1.5" />
                  <p className="text-xs font-medium text-white">Add Offline Profile</p>
                </div>
                <div className="flex gap-1.5 mt-2">
                  <input
                    type="text"
                    placeholder="Username..."
                    value={newOfflineName}
                    onChange={(e) => setNewOfflineName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddOfflineAccount()}
                    className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-2 py-1 text-xs text-white outline-none"
                  />
                  <button
                    onClick={() => handleAddOfflineAccount()}
                    className="px-2.5 py-1 bg-white text-black text-xs font-semibold rounded-lg hover:bg-neutral-200 cursor-pointer"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>

            {/* Existing Accounts List */}
            <div className="space-y-2">
              <p className="text-[11px] font-semibold tracking-wider uppercase text-white/30">Your Profiles</p>
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {accounts.accounts.map((acc) => {
                  const isActive = acc.id === currentAccount?.id;
                  return (
                    <div
                      key={acc.id}
                      className={`flex items-center justify-between p-3 rounded-2xl border transition-all ${
                        isActive ? 'bg-white/[0.07] border-white/20' : 'bg-white/[0.02] border-white/[0.05]'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <SkinAvatar
                          skinUrl={acc.skin_url}
                          uuid={acc.uuid}
                          username={acc.username}
                          size={32}
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-white truncate">{acc.username}</p>
                          <span className="inline-block px-1.5 py-0.2 bg-white/10 rounded text-[9px] text-white/50 capitalize">
                            {acc.account_type}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {isActive ? (
                          <span className="px-2.5 py-1 rounded-full text-[10px] font-medium bg-white/15 text-white">
                            Active
                          </span>
                        ) : (
                          <button
                            onClick={() => handleSetActiveAccount(acc.id)}
                            className="px-2.5 py-1 rounded-full text-[10px] font-medium bg-white/[0.05] hover:bg-white/15 text-white/70 hover:text-white transition-all cursor-pointer"
                          >
                            Set Active
                          </button>
                        )}

                        <button
                          title="Change Skin"
                          onClick={() => {
                            setShowAccountManager(false);
                            handleOpenSkinModal(acc);
                          }}
                          className="size-7 rounded-full bg-white/[0.05] hover:bg-white/15 text-white/50 hover:text-white flex items-center justify-center transition-all cursor-pointer"
                        >
                          <Shirt className="size-3" />
                        </button>

                        <button
                          title="Remove Account"
                          onClick={() => handleRemoveAccount(acc.id)}
                          className="size-7 rounded-full bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 flex items-center justify-center transition-all cursor-pointer"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setShowAccountManager(false)}
                className="px-4 py-2 rounded-xl bg-white text-black text-xs font-medium hover:bg-neutral-200 cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Skin Changer Modal with 3D Interactive Model Preview */}
      {showSkinModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xl flex items-center justify-center z-50 p-4">
          <div className="bg-[#111111] border border-white/10 rounded-3xl max-w-sm w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-white">Change Skin (@{showSkinModal.username})</h3>
              <button onClick={() => setShowSkinModal(null)} className="text-white/40 hover:text-white cursor-pointer">
                <X className="size-4" />
              </button>
            </div>

            {/* 3D Skin Preview Container */}
            <SkinPreview3D
              skinUrl={skinPreviewData || showSkinModal.skin_url || ''}
              model={skinModelChoice}
              width={260}
              height={260}
            />

            {/* Model Selector Pill */}
            <div className="space-y-1.5">
              <label className="text-xs text-white/60 block">Skin Model</label>
              <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-white/[0.04] border border-white/[0.06]">
                <button
                  type="button"
                  onClick={() => setSkinModelChoice('classic')}
                  className={`py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer ${
                    skinModelChoice === 'classic'
                      ? 'bg-white text-black shadow-sm'
                      : 'text-white/40 hover:text-white'
                  }`}
                >
                  Classic (Steve)
                </button>
                <button
                  type="button"
                  onClick={() => setSkinModelChoice('slim')}
                  className={`py-1.5 text-xs font-medium rounded-lg transition-all cursor-pointer ${
                    skinModelChoice === 'slim'
                      ? 'bg-white text-black shadow-sm'
                      : 'text-white/40 hover:text-white'
                  }`}
                >
                  Slim (Alex)
                </button>
              </div>
            </div>

            {/* File Upload Trigger */}
            <div className="space-y-1.5">
              <label className="text-xs text-white/60 block">Upload Skin PNG</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png"
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-2.5 px-3 rounded-xl border border-dashed border-white/20 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/40 text-xs text-white/70 flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <Upload className="size-3.5" />
                <span>Choose .png file from disk</span>
              </button>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowSkinModal(null)}
                className="px-3 py-1.5 rounded-xl text-xs text-white/50 hover:text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveSkin}
                disabled={!skinPreviewData}
                className="px-4 py-1.5 rounded-xl bg-white text-black text-xs font-semibold hover:bg-neutral-200 disabled:bg-neutral-600 cursor-pointer"
              >
                Save Skin
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create / Import Instance Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xl flex items-center justify-center z-50 p-4">
          <div className="bg-[#111111] border border-white/10 rounded-3xl max-w-md w-full p-6 space-y-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 bg-white/[0.04] p-1 rounded-full border border-white/[0.06]">
                <button
                  onClick={() => setCreationTab('scratch')}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-all cursor-pointer ${
                    creationTab === 'scratch' ? 'bg-white text-black' : 'text-white/40 hover:text-white'
                  }`}
                >
                  New Instance
                </button>
                <button
                  onClick={() => setCreationTab('import')}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-all cursor-pointer ${
                    creationTab === 'import' ? 'bg-white text-black' : 'text-white/40 hover:text-white'
                  }`}
                >
                  Import Code
                </button>
              </div>

              <button onClick={() => setShowCreateModal(false)} className="text-white/40 hover:text-white cursor-pointer">
                <X className="size-4" />
              </button>
            </div>

            {creationTab === 'import' ? (
              <form onSubmit={handleImportInstance} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-white/70 block">Paste Share Code</label>
                  <textarea
                    required
                    rows={4}
                    placeholder="KYBOS:H4sIC... or AGYMC:..."
                    value={importShareCode}
                    onChange={(e) => setImportShareCode(e.target.value)}
                    className="w-full bg-white/[0.04] border border-white/10 rounded-xl p-3 text-xs font-mono text-white placeholder-white/30 outline-none focus:border-white/30 resize-none"
                  />
                </div>

                <div className="pt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="px-4 py-2 rounded-xl text-xs font-medium text-white/60 hover:text-white cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isImporting}
                    className="px-5 py-2 rounded-xl bg-white text-black text-xs font-semibold hover:bg-neutral-200 transition-all cursor-pointer disabled:bg-neutral-600"
                  >
                    {isImporting ? 'Importing & Downloading...' : 'Import & Build'}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleCreateInstance} className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-white/60 block mb-1.5">Instance Name</label>
                  <input
                    type="text"
                    required
                    placeholder="Enter instance name..."
                    value={createForm.name}
                    onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                    className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-white/30"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {/* Game Version Cosmos Dropdown */}
                  <div className="relative" ref={gameVersionMenuRef}>
                    <label className="text-xs font-medium text-white/60 block mb-1.5">Game Version</label>
                    <button
                      type="button"
                      onClick={() => setShowGameVersionMenu(!showGameVersionMenu)}
                      className="w-full bg-[#141414] border border-white/10 rounded-xl px-3 py-2 text-xs text-white flex items-center justify-between hover:border-white/20 transition-all cursor-pointer"
                    >
                      <span>{createForm.game_version}</span>
                      <ChevronDown className={`size-3 text-white/40 transition-transform ${showGameVersionMenu ? 'rotate-180' : ''}`} />
                    </button>

                    {showGameVersionMenu && (
                      <div className="absolute left-0 top-full mt-1.5 w-full bg-[#121212]/95 border border-white/10 rounded-2xl p-1.5 shadow-2xl backdrop-blur-3xl z-50">
                        {['1.21.1', '1.21', '1.20.4', '1.20.1'].map((v) => {
                          const isSel = createForm.game_version === v;
                          return (
                            <button
                              key={v}
                              type="button"
                              onClick={() => {
                                setCreateForm({ ...createForm, game_version: v });
                                setShowGameVersionMenu(false);
                              }}
                              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-colors cursor-pointer ${
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
                    <label className="text-xs font-medium text-white/60 block mb-1.5">Mod Loader</label>
                    <button
                      type="button"
                      onClick={() => setShowLoaderMenu(!showLoaderMenu)}
                      className="w-full bg-[#141414] border border-white/10 rounded-xl px-3 py-2 text-xs text-white flex items-center justify-between hover:border-white/20 transition-all cursor-pointer"
                    >
                      <span>{createForm.loader}</span>
                      <ChevronDown className={`size-3 text-white/40 transition-transform ${showLoaderMenu ? 'rotate-180' : ''}`} />
                    </button>

                    {showLoaderMenu && (
                      <div className="absolute left-0 top-full mt-1.5 w-full bg-[#121212]/95 border border-white/10 rounded-2xl p-1.5 shadow-2xl backdrop-blur-3xl z-50">
                        {(['Vanilla', 'Fabric', 'NeoForge', 'Forge', 'Quilt'] as ModLoader[]).map((loaderName) => {
                          const isSel = createForm.loader === loaderName;
                          return (
                            <button
                              key={loaderName}
                              type="button"
                              onClick={() => {
                                setCreateForm({ ...createForm, loader: loaderName });
                                setShowLoaderMenu(false);
                              }}
                              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-colors cursor-pointer ${
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

                {/* Instance Account Override Cosmos Dropdown */}
                <div className="relative" ref={accountOverrideMenuRef}>
                  <label className="text-xs font-medium text-white/60 block mb-1.5">Instance Account (Optional)</label>
                  <button
                    type="button"
                    onClick={() => setShowAccountOverrideMenu(!showAccountOverrideMenu)}
                    className="w-full bg-[#141414] border border-white/10 rounded-xl px-3 py-2 text-xs text-white flex items-center justify-between hover:border-white/20 transition-all cursor-pointer"
                  >
                    <span className="truncate">
                      {createForm.account_override_id
                        ? accounts.accounts.find((a) => a.id === createForm.account_override_id)?.username || 'Selected Profile'
                        : 'Use Default Global Account'}
                    </span>
                    <ChevronDown className={`size-3 text-white/40 shrink-0 ml-2 transition-transform ${showAccountOverrideMenu ? 'rotate-180' : ''}`} />
                  </button>

                  {showAccountOverrideMenu && (
                    <div className="absolute left-0 top-full mt-1.5 w-full bg-[#121212]/95 border border-white/10 rounded-2xl p-1.5 shadow-2xl backdrop-blur-3xl z-50 max-h-52 overflow-y-auto">
                      <button
                        type="button"
                        onClick={() => {
                          setCreateForm({ ...createForm, account_override_id: undefined });
                          setShowAccountOverrideMenu(false);
                        }}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-colors cursor-pointer ${
                          !createForm.account_override_id ? 'bg-white/10 text-white font-medium' : 'text-white/60 hover:text-white hover:bg-white/[0.04]'
                        }`}
                      >
                        <span>Use Default Global Account</span>
                        {!createForm.account_override_id && <Check className="size-3.5 text-white" />}
                      </button>

                      {accounts.accounts.map((acc) => {
                        const isSel = createForm.account_override_id === acc.id;
                        return (
                          <button
                            key={acc.id}
                            type="button"
                            onClick={() => {
                              setCreateForm({ ...createForm, account_override_id: acc.id });
                              setShowAccountOverrideMenu(false);
                            }}
                            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-colors cursor-pointer ${
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

                {/* Pantone / Card Swatch Color Selector */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-white/60">Card Color / Swatch</label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          // Generates any true random vibrant or deep hex color with good saturation
                          const h = Math.floor(Math.random() * 360);
                          const s = Math.floor(Math.random() * 40) + 50; // 50% - 90% saturation
                          const l = Math.floor(Math.random() * 35) + 15; // 15% - 50% lightness (aesthetic, not washed out)
                          // Convert HSL to HEX
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
                          setCreateForm({ ...createForm, color: randomHex });
                        }}
                        className="text-[11px] text-white/50 hover:text-white transition-colors cursor-pointer flex items-center gap-1"
                        title="Generate True Random Color"
                      >
                        <Sparkles className="size-3" />
                        <span>Random</span>
                      </button>
                      <span className="text-[10px] text-white/40 font-mono uppercase">{createForm.color || '#1E293B'}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 max-w-full">
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
                        onClick={() => setCreateForm({ ...createForm, color: col })}
                        style={{ backgroundColor: col }}
                        className={`size-6 rounded-full border transition-transform cursor-pointer ${
                          createForm.color === col
                            ? 'border-white scale-110 shadow-md ring-2 ring-white/20'
                            : 'border-white/20 hover:scale-105'
                        }`}
                      />
                    ))}
                    {/* Custom Color Wheel Picker */}
                    <label className="relative size-6 rounded-full overflow-hidden border border-white/20 hover:scale-105 cursor-pointer flex items-center justify-center bg-gradient-to-tr from-pink-500 via-amber-400 to-cyan-500 shrink-0" title="Custom Color">
                      <input
                        type="color"
                        value={createForm.color || '#1E293B'}
                        onChange={(e) => setCreateForm({ ...createForm, color: e.target.value })}
                        className="opacity-0 absolute inset-0 cursor-pointer size-full"
                      />
                    </label>
                  </div>
                </div>

                <div className="pt-2 flex justify-between items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateModal(false);
                      setShowAdvancedModal({ open: true, instance: null });
                    }}
                    className="px-3.5 py-2 rounded-xl bg-white/[0.05] hover:bg-white/10 text-white/80 hover:text-white text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer"
                  >
                    <Settings className="size-3.5" />
                    <span>Advanced Options...</span>
                  </button>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowCreateModal(false)}
                      className="px-4 py-2 rounded-xl text-xs font-medium text-white/60 hover:text-white cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-5 py-2 rounded-xl bg-white text-black text-xs font-semibold hover:bg-neutral-200 transition-all cursor-pointer"
                    >
                      Create
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Share Manifest Modal */}
      {showShareModal.open && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xl flex items-center justify-center z-50 p-4">
          <div className="bg-[#111111] border border-white/10 rounded-3xl max-w-lg w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-white">Share Instance</h3>
              <button onClick={() => setShowShareModal({ open: false })} className="text-white/40 hover:text-white cursor-pointer">
                <X className="size-4" />
              </button>
            </div>

            <p className="text-xs text-white/50">
              This code fingerprints your installed mods using cryptographic SHA-512 hashes. Your friends can import this
              code and the launcher will auto-resolve and download official versions directly from Modrinth!
            </p>

            <div className="relative">
              <textarea
                readOnly
                rows={4}
                value={showShareModal.code || ''}
                className="w-full bg-white/[0.04] border border-white/10 rounded-xl p-3 text-xs font-mono text-white/80 outline-none resize-none"
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(showShareModal.code || '');
                  showToast('Share code copied to clipboard!');
                }}
                className="absolute right-3 bottom-3 px-3 py-1 bg-white text-black rounded-lg text-xs font-medium flex items-center gap-1.5 shadow cursor-pointer"
              >
                <Copy className="size-3" />
                <span>Copy</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Two-Pane Cosmos Settings Modal (Left Navigation + Right Details) */}
      {showSettingsModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xl flex items-center justify-center z-50 p-4">
          <div className="relative bg-[#121212] border border-white/10 rounded-3xl max-w-2xl w-full h-[460px] flex overflow-hidden shadow-2xl">
            {/* Top Right Close Button (Cosmos Style) */}
            <button
              onClick={() => setShowSettingsModal(false)}
              className="absolute top-5 right-5 size-7 rounded-full bg-white/[0.05] hover:bg-white/15 text-white/50 hover:text-white flex items-center justify-center transition-all cursor-pointer z-10"
            >
              <X className="size-3.5" />
            </button>

            {/* Left Nav Pane */}
            <div className="w-56 border-r border-white/[0.07] p-5 flex flex-col justify-between shrink-0">
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-white px-3 py-1">Settings</h3>

                <nav className="space-y-1">
                  <button
                    onClick={() => setSettingsActiveTab('storage')}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all text-left cursor-pointer ${
                      settingsActiveTab === 'storage'
                        ? 'bg-white/10 text-white'
                        : 'text-white/40 hover:text-white hover:bg-white/[0.03]'
                    }`}
                  >
                    <HardDrive className="size-3.5" />
                    <span>Storage & Paths</span>
                  </button>

                  <button
                    onClick={() => setSettingsActiveTab('apis')}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all text-left cursor-pointer ${
                      settingsActiveTab === 'apis'
                        ? 'bg-white/10 text-white'
                        : 'text-white/40 hover:text-white hover:bg-white/[0.03]'
                    }`}
                  >
                    <KeyRound className="size-3.5" />
                    <span>API Integrations</span>
                  </button>

                  <button
                    onClick={() => setSettingsActiveTab('about')}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all text-left cursor-pointer ${
                      settingsActiveTab === 'about'
                        ? 'bg-white/10 text-white'
                        : 'text-white/40 hover:text-white hover:bg-white/[0.03]'
                    }`}
                  >
                    <Laptop className="size-3.5" />
                    <span>About Kybos</span>
                  </button>
                </nav>
              </div>

              <div className="pt-4 border-t border-white/[0.06] text-[11px] text-white/30">
                Kybos Launcher v0.1.0
              </div>
            </div>

            {/* Right Content Pane */}
            <div className="flex-1 p-6 space-y-6 overflow-y-auto">
              {settingsActiveTab === 'storage' && (
                <div className="space-y-6">
                  <div>
                    <h4 className="text-sm font-semibold text-white">Storage & Paths</h4>
                    <p className="text-xs text-white/40 mt-0.5">Physical directory paths used by your launcher on this machine.</p>
                  </div>

                  <div className="space-y-4">
                    {/* Instances Directory */}
                    <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-between gap-3">
                      <div className="min-w-0 space-y-0.5">
                        <p className="text-xs font-medium text-white/90">Instances Directory</p>
                        <p className="text-[11px] font-mono text-white/40 truncate">
                          {storagePaths?.instances_dir || 'Loading...'}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => handleSelectCustomPath('instances')}
                          className="px-3 py-1.5 rounded-xl bg-white text-black text-xs font-medium hover:bg-neutral-200 transition-all cursor-pointer"
                        >
                          Change
                        </button>
                        <button
                          onClick={() => storagePaths && handleOpenFolder(storagePaths.instances_dir)}
                          className="px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/15 text-white/80 text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer"
                        >
                          <FolderOpen className="size-3.5" />
                          <span>Open</span>
                        </button>
                      </div>
                    </div>

                    {/* Shared Assets Directory */}
                    <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-between gap-3">
                      <div className="min-w-0 space-y-0.5">
                        <p className="text-xs font-medium text-white/90">Shared Assets Pool</p>
                        <p className="text-[11px] font-mono text-white/40 truncate">
                          {storagePaths?.assets_dir || 'Loading...'}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => handleSelectCustomPath('assets')}
                          className="px-3 py-1.5 rounded-xl bg-white text-black text-xs font-medium hover:bg-neutral-200 transition-all cursor-pointer"
                        >
                          Change
                        </button>
                        <button
                          onClick={() => storagePaths && handleOpenFolder(storagePaths.assets_dir)}
                          className="px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/15 text-white/80 text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer"
                        >
                          <FolderOpen className="size-3.5" />
                          <span>Open</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {settingsActiveTab === 'apis' && (
                <div className="space-y-6">
                  <div>
                    <h4 className="text-sm font-semibold text-white">API Integrations</h4>
                    <p className="text-xs text-white/40 mt-0.5">
                      Configure external service keys and endpoints for mods and photography.
                    </p>
                  </div>

                  {/* CurseForge API Key Card */}
                  <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] space-y-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Package className="size-4 text-white/80" />
                        <h5 className="text-xs font-semibold text-white">CurseForge API</h5>
                      </div>
                      <p className="text-[11px] text-white/40 leading-relaxed">
                        Enables searching, browsing, and installing mods from the CurseForge catalog.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[11px] font-medium text-white/70 block">CurseForge API Key</label>
                      <input
                        type="password"
                        placeholder="Enter your personal CurseForge API key ($2a$10$...)"
                        value={curseforgeApiKey}
                        onChange={(e) => setCurseforgeApiKey(e.target.value)}
                        className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-white/30 font-mono"
                      />
                      <p className="text-[11px] text-white/40 leading-relaxed">
                        If CurseForge returns a 403 or rate limits the default public community key, you can generate your own free key at{' '}
                        <span className="text-white font-mono">console.curseforge.com</span> and save it here.
                      </p>
                    </div>

                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        onClick={async () => {
                          setIsSavingCfKey(true);
                          try {
                            await invoke('set_curseforge_api_key', { apiKey: curseforgeApiKey });
                            showToast('CurseForge API key saved!');
                          } catch (e) {
                            showToast(`Failed to save key: ${e}`);
                          } finally {
                            setIsSavingCfKey(false);
                          }
                        }}
                        disabled={isSavingCfKey}
                        className="px-3.5 py-1.5 rounded-xl bg-white text-black text-xs font-semibold hover:bg-neutral-200 transition-all cursor-pointer disabled:opacity-50"
                      >
                        {isSavingCfKey ? 'Saving...' : 'Save CurseForge Key'}
                      </button>
                    </div>
                  </div>

                  {/* Unsplash API & Themes Card */}
                  <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] space-y-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Layers className="size-4 text-white/80" />
                        <h5 className="text-xs font-semibold text-white">Unsplash Photography API</h5>
                      </div>
                      <p className="text-[11px] text-white/40 leading-relaxed">
                        Powers random instance cover banners and customized architectural imagery.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[11px] font-medium text-white/70 block">Unsplash Access Key (Optional)</label>
                      <input
                        type="password"
                        placeholder="Paste your personal Unsplash Access Key"
                        value={unsplashAccessKey}
                        onChange={(e) => setUnsplashAccessKey(e.target.value)}
                        className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-white/30 font-mono"
                      />
                      <p className="text-[11px] text-white/40 leading-relaxed">
                        Keys are obtainable for free at <span className="text-white font-mono">unsplash.com/developers</span>. If left empty, Kybos uses high-res CDN photo collections with no key needed.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[11px] font-medium text-white/70 block">Curated Topics & Keywords</label>
                      <input
                        type="text"
                        placeholder="e.g. architecture, nature, wallpapers, brutalism, minimal"
                        value={unsplashTopics}
                        onChange={(e) => setUnsplashTopics(e.target.value)}
                        className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-white/30 font-mono"
                      />
                      <p className="text-[11px] text-white/40 leading-relaxed">
                        Comma-separated keywords used when selecting "Random Cover".
                      </p>
                    </div>

                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        onClick={async () => {
                          setIsSavingUnsplash(true);
                          try {
                            await invoke('set_unsplash_config', {
                              accessKey: unsplashAccessKey,
                              topics: unsplashTopics,
                            });
                            showToast('Unsplash configuration saved!');
                          } catch (e) {
                            showToast(`Failed to save: ${e}`);
                          } finally {
                            setIsSavingUnsplash(false);
                          }
                        }}
                        disabled={isSavingUnsplash}
                        className="px-3.5 py-1.5 rounded-xl bg-white text-black text-xs font-semibold hover:bg-neutral-200 transition-all cursor-pointer disabled:opacity-50"
                      >
                        {isSavingUnsplash ? 'Saving...' : 'Save Unsplash Settings'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {settingsActiveTab === 'about' && (
                <div className="space-y-4">
                  <div>
                    <h4 className="text-sm font-semibold text-white">About Kybos</h4>
                    <p className="text-xs text-white/40 mt-0.5">High-performance Minecraft launcher.</p>
                  </div>

                  <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.06] space-y-2 text-xs text-white/60 leading-relaxed">
                    <p>Designed with a quiet, minimalist interface and powered by a high-throughput Rust backend.</p>
                    <p>Features zero-orphan instance deletion, automatic SHA-512 mod transfer fingerprinting via Modrinth, and seamless cross-platform support.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Clean Custom In-App Confirmation Dialog */}
      {confirmDialog && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-xl flex items-center justify-center z-60 p-4 animate-in fade-in zoom-in-95 duration-100">
          <div className="bg-[#141414] border border-white/10 rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl">
            <h3 className="text-base font-semibold text-white">{confirmDialog.title}</h3>
            <p className="text-xs text-white/60 leading-relaxed">{confirmDialog.message}</p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setConfirmDialog(null)}
                className="px-4 py-2 rounded-xl text-xs font-medium text-white/60 hover:text-white cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={confirmDialog.onConfirm}
                className={`px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-all ${
                  confirmDialog.danger
                    ? 'bg-rose-500 hover:bg-rose-600 text-white'
                    : 'bg-white hover:bg-neutral-200 text-black'
                }`}
              >
                {confirmDialog.confirmText || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* In-App Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[#1A1A1A] border border-white/15 px-4 py-2.5 rounded-full text-xs text-white shadow-2xl z-70 animate-in fade-in slide-in-from-bottom-2 duration-150">
          {toastMessage}
        </div>
      )}

      {/* Minimalist Cosmos Progress Indicator (Java & Assets) */}
      {installProgress && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-full max-w-md px-4 z-80 animate-in fade-in slide-in-from-bottom-3 duration-200">
          <div className="bg-[#101010]/95 border border-white/10 rounded-2xl p-4 shadow-2xl backdrop-blur-2xl space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <Loader2 className="size-3.5 text-white animate-spin shrink-0" />
                <span className="text-xs font-semibold text-white tracking-tight truncate">
                  {installProgress.title}
                </span>
              </div>
              <span className="font-mono text-xs text-white/90 font-medium tabular-nums shrink-0">
                {Math.round(installProgress.percentage)}%
              </span>
            </div>

            {/* Quiet Cosmos monochrome progress track */}
            <div className="w-full h-1 rounded-full bg-white/[0.08] overflow-hidden">
              <div
                className="h-full bg-white rounded-full transition-all duration-200 ease-out"
                style={{ width: `${Math.max(3, Math.min(100, installProgress.percentage))}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-[11px] text-white/40">
              <span className="truncate pr-2">{installProgress.status}</span>
              <span className="shrink-0 text-white/30 font-mono">Syncing</span>
            </div>
          </div>
        </div>
      )}

      {/* Microsoft Device Code OAuth Modal */}
      {msLoginModal && msLoginModal.open && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-xl flex items-center justify-center z-70 p-4 animate-in fade-in zoom-in-95 duration-100">
          <div className="relative bg-[#121212] border border-white/10 rounded-3xl max-w-sm w-full p-6 space-y-6 shadow-2xl text-center">
            <button
              onClick={() => setMsLoginModal(null)}
              className="absolute top-5 right-5 size-7 rounded-full bg-white/[0.05] hover:bg-white/15 text-white/50 hover:text-white flex items-center justify-center transition-all cursor-pointer"
            >
              <X className="size-3.5" />
            </button>

            <div className="size-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
              <ShieldCheck className="size-6" />
            </div>

            <div className="space-y-1.5">
              <h3 className="text-base font-semibold text-white">Sign in to Microsoft</h3>
              <p className="text-xs text-white/40 leading-relaxed">
                Enter this code in your browser to connect your official Minecraft account.
              </p>
            </div>

            {/* Code Display with Copy Button */}
            <div className="p-4 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-between">
              <span className="font-mono text-xl font-bold tracking-wider text-white select-all">
                {msLoginModal.userCode}
              </span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(msLoginModal.userCode);
                  showToast('Code copied to clipboard!');
                }}
                className="size-8 rounded-xl bg-white/[0.06] hover:bg-white/15 text-white/70 hover:text-white flex items-center justify-center transition-all cursor-pointer"
                title="Copy Code"
              >
                <Copy className="size-4" />
              </button>
            </div>

            <div className="space-y-3 pt-1">
              <a
                href={msLoginModal.verificationUri}
                target="_blank"
                rel="noreferrer"
                className="w-full py-2.5 px-4 rounded-xl bg-white text-black hover:bg-neutral-200 text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <span>Open Microsoft Page</span>
                <ExternalLink className="size-3.5" />
              </a>

              <div className="flex items-center justify-center gap-2 text-[11px] text-white/40 pt-1">
                <Loader2 className="size-3.5 animate-spin text-emerald-400" />
                <span>Waiting for authorization...</span>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Advanced Instance Configuration & Mods Modal */}
      <AdvancedInstanceModal
        isOpen={showAdvancedModal.open}
        onClose={() => setShowAdvancedModal({ open: false, instance: null })}
        editingInstance={showAdvancedModal.instance}
        initialCreateForm={createForm}
        accounts={accounts.accounts}
        currentAccount={currentAccount}
        onSaveInstance={handleSaveAdvancedInstance}
        onDeleteInstance={handleDeleteInstance}
        onShareInstance={handleShareInstance}
        showToast={showToast}
      />
    </div>
  );
}
export default App;
