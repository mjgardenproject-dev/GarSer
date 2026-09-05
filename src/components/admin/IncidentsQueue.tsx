import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, RotateCcw, X, MessageSquareQuote } from 'lucide-react';
import { toast } from 'react-hot-toast';

import { supabase } from '../../lib/supabase';
import { formatEuro } from '../../shared/bookingAmounts';
import { fetchProfileNames } from '../../utils/profileNames';
import { resolveBookingIncident } from '../../utils/bookingIncidentService';

/**
 * Cola de incidencias del administrador.
 *
 * Modelada sobre `ReviewModeration.tsx` (lee la tabla directo por RLS, actúa por RPC/función),
 * con dos diferencias a propósito:
 *   · Nada de `window.prompt` para las notas — en móvil recorta el texto y parece un aviso del
 *     navegador. Aquí la nota es un `textarea` dentro de la propia fila.
 *   · El importe a devolver se ve en euros ANTES de confirmar, no después.
 */

interface IncidentRow {
  id: string;
  booking_id: string;
  kind: string;
  description: string;
  status: string;
  gardener_response: string | null;
  money_action: string | null;
  money_status: string | null;
  resolution_note: string | null;
  created_at: string;
  bookings: {
    client_id: string;
    gardener_id: string;
    management_fee: number | null;
    date: string;
    services: { name: string | null } | null;
  } | null;
}

const KIND_LABELS: Record<string, string> = {
  gardener_no_show: 'El profesional no vino',
  service_not_done: 'Vino, pero no hizo el trabajo',
  service_incomplete: 'El trabajo quedó incompleto',
  billing: 'Problema con el cobro',
  behaviour: 'Problema de trato',
  other: 'Otro',
};

const STATUS_LABELS: Record<string, string> = {
  open: 'Abierta',
  in_review: 'En revisión',
  resolved_refunded: 'Resuelta · devuelta',
  resolved_no_action: 'Resuelta · sin acción',
  rejected: 'Rechazada',
};

type Filter = 'open' | 'failed' | 'resolved';

