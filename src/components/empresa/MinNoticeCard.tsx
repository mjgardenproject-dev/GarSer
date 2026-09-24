import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';

// Antelación mínima de la empresa (GarSer Empresas F5.1): cuánto antes tiene que reservar un
// cliente. Es una regla de venta de la empresa, no de cada empleado; vive en el mismo sitio que la
// de un autónomo (recurring_availability_settings de la cuenta de la empresa), que es la que lee
// booking-authority.

const OPTIONS = [
  { value: 0, label: 'Sin restricción (inmediato)' },
  { value: 24, label: '24 horas antes' },
  { value: 48, label: '48 horas antes' },
  { value: 72, label: '3 días antes' },
  { value: 168, label: '1 semana antes' },
];

const MinNoticeCard: React.FC = () => {
  const { user } = useAuth();
  const [value, setValue] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    void supabase
      .from('recurring_availability_settings')
      .select('min_notice_hours')
      .eq('gardener_id', user.id)
      .maybeSingle()
      .then(({ data }) => setValue(data?.min_notice_hours ?? 0));
  }, [user?.id]);

  const save = async (next: number) => {
    if (!user?.id) return;
    const previous = value;
    setValue(next);
    setSaving(true);
    const { error } = await supabase
      .from('recurring_availability_settings')
      .upsert({ gardener_id: user.id, min_notice_hours: next }, { onConflict: 'gardener_id' });
    setSaving(false);
    if (error) {
      setValue(previous);
      toast.error(error.message || 'No se ha podido guardar.');
      return;
    }
    toast.success('Guardado');
  };

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4">
      <label htmlFor="min-notice" className="block text-base font-bold text-gray-900">Antelación mínima para reservar</label>
      <p className="mt-1 text-sm text-gray-600">Los clientes no podrán reservar un hueco que empiece antes de este plazo. Vale para todo tu equipo.</p>
      <div className="relative mt-3">
        <select
          id="min-notice"
          value={value ?? ''}
          disabled={value === null || saving}
          onChange={(e) => void save(Number(e.target.value))}
          className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20 disabled:opacity-60"
        >
          {value === null && <option value="">Cargando…</option>}
          {OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {saving && <Loader2 className="absolute right-10 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-gray-400" />}
      </div>
    </section>
  );
};

export default MinNoticeCard;
