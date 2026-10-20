import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { AlertTriangle, Building2, CheckCircle, ExternalLink, Eye, RefreshCw, Shield, User, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { formatLicenseDate } from '../../shared/phytoLicense';
import { holderKindLabel, REJECTION_PRESETS, type AdminLicenseRow } from './licenseReview';

// Revisión de carnets fitosanitarios (admin). La cola viene de `admin_phyto_license_queue`: de quién
// es (autónomo, empresa o empleado de qué empresa), si es una renovación, si lo envió la empresa y
// cuántas veces se rechazó antes. La decisión pasa por `review_gardener_license`, que exige la
// caducidad para aprobar (D1) y el motivo para rechazar (lo ve quien lo envió).

const isPdfPath = (path: string) => /\.pdf$/i.test(path);

const LicenseVerificationAdmin: React.FC = () => {
  const [licenses, setLicenses] = useState<AdminLicenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [selected, setSelected] = useState<AdminLicenseRow | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [docError, setDocError] = useState(false);
  const [processing, setProcessing] = useState(false);
  // D1: la caducidad la escribe el admin ANTES de aprobar (también lo exige la RPC).
  const [expiresAt, setExpiresAt] = useState('');
  const [reason, setReason] = useState('');

  const fetchPendingLicenses = useCallback(async () => {
    setLoading(true);
    setErrorMsg('');
    const { data, error } = await supabase.rpc('admin_phyto_license_queue');
    if (error) setErrorMsg(error.message || 'No se han podido cargar los carnets.');
    else setLicenses((data as unknown as AdminLicenseRow[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void fetchPendingLicenses(); }, [fetchPendingLicenses]);

  const viewDocument = async (license: AdminLicenseRow) => {
    setSelected(license);
    setSignedUrl(null);
    setDocError(false);
    setExpiresAt('');
    setReason('');
    // Enlace firmado de 5 minutos: el documento nunca es público.
    const { data, error } = await supabase.storage.from('private_licenses').createSignedUrl(license.document_url, 300);
    if (error || !data?.signedUrl) {
      setDocError(true);
      toast.error('No se pudo cargar el documento de manera segura');
      return;
    }
    setSignedUrl(data.signedUrl);
  };

  const close = () => {
    if (processing) return;
    setSelected(null);
  };

  const handleAction = async (status: 'approved' | 'rejected') => {
    if (!selected) return;
    if (status === 'approved' && !expiresAt) {
      toast.error('Indica la fecha de caducidad del carnet antes de aprobarlo.');
      return;
    }
    if (status === 'rejected' && reason.trim().length < 3) {
      toast.error('Escribe el motivo del rechazo: lo verá quien lo envió.');
      return;
    }
    setProcessing(true);
    try {
      const { error } = await supabase.rpc('review_gardener_license', {
        p_license_id: selected.id,
        p_status: status,
        p_expires_at: status === 'approved' ? new Date(`${expiresAt}T23:59:59`).toISOString() : undefined,
        p_reason: status === 'rejected' ? reason.trim() : undefined,
      });
      if (error) throw error;
      toast.success(status === 'approved' ? 'Carnet aprobado. Le avisamos.' : 'Carnet rechazado. Le avisamos con el motivo.');
      setSelected(null);
      void fetchPendingLicenses();
    } catch (e: unknown) {
      toast.error((e as { message?: string })?.message || 'Error al guardar la revisión');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <div className="mb-6 flex items-center gap-3">
        <Shield className="h-8 w-8 text-emerald-700" aria-hidden="true" />
        <h1 className="text-2xl font-bold text-gray-900">Carnets fitosanitarios</h1>
      </div>

      {errorMsg && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p>{errorMsg}</p>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 p-4">
          <h2 className="font-semibold text-gray-800">Pendientes de revisar ({licenses.length})</h2>
          <button type="button" onClick={() => void fetchPendingLicenses()} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-emerald-700 hover:text-emerald-800">
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Actualizar
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-gray-500">Cargando carnets…</div>
        ) : licenses.length === 0 ? (
          <div className="flex flex-col items-center p-8 text-center text-gray-500">
            <CheckCircle className="mb-3 h-12 w-12 text-green-300" aria-hidden="true" />
            <p>No hay carnets pendientes de revisión.</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {licenses.map((license) => (
              <li key={license.id} className="flex flex-col justify-between gap-4 p-4 hover:bg-gray-50 sm:flex-row sm:items-center">
                <div className="min-w-0">
                  <h3 className="font-bold text-gray-900">{license.holder_name || 'Sin nombre'}</h3>
                  <p className="mt-0.5 flex items-center gap-1.5 text-sm text-gray-700">
                    {license.holder_kind === 'solo' ? <User className="h-4 w-4 text-gray-500" aria-hidden="true" /> : <Building2 className="h-4 w-4 text-gray-500" aria-hidden="true" />}
                    {holderKindLabel(license)}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {license.current_expires_at && (
                      <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800">Renovación · el actual vale hasta el {formatLicenseDate(license.current_expires_at)}</span>
                    )}
                    {license.submitted_by_company && (
                      <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-800">Lo envió su empresa</span>
                    )}
                    {license.previous_rejections > 0 && (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                        Rechazado {license.previous_rejections} {license.previous_rejections === 1 ? 'vez' : 'veces'} antes
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-xs text-gray-500">
                    Enviado el {new Date(license.created_at).toLocaleString('es-ES')}
                    {license.license_number && ` · Nº ${license.license_number}`}
                    {license.phone && ` · Tel. ${license.phone}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void viewDocument(license)}
                  className="inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-emerald-200 bg-emerald-50 px-4 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
                >
                  <Eye className="h-4 w-4" aria-hidden="true" /> Revisar
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selected && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 sm:items-center sm:p-4" role="presentation" onClick={close}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="license-review-title"
            className="flex max-h-[94vh] w-full max-w-3xl flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-gray-200 p-4">
              <div className="min-w-0">
                <h3 id="license-review-title" className="font-bold text-gray-900">Carnet de {selected.holder_name || 'sin nombre'}</h3>
                <p className="text-sm text-gray-600">{holderKindLabel(selected)}{selected.email && selected.email !== selected.holder_name ? ` · ${selected.email}` : ''}</p>
              </div>
              <button type="button" onClick={close} aria-label="Cerrar" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100">✕</button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto bg-gray-50 p-4">
              {docError ? (
                <div className="flex h-48 flex-col items-center justify-center rounded-lg border border-red-100 bg-red-50 p-6 text-center text-red-600">
                  <AlertTriangle className="mb-3 h-10 w-10 opacity-80" aria-hidden="true" />
                  <p className="mb-1 font-semibold">No se pudo cargar el documento</p>
                  <p className="max-w-sm text-sm opacity-90">El archivo no existe o no tienes permiso para verlo. Recházalo pidiendo que lo suban de nuevo.</p>
                </div>
              ) : signedUrl ? (
                <>
                <a href={signedUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-emerald-700 hover:text-emerald-800">
                  <ExternalLink className="h-4 w-4" aria-hidden="true" /> Abrir el documento en otra pestaña
                </a>
                <div className="flex justify-center overflow-hidden rounded-lg border border-gray-200 bg-white">
                  {isPdfPath(selected.document_url) ? (
                    <iframe src={signedUrl} className="h-[60vh] min-h-[400px] w-full" title="Carnet en PDF" />
                  ) : (
                    <a href={signedUrl} target="_blank" rel="noopener noreferrer" title="Abrir a tamaño completo">
                      <img src={signedUrl} alt="Carnet fitosanitario enviado" className="max-h-[60vh] max-w-full object-contain" />
                    </a>
                  )}
                </div>
                </>
              ) : (
                <div className="flex h-48 flex-col items-center justify-center gap-3 text-gray-500">
                  <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-emerald-700" />
                  <p className="text-sm">Generando enlace seguro…</p>
                </div>
              )}

              <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-700">
                <p className="font-semibold text-gray-900">Declaración responsable</p>
                <p className="mt-1">
                  {selected.submitted_by_company
                    ? `Lo envió ${selected.company_name || 'su empresa'}, declarando que es el carnet de esta persona, que está en vigor y que tiene su permiso para enviarlo.`
                    : 'Lo envió el titular, declarando que es su carnet, que está en vigor y que los datos son ciertos.'}
                </p>
                {selected.license_number && <p className="mt-2 font-medium text-gray-900">Número indicado: {selected.license_number}</p>}
                {selected.current_expires_at && (
                  <p className="mt-2 text-sky-800">Es una renovación: el carnet actual vale hasta el {formatLicenseDate(selected.current_expires_at)}. Si rechazas este, el actual sigue valiendo.</p>
                )}
              </div>

              {/* D1: la caducidad se escribe ANTES de aprobar. */}
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                <label htmlFor="license-expires-at" className="mb-1 block text-sm font-semibold text-amber-900">Para aprobar: fecha de caducidad del carnet</label>
                <p className="mb-2 text-xs text-amber-800">
                  Compruébala en el documento. Ese día caduca solo: le avisaremos 30 días antes y, al caducar, deja de poder hacer tratamientos químicos hasta que se apruebe el renovado.
                </p>
                <input
                  id="license-expires-at"
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  min={new Date().toISOString().slice(0, 10)}
                  className="rounded-lg border border-amber-300 px-3 py-2 text-base"
                />
              </div>

              <div className="rounded-lg border border-red-100 bg-white p-4">
                <label htmlFor="license-reason" className="mb-1 block text-sm font-semibold text-gray-900">Para rechazar: motivo</label>
                <p className="mb-2 text-xs text-gray-600">Lo verá quien lo envió (y su empresa, si es un empleado). Dile qué tiene que corregir.</p>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {REJECTION_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setReason(preset)}
                      className={`rounded-full border px-2.5 py-1 text-left text-xs ${reason === preset ? 'border-red-300 bg-red-50 text-red-800' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <textarea
                  id="license-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value.slice(0, 300))}
                  rows={2}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
                />
              </div>
            </div>

            <div className="flex gap-3 border-t border-gray-200 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:justify-end sm:rounded-b-2xl">
              <button
                type="button"
                onClick={() => void handleAction('rejected')}
                disabled={processing || reason.trim().length < 3}
                title={reason.trim().length < 3 ? 'Escribe antes el motivo' : undefined}
                className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-5 font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50 sm:flex-none"
              >
                <XCircle className="h-5 w-5" aria-hidden="true" /> Rechazar
              </button>
              <button
                type="button"
                onClick={() => void handleAction('approved')}
                disabled={processing || docError || !signedUrl || !expiresAt}
                title={!expiresAt ? 'Indica antes la fecha de caducidad' : undefined}
                className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 sm:flex-none"
              >
                <CheckCircle className="h-5 w-5" aria-hidden="true" /> Aprobar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LicenseVerificationAdmin;
