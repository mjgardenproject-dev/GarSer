import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BadgeCheck, Camera, Clock, FileText, Loader2, Plus, ShieldCheck, Upload, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import {
  canUpload,
  EMPTY_LICENSE,
  LICENSE_NUMBER_MAX,
  licenseStatusCopy,
  licenseView,
  needsUpload,
  type LicenseTone,
  type PhytoLicenseStatus,
  type PhytoLicenseSummary,
} from '../../shared/phytoLicense';
import { checkLicenseFile, formatFileSize, isPdfFile, licenseObjectPath, prepareLicenseUpload, sha256Hex } from '../../utils/licenseFile';

// Carnet fitosanitario (2026-10-20): estado y envío, para el autónomo, el dueño de una empresa y el
// empleado; y, con `forMember`, para que el dueño lo envíe en nombre de alguien de su equipo.
// El estado lo calcula el servidor (my_phyto_license o el que llega por props) y el envío pasa por
// submit_phyto_license, que comprueba quién lo envía, para quién y el archivo.

interface Props {
  /** El dueño envía el carnet de alguien de su equipo. */
  forMember?: { memberId: string; userId: string; name: string };
  /** Estado ya cargado (empleado y equipo). Sin él, se pide el propio con my_phyto_license. */
  summary?: PhytoLicenseSummary | null;
  /** Texto bajo el título. */
  intro?: string;
  onStatusChange?: (status: PhytoLicenseStatus | null) => void;
  /** Tras enviarlo (para recargar lo que lo contiene). */
  onSubmitted?: () => void;
  id?: string;
  /** Sin borde ni título: dentro de una hoja que ya los tiene. */
  bare?: boolean;
}

const TONE: Record<Exclude<LicenseTone, 'none'>, { box: string; icon: React.ReactNode }> = {
  ok: { box: 'border-emerald-200 bg-emerald-50 text-emerald-900', icon: <BadgeCheck className="h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" /> },
  info: { box: 'border-sky-200 bg-sky-50 text-sky-900', icon: <Clock className="h-5 w-5 shrink-0 text-sky-700" aria-hidden="true" /> },
  warn: { box: 'border-amber-200 bg-amber-50 text-amber-900', icon: <AlertTriangle className="h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" /> },
  bad: { box: 'border-red-200 bg-red-50 text-red-900', icon: <AlertTriangle className="h-5 w-5 shrink-0 text-red-700" aria-hidden="true" /> },
};

