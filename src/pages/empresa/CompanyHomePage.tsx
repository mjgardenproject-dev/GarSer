import React, { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { AlertTriangle, ChevronRight, Clock, Loader2, Settings2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import AppHeader from '../../components/common/AppHeader';
import { useConfirmDialog } from '../../components/common/ConfirmDialog';
import InviteMemberCard from '../../components/empresa/InviteMemberCard';
import PhytosanitaryLicenseUpload from '../../components/gardener/PhytosanitaryLicenseUpload';
import TeamMemberCard from '../../components/empresa/TeamMemberCard';
import { useCompanyOnboarding } from '../../hooks/useCompanyOnboarding';
import { PHYTO_SERVICE_NAME, useCompanyTeam, type TeamInvitation, type TeamMember } from '../../hooks/useCompanyTeam';
import { supabase } from '../../lib/supabase';

// Panel de la empresa (/empresa, GarSer Empresas F3.3). Decide adónde va cada cuenta según su
// alta y, con la empresa activa, muestra su equipo (invitar, servicios por persona, bajas) y
// sus datos. Servicios, precios y zona se editan con la misma pantalla que un autónomo
// (/empresa/configuracion): un solo sistema de precios.

type Tab = 'team' | 'company';

const noop = () => {};

const dateFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });

const Spinner = () => (
  <div className="flex min-h-[60vh] items-center justify-center">
    <Loader2 className="h-8 w-8 animate-spin text-emerald-700" aria-label="Cargando" />
  </div>
);

