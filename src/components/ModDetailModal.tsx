import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  X,
  Download,
  CheckCircle2,
  Package,
  ArrowDownToLine,
  Heart,
  ExternalLink,
  Layers,
  FileCode,
  Code2,
  Globe,
  Loader2,
  Image as ImageIcon
} from 'lucide-react';
import { ModSearchHit } from './ModBrowser';
import { parseMarkdownToHtml } from '../utils/markdown';

interface ModDetailModalProps {
  mod: ModSearchHit | null;
  onClose: () => void;
  onInstall: (mod: ModSearchHit) => void;
  isInstalled?: boolean;
  isInstalling?: boolean;
  targetInstanceName?: string;
}

export interface ScreenshotItem {
  url: string;
  title?: string;
  description?: string;
}

export interface UnifiedModDetails {
  id: string;
  slug: string;
  title: string;
  description: string;
  bodyHtml: string;
  icon_url?: string;
  downloads: number;
  followers: number;
  author: string;
  source_url?: string;
  wiki_url?: string;
  issues_url?: string;
  discord_url?: string;
  screenshots: ScreenshotItem[];
}

export const ModDetailModal: React.FC<ModDetailModalProps> = ({
  mod,
  onClose,
  onInstall,
  isInstalled = false,
  isInstalling = false,
  targetInstanceName,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'gallery' | 'dependencies'>('overview');
  const [details, setDetails] = useState<UnifiedModDetails | null>(null);
  const [dependencies, setDependencies] = useState<ModSearchHit[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [selectedGalleryImage, setSelectedGalleryImage] = useState<ScreenshotItem | null>(null);

  useEffect(() => {
    if (!mod) {
      setDetails(null);
      setDependencies([]);
      setSelectedGalleryImage(null);
      return;
    }

    const loadDetails = async () => {
      setLoadingDetails(true);
      try {
        const isCurseForge = mod.project_id.startsWith('cf-');

        if (isCurseForge) {
          const cfId = parseInt(mod.project_id.replace('cf-', ''), 10);
          const [descHtml, cfMod] = await Promise.all([
            invoke<string>('get_curseforge_description', { modId: cfId }).catch(() => ''),
            invoke<any>('get_curseforge_mod', { modId: cfId }).catch(() => null),
          ]);

          const screenshots: ScreenshotItem[] = (cfMod?.screenshots || []).map((s: any) => ({
            url: s.url,
            title: s.title || undefined,
            description: s.description || undefined,
          }));

          setDetails({
            id: mod.project_id,
            slug: cfMod?.slug || mod.slug,
            title: cfMod?.name || mod.title,
            description: cfMod?.summary || mod.description,
            bodyHtml: descHtml || `<p>${mod.description}</p>`,
            icon_url: cfMod?.logo?.url || mod.icon_url,
            downloads: cfMod?.download_count || mod.downloads,
            followers: mod.follows || 0,
            author: cfMod?.authors?.[0]?.name || mod.author,
            source_url: cfMod?.links?.source_url,
            wiki_url: cfMod?.links?.wiki_url,
            issues_url: cfMod?.links?.issues_url,
            discord_url: undefined,
            screenshots,
          });
        } else {
          // Modrinth
          const [project, deps] = await Promise.all([
            invoke<any>('get_modrinth_project', { projectIdOrSlug: mod.project_id }).catch(() => null),
            invoke<{ projects: ModSearchHit[] }>('get_modrinth_dependencies', { projectIdOrSlug: mod.project_id }).catch(() => ({ projects: [] })),
          ]);

          const screenshots: ScreenshotItem[] = (project?.gallery || []).map((g: any) => ({
            url: g.url,
            title: g.title || undefined,
            description: g.description || undefined,
          }));

          const renderedHtml = project?.body
            ? parseMarkdownToHtml(project.body)
            : `<p>${mod.description}</p>`;

          setDetails({
            id: mod.project_id,
            slug: project?.slug || mod.slug,
            title: project?.title || mod.title,
            description: project?.description || mod.description,
            bodyHtml: renderedHtml,
            icon_url: project?.icon_url || mod.icon_url,
            downloads: project?.downloads || mod.downloads,
            followers: project?.followers || mod.follows || 0,
            author: mod.author,
            source_url: project?.source_url,
            wiki_url: project?.wiki_url,
            issues_url: project?.issues_url,
            discord_url: project?.discord_url,
            screenshots,
          });

          if (deps && deps.projects) {
            const mappedDeps: ModSearchHit[] = deps.projects.map((p: any) => ({
              project_id: p.id,
              title: p.title,
              description: p.description,
              icon_url: p.icon_url,
              author: 'Dependency',
              downloads: p.downloads || 0,
              follows: p.followers || 0,
              slug: p.slug,
              loaders: p.loaders,
              versions: p.versions,
            }));
            setDependencies(mappedDeps);
          }
        }
      } catch (err) {
        console.error('Failed to load full mod details:', err);
      } finally {
        setLoadingDetails(false);
      }
    };

    loadDetails();
  }, [mod]);

  if (!mod) return null;

  const isCurseForge = mod.project_id.startsWith('cf-');
  const externalLinkUrl = isCurseForge
    ? `https://www.curseforge.com/minecraft/mc-mods/${mod.slug}`
    : `https://modrinth.com/mod/${mod.slug}`;

  const formatCount = (num: number) => {
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(0)}k`;
    return num.toString();
  };

  const screenshots = details?.screenshots || [];

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-2xl flex items-center justify-center z-60 p-4 sm:p-6 md:p-8 animate-in fade-in duration-200">
      <div className="relative bg-[#0F0F0F] border border-white/[0.08] rounded-3xl w-full h-[92vh] max-w-5xl flex flex-col overflow-hidden shadow-2xl">
        {/* Top Header */}
        <div className="relative h-16 px-6 border-b border-white/[0.07] flex items-center justify-between shrink-0 bg-[#0C0C0C]/80">
          {/* Centered Navigation Tabs Pill */}
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1 bg-white/[0.04] p-1 rounded-2xl border border-white/[0.06] z-10">
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-4 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                activeTab === 'overview' ? 'bg-white text-black shadow-sm' : 'text-white/50 hover:text-white'
              }`}
            >
              Description & Details
            </button>

            {screenshots.length > 0 && (
              <button
                onClick={() => setActiveTab('gallery')}
                className={`px-4 py-1.5 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'gallery' ? 'bg-white text-black shadow-sm' : 'text-white/50 hover:text-white'
                }`}
              >
                <ImageIcon className="size-3.5" />
                <span>Gallery</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${activeTab === 'gallery' ? 'bg-black/10 text-black' : 'bg-white/10 text-white/70'}`}>
                  {screenshots.length}
                </span>
              </button>
            )}

            <button
              onClick={() => setActiveTab('dependencies')}
              className={`px-4 py-1.5 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'dependencies' ? 'bg-white text-black shadow-sm' : 'text-white/50 hover:text-white'
              }`}
            >
              <Layers className="size-3.5" />
              <span>Dependencies</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${activeTab === 'dependencies' ? 'bg-black/10 text-black' : 'bg-white/10 text-white/70'}`}>
                {dependencies.length}
              </span>
            </button>
          </div>

          {/* Right Close Button */}
          <div className="ml-auto flex items-center z-10">
            <button
              onClick={onClose}
              className="size-8 rounded-full bg-white/[0.04] hover:bg-white/10 text-white/50 hover:text-white flex items-center justify-center transition-all cursor-pointer"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Hero Mod Summary Section (Always visible on top of modal) */}
        <div className="p-6 border-b border-white/[0.06] bg-[#0E0E0E] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5 shrink-0">
          <div className="flex items-start gap-4 min-w-0">
            {mod.icon_url ? (
              <img
                src={mod.icon_url}
                alt={mod.title}
                className="size-16 rounded-2xl object-cover bg-neutral-900 border border-white/10 shrink-0 shadow-lg"
              />
            ) : (
              <div className="size-16 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-center text-white/40 shrink-0">
                <Package className="size-8" />
              </div>
            )}

            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-bold text-white tracking-tight leading-snug">{mod.title}</h2>
                <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-white/10 text-white/70">
                  {isCurseForge ? 'CurseForge' : 'Modrinth'}
                </span>
              </div>
              <p className="text-xs text-white/50">
                by <span className="text-white/80 font-medium">{details?.author || mod.author}</span>
              </p>
              <div className="flex items-center gap-3 pt-0.5 text-xs text-white/40 font-mono">
                <span className="flex items-center gap-1">
                  <ArrowDownToLine className="size-3" />
                  {formatCount(details?.downloads || mod.downloads)} downloads
                </span>
                {(details?.followers || mod.follows) > 0 && (
                  <span className="flex items-center gap-1">
                    <Heart className="size-3" />
                    {formatCount(details?.followers || mod.follows)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Action Links & Install Button */}
          <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
            <a
              href={externalLinkUrl}
              target="_blank"
              rel="noreferrer"
              className="px-3.5 py-2 rounded-xl bg-white/[0.04] hover:bg-white/10 text-white/70 hover:text-white text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <span>{isCurseForge ? 'CurseForge Page' : 'Modrinth Page'}</span>
              <ExternalLink className="size-3" />
            </a>

            <button
              onClick={() => onInstall(mod)}
              disabled={isInstalling || isInstalled}
              className={`px-5 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer shadow-lg active:scale-98 ${
                isInstalled
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  : isInstalling
                  ? 'bg-neutral-700 text-white animate-pulse'
                  : 'bg-white text-black hover:bg-neutral-200'
              }`}
            >
              {isInstalled ? (
                <>
                  <CheckCircle2 className="size-4" />
                  <span>Installed to {targetInstanceName || 'Instance'}</span>
                </>
              ) : isInstalling ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  <span>Installing...</span>
                </>
              ) : (
                <>
                  <Download className="size-4" />
                  <span>Install to {targetInstanceName || 'Instance'}</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8">
          {loadingDetails ? (
            <div className="flex flex-col items-center justify-center py-24 text-xs text-white/40 space-y-3">
              <Loader2 className="size-6 animate-spin text-white/30" />
              <span>Loading full mod details and assets...</span>
            </div>
          ) : activeTab === 'overview' ? (
            <div className="max-w-4xl mx-auto space-y-8">
              {/* Short summary banner */}
              <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/[0.06] text-xs text-white/70 leading-relaxed">
                {details?.description || mod.description}
              </div>

              {/* External Links Bar */}
              {details && (details.source_url || details.wiki_url || details.issues_url || details.discord_url) && (
                <div className="flex items-center gap-2 flex-wrap">
                  {details.source_url && (
                    <a
                      href={details.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3.5 py-1.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.06] text-white/70 hover:text-white text-xs flex items-center gap-1.5 transition-all"
                    >
                      <Code2 className="size-3.5" />
                      <span>Source Code</span>
                    </a>
                  )}
                  {details.wiki_url && (
                    <a
                      href={details.wiki_url}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3.5 py-1.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.06] text-white/70 hover:text-white text-xs flex items-center gap-1.5 transition-all"
                    >
                      <Globe className="size-3.5" />
                      <span>Documentation / Wiki</span>
                    </a>
                  )}
                  {details.issues_url && (
                    <a
                      href={details.issues_url}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3.5 py-1.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.06] text-white/70 hover:text-white text-xs flex items-center gap-1.5 transition-all"
                    >
                      <FileCode className="size-3.5" />
                      <span>Issue Tracker</span>
                    </a>
                  )}
                </div>
              )}

              {/* Full Description / Body formatted with images and styling */}
              <div className="space-y-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-white/40">Description</h3>
                <div
                  className="prose prose-invert max-w-none text-xs text-white/70 leading-relaxed space-y-3 font-normal"
                  dangerouslySetInnerHTML={{ __html: details?.bodyHtml || `<p>${mod.description}</p>` }}
                />
              </div>
            </div>
          ) : activeTab === 'gallery' ? (
            /* Tab 2: Screenshots Gallery */
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="flex items-center justify-between text-xs text-white/40">
                <span>Screenshots & Media for <strong className="text-white/80">{mod.title}</strong></span>
                <span>{screenshots.length} images</span>
              </div>

              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3">
                {screenshots.map((s, idx) => (
                  <div
                    key={idx}
                    onClick={() => setSelectedGalleryImage(s)}
                    className="group relative rounded-2xl overflow-hidden border border-white/10 bg-[#0E0E0E] cursor-pointer hover:border-white/30 transition-all aspect-video flex items-center justify-center"
                  >
                    <img
                      src={s.url}
                      alt={s.title || 'Screenshot'}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      loading="lazy"
                    />
                    {s.title && (
                      <div className="absolute inset-x-0 bottom-0 p-2.5 bg-gradient-to-t from-black/80 to-transparent text-[11px] text-white/90 truncate font-medium">
                        {s.title}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* Tab 3: Dependencies */
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="flex items-center justify-between text-xs text-white/40">
                <span>
                  Dependencies required or recommended by <strong className="text-white/80">{mod.title}</strong>
                </span>
                <span>{dependencies.length} dependencies</span>
              </div>

              {dependencies.length === 0 ? (
                <div className="p-12 text-center border border-dashed border-white/[0.08] rounded-3xl space-y-2">
                  <Layers className="size-8 text-white/20 mx-auto" />
                  <p className="text-xs text-white/50">This mod has no declared dependencies.</p>
                </div>
              ) : (
                <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
                  {dependencies.map((dep) => (
                    <div
                      key={dep.project_id}
                      className="p-4 rounded-2xl bg-white/[0.02] border border-white/[0.06] hover:border-white/15 flex items-start gap-3.5 transition-all"
                    >
                      {dep.icon_url ? (
                        <img
                          src={dep.icon_url}
                          alt=""
                          className="size-11 rounded-xl object-cover bg-neutral-900 border border-white/10 shrink-0"
                        />
                      ) : (
                        <div className="size-11 rounded-xl bg-white/[0.04] border border-white/10 flex items-center justify-center text-white/40 shrink-0">
                          <Package className="size-5" />
                        </div>
                      )}

                      <div className="min-w-0 flex-1 space-y-1">
                        <h4 className="text-xs font-semibold text-white truncate">{dep.title}</h4>
                        <p className="text-[11px] text-white/40 line-clamp-2 leading-relaxed">{dep.description}</p>
                        <div className="flex items-center gap-2 pt-1 text-[10px] text-white/30">
                          <span>by {dep.author}</span>
                          <span>•</span>
                          <span>{(dep.downloads / 1_000_000).toFixed(1)}M downloads</span>
                        </div>
                      </div>

                      <button
                        onClick={() => onInstall(dep)}
                        className="px-3 py-1.5 rounded-full text-xs font-semibold bg-white text-black hover:bg-neutral-200 shrink-0 flex items-center gap-1.5 transition-all cursor-pointer"
                      >
                        <Download className="size-3.5" />
                        <span>Add</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Fullscreen Screenshot Lightbox */}
        {selectedGalleryImage && (
          <div
            onClick={() => setSelectedGalleryImage(null)}
            className="fixed inset-0 bg-black/95 z-70 flex items-center justify-center p-6 animate-in fade-in duration-150 cursor-zoom-out"
          >
            <div className="relative max-w-5xl max-h-[90vh] flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
              <img
                src={selectedGalleryImage.url}
                alt=""
                className="max-h-[80vh] w-auto rounded-2xl border border-white/20 shadow-2xl object-contain"
              />
              {selectedGalleryImage.title && (
                <p className="text-xs text-white/80 font-medium text-center">{selectedGalleryImage.title}</p>
              )}
              <button
                onClick={() => setSelectedGalleryImage(null)}
                className="absolute -top-4 -right-4 size-8 rounded-full bg-white/20 hover:bg-white text-white hover:text-black flex items-center justify-center transition-all cursor-pointer shadow-lg"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