const PhytosanitaryLicenseUpload: React.FC<Props> = ({ forMember, summary: summaryProp, intro, onStatusChange, onSubmitted, id, bare = false }) => {
  const { user } = useAuth();
  const uid = useId();
  const [ownSummary, setOwnSummary] = useState<PhytoLicenseSummary | null>(null);
  const [loading, setLoading] = useState(summaryProp === undefined);
  const [formOpen, setFormOpen] = useState(false);
  const [images, setImages] = useState<File[]>([]);
  const [pdf, setPdf] = useState<File | null>(null);
  const [licenseNumber, setLicenseNumber] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const summary = summaryProp !== undefined ? summaryProp ?? EMPTY_LICENSE : ownSummary ?? EMPTY_LICENSE;
  const view = licenseView(summary);
  const status = licenseStatusCopy(summary, forMember ? 'company' : 'self');
  const holderId = forMember?.userId ?? user?.id ?? '';
  const showForm = canUpload(view) && (needsUpload(view) || formOpen);

  const loadOwn = useCallback(async () => {
    if (summaryProp !== undefined || !user?.id) return;
    const { data, error } = await supabase.rpc('my_phyto_license');
    if (!error) setOwnSummary((data as unknown as PhytoLicenseSummary) ?? EMPTY_LICENSE);
    setLoading(false);
  }, [summaryProp, user?.id]);

  useEffect(() => { void loadOwn(); }, [loadOwn]);
  useEffect(() => {
    if (!loading) onStatusChange?.(summary.status);
    // Solo cuando cambia el estado, no en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, summary.status]);

  const previews = useMemo(() => images.map((file) => URL.createObjectURL(file)), [images]);
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);

  const reset = () => {
    setImages([]);
    setPdf(null);
    setLicenseNumber('');
    setAccepted(false);
  };

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const problem = checkLicenseFile(file, { images: pdf ? 0 : images.length, hasPdf: Boolean(pdf) });
    if (problem) {
      toast.error(problem);
      return;
    }
    if (isPdfFile(file)) {
      setPdf(file);
      setImages([]);
    } else {
      setPdf(null);
      setImages((cur) => [...cur, file]);
    }
  };

  const submit = async () => {
    if (!holderId || busy || (!pdf && images.length === 0) || !accepted) return;
    setBusy(true);
    try {
      const prepared = await prepareLicenseUpload(pdf ? [pdf] : images);
      const hash = await sha256Hex(prepared.file);
      const path = licenseObjectPath(holderId, prepared.ext);
      const { error: uploadError } = await supabase.storage
        .from('private_licenses')
        .upload(path, prepared.file, { contentType: prepared.file.type, upsert: false });
      if (uploadError) {
        throw new Error(/size|large/i.test(uploadError.message)
          ? 'El archivo pesa más de 10 MB.'
          : 'No se ha podido subir el archivo. Revisa tu conexión y vuelve a intentarlo.');
      }
      const { error } = await supabase.rpc('submit_phyto_license', {
        p_document_path: path,
        p_declaration: true,
        p_license_number: licenseNumber.trim() || undefined,
        p_document_hash: hash ?? undefined,
        p_member_id: forMember?.memberId,
      });
      if (error) throw new Error(error.message);
      toast.success(forMember ? `Carnet de ${forMember.name} enviado a revisión` : 'Carnet enviado. Te avisaremos cuando esté revisado.');
      reset();
      setFormOpen(false);
      await loadOwn();
      onSubmitted?.();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : 'No se ha podido enviar el carnet.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="h-24 animate-pulse rounded-2xl bg-gray-100" aria-label="Cargando el carnet" />;

  const defaultIntro = forMember
    ? `Si tienes su carnet, puedes enviarlo tú. Le avisaremos de que lo has enviado.`
    : 'Para aplicar insecticidas, fungicidas o herbicidas, la ley pide el carnet de aplicador de productos fitosanitarios. GarSer lo revisa.';
  const hasDraft = Boolean(pdf) || images.length > 0;
  const declaration = forMember
    ? `Declaro que es el carnet de ${forMember.name}, que está en vigor y que tengo su permiso para enviarlo a GarSer.`
    : 'Declaro que es mi carnet de aplicador de productos fitosanitarios, que está en vigor y que los datos son ciertos.';
  const btn = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 [touch-action:manipulation]';

  return (
    <section id={id} aria-labelledby={`${uid}-title`} className={bare ? '' : 'scroll-mt-40 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5'}>
      {!bare && (
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50">
            <ShieldCheck className="h-5 w-5 text-emerald-700" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id={`${uid}-title`} className="text-base font-bold text-gray-900">Carnet fitosanitario</h2>
            <p className="mt-0.5 text-sm text-gray-600">{intro ?? defaultIntro}</p>
          </div>
        </div>
      )}
      {bare && <h2 id={`${uid}-title`} className="sr-only">Carnet fitosanitario</h2>}

      {status.tone !== 'none' && (
        <div className={`mt-4 flex items-start gap-3 rounded-xl border p-3 ${TONE[status.tone].box}`} role="status">
          {TONE[status.tone].icon}
          <div className="min-w-0 text-sm">
            <p className="font-semibold">{status.title}</p>
            <p className="mt-0.5">{status.detail}</p>
          </div>
        </div>
      )}

      {!showForm && canUpload(view) && (
        view === 'expiring' ? (
          <button type="button" onClick={() => setFormOpen(true)} className={`${btn} mt-3 w-full bg-emerald-700 text-white hover:bg-emerald-800`}>
            <Upload className="h-4 w-4" aria-hidden="true" /> Subir el carnet renovado
          </button>
        ) : (
          <button type="button" onClick={() => setFormOpen(true)} className="mt-3 min-h-11 text-sm font-semibold text-emerald-700 hover:text-emerald-800">
            {forMember ? '¿Tienes su carnet renovado? Envíalo' : '¿Has renovado tu carnet? Súbelo'}
          </button>
        )
      )}

      {showForm && (
        <div className="mt-4 space-y-4">
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={pick} aria-hidden="true" tabIndex={-1} />
          <input ref={fileRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={pick} aria-hidden="true" tabIndex={-1} />

          {!hasDraft ? (
            <div>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => cameraRef.current?.click()} className={`${btn} min-h-20 flex-col border-2 border-dashed border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100`}>
                  <Camera className="h-6 w-6" aria-hidden="true" /> Hacer foto
                </button>
                <button type="button" onClick={() => fileRef.current?.click()} className={`${btn} min-h-20 flex-col border-2 border-dashed border-gray-300 bg-white text-gray-800 hover:bg-gray-50`}>
                  <Upload className="h-6 w-6" aria-hidden="true" /> Elegir archivo
                </button>
              </div>
              <p className="mt-2 text-xs text-gray-500">Una foto de cada cara o un PDF. Que se lea entero, con buena luz. Máximo 10 MB.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
              {pdf ? (
                <div className="flex items-center gap-3">
                  <FileText className="h-8 w-8 shrink-0 text-red-600" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-gray-900">{pdf.name}</p>
                    <p className="text-xs text-gray-500">PDF · {formatFileSize(pdf.size)}</p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {previews.map((url, index) => (
                    <figure key={url} className="relative overflow-hidden rounded-lg border border-gray-200 bg-white">
                      <img src={url} alt={index === 0 ? 'Cara delantera del carnet' : 'Cara trasera del carnet'} className="h-32 w-full object-contain" />
                      <figcaption className="px-2 py-1 text-xs text-gray-600">{index === 0 ? 'Delante' : 'Detrás'}</figcaption>
                      <button
                        type="button"
                        onClick={() => setImages((cur) => cur.filter((_, i) => i !== index))}
                        disabled={busy}
                        aria-label={`Quitar la foto ${index === 0 ? 'de delante' : 'de detrás'}`}
                        className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-gray-700 shadow hover:bg-white"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </figure>
                  ))}
                  {images.length === 1 && (
                    <button type="button" onClick={() => cameraRef.current?.click()} disabled={busy} className="flex min-h-32 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-gray-300 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50">
                      <Plus className="h-5 w-5" aria-hidden="true" /> Foto de detrás
                      <span className="text-xs font-normal text-gray-500">si tiene datos</span>
                    </button>
                  )}
                </div>
              )}
              <button type="button" onClick={() => { setImages([]); setPdf(null); }} disabled={busy} className="mt-2 min-h-11 text-sm font-semibold text-gray-700 hover:text-gray-900">
                Cambiar
              </button>
            </div>
          )}

          <div>
            <label htmlFor={`${uid}-number`} className="block text-sm font-medium text-gray-700">Número de carnet <span className="font-normal text-gray-500">(opcional)</span></label>
            <input
              id={`${uid}-number`}
              value={licenseNumber}
              onChange={(e) => setLicenseNumber(e.target.value.slice(0, LICENSE_NUMBER_MAX))}
              disabled={busy}
              autoComplete="off"
              className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
            />
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-gray-50 p-3">
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} disabled={busy} className="mt-0.5 h-5 w-5 shrink-0 rounded text-emerald-700" />
            <span className="text-sm text-gray-700">{declaration}</span>
          </label>

          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            {formOpen && !needsUpload(view) && (
              <button type="button" onClick={() => { reset(); setFormOpen(false); }} disabled={busy} className={`${btn} border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 sm:flex-1`}>
                Cancelar
              </button>
            )}
            <button type="button" onClick={() => void submit()} disabled={busy || !hasDraft || !accepted} className={`${btn} bg-emerald-700 text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-1`}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
              {busy ? 'Enviando…' : 'Enviar a revisión'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
};

export default PhytosanitaryLicenseUpload;
