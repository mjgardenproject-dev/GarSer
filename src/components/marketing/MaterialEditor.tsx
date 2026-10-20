import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Copy, Download, Loader2, Lock, Share2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import MaterialPreview from './MaterialPreview';
import type { MarketingMaterial } from '../../utils/marketing/materials';
import {
  buildMarketingContent,
  flyerCaption,
  headlinePresets,
  HEADLINE_MAX,
  MAX_SERVICES,
  materialFileName,
  SUBTITLE_MAX,
  bookingUrl,
  type MarketingOptions,
  type MarketingProfile,
  type MarketingTheme,
} from '../../utils/marketing/content';
import { renderToBlob } from '../../utils/marketing/renderMaterial';
import { canShareFiles, downloadFiles, logMarketingDownload, shareFiles } from '../../utils/marketing/exportMaterial';

// Editor de un material: vista previa en vivo, lo que se puede cambiar y «Compartir o descargar»
// con uno o varios tamaños a la vez. Sin aparecer a los clientes se ve, pero no se descarga.

interface Props {
  material: MarketingMaterial;
  profile: MarketingProfile;
  visibleServices: string[];
  feeWaiverEnabled: boolean;
  canDownload: boolean;
  avatar: HTMLImageElement | null;
  options: MarketingOptions;
  onOptionsChange: (next: MarketingOptions) => void;
  onBack: () => void;
  onCompleteAccount: () => void;
}

const THEMES: Array<{ id: MarketingTheme; label: string; swatch: string }> = [
  { id: 'green', label: 'Verde', swatch: 'bg-[#0E3A22]' },
  { id: 'light', label: 'Claro', swatch: 'bg-white' },
];

const chip = (active: boolean) =>
  `inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 [touch-action:manipulation] ${
    active ? 'border-emerald-600 bg-emerald-50 text-emerald-900' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
  }`;

