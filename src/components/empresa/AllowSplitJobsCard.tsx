import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';

// «Aceptar trabajos partidos» (GarSer Empresas F6, D10). Apagado: la empresa solo se ofrece al
// cliente si una misma persona puede hacer el trabajo entero. Encendido: también si entre varias,
// por turnos, cubren todas las horas. Repartir un trabajo ya vendido se puede siempre.

const AllowSplitJobsCard: React.FC<{ value: boolean; onChanged: () => void }> = ({ value, onChanged }) => {
  const [saving, setSaving] = useState(false);

  const toggle = async () => {
    setSaving(true);
    const { error } = await supabase.rpc('set_company_allow_split_jobs', { p_allow: !value });
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
        <div>
          <h2 className="text-base font-bold text-gray-900">Aceptar trabajos partidos</h2>
          <p className="mt-1 text-sm text-gray-600">
            {value
              ? 'Te ofrecemos a los clientes también cuando el trabajo lo tengan que hacer varias personas por turnos (por ejemplo, Ana de 9 a 11 y Luis de 11 a 13).'
              : 'Solo te ofrecemos a los clientes si el trabajo lo puede hacer una misma persona entera (o varias a la vez, según «Personas a la vez»).'}
          </p>
          <p className="mt-1 text-xs text-gray-500">Repartir un trabajo ya reservado lo puedes hacer siempre, desde la agenda.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={value}
          aria-label="Aceptar trabajos partidos"
          disabled={saving}
          onClick={() => void toggle()}
          className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${value ? 'bg-emerald-700' : 'bg-gray-300'}`}
        >
          <span className={`absolute left-0 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      </div>
    </section>
  );
};

export default AllowSplitJobsCard;