const CompanyPanel: React.FC = () => {
  const { data, loading, error, refresh } = useCompanyTeam();
  const { openConfirm, confirmDialog } = useConfirmDialog();
  const [tab, setTab] = useState<Tab>('team');
  const [showFormer, setShowFormer] = useState(false);

  if (loading && !data) return <Spinner />;
  if (!data) {
    return (
      <div className="mx-auto w-full px-4 py-8 sm:max-w-xl">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p>{error || 'No hemos podido cargar tu empresa.'}</p>
          <button type="button" onClick={() => void refresh()} className="mt-2 font-semibold underline">Reintentar</button>
        </div>
      </div>
    );
  }

  const active = data.members.filter((m) => m.status === 'active');
  const former = data.members.filter((m) => m.status !== 'active');
  // El carnet es de cada persona (D4): si el titular trabaja y la empresa hace fitosanitarios,
  // él también sube el suyo. La ficha de la empresa (/empresa/configuracion) no lo pide.
  const ownerWorks = active.some((m) => m.role === 'owner' && m.counts_as_labour);
  const offersPhyto = data.offered_services.some((s) => s.name === PHYTO_SERVICE_NAME);

  const askDeactivate = (member: TeamMember) => {
    const name = member.full_name || member.email || 'esta persona';
    openConfirm({
      title: `¿Dar de baja a ${name}?`,
      message: 'Dejará de formar parte de tu equipo y no podrás asignarle trabajos. Su cuenta seguirá existiendo y podrás volver a invitarla.',
      confirmLabel: 'Dar de baja',
      tone: 'danger',
      onConfirm: async () => {
        const { error: rpcError } = await supabase.rpc('deactivate_company_member', { p_member_id: member.member_id });
        if (rpcError) {
          toast.error(rpcError.message || 'No se ha podido dar de baja.');
          return;
        }
        toast.success(`${name} ya no forma parte de tu equipo`);
        await refresh();
      },
    });
  };

  const askRevoke = (invitation: TeamInvitation) => {
    openConfirm({
      title: '¿Anular la invitación?',
      message: `El enlace enviado a ${invitation.email} dejará de funcionar.`,
      confirmLabel: 'Anular',
      tone: 'danger',
      onConfirm: async () => {
        const { error: rpcError } = await supabase.rpc('revoke_company_invitation', { p_invitation_id: invitation.id });
        if (rpcError) {
          toast.error(rpcError.message || 'No se ha podido anular.');
          return;
        }
        toast.success('Invitación anulada');
        await refresh();
      },
    });
  };

  const c = data.company;

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader title={c.commercial_name || 'Tu empresa'}>
        <div role="tablist" aria-label="Secciones del panel" className="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1">
          {([['team', 'Equipo'], ['company', 'Tu empresa']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => {
                setTab(key);
                if (key === 'team') void refresh();
              }}
              className={`rounded-lg py-2 text-sm font-semibold transition-colors ${tab === key ? 'bg-white text-emerald-800 shadow-sm' : 'text-gray-600'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </AppHeader>

      <main className="mx-auto w-full space-y-4 px-4 py-4 sm:max-w-xl">
        {tab === 'team' ? (
          <>
            {data.offered_services.length === 0 && (
              <Link to="/empresa/configuracion" className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                <span>
                  <span className="font-semibold">Aún no ofreces ningún servicio.</span> Actívalos con sus precios para poder repartirlos entre tu equipo.
                </span>
              </Link>
            )}

            <InviteMemberCard onInvited={() => void refresh()} />

            {data.invitations.length > 0 && (
              <section>
                <h2 className="mb-2 px-1 text-sm font-bold uppercase tracking-wide text-gray-500">Invitaciones pendientes</h2>
                <ul className="space-y-2">
                  {data.invitations.map((inv) => (
                    <li key={inv.id} className="flex items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-900">{inv.email}</p>
                        <p className="flex items-center gap-1 text-xs text-gray-500">
                          <Clock className="h-3.5 w-3.5" /> Caduca el {dateFmt.format(new Date(inv.expires_at))}
                        </p>
                      </div>
                      <button type="button" onClick={() => askRevoke(inv)} className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-2 text-sm font-semibold text-red-600 hover:bg-red-50">
                        <X className="h-4 w-4" /> Anular
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section>
              <h2 className="mb-2 px-1 text-sm font-bold uppercase tracking-wide text-gray-500">Tu equipo ({active.length})</h2>
              <ul className="space-y-3">
                {active.map((m) => (
                  <TeamMemberCard
                    key={`${m.member_id}:${m.services.map((s) => s.id).join(',')}`}
                    member={m}
                    offeredServices={data.offered_services}
                    onChanged={() => void refresh()}
                    onAskDeactivate={askDeactivate}
                  />
                ))}
              </ul>
            </section>

            {former.length > 0 && (
              <section>
                <button type="button" onClick={() => setShowFormer((v) => !v)} className="px-1 text-sm font-semibold text-gray-600 underline">
                  {showFormer ? 'Ocultar' : 'Ver'} personas dadas de baja ({former.length})
                </button>
                {showFormer && (
                  <ul className="mt-2 space-y-2">
                    {former.map((m) => (
                      <li key={m.member_id} className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-500">
                        {m.full_name || m.email}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </>
        ) : (
          <>
            <Link to="/empresa/configuracion" className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4 hover:bg-gray-50">
              <Settings2 className="h-6 w-6 shrink-0 text-emerald-700" />
              <span className="flex-1">
                <span className="block font-semibold text-gray-900">Servicios, precios y zona</span>
                <span className="block text-sm text-gray-600">Lo que ofreces a los clientes y hasta dónde vas.</span>
              </span>
              <ChevronRight className="h-5 w-5 text-gray-400" />
            </Link>

            {ownerWorks && offersPhyto && (
              <section>
                <p className="mb-2 px-1 text-sm text-gray-600">Tu carnet fitosanitario: solo si tú vas a hacer tratamientos. Cada persona del equipo sube el suyo.</p>
                <PhytosanitaryLicenseUpload onStatusChange={noop} />
              </section>
            )}

            <section className="rounded-2xl border border-gray-200 bg-white p-4">
              <h2 className="text-base font-bold text-gray-900">Datos de la empresa</h2>
              <dl className="mt-3 space-y-3 text-sm">
                {[
                  ['Nombre comercial', c.commercial_name],
                  ['Razón social', c.legal_name],
                  ['CIF', c.tax_id],
                  ['Teléfono', c.phone],
                  ['Dirección', c.address],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-gray-500">{label}</dt>
                    <dd className="font-medium text-gray-900">{value || '—'}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 text-xs text-gray-500">El nombre comercial, el teléfono y la dirección se cambian en «Servicios, precios y zona». Para cambiar la razón social o el CIF, escríbenos.</p>
            </section>
          </>
        )}
      </main>
      {confirmDialog}
    </div>
  );
};

const CompanyHomePage: React.FC = () => {
  const { loading, stage } = useCompanyOnboarding();

  if (loading) return <Spinner />;
  if (stage === 'not_company') return <Navigate to="/dashboard" replace />;
  if (stage === 'none' || stage === 'draft') return <Navigate to="/empresa/solicitud" replace />;
  if (stage === 'submitted' || stage === 'rejected') return <Navigate to="/empresa/estado" replace />;

  return <CompanyPanel />;
};

export default CompanyHomePage;
