import React, { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { addDays, format } from 'date-fns';
import { Building2, CalendarClock, CalendarDays, ChevronRight, Loader2, UserRound } from 'lucide-react';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import AppHeader from '../../components/common/AppHeader';
import JobCard from '../../components/empleado/JobCard';
import { useMyJobs } from '../../hooks/useMyJobs';
import PhytosanitaryLicenseUpload from '../../components/gardener/PhytosanitaryLicenseUpload';
import { useAuth } from '../../contexts/AuthContext';
import { useAccount } from '../../contexts/AccountContext';
import { supabase } from '../../lib/supabase';

// Panel del empleado (/mi-trabajo, GarSer Empresas F3.3 y F5.3), en tres pestañas: Hoy (sus
// trabajos de hoy), Semana (los de los próximos 7 días y su horario) y Perfil (empresa,
// servicios, datos de contacto y, si la empresa hace fitosanitarios, su carnet — D4).

interface Membership {
  member_id: string;
  role: string;
  company_name: string;
  joined_at: string;
  company_offers_phyto: boolean;
  services: string[];
}

const noop = () => {};
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

type Tab = 'today' | 'week' | 'profile';
const TABS: Array<[Tab, string]> = [['today', 'Hoy'], ['week', 'Semana'], ['profile', 'Perfil']];

const EmployeeHomePage: React.FC = () => {
  const { user } = useAuth();
  const { role, loading: roleLoading } = useAccount();
  const [membership, setMembership] = useState<Membership | null>(null);
  const [loading, setLoading] = useState(true);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [savedContact, setSavedContact] = useState({ fullName: '', phone: '' });
  const [saving, setSaving] = useState(false);
  const [params, setParams] = useSearchParams();
  const tab: Tab = (['today', 'week', 'profile'] as const).includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'today';
  const today = format(new Date(), 'yyyy-MM-dd');
  const weekEnd = format(addDays(new Date(), 6), 'yyyy-MM-dd');
  const { jobs, loading: jobsLoading, refresh: refreshJobs } = useMyJobs(today, weekEnd);
  const todayJobs = jobs.filter((j) => j.date === today);

  const load = useCallback(async () => {
    if (!user?.id) return;
    const [{ data: m }, { data: profile }] = await Promise.all([
      supabase.rpc('my_company_membership'),
      supabase.from('profiles').select('full_name, phone').eq('user_id', user.id).maybeSingle(),
    ]);
    setMembership((m as unknown as Membership) ?? null);
    const contact = { fullName: profile?.full_name ?? '', phone: profile?.phone ?? '' };
    setFullName(contact.fullName);
    setPhone(contact.phone);
    setSavedContact(contact);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { void load(); }, [load]);

  if (roleLoading) return null;
  if (role !== 'employee') return <Navigate to="/dashboard" replace />;

  const dirty = fullName.trim() !== savedContact.fullName.trim() || phone.trim() !== savedContact.phone.trim();

  const saveContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.id) return;
    setSaving(true);
    const next = { fullName: fullName.trim(), phone: phone.trim() };
    const { error } = await supabase.from('profiles').update({ full_name: next.fullName, phone: next.phone }).eq('user_id', user.id);
    setSaving(false);
    if (error) {
      toast.error(error.message || 'No se han podido guardar tus datos.');
      return;
    }
    setSavedContact(next);
    toast.success('Datos guardados');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader title="Mi trabajo">
        <div role="tablist" aria-label="Secciones" className="grid grid-cols-3 gap-1 rounded-xl bg-gray-100 p-1">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setParams(key === 'today' ? {} : { tab: key }, { replace: true })}
              className={`rounded-lg py-2 text-sm font-semibold transition-colors ${tab === key ? 'bg-white text-emerald-800 shadow-sm' : 'text-gray-600'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </AppHeader>
      {loading ? (
        <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-emerald-700" aria-label="Cargando" /></div>
      ) : !membership ? (
        <main className="mx-auto w-full px-4 py-6 sm:max-w-xl">
          <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Ya no formas parte de ninguna empresa en GarSer.</p>
        </main>
      ) : tab === 'today' ? (
        <main className="mx-auto w-full space-y-3 px-4 py-4 sm:max-w-xl">
          <p className="px-1 text-sm font-semibold text-gray-600">{capitalize(format(new Date(), "EEEE d 'de' MMMM", { locale: es }))}</p>
          {jobsLoading && jobs.length === 0 ? (
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-emerald-700" />
          ) : todayJobs.length === 0 ? (
            <section className="rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-center">
              <CalendarDays className="mx-auto h-8 w-8 text-gray-400" />
              <p className="mt-2 font-semibold text-gray-900">Hoy no tienes trabajos</p>
              <p className="mt-1 text-sm text-gray-600">
                {jobs.length > 0 ? `Tienes ${jobs.length} esta semana: míralos en «Semana».` : 'Cuando tu empresa te asigne trabajos, aparecerán aquí con la dirección y la hora.'}
              </p>
            </section>
          ) : (
            <ul className="space-y-3">
              {todayJobs.map((j) => <JobCard key={j.booking_id} job={j} onChanged={() => void refreshJobs()} />)}
            </ul>
          )}
        </main>
      ) : tab === 'week' ? (
        <main className="mx-auto w-full space-y-3 px-4 py-4 sm:max-w-xl">
          <Link to="/mi-trabajo/horario" className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4 hover:bg-gray-50">
            <CalendarClock className="h-6 w-6 shrink-0 text-emerald-700" />
            <span className="flex-1">
              <span className="block font-semibold text-gray-900">Mi horario</span>
              <span className="block text-sm text-gray-600">Los días y horas en que puedes trabajar. Tu empresa solo te asigna trabajos dentro de ellos.</span>
            </span>
            <ChevronRight className="h-5 w-5 text-gray-400" />
          </Link>
          {jobsLoading && jobs.length === 0 ? (
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-emerald-700" />
          ) : jobs.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-600">No tienes trabajos en los próximos 7 días.</p>
          ) : (
            <ul className="space-y-3">
              {jobs.map((j) => <JobCard key={j.booking_id} job={j} showDate onChanged={() => void refreshJobs()} />)}
            </ul>
          )}
        </main>
      ) : (
        <main className="mx-auto w-full space-y-4 px-4 py-4 sm:max-w-xl">
          <section className="rounded-2xl border border-gray-200 bg-white p-4">
            <div className="flex items-center gap-3">
              <Building2 className="h-8 w-8 shrink-0 text-emerald-700" />
              <div className="min-w-0">
                <p className="text-sm text-gray-500">Trabajas en</p>
                <p className="truncate text-lg font-bold text-gray-900">{membership.company_name}</p>
              </div>
            </div>
            <div className="mt-3">
              <p className="text-sm font-medium text-gray-700">Tus servicios</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {membership.services.length === 0 ? (
                  <span className="text-sm text-gray-500">Tu empresa aún no te ha asignado servicios.</span>
                ) : (
                  membership.services.map((s) => (
                    <span key={s} className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">{s}</span>
                  ))
                )}
              </div>
            </div>
          </section>

          <form onSubmit={saveContact} className="rounded-2xl border border-gray-200 bg-white p-4">
            <h2 className="flex items-center gap-2 text-base font-bold text-gray-900"><UserRound className="h-5 w-5 text-emerald-700" /> Tus datos</h2>
            <p className="mt-1 text-sm text-gray-600">Tu empresa los usa para contactarte.</p>
            <label htmlFor="emp-name" className="mt-3 block text-sm font-medium text-gray-700">Nombre y apellidos</label>
            <input id="emp-name" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20" />
            <label htmlFor="emp-phone" className="mt-3 block text-sm font-medium text-gray-700">Teléfono</label>
            <input id="emp-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20" />
            <button type="submit" disabled={!dirty || saving} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">
              {saving && <Loader2 className="h-5 w-5 animate-spin" />} Guardar
            </button>
            <Link to="/account" className="mt-3 flex items-center justify-between rounded-xl px-1 py-2 text-sm font-semibold text-emerald-700">
              Tu foto y tu contraseña <ChevronRight className="h-4 w-4" />
            </Link>
          </form>

          {membership.company_offers_phyto && (
            <section>
              <p className="mb-2 px-1 text-sm text-gray-600">Solo si vas a hacer tratamientos fitosanitarios: sube tu carnet. GarSer lo revisa y, cuando esté aprobado, tu empresa podrá asignarte esos trabajos.</p>
              <PhytosanitaryLicenseUpload onStatusChange={noop} />
            </section>
          )}
        </main>
      )}
    </div>
  );
};

export default EmployeeHomePage;