const IncidentsQueue = () => {
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [names, setNames] = useState<Record<string, { full_name: string | null }>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('open');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('booking_incidents')
      .select(
        'id, booking_id, kind, description, status, gardener_response, money_action, money_status, resolution_note, created_at, bookings(client_id, gardener_id, management_fee, date, services(name))',
      )
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      toast.error('No se pudieron cargar las incidencias.');
      setLoading(false);
      return;
    }

    const rows = (data || []) as unknown as IncidentRow[];
    setIncidents(rows);

    const ids = rows.flatMap((row) => [row.bookings?.client_id, row.bookings?.gardener_id]);
    setNames(await fetchProfileNames(ids));
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = incidents.filter((incident) => {
    if (filter === 'failed') return incident.money_status === 'failed';
    if (filter === 'resolved') return incident.status.startsWith('resolved') || incident.status === 'rejected';
    return incident.status === 'open' || incident.status === 'in_review';
  });

  const setInReview = async (incident: IncidentRow) => {
    setBusyId(incident.id);
    const { error } = await supabase.rpc('set_incident_in_review', { p_incident_id: incident.id });
    setBusyId(null);
    if (error) {
      toast.error(error.message || 'No se pudo marcar en revisión.');
      return;
    }
    await load();
  };

  const resolve = async (incident: IncidentRow, outcome: 'refund' | 'no_action' | 'reject') => {
    const note = (noteDraft[incident.id] || '').trim();
    if (outcome !== 'refund' && note.length < 5) {
      toast.error('Explica el motivo de la resolución.');
      return;
    }
    setBusyId(incident.id);
    try {
      const result = await resolveBookingIncident(incident.id, outcome, note || undefined);
      if (result.moneyAction === 'refund' && result.moneyStatus === 'failed') {
        toast.error('Se resolvió, pero el reembolso en Stripe falló. Puedes reintentarlo.');
      } else if (result.moneyAction === 'refund') {
        toast.success('Incidencia resuelta y gastos de gestión devueltos.');
      } else {
        toast.success('Incidencia resuelta.');
      }
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo resolver la incidencia.');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <div className="py-8 text-center text-sm text-gray-500">Cargando incidencias…</div>;

  return (
    <div className="bg-white rounded-2xl shadow-sm p-5 sm:p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Incidencias</h2>
      <p className="text-sm text-gray-500 mb-4">
        Aceptar devuelve los gastos de gestión al cliente en Stripe. Resolver sin acción cierra
        la incidencia sin mover dinero.
      </p>

      <div className="flex flex-wrap gap-2 mb-5">
        {([
          ['open', 'Abiertas'],
          ['failed', 'Reembolso fallido'],
          ['resolved', 'Resueltas'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
              filter === value
                ? value === 'failed'
                  ? 'bg-red-600 text-white border-red-600'
                  : 'bg-green-600 text-white border-green-600'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {filtered.length === 0 && <p className="text-sm text-gray-500 py-4">No hay incidencias en este filtro.</p>}

      <ul className="space-y-4">
        {filtered.map((incident) => {
          const isBlocking = ['gardener_no_show', 'service_not_done', 'service_incomplete'].includes(incident.kind);
          const clientName = incident.bookings ? names[incident.bookings.client_id]?.full_name : null;
          const gardenerName = incident.bookings ? names[incident.bookings.gardener_id]?.full_name : null;
          const fee = incident.bookings?.management_fee;
          const isOpen = incident.status === 'open' || incident.status === 'in_review';
          const failed = incident.money_status === 'failed';

          return (
            <li key={incident.id} className="rounded-xl border border-gray-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 break-words">
                    {KIND_LABELS[incident.kind] || incident.kind}
                    {isBlocking && <span className="ml-1.5 text-xs font-normal text-amber-700">· congela la reserva</span>}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {incident.bookings?.services?.name || 'Servicio'} ·{' '}
                    {clientName ? `cliente ${clientName}` : 'cliente'} ·{' '}
                    {gardenerName ? `profesional ${gardenerName}` : 'profesional'}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {failed && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">
                      Reembolso fallido
                    </span>
                  )}
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 border border-gray-200">
                    {STATUS_LABELS[incident.status] || incident.status}
                  </span>
                </div>
              </div>

              <p className="text-sm text-gray-700 break-words whitespace-pre-line mb-2">{incident.description}</p>

              {incident.gardener_response && (
                <div className="rounded-lg bg-gray-50 p-3 mb-2">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-600">
                    <MessageSquareQuote className="w-3.5 h-3.5" aria-hidden="true" />
                    Versión del profesional
                  </p>
                  <p className="mt-1 text-sm text-gray-700 whitespace-pre-line break-words">{incident.gardener_response}</p>
                </div>
              )}

              {incident.resolution_note && (
                <p className="text-xs text-gray-500 mb-2">Resolución: {incident.resolution_note}</p>
              )}

              {(isOpen || failed) && (
                <div className="mt-3 space-y-2">
                  {incident.status === 'open' && (
                    <button
                      type="button"
                      onClick={() => void setInReview(incident)}
                      disabled={busyId === incident.id}
                      className="text-xs font-semibold text-gray-600 underline hover:text-gray-800 disabled:opacity-50"
                    >
                      Marcar en revisión
                    </button>
                  )}

                  <textarea
                    value={noteDraft[incident.id] || ''}
                    onChange={(event) => setNoteDraft((prev) => ({ ...prev, [incident.id]: event.target.value }))}
                    placeholder="Nota de resolución (obligatoria si no hay devolución)"
                    rows={2}
                    className="w-full p-2.5 border border-gray-300 rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                  />

                  <div className="flex flex-col sm:flex-row gap-2">
                    <button
                      type="button"
                      onClick={() => void resolve(incident, 'refund')}
                      disabled={busyId === incident.id}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-green-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                    >
                      {failed ? <RotateCcw className="w-4 h-4" aria-hidden="true" /> : <Check className="w-4 h-4" aria-hidden="true" />}
                      {failed
                        ? 'Reintentar reembolso'
                        : `Aceptar y devolver${fee ? ` ${formatEuro(fee)}` : ''}`}
                    </button>
                    {!failed && (
                      <>
                        <button
                          type="button"
                          onClick={() => void resolve(incident, 'no_action')}
                          disabled={busyId === incident.id}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                        >
                          Resolver sin acción
                        </button>
                        <button
                          type="button"
                          onClick={() => void resolve(incident, 'reject')}
                          disabled={busyId === incident.id}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                        >
                          <X className="w-4 h-4" aria-hidden="true" />
                          Rechazar
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {isBlocking && incident.status === 'open' && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  Mientras esté abierta, esta reserva no se cierra ni se cobra sola.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default IncidentsQueue;
