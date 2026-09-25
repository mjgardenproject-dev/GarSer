import React, { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';

// «Personas a la vez» (GarSer Empresas F7, D11): hasta cuántas personas del equipo pueden ir a
// la vez a un mismo trabajo. GarSer manda las menos posibles para acabar cuanto antes con la
// gente libre. El precio para el cliente no cambia: sale de las horas de trabajo.

const MAX = 10;

const MaxCrewCard: React.FC<{ value: number; onChanged: () => void }> = ({ value, onChanged }) => {
  const [saving, setSaving] = useState(false);

  const save = async (next: number) => {
    if (next < 1 || next > MAX || next === value) return;
    setSaving(true);
    const { error } = await supabase.rpc('set_company_max_crew', { p_max: next });
    setSaving(false);
    if (error) {
      toast.error(error.message || 'No se ha podido guardar.');
      return;
    }
    toast.success('Guardado');
    onChanged();
  };

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-gray-900">Personas a la vez</h2>
          <p className="mt-1 text-sm text-gray-600">
            {value === 1
              ? 'Cada trabajo lo hace una sola persona a la vez. Los trabajos grandes se reparten en varios días.'
              : `Si hace falta, mandamos hasta ${value} personas a la vez para acabar antes: un trabajo de 8 h lo pueden hacer 2 personas en 4 h.`}
          </p>
          <p className="mt-1 text-xs text-gray-500">El precio para el cliente es el mismo: sale de las horas de trabajo, no de cuántos vais.</p>
        </div>
        <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Personas a la vez">
          <button type="button" aria-label="Una persona menos" disabled={saving || value <= 1} onClick={() => void save(value - 1)}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-700 disabled:opacity-40">
            <Minus className="h-4 w-4" />
          </button>
          <span className="w-7 text-center text-lg font-bold tabular-nums text-gray-900" aria-live="polite">{value}</span>
          <button type="button" aria-label="Una persona más" disabled={saving || value >= MAX} onClick={() => void save(value + 1)}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-700 disabled:opacity-40">
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>
    </section>
  );
};

export default MaxCrewCard;
