import React, { useCallback, useEffect, useState } from 'react';
import { Building2, CheckCircle, ChevronDown, ChevronUp, Loader2, RefreshCw, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { useConfirmDialog } from '../common/ConfirmDialog';
import { describeAnswers, TEAM_SIZE_OPTIONS, type CompanyApplicationAnswers } from '../../config/companyApplication';

// Revisión de solicitudes de alta de empresas (GarSer Empresas F3.2, D2). Separada de las de
// jardineros (F3-10). Aprobar o rechazar lo hace el servidor (admin_review_company_application),
// que crea la ficha de empresa, la empresa y su dueño.

interface CompanyApplication {
  id: string;
  user_id: string;
  status: 'submitted' | 'approved' | 'rejected' | 'draft';
  commercial_name: string | null;
  legal_name: string | null;
  tax_id: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city_zone: string | null;
  services: string[];
  owner_works: boolean;
  answers: CompanyApplicationAnswers;
  submitted_at: string | null;
  reviewed_at: string | null;
  review_comment: string | null;
}

const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-0.5 py-1.5 sm:grid-cols-[200px_1fr] sm:gap-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-gray-500 sm:normal-case sm:text-sm sm:tracking-normal">{label}</dt>
      <dd className="text-sm text-gray-900 break-words">{value}</dd>
    </div>
  );
}

