import React, { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Download,
  Package,
  ArrowDownToLine,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Check,
  X
} from 'lucide-react';
import { InstanceConfig } from '../App';
import { ModDetailModal } from './ModDetailModal';

export interface ModSearchHit {
  project_id: string;
  title: string;
  description: string;
  icon_url?: string;
  author: string;
  downloads: number;
  follows: number;
  slug: string;
  loaders?: string[];
  versions?: string[];
}

export interface ModrinthSearchResponse {
  hits: ModSearchHit[];
  total_hits: number;
}

export interface ModVersion {
  id: string;
  name: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  files: Array<{
    url: string;
    filename: string;
    primary: boolean;
    size: number;
  }>;
}

export interface CurseForgeFile {
  id: number;
  displayName: string;
  fileName: string;
  downloadUrl?: string;
  fileLength: number;
  gameVersions: string[];
}

interface ModBrowserProps {
  instances: InstanceConfig[];
  selectedInstanceId?: string;
  onSelectInstance?: (instanceId: string) => void;
  onModInstalled?: (instanceId: string, filename: string) => void;
  showToast: (msg: string) => void;
  // Controlled header inputs from App.tsx
  source: 'modrinth' | 'curseforge';
  query: string;
  pageSize: 25 | 50 | 100;
  onSourceChange: (source: 'modrinth' | 'curseforge') => void;
  onPageSizeChange?: (size: 25 | 50 | 100) => void;
}

interface SourceCache {
  mods: ModSearchHit[];
  totalHits: number;
  currentPage: number;
  scrollPos: number;
  lastFilterKey: string;
}

