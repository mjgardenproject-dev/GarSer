import React, { useState } from 'react';
import { CalendarClock, Loader2, Repeat } from 'lucide-react';
import toast from 'react-hot-toast';
import { useConfirmDialog } from '../common/ConfirmDialog';
import { cancelMaintenancePlan, FREQUENCY_LABEL, type MaintenancePlan } from '../../utils/maintenancePlans';
import { formatEuro } from '../../shared/bookingAmounts';

// Los planes de mantenimiento (GarSer Empresas F9). El cliente ve la próxima visita propuesta y
// la confirma y paga; el profesional ve para quién es y cada cuánto. Los dos pueden cancelarlo.

const dayLabel = (iso: string) => {
  const text = new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  return text.charAt(0).toUpperCase() + text.slice(1);
};
const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

interface Props {
  plans: MaintenancePlan[];
  /** Solo el cliente: abrir el pago de la visita propuesta. */
  onPayVisit?: (plan: MaintenancePlan) => void;
  onChanged: () => void;
  busyPlanId?: string | null;
}

const MaintenancePlansSection: React.FC<Props> = ({ plans, onPayVisit, onChanged, busyPlanId }) => {
  const { openConfirm, confirmDialog } = useConfirmDialog();
  const [cancelling, setCancelling] = useState<string | null>(null);
  const active = plans.filter((plan) => plan.status === 'active');
  if (active.length === 0) return null;

  const askCancel = (plan: MaintenancePlan) => openConfirm({
    title: '¿Cancelar el plan?',
    message: 'No se propondrán más visitas. Las que ya estén reservadas siguen en pie.',
    confirmLabel: 'Sí, cancelar',
    tone: 'warning',
    onConfirm: async () => {
      setCancelling(plan.id);
      try {
        await cancelMaintenancePlan(plan.id);
        toast.success('Plan cancelado');
        onChanged();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'No se ha podido cancelar.');
      } finally {
        setCancelling(null);
      }
    },
  });

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-gray-900">Planes de mantenimiento</h2>
      <ul className="space-y-3">
        {active.map((plan) => {
          const lastIssue = plan.visits.find((visit) => visit.status === 'no_availability' || visit.status === 'skipped');
          return (
            <li key={plan.id} className="rounded-2xl border border-emerald-200 bg-white p-4">
              <div className="flex items-start gap-3">
                <Repeat className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-900 break-words">{plan.services || 'Mantenimiento'}</p>
                  <p className="text-sm text-gray-600">
                    {FREQUENCY_LABEL[plan.frequency]} · {formatEuro(plan.total_price)} cada visita
                    {plan.role === 'client' ? ` · con ${plan.provider_name || 'tu profesional'}` : plan.client_name ? ` · ${plan.client_name}` : ''}
                  </p>
                </div>
              </div>

              {plan.proposal ? (
                <div className="mt-3 rounded-xl bg-amber-50 p-3">
                  <p className="flex items-start gap-2 text-sm text-amber-900">
                    <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>
                      Próxima visita: <strong>{dayLabel(plan.proposal.date)} a las {hourLabel(plan.proposal.start_hour)}</strong>.
                      {plan.role === 'client'
                        ? ` Confírmala antes del ${new Date(plan.proposal.expires_at).toLocaleString('es-ES', { weekday: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })}.`
                        : ' Esperando a que el cliente la confirme.'}
                    </span>
                  </p>
                  {plan.role === 'client' && onPayVisit && (
                    <button
                      type="button"
                      onClick={() => onPayVisit(plan)}
                      disabled={busyPlanId === plan.id}
                      className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
                    >
                      {busyPlanId === plan.id && <Loader2 className="h-4 w-4 animate-spin" />} Confirmar y pagar la visita
                    </button>
                  )}
                </div>
              ) : (
                <p className="mt-3 text-sm text-gray-600">
                  Próxima visita hacia el {dayLabel(plan.next_visit_date).toLowerCase()} a las {hourLabel(plan.start_hour)}:
                  {plan.role === 'client' ? ' te la propondremos unos días antes.' : ' se le propondrá al cliente unos días antes y, si la confirma, te llegará como solicitud.'}
                </p>
              )}
              {lastIssue && !plan.proposal && (
                <p className="mt-1 text-xs text-gray-500">
                  {lastIssue.status === 'no_availability' ? 'La última no tenía hueco y se saltó.' : 'La última no se confirmó a tiempo y se saltó.'}
                </p>
              )}

              <button
                type="button"
                onClick={() => askCancel(plan)}
                disabled={cancelling === plan.id}
                className="mt-3 text-sm font-semibold text-red-600 hover:text-red-700 disabled:opacity-50"
              >
                {cancelling === plan.id ? 'Cancelando…' : 'Cancelar el plan'}
              </button>
            </li>
          );
        })}
      </ul>
      {confirmDialog}
    </section>
  );
};

export default MaintenancePlansSection;