const CompanyApplicationsAdmin: React.FC = () => {
  const [view, setView] = useState<'pending' | 'history'>('pending');
  const [apps, setApps] = useState<CompanyApplication[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const { openConfirm, confirmDialog } = useConfirmDialog();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const query = supabase.from('company_applications').select('*');
    const { data, error: loadError } = view === 'pending'
      ? await query.eq('status', 'submitted').order('submitted_at', { ascending: true })
      : await query.in('status', ['approved', 'rejected']).order('reviewed_at', { ascending: false }).limit(30);
    if (loadError) {
      setError(loadError.message || 'No se han podido cargar las solicitudes.');
      setApps([]);
    } else {
      setApps(((data ?? []) as unknown) as CompanyApplication[]);
    }
    setLoading(false);
  }, [view]);

  useEffect(() => { void load(); }, [load]);

  const review = async (app: CompanyApplication, status: 'approved' | 'rejected', comment?: string) => {
    setBusyId(app.id);
    try {
      const { error: rpcError } = await supabase.rpc('admin_review_company_application', {
        p_application_id: app.id,
        p_status: status,
        p_comment: comment,
      });
      if (rpcError) throw rpcError;
      toast.success(status === 'approved' ? `${app.commercial_name} ya está dada de alta.` : 'Solicitud rechazada.');
      // Aviso por correo (F3.4). El destinatario y el motivo los saca el servidor de la
      // solicitud; si el correo falla, la revisión ya está guardada: solo se avisa al admin.
      const { error: mailError } = await supabase.functions.invoke('send-email-notification', {
        body: { type: status === 'approved' ? 'company_approved' : 'company_rejected', companyApplicationId: app.id },
      });
      if (mailError) toast.error('Guardado, pero no se ha podido enviar el correo a la empresa.');
      setRejectingId(null);
      setRejectReason('');
      setOpenId(null);
      await load();
    } catch (e: unknown) {
      toast.error((e as { message?: string })?.message || 'No se ha podido guardar la revisión.');
    } finally {
      setBusyId(null);
    }
  };

  const askApprove = (app: CompanyApplication) =>
    openConfirm({
      title: `Aprobar ${app.commercial_name}`,
      message: 'Se creará la ficha de la empresa y su dueño podrá entrar en su panel, invitar a su equipo y configurar sus servicios.',
      confirmLabel: 'Sí, aprobar',
      tone: 'warning',
      onConfirm: () => review(app, 'approved'),
    });

  return (
    <div className="p-4 sm:p-6">
      {confirmDialog}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="inline-flex rounded-xl bg-gray-100 p-1">
          {(['pending', 'history'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${view === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600'}`}
            >
              {v === 'pending' ? 'Pendientes' : 'Revisadas'}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-lg p-2 text-sm text-gray-600 hover:bg-gray-100" aria-label="Actualizar">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {!loading && apps.length === 0 && !error && (
        <p className="py-8 text-center text-sm text-gray-500">
          {view === 'pending' ? 'No hay solicitudes de empresas pendientes.' : 'Todavía no se ha revisado ninguna solicitud de empresa.'}
        </p>
      )}

      <ul className="space-y-3">
        {apps.map((app) => {
          const open = openId === app.id;
          return (
            <li key={app.id} className="rounded-xl border border-gray-200 bg-white">
              <button type="button" onClick={() => setOpenId(open ? null : app.id)} className="flex w-full items-center gap-3 p-4 text-left" aria-expanded={open}>
                <Building2 className="h-5 w-5 shrink-0 text-emerald-700" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-gray-900">{app.commercial_name || 'Sin nombre'}</p>
                  <p className="truncate text-sm text-gray-500">
                    {app.city_zone} · {TEAM_SIZE_OPTIONS.find((o) => o.value === app.answers?.team_size)?.label ?? '—'} personas · enviada {formatDate(app.submitted_at)}
                  </p>
                </div>
                {app.status === 'approved' && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">Aprobada</span>}
                {app.status === 'rejected' && <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">Rechazada</span>}
                {open ? <ChevronUp className="h-5 w-5 text-gray-400" /> : <ChevronDown className="h-5 w-5 text-gray-400" />}
              </button>

              {open && (
                <div className="border-t border-gray-100 px-4 pb-4 pt-2">
                  <dl className="divide-y divide-gray-100">
                    <Row label="Razón social" value={app.legal_name} />
                    <Row label="CIF" value={app.tax_id} />
                    <Row label="Contacto" value={app.contact_name} />
                    <Row label="Teléfono" value={app.phone} />
                    <Row label="Correo" value={app.email || '—'} />
                    <Row label="Dirección" value={app.address} />
                    <Row label="Zona de trabajo" value={app.city_zone} />
                    <Row label="Servicios" value={app.services.join(', ') || '—'} />
                    <Row label="El titular trabaja" value={app.owner_works ? 'Sí' : 'No'} />
                    {describeAnswers(app.answers || {}).map((a) => <Row key={a.label} label={a.label} value={a.value} />)}
                    {app.review_comment && <Row label="Motivo del rechazo" value={app.review_comment} />}
                  </dl>

                  {app.status === 'submitted' && rejectingId !== app.id && (
                    <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <button type="button" disabled={busyId === app.id} onClick={() => askApprove(app)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white hover:bg-emerald-800 disabled:opacity-50">
                        {busyId === app.id ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle className="h-5 w-5" />} Aprobar
                      </button>
                      <button type="button" disabled={busyId === app.id} onClick={() => { setRejectingId(app.id); setRejectReason(''); }} className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-3 font-bold text-red-600 hover:bg-red-50 disabled:opacity-50">
                        <XCircle className="h-5 w-5" /> Rechazar
                      </button>
                    </div>
                  )}

                  {app.status === 'submitted' && rejectingId === app.id && (
                    <div className="mt-4 rounded-xl border border-red-200 bg-red-50/40 p-3">
                      <label htmlFor={`reject-${app.id}`} className="mb-1.5 block text-sm font-medium text-gray-700">
                        Motivo (lo verá la empresa)
                      </label>
                      <textarea
                        id={`reject-${app.id}`}
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        className="min-h-[88px] w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-base"
                        placeholder="Por ejemplo: falta acreditar el seguro de responsabilidad civil."
                      />
                      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <button type="button" onClick={() => setRejectingId(null)} className="rounded-xl border border-gray-200 bg-white px-4 py-3 font-bold text-gray-700 hover:bg-gray-50">
                          Cancelar
                        </button>
                        <button
                          type="button"
                          disabled={rejectReason.trim().length < 5 || busyId === app.id}
                          onClick={() => review(app, 'rejected', rejectReason.trim())}
                          className="rounded-xl bg-red-600 px-4 py-3 font-bold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Rechazar solicitud
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default CompanyApplicationsAdmin;
