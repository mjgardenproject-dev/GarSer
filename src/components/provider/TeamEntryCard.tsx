import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Clock, Loader2, RefreshCw, Users, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { useProviderMode } from '../../hooks/useProviderMode';
import { useConfirmDialog } from '../common/ConfirmDialog';
import AddTeamSheet from './AddTeamSheet';

// «¿Trabajas con más gente?» (2026-11-08, D31): la única pista de equipo que ve un profesional en modo
// individual. Debajo de los accesos del panel, discreta; abre la hoja «Añade a tu equipo». Con invitaciones
// pendientes las lista (con «Anular») y ofrece «Actualizar», porque el modo no cambia solo hasta que
// la otra persona acepta (D39: sin tiempo real).
//
// En modo equipo no sale: allí el equipo ya es el panel.

interface PendingInvitation {
  id: string;
  email: string;
  expires_at: string;
}

const dateFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });

const TeamEntryCard: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { isApprovedProfessional, isIndividual, suspended, pendingInvitations, hasTeamStructure, error, refresh } = useProviderMode();
  const { openConfirm, confirmDialog } = useConfirmDialog();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadInvitations = useCallback(async () => {
    const { data, error: queryError } = await supabase
      .from('company_invitations')
      .select('id, email, expires_at')
      .is('accepted_at', null)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });
    if (queryError) {
      console.error('Error cargando las invitaciones pendientes:', queryError);
      return;
    }
    setInvitations((data as PendingInvitation[] | null) ?? []);
  }, []);

  useEffect(() => {
    if (pendingInvitations > 0) void loadInvitations();
    else setInvitations([]);
  }, [pendingInvitations, loadInvitations]);

  if (error) {
    return (
      <section role="status" className={`rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 ${className}`}>
        <p className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>No hemos podido comprobar si tu cuenta tiene equipo.</span>
        </p>
        <button type="button" onClick={() => void refresh()} className="mt-2 min-h-11 rounded-lg px-1 font-semibold underline [touch-action:manipulation]">
          Reintentar
        </button>
      </section>
    );
  }

  // Solo en modo individual y con la cuenta en regla: un suspendido no invita a nadie (el servidor tampoco).
  if (!isApprovedProfessional || !isIndividual || suspended) return null;

  const update = async () => {
    setRefreshing(true);
    try {
      const next = await refresh();
      if (next?.mode === 'individual') toast.success('Todo al día: tu cuenta sigue en modo individual.');
      if (!next) toast.error('No hemos podido comprobarlo. Inténtalo de nuevo.');
    } finally {
      setRefreshing(false);
    }
  };

  const askRevoke = (invitation: PendingInvitation) => {
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
        await loadInvitations();
      },
    });
  };

  const invited = async () => {
    await refresh();
    await loadInvitations();
  };

  return (
    <section aria-label="Equipo" className={`rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5 ${className}`}>
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
          <Users className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-gray-900">¿Trabajas con más gente?</h2>
          <p className="text-sm text-gray-600">Añade a tu equipo y reparte los trabajos.</p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-emerald-300 bg-white px-4 py-3 font-bold text-emerald-800 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 [touch-action:manipulation]"
      >
        Añadir a mi equipo
      </button>

      {pendingInvitations > 0 && (
        <div className="mt-4 border-t border-gray-100 pt-3">
          <h3 className="text-sm font-bold text-gray-900">Invitaciones pendientes ({pendingInvitations})</h3>
          <p className="mt-0.5 text-xs text-gray-600">Mientras no acepten, tu cuenta no cambia.</p>
          <ul className="mt-2 space-y-2">
            {invitations.map((invitation) => (
              <li key={invitation.id} className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">{invitation.email}</p>
                  <p className="flex items-center gap-1 text-xs text-gray-500">
                    <Clock className="h-3.5 w-3.5" aria-hidden="true" /> Caduca el {dateFmt.format(new Date(invitation.expires_at))}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => askRevoke(invitation)}
                  className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-red-600 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 [touch-action:manipulation]"
                >
                  <X className="h-4 w-4" aria-hidden="true" /> Anular
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => void update()}
            disabled={refreshing}
            className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-sm font-semibold text-emerald-800 underline-offset-2 hover:underline disabled:opacity-60 [touch-action:manipulation]"
          >
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
            ¿Ya ha aceptado? Actualizar
          </button>
        </div>
      )}

      <AddTeamSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        // El servidor pide la declaración solo cuando aún no existe la empresa (la primera invitación).
        needsLiability={!hasTeamStructure}
        onInvited={() => void invited()}
      />
      {confirmDialog}
    </section>
  );
};

export default TeamEntryCard;
