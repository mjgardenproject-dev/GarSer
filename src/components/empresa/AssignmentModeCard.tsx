import React, { useState } from 'react';
import { Loader2, Shuffle, UserCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';

// ¿Quién va a cada trabajo? (GarSer Empresas F4, A-29). Lo decide el dueño. En los dos modos
// GarSer aparta al vender a alguien del equipo que puede hacer el trabajo entero, para no vender
// nunca un hueco imposible; la diferencia es si esa persona es definitiva o una propuesta.

type Mode = 'auto' | 'manual';

const OPTIONS: Array<{ value: Mode; title: string; text: string; icon: React.ReactNode }> = [
  {
    value: 'auto',
    title: 'GarSer elige automáticamente',
    text: 'Cuando entra una reserva, GarSer la asigna a alguien de tu equipo que hace ese servicio y está libre todas las horas. Repartimos el trabajo entre quienes menos tienen ese día.',
    icon: <Shuffle className="h-5 w-5" />,
  },
  {
    value: 'manual',
    title: 'Yo elijo quién va',
    text: 'GarSer te guarda el hueco con alguien libre como propuesta, y tú decides quién va en cada trabajo.',
    icon: <UserCheck className="h-5 w-5" />,
  },
];

const AssignmentModeCard: React.FC<{ mode: Mode; onChanged: () => void }> = ({ mode, onChanged }) => {
  const [saving, setSaving] = useState<Mode | null>(null);

  const choose = async (value: Mode) => {
    if (value === mode || saving) return;
    setSaving(value);
    const { error } = await supabase.rpc('set_company_assignment_mode', { p_mode: value });
    setSaving(null);
    if (error) {
      toast.error(error.message || 'No se ha podido guardar.');
      return;
    }
    toast.success('Guardado');
    onChanged();
  };

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4">
      <h2 className="text-base font-bold text-gray-900">¿Quién va a cada trabajo?</h2>
      <p className="mt-1 text-sm text-gray-600">Se aplica a las reservas nuevas.</p>
      <div role="radiogroup" aria-label="Quién va a cada trabajo" className="mt-3 space-y-2">
        {OPTIONS.map((o) => {
          const active = o.value === mode;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={saving !== null}
              onClick={() => void choose(o.value)}
              className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors disabled:opacity-60 ${
                active ? 'border-emerald-600 bg-emerald-50' : 'border-gray-200 bg-white hover:bg-gray-50'
              }`}
            >
              <span className={`mt-0.5 shrink-0 ${active ? 'text-emerald-700' : 'text-gray-400'}`}>
                {saving === o.value ? <Loader2 className="h-5 w-5 animate-spin" /> : o.icon}
              </span>
              <span>
                <span className="block font-semibold text-gray-900">{o.title}</span>
                <span className="mt-0.5 block text-sm text-gray-600">{o.text}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
};

export default AssignmentModeCard;