const MaterialEditor: React.FC<Props> = ({
  material,
  profile,
  visibleServices,
  feeWaiverEnabled,
  canDownload,
  avatar,
  options,
  onOptionsChange,
  onBack,
  onCompleteAccount,
}) => {
  const [previewId, setPreviewId] = useState(material.sizes[0].id);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([material.sizes[0].id]);
  const [busy, setBusy] = useState<null | 'share' | 'download'>(null);
  const presets = useMemo(() => headlinePresets(new Date()), []);
  const [customHeadline, setCustomHeadline] = useState(() => (presets.includes(options.headline) ? '' : options.headline));
  const sheetRef = useRef<HTMLDivElement>(null);
  const shareSupported = useMemo(() => canShareFiles(), []);

  const content = useMemo(
    () => buildMarketingContent({ profile, visibleServices, feeWaiverEnabled, options, source: material.id }),
    [profile, visibleServices, feeWaiverEnabled, options, material.id],
  );
  const previewSize = material.sizes.find((s) => s.id === previewId) ?? material.sizes[0];
  const set = (patch: Partial<MarketingOptions>) => onOptionsChange({ ...options, ...patch });

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    if (!sheetOpen) return undefined;
    sheetRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) setSheetOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheetOpen, busy]);

  const toggleService = (name: string) => {
    const has = options.services.includes(name);
    if (!has && options.services.length >= MAX_SERVICES) return;
    set({ services: has ? options.services.filter((s) => s !== name) : [...options.services, name] });
  };

  const openSheet = () => {
    setSelected([previewSize.id]);
    setSheetOpen(true);
  };

  const exportSelected = async (mode: 'share' | 'download') => {
    const sizes = material.sizes.filter((s) => selected.includes(s.id));
    if (sizes.length === 0) return;
    setBusy(mode);
    try {
      const files: File[] = [];
      for (const size of sizes) {
        const blob = await renderToBlob({ material: material.id, size, content, avatar });
        files.push(new File([blob], materialFileName(profile.name, material.id, size.id), { type: 'image/png' }));
      }
      if (mode === 'share') {
        const shared = await shareFiles(files, material.title);
        if (!shared) return;
      } else {
        await downloadFiles(files);
        toast.success(files.length === 1 ? 'Imagen descargada' : `${files.length} imágenes descargadas`);
      }
      void logMarketingDownload(material.id, sizes.map((s) => s.id));
      setSheetOpen(false);
    } catch (error) {
      console.error('No se pudo exportar el material:', error);
      toast.error('No se ha podido preparar la imagen. Inténtalo de nuevo.');
    } finally {
      setBusy(null);
    }
  };

  const copyCaption = async () => {
    try {
      await navigator.clipboard.writeText(flyerCaption(content, profile.zone, bookingUrl(profile.providerId, 'instagram')));
      toast.success('Texto copiado: pégalo en tu publicación');
    } catch {
      toast.error('No se ha podido copiar el texto');
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex min-h-11 items-center gap-2 rounded-lg px-1 text-sm font-semibold text-gray-700 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Marketing
      </button>

      <header className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900">{material.title}</h1>
        <p className="mt-1 text-gray-600">{material.use}</p>
      </header>

      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] md:items-start">
        {/* Vista previa: el mismo dibujo que se descarga. */}
        <section aria-label="Vista previa" className="rounded-2xl border border-gray-200 bg-gray-50 p-3 sm:p-4 md:sticky md:top-20">
          {material.sizes.length > 1 && (
            <div role="tablist" aria-label="Tamaño de la vista previa" className="mb-3 flex flex-wrap gap-2">
              {material.sizes.map((size) => (
                <button
                  key={size.id}
                  type="button"
                  role="tab"
                  aria-selected={size.id === previewSize.id}
                  onClick={() => setPreviewId(size.id)}
                  className={chip(size.id === previewSize.id)}
                >
                  {size.label}
                </button>
              ))}
            </div>
          )}
          <MaterialPreview
            material={material.id}
            size={previewSize}
            content={content}
            avatar={avatar}
            maxSide={1100}
            label={`Vista previa: ${material.title}, ${previewSize.label}`}
            className="mx-auto flex max-h-[60vh] justify-center"
          />
          <p className="mt-2 text-center text-xs text-gray-500">{previewSize.detail}</p>
        </section>

        <div className="space-y-5">
          {/* Acciones arriba: lo primero que se toca en el móvil, sin bajar. */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={openSheet}
              disabled={!canDownload}
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 py-3 text-base font-bold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-gray-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 [touch-action:manipulation]"
            >
              {canDownload ? <Share2 className="h-5 w-5" aria-hidden="true" /> : <Lock className="h-5 w-5" aria-hidden="true" />}
              Compartir o descargar
            </button>
            {!canDownload && (
              <p className="text-sm text-gray-600">
                Podrás descargarlo cuando aparezcas a los clientes.{' '}
                <button type="button" onClick={onCompleteAccount} className="font-semibold text-emerald-700 underline">
                  Completar mi cuenta
                </button>
              </p>
            )}
            {material.id === 'social' && (
              <button
                type="button"
                onClick={() => void copyCaption()}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-800 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 [touch-action:manipulation]"
              >
                <Copy className="h-4 w-4" aria-hidden="true" /> Copiar texto para la publicación
              </button>
            )}
          </div>

          <fieldset>
            <legend className="mb-2 text-sm font-bold text-gray-900">Estilo</legend>
            <div className="flex flex-wrap gap-2">
              {THEMES.map((theme) => (
                <button key={theme.id} type="button" aria-pressed={options.theme === theme.id} onClick={() => set({ theme: theme.id })} className={chip(options.theme === theme.id)}>
                  <span className={`h-5 w-5 rounded-full border border-gray-300 ${theme.swatch}`} aria-hidden="true" />
                  {theme.label}
                </button>
              ))}
            </div>
          </fieldset>

          {material.options.headline && (
            <fieldset>
              <legend className="mb-2 text-sm font-bold text-gray-900">Titular</legend>
              <div className="flex flex-col gap-2">
                {presets.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    aria-pressed={options.headline === preset}
                    onClick={() => {
                      setCustomHeadline('');
                      set({ headline: preset });
                    }}
                    className={`${chip(options.headline === preset)} justify-start text-left`}
                  >
                    {options.headline === preset && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
                    {preset}
                  </button>
                ))}
                <label className="block">
                  <span className="sr-only">Escribe tu titular</span>
                  <input
                    type="text"
                    value={customHeadline}
                    maxLength={HEADLINE_MAX}
                    placeholder="O escribe el tuyo"
                    onChange={(event) => {
                      setCustomHeadline(event.target.value);
                      if (event.target.value.trim()) set({ headline: event.target.value });
                    }}
                    className="w-full rounded-xl border border-gray-300 px-3 py-3 text-base focus:border-transparent focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </label>
              </div>
            </fieldset>
          )}

          {material.options.subtitle && (
            <label className="block">
              <span className="mb-2 block text-sm font-bold text-gray-900">Debajo de tu nombre</span>
              <input
                type="text"
                value={options.subtitle}
                maxLength={SUBTITLE_MAX}
                onChange={(event) => set({ subtitle: event.target.value })}
                className="w-full rounded-xl border border-gray-300 px-3 py-3 text-base focus:border-transparent focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <span className="mt-1 block text-xs text-gray-500">Por ejemplo, tu zona. Nunca sale tu dirección ni tu teléfono.</span>
            </label>
          )}

          {material.options.services && (
            <fieldset>
              <legend className="mb-2 text-sm font-bold text-gray-900">
                Servicios <span className="font-normal text-gray-500">(hasta {MAX_SERVICES})</span>
              </legend>
              {visibleServices.length === 0 ? (
                <p className="text-sm text-gray-600">Aquí saldrán los servicios en los que ya apareces a los clientes.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {visibleServices.map((name) => {
                    const on = options.services.includes(name);
                    const full = !on && options.services.length >= MAX_SERVICES;
                    return (
                      <button key={name} type="button" aria-pressed={on} disabled={full} onClick={() => toggleService(name)} className={`${chip(on)} disabled:opacity-50`}>
                        {on && <Check className="h-4 w-4" aria-hidden="true" />}
                        {name}
                      </button>
                    );
                  })}
                </div>
              )}
            </fieldset>
          )}

          {material.options.rating && profile.ratingCount > 0 && (
            <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2">
              <span className="text-sm font-semibold text-gray-900">Enseñar mi valoración</span>
              <input type="checkbox" checked={options.showRating} onChange={(event) => set({ showRating: event.target.checked })} className="h-5 w-5 rounded text-emerald-700" />
            </label>
          )}

          <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-900">
            <p className="font-semibold">Consejo</p>
            <p className="mt-1">{material.tip}</p>
            {material.printNote && <p className="mt-2 text-emerald-800">{material.printNote}</p>}
          </div>
        </div>
      </div>

      {/* Hoja «Compartir o descargar»: uno o varios tamaños a la vez. */}
      {sheetOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="presentation">
          <button type="button" aria-label="Cerrar" className="absolute inset-0 bg-black/40" onClick={() => !busy && setSheetOpen(false)} />
          <div
            ref={sheetRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="export-title"
            className="relative max-h-[88vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-xl outline-none sm:max-w-md sm:rounded-2xl"
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 id="export-title" className="text-lg font-bold text-gray-900">Elige los tamaños</h2>
                <p className="text-sm text-gray-600">Puedes elegir varios a la vez.</p>
              </div>
              <button
                type="button"
                onClick={() => !busy && setSheetOpen(false)}
                aria-label="Cerrar"
                className="-mr-2 -mt-1 inline-flex h-11 w-11 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <ul className="space-y-2">
              {material.sizes.map((size) => {
                const on = selected.includes(size.id);
                return (
                  <li key={size.id}>
                    <label className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 ${on ? 'border-emerald-600 bg-emerald-50' : 'border-gray-200'}`}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => setSelected((prev) => (on ? prev.filter((id) => id !== size.id) : [...prev, size.id]))}
                        className="h-5 w-5 rounded text-emerald-700"
                      />
                      <span className="min-w-0">
                        <span className="block font-semibold text-gray-900">{size.label}</span>
                        <span className="block text-sm text-gray-600">{size.detail}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            {material.printNote && <p className="mt-3 text-sm text-gray-600">{material.printNote}</p>}
            <div className="mt-4 grid gap-2">
              {shareSupported && (
                <button
                  type="button"
                  disabled={selected.length === 0 || busy !== null}
                  onClick={() => void exportSelected('share')}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  {busy === 'share' ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Share2 className="h-5 w-5" aria-hidden="true" />}
                  {busy === 'share' ? 'Preparando…' : 'Compartir'}
                </button>
              )}
              <button
                type="button"
                disabled={selected.length === 0 || busy !== null}
                onClick={() => void exportSelected('download')}
                className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 py-3 font-bold disabled:opacity-50 ${
                  shareSupported ? 'border border-gray-200 bg-white text-gray-900 hover:bg-gray-50' : 'bg-emerald-700 text-white hover:bg-emerald-800'
                }`}
              >
                {busy === 'download' ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Download className="h-5 w-5" aria-hidden="true" />}
                {busy === 'download' ? 'Preparando…' : selected.length > 1 ? `Descargar ${selected.length} imágenes` : 'Descargar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MaterialEditor;
