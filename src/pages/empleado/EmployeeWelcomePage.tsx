import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarClock, Loader2, Wrench } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import PhytosanitaryLicenseUpload from '../../components/gardener/PhytosanitaryLicenseUpload';
import PushNotificationsCard from '../../components/account/PushNotificationsCard';

// Bienvenida del empleado al aceptar la invitación (cuestionario del empleado, 2026-11-11). En una pantalla:
// sus datos, su carnet si su empresa hace tratamientos (o se lo ha pedido), lo que su empresa le ha
// preparado (servicios y horario) y los avisos para enterarse de los trabajos. Después, «Mi trabajo».

interface Membership {
  company_name: string;
  license_needed?: boolean;
  services: string[];
}

const inputClass =
  'mt-1 min-h-12 w-full rounded-xl border border-gray-300 px-3 text-base text-gray-900 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-600';

const EmployeeWelcomePage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [membership, setMembership] = useState<Membership | null>(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    void Promise.all([
      supabase.rpc('my_company_membership'),
      supabase.from('profiles').select('full_name, phone').eq('user_id', user.id).maybeSingle(),
    ]).then(([{ data: m }, { data: profile }]) => {
      if (cancelled) return;
      setMembership((m as unknown as Membership) ?? null);
      setFullName(profile?.full_name ?? '');
      setPhone(profile?.phone ?? '');
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const firstName = fullName.trim().split(/\s+/)[0] ?? '';

  const finish = async () => {
    if (!user?.id || saving) return;
    setSaving(true);
    const { error } = await supabase.from('profiles').update({ full_name: fullName.trim(), phone: phone.trim() }).eq('user_id', user.id);
    setSaving(false);
    if (error) {
      toast.error('No se han podido guardar tus datos. Inténtalo de nuevo.');
      return;
    }
    navigate('/mi-trabajo', { replace: true });
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center" role="status">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-700" aria-hidden="true" />
        <span className="sr-only">Cargando</span>
      </div>
    );
  }

  const company = membership?.company_name || 'Tu empresa';

  return (
    <div className="mx-auto w-full max-w-xl px-1 pb-28 pt-4 sm:px-4">
      <h1 className="text-2xl font-bold leading-tight text-gray-900">
        Hola{firstName ? ` ${firstName}` : ''}, {company} te ha añadido a su equipo en GarSer
      </h1>
      <p className="mt-2 text-gray-700">Revisa estos datos en un minuto y empieza a recibir trabajos.</p>

      <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-4" aria-labelledby="welcome-data">
        <h2 id="welcome-data" className="font-bold text-gray-900">Tus datos</h2>
        <label htmlFor="welcome-name" className="mt-3 block text-sm font-semibold text-gray-800">Nombre y apellidos</label>
        <input id="welcome-name" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" className={inputClass} />
        <label htmlFor="welcome-phone" className="mt-3 block text-sm font-semibold text-gray-800">Teléfono</label>
        <input id="welcome-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="600 000 000" className={inputClass} />
      </section>

      {membership?.license_needed && (
        <section className="mt-4" aria-label="Tu carnet de aplicador">
          <PhytosanitaryLicenseUpload intro={`${company} hace tratamientos fitosanitarios: sube tu carnet de aplicador. GarSer lo revisa y te avisa.`} />
        </section>
      )}

      <section className="mt-4 rounded-2xl border border-gray-200 bg-white p-4" aria-labelledby="welcome-work">
        <h2 id="welcome-work" className="font-bold text-gray-900">Lo que te ha preparado {company}</h2>
        <p className="mt-3 flex items-start gap-2 text-sm text-gray-800">
          <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
          <span>
            <span className="font-semibold">Tus servicios: </span>
            {membership && membership.services.length > 0 ? membership.services.join(', ') : 'tu empresa aún no te ha asignado servicios.'}
          </span>
        </p>
        <p className="mt-2 flex items-start gap-2 text-sm text-gray-800">
          <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
          <span>
            <span className="font-semibold">Tu horario: </span>
            <Link to="/mi-trabajo/horario" className="font-semibold text-emerald-800 underline underline-offset-2">verlo</Link>. Si no te encaja,
            díselo a tu empresa.
          </span>
        </p>
      </section>

      <section className="mt-4" aria-label="Avisos en el móvil">
        <PushNotificationsCard />
      </section>

      <div
        className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-200 bg-white/95 px-4 pt-3 backdrop-blur"
        style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto w-full max-w-xl">
          <button
            type="button"
            onClick={() => void finish()}
            disabled={saving || fullName.trim().length === 0}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 py-3 text-base font-bold text-white hover:bg-emerald-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
          >
            {saving && <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />}
            {fullName.trim().length === 0 ? 'Escribe tu nombre para empezar' : 'Empezar'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default EmployeeWelcomePage;
