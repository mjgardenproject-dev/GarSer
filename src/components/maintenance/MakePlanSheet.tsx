import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { createMaintenancePlan, FREQUENCY_LABEL, type MaintenanceFrequency } from '../../utils/maintenancePlans';
import { formatEuro } from '../../shared/bookingAmounts';

// Crear un plan de mantenimiento desde una reserva (GarSer Empresas F9, D17–D19): el mismo
// trabajo, con el mismo profesional, cada semana, cada 2 semanas o cada mes, al mismo precio.
// Cada visita se propone unos días antes y el cliente la confirma y paga con un toque.

interface Props {
  bookingId: string;
  serviceName: string;
  professionalName: string;
  price: number | null;
  onClose: () => void;
  onCreated: () => void;
}

const OPTIONS: MaintenanceFrequency[] = ['weekly', 'biweekly', 'monthly'];

const MakePlanSheet: React.FC<Props> = ({ bookingId, serviceName, professionalName, price, onClose, onCreated }) => {
  const [frequency, setFrequency] = useState<MaintenanceFrequency>('biweekly');
  const [saving, setSaving] = useState(false);

  const create = async () => {
    setSaving(true);
    try {
      const plan = await createMaintenancePlan(bookingId, frequency);
      toast.success(`Plan creado. Te propondremos la visita del ${new Date(`${plan.nextVisitDate}T12:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', timeZone: 'UTC' })} unos días antes.`);
      onCreated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se ha podido crear el plan.');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[9998] flex items-end justify-center bg-black/50 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="make-plan-title" onClick={() => !saving && onClose()}>
      <div className="w-full rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:max-w-md sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="make-plan-title" className="text-lg font-bold text-gray-900">Plan de mantenimiento</h2>
            <p className="text-sm text-gray-600 break-words">{serviceName} con {professionalName}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" /></button>
        </div>

        <p className="mt-3 text-sm font-semibold text-gray-900">¿Cada cuánto?</p>
        <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Frecuencia">
          {OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={frequency === option}
              onClick={() => setFrequency(option)}
              className={`rounded-xl border px-2 py-3 text-sm font-semibold ${frequency === option ? 'border-emerald-600 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-600' : 'border-gray-200 bg-white text-gray-700'}`}
            >
              {FREQUENCY_LABEL[option]}
            </button>
          ))}
        </div>

        <ul className="mt-4 space-y-1.5 text-sm text-gray-700">
          <li>• El mismo día de la semana y a la misma hora{price != null ? `, por ${formatEuro(price)} cada visita` : ''}.</li>
          <li>• Unos días antes te proponemos la visita: la confirmas y pagas la gestión con un toque.</li>
          <li>• Si una no te viene bien, no la confirmes: se salta y el plan sigue. Lo cancelas cuando quieras.</li>
        </ul>

        <button
          type="button"
          onClick={() => void create()}
          disabled={saving}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {saving && <Loader2 className="h-5 w-5 animate-spin" />} Crear plan {FREQUENCY_LABEL[frequency].toLowerCase()}
        </button>
      </div>
    </div>,
    document.body,
  );
};

export default MakePlanSheet;