export const ModBrowser: React.FC<ModBrowserProps> = ({
  instances,
  selectedInstanceId,
  onSelectInstance,
  onModInstalled,
  showToast,
  source,
  query,
  pageSize,
  onSourceChange,
  onPageSizeChange,
}) => {
  // Independent cache for Modrinth and CurseForge so switching tabs doesn't reload/reset
  const [cache, setCache] = useState<{
    modrinth: SourceCache;
    curseforge: SourceCache;
  }>({
    modrinth: { mods: [], totalHits: 0, currentPage: 1, scrollPos: 0, lastFilterKey: '' },
    curseforge: { mods: [], totalHits: 0, currentPage: 1, scrollPos: 0, lastFilterKey: '' },
  });

  const [loading, setLoading] = useState(false);
  const [installingProject, setInstallingProject] = useState<string | null>(null);
  const [installedMap, setInstalledMap] = useState<Record<string, boolean>>({});

  // Compact Instance Selector Modal when adding with no instance selected
  const [pendingModToInstall, setPendingModToInstall] = useState<ModSearchHit | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Detail Modal
  const [selectedModDetail, setSelectedModDetail] = useState<ModSearchHit | null>(null);

  // Dropdown menus in Browse header line
  const [showInstanceMenu, setShowInstanceMenu] = useState(false);
  const [showPageSizeMenu, setShowPageSizeMenu] = useState(false);
  const [instanceSearchFilter, setInstanceSearchFilter] = useState('');

  const instanceMenuRef = useRef<HTMLDivElement>(null);
  const pageSizeMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (instanceMenuRef.current && !instanceMenuRef.current.contains(e.target as Node)) {
        setShowInstanceMenu(false);
      }
      if (pageSizeMenuRef.current && !pageSizeMenuRef.current.contains(e.target as Node)) {
        setShowPageSizeMenu(false);
      }
    };
    window.addEventListener('mousedown', handleOutsideClick);
    return () => window.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const targetInstance = instances.find((i) => i.id === selectedInstanceId);

  const formatDownloads = (num: number) => {
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(0)}k`;
    return num.toString();
  };

  const normalizeLoader = (loaderStr?: string) => {
    if (!loaderStr || loaderStr.toLowerCase() === 'vanilla') return undefined;
    return loaderStr.toLowerCase().replace(/[^a-z0-9]/g, '');
  };

  const currentData = cache[source];

  const searchMods = async (
    searchQuery: string,
    targetSource: 'modrinth' | 'curseforge' = source,
    page: number = 1,
    limit: number = pageSize
  ) => {
    setLoading(true);
    try {
      const offset = (page - 1) * limit;
      const loaderParam = normalizeLoader(targetInstance?.loader);
      const versionParam = targetInstance?.game_version || undefined;

      if (targetSource === 'modrinth') {
        const res = await invoke<ModrinthSearchResponse>('search_modrinth_mods', {
          query: searchQuery,
          loader: loaderParam || null,
          gameVersion: versionParam || null,
          limit,
          offset,
        });

        const filterKey = `${searchQuery}|${loaderParam}|${versionParam}|${limit}`;
        setCache((prev) => ({
          ...prev,
          modrinth: {
            mods: res.hits,
            totalHits: res.total_hits,
            currentPage: page,
            scrollPos: 0,
            lastFilterKey: filterKey,
          },
        }));
      } else {
        const res = await invoke<{ hits: ModSearchHit[]; total_hits: number }>('search_curseforge_mods', {
          query: searchQuery,
          gameVersion: versionParam || null,
          loader: loaderParam || null,
          limit,
          index: offset,
        });

        const filterKey = `${searchQuery}|${loaderParam}|${versionParam}|${limit}`;
        setCache((prev) => ({
          ...prev,
          curseforge: {
            mods: res.hits,
            totalHits: res.total_hits,
            currentPage: page,
            scrollPos: 0,
            lastFilterKey: filterKey,
          },
        }));
      }
    } catch (err) {
      console.error(err);
      showToast(`Search failed: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  // Debounced auto-search when query, targetInstance, or pageSize changes
  useEffect(() => {
    const loaderParam = normalizeLoader(targetInstance?.loader);
    const versionParam = targetInstance?.game_version || undefined;
    const currentFilterKey = `${query}|${loaderParam}|${versionParam}|${pageSize}`;

    // If cache already matches the current filter, do not re-request (preserves comparison when switching tabs)
    if (cache[source].lastFilterKey === currentFilterKey && cache[source].mods.length > 0) {
      return;
    }

    const timer = setTimeout(() => {
      searchMods(query, source, 1, pageSize);
    }, 350);

    return () => clearTimeout(timer);
  }, [query, selectedInstanceId, pageSize, source]);

  // Check installed mods for current instance
  useEffect(() => {
    if (!selectedInstanceId) {
      setInstalledMap({});
      return;
    }

    const checkInstalled = async () => {
      try {
        const mods = await invoke<Array<{ filename: string }>>('list_instance_mods', {
          instanceId: selectedInstanceId,
        });
        const map: Record<string, boolean> = {};

        // Match lowercase mod filenames against mod title / slug
        mods.forEach((m) => {
          const fn = m.filename.toLowerCase();
          currentData.mods.forEach((mod) => {
            const slug = mod.slug.toLowerCase();
            const cleanTitle = mod.title.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (fn.includes(slug) || (cleanTitle.length > 3 && fn.includes(cleanTitle))) {
              map[mod.project_id] = true;
            }
          });
        });
        setInstalledMap(map);
      } catch (err) {
        console.error('Failed to list installed mods:', err);
      }
    };

    checkInstalled();
  }, [selectedInstanceId, currentData.mods]);

  const executeInstallMod = async (mod: ModSearchHit, targetInstId: string) => {
    const inst = instances.find((i) => i.id === targetInstId);
    if (!inst) return;

    setInstallingProject(mod.project_id);
    try {
      const isCurseForge = mod.project_id.startsWith('cf-');

      if (isCurseForge) {
        const cfId = parseInt(mod.project_id.replace('cf-', ''), 10);
        const files = await invoke<CurseForgeFile[]>('get_curseforge_files', { modId: cfId });

        const loaderStr = normalizeLoader(inst.loader);
        const versionStr = inst.game_version;

        // Find file matching version and loader
        let matched = files.find((f) => {
          const gv = f.gameVersions.map((v) => v.toLowerCase());
          const matchVersion = gv.includes(versionStr);
          const matchLoader = loaderStr ? gv.includes(loaderStr) : true;
          return matchVersion && matchLoader;
        });

        if (!matched && files.length > 0) {
          matched = files[0];
        }

        if (!matched || !matched.downloadUrl) {
          showToast('No downloadable file found for this mod on CurseForge.');
          return;
        }

        const savedName = await invoke<string>('install_curseforge_mod', {
          instanceId: targetInstId,
          fileUrl: matched.downloadUrl,
          filename: matched.fileName,
        });

        showToast(`Installed ${savedName} to ${inst.name}!`);
        setInstalledMap((prev) => ({ ...prev, [mod.project_id]: true }));
        onModInstalled?.(targetInstId, savedName);
      } else {
        // Modrinth
        const versions = await invoke<ModVersion[]>('get_mod_versions', {
          projectId: mod.project_id,
          projectIdOrSlug: mod.project_id,
          loader: normalizeLoader(inst.loader) || null,
          gameVersion: inst.game_version || null,
        });

        if (!versions || versions.length === 0) {
          showToast(`No compatible version found for ${inst.loader} ${inst.game_version}`);
          return;
        }

        const latest = versions[0];
        const primary = latest.files.find((f) => f.primary) || latest.files[0];
        if (!primary) {
          showToast('No downloadable file found in version.');
          return;
        }

        const savedName = await invoke<string>('install_mod_to_instance', {
          instanceId: targetInstId,
          fileUrl: primary.url,
          filename: primary.filename,
        });

        showToast(`Installed ${savedName} to ${inst.name}!`);
        setInstalledMap((prev) => ({ ...prev, [mod.project_id]: true }));
        onModInstalled?.(targetInstId, savedName);
      }
    } catch (err) {
      console.error(err);
      showToast(`Install failed: ${err}`);
    } finally {
      setInstallingProject(null);
    }
  };

  const handleInstallMod = async (mod: ModSearchHit, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!selectedInstanceId) {
      // Open compact instance picker selector modal
      setPendingModToInstall(mod);
      return;
    }
    await executeInstallMod(mod, selectedInstanceId);
  };

  const totalPages = Math.ceil(currentData.totalHits / pageSize);

  return (
    <div className="flex-1 flex flex-col h-full bg-[#080808] overflow-hidden select-none">
      {/* Main Mods Grid - Dynamic Full-Width Cosmos Scaling */}
      <div className="flex-1 overflow-y-auto px-6 py-6" ref={scrollContainerRef}>
        <div className="w-full space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <span className="text-base font-semibold text-white/90">Browse</span>
                {/* Seamless Inline Source Toggle */}
                <div className="flex items-center bg-white/[0.04] p-0.5 rounded-full border border-white/[0.08] shadow-sm">
                  <button
                    onClick={() => onSourceChange('modrinth')}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-all cursor-pointer ${
                      source === 'modrinth'
                        ? 'bg-white text-black shadow-sm font-semibold'
                        : 'text-white/40 hover:text-white/80'
                    }`}
                  >
                    Modrinth
                  </button>
                  <button
                    onClick={() => onSourceChange('curseforge')}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-all cursor-pointer ${
                      source === 'curseforge'
                        ? 'bg-white text-black shadow-sm font-semibold'
                        : 'text-white/40 hover:text-white/80'
                    }`}
                  >
                    CurseForge
                  </button>
                </div>
              </div>
              {targetInstance && (
                <p className="text-xs text-white/40 mt-1">
                  Filtered for {targetInstance.loader} {targetInstance.game_version}
                </p>
              )}
            </div>

            {/* Right Aligned: Total Hits Count on Left, then Instance & Page Size Pill */}
            <div className="flex items-center gap-4">
              <div className="text-xs text-white/40 font-mono whitespace-nowrap">
                {currentData.totalHits.toLocaleString()} mods found
              </div>

              <div className="flex items-center bg-white/[0.04] p-1 rounded-full border border-white/[0.08] shadow-sm gap-1">
                {/* Target Instance Dropdown */}
                <div className="relative" ref={instanceMenuRef}>
                  <button
                    onClick={() => {
                      setShowInstanceMenu(!showInstanceMenu);
                      setShowPageSizeMenu(false);
                    }}
                    className="flex items-center justify-between px-3 py-1 rounded-full hover:bg-white/[0.06] transition-all cursor-pointer text-xs gap-1.5"
                  >
                    <span className="text-white/40">Instance:</span>
                    <span className="text-white font-medium truncate max-w-[110px]">
                      {instances.find((i) => i.id === selectedInstanceId)?.name || 'All'}
                    </span>
                    <ChevronDown className="size-3 text-white/40 shrink-0" />
                  </button>

                  {showInstanceMenu && (
                    <div className="absolute right-0 mt-2 w-72 bg-[#121212]/95 border border-white/[0.1] rounded-2xl p-2 shadow-2xl backdrop-blur-3xl z-50 animate-in fade-in zoom-in-95 duration-100">
                      <p className="px-3 py-1 text-[10px] font-semibold tracking-wider uppercase text-white/30">
                        Target Instance
                      </p>

                      <div className="px-2 py-1.5">
                        <input
                          type="text"
                          placeholder="Search instance name..."
                          value={instanceSearchFilter}
                          onChange={(e) => setInstanceSearchFilter(e.target.value)}
                          className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-2.5 py-1 text-xs text-white placeholder-white/30 outline-none focus:border-white/25"
                        />
                      </div>

                      <div className="max-h-56 overflow-y-auto space-y-0.5 mt-1">
                        <button
                          onClick={() => {
                            onSelectInstance?.('');
                            setShowInstanceMenu(false);
                            setInstanceSearchFilter('');
                          }}
                          className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs text-left hover:bg-white/[0.06] transition-all text-white/80 cursor-pointer"
                        >
                          <span>All</span>
                          {!selectedInstanceId && <Check className="size-3.5 text-white" />}
                        </button>
                        {instances
                          .filter((inst) =>
                            inst.name.toLowerCase().includes(instanceSearchFilter.toLowerCase())
                          )
                          .map((inst) => (
                            <button
                              key={inst.id}
                              onClick={() => {
                                onSelectInstance?.(inst.id);
                                setShowInstanceMenu(false);
                                setInstanceSearchFilter('');
                              }}
                              className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs text-left hover:bg-white/[0.06] transition-all text-white/80 cursor-pointer"
                            >
                              <div className="min-w-0 pr-2">
                                <p className="truncate text-white/90">{inst.name}</p>
                                <p className="text-[10px] text-white/40 font-mono">
                                  {inst.loader} • {inst.game_version}
                                </p>
                              </div>
                              {selectedInstanceId === inst.id && (
                                <Check className="size-3.5 text-white shrink-0" />
                              )}
                            </button>
                          ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="h-4 w-px bg-white/10" />

                {/* Show Amount Dropdown */}
                <div className="relative shrink-0" ref={pageSizeMenuRef}>
                  <button
                    onClick={() => {
                      setShowPageSizeMenu(!showPageSizeMenu);
                      setShowInstanceMenu(false);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-full hover:bg-white/[0.06] transition-all cursor-pointer text-xs"
                  >
                    <span className="text-white/40">Show:</span>
                    <span className="text-white font-medium">{pageSize}</span>
                    <ChevronDown className="size-3 text-white/40" />
                  </button>

                  {showPageSizeMenu && (
                    <div className="absolute right-0 mt-2 w-32 bg-[#121212]/95 border border-white/[0.1] rounded-2xl p-1.5 shadow-2xl backdrop-blur-3xl z-50 animate-in fade-in zoom-in-95 duration-100">
                      <p className="px-2.5 py-1 text-[10px] font-semibold tracking-wider uppercase text-white/30">
                        Per Page
                      </p>
                      {([25, 50, 100] as const).map((size) => (
                        <button
                          key={size}
                          onClick={() => {
                            onPageSizeChange?.(size);
                            setShowPageSizeMenu(false);
                          }}
                          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-left hover:bg-white/[0.06] transition-all text-white/80 cursor-pointer"
                        >
                          <span>{size} mods</span>
                          {pageSize === size && <Check className="size-3.5 text-white" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-24 text-xs text-white/40">
              Loading mods from {source === 'modrinth' ? 'Modrinth' : 'CurseForge'}...
            </div>
          ) : currentData.mods.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center space-y-2">
              <Package className="size-8 text-white/20" />
              <p className="text-xs text-white/50">No mods found matching your query.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-5">
              {currentData.mods.map((mod) => {
                const isInstalled = installedMap[mod.project_id];
                const isInstalling = installingProject === mod.project_id;

                return (
                  <div
                    key={mod.project_id}
                    onClick={() => setSelectedModDetail(mod)}
                    className="p-5 rounded-3xl bg-[#0E0E0E] border border-white/[0.08] hover:border-white/25 hover:bg-white/[0.03] transition-all flex flex-col justify-between space-y-4 cursor-pointer group"
                  >
                    <div className="flex items-start gap-3.5">
                      {mod.icon_url ? (
                        <img
                          src={mod.icon_url}
                          alt={mod.title}
                          className="size-12 rounded-2xl object-cover bg-neutral-900 border border-white/10 shrink-0"
                        />
                      ) : (
                        <div className="size-12 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-center text-white/40 shrink-0">
                          <Package className="size-6" />
                        </div>
                      )}

                      <div className="min-w-0 space-y-1 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-sm font-semibold text-white truncate group-hover:text-white transition-colors">
                            {mod.title}
                          </h3>
                        </div>
                        <span className="text-[10px] text-white/30 truncate block">
                          by {mod.author}
                        </span>
                        <p className="text-[11px] text-white/50 line-clamp-2 leading-relaxed">
                          {mod.description}
                        </p>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-white/[0.05] flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-[11px] text-white/40 font-mono">
                        <ArrowDownToLine className="size-3" />
                        <span>{formatDownloads(mod.downloads)}</span>
                      </div>

                      <button
                        onClick={(e) => handleInstallMod(mod, e)}
                        disabled={isInstalling || isInstalled}
                        className={`px-4 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
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
                  </div>
                );
              })}
            </div>
          )}

          {/* Bottom Pagination Controls */}
          {totalPages > 1 && (
            <div className="pt-6 border-t border-white/[0.06] flex items-center justify-between text-xs text-white/50">
              <span>
                Page {currentData.currentPage} of {totalPages}
              </span>
              <div className="flex items-center gap-2">
                <button
                  disabled={currentData.currentPage <= 1}
                  onClick={() => searchMods(query, source, currentData.currentPage - 1, pageSize)}
                  className="size-8 rounded-full border border-white/10 bg-white/[0.04] hover:bg-white/15 disabled:opacity-30 disabled:hover:bg-white/[0.04] flex items-center justify-center transition-all cursor-pointer"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <button
                  disabled={currentData.currentPage >= totalPages}
                  onClick={() => searchMods(query, source, currentData.currentPage + 1, pageSize)}
                  className="size-8 rounded-full border border-white/10 bg-white/[0.04] hover:bg-white/15 disabled:opacity-30 disabled:hover:bg-white/[0.04] flex items-center justify-center transition-all cursor-pointer"
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Compact Instance Selector Modal when adding with no instance selected */}
      {pendingModToInstall && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xl flex items-center justify-center z-70 p-4 animate-in fade-in zoom-in-95 duration-100">
          <div className="bg-[#121212] border border-white/10 rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white">Select Target Instance</h3>
                <p className="text-[11px] text-white/40 mt-0.5">
                  Choose where to install <span className="text-white font-medium">{pendingModToInstall.title}</span>
                </p>
              </div>
              <button
                onClick={() => setPendingModToInstall(null)}
                className="size-7 rounded-full bg-white/[0.05] hover:bg-white/10 text-white/50 hover:text-white flex items-center justify-center transition-all cursor-pointer"
              >
                <X className="size-3.5" />
              </button>
            </div>

            <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
              {instances.length === 0 ? (
                <div className="py-8 text-center text-xs text-white/40">
                  No instances available. Create an instance first.
                </div>
              ) : (
                instances.map((inst) => (
                  <button
                    key={inst.id}
                    onClick={() => {
                      const modToInstall = pendingModToInstall;
                      setPendingModToInstall(null);
                      onSelectInstance?.(inst.id);
                      executeInstallMod(modToInstall, inst.id);
                    }}
                    className="w-full flex items-center justify-between p-3.5 rounded-2xl bg-white/[0.03] border border-white/[0.07] hover:border-white/20 hover:bg-white/[0.06] transition-all text-left cursor-pointer group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {/* Clean Cosmos swatch indicator */}
                      <div
                        className="size-4 rounded-full border border-white/20 shrink-0 shadow-sm"
                        style={{
                          backgroundColor: inst.color || '#3b82f6',
                        }}
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-white group-hover:text-white truncate">
                          {inst.name}
                        </p>
                        <p className="text-[10px] text-white/40 font-mono mt-0.5">
                          {inst.loader} • {inst.game_version}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs font-semibold px-3 py-1 rounded-full bg-white text-black hover:bg-neutral-200 transition-colors shadow-sm shrink-0">
                      Install
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Expanded Mod Detail & Dependencies Screen */}
      <ModDetailModal
        mod={selectedModDetail}
        onClose={() => setSelectedModDetail(null)}
        onInstall={(modToInstall) => {
          handleInstallMod(modToInstall);
        }}
        isInstalled={selectedModDetail ? !!installedMap[selectedModDetail.project_id] : false}
        isInstalling={selectedModDetail ? installingProject === selectedModDetail.project_id : false}
        targetInstanceName={targetInstance?.name}
      />
    </div>
  );
};
