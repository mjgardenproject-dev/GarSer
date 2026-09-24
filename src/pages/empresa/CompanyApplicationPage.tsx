import React, { useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Check, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useCompanyOnboarding } from '../../hooks/useCompanyOnboarding';
import {
  COMPANY_APPLICATION_STEPS,
  COMPANY_SERVICE_OPTIONS,
  EMPTY_COMPANY_APPLICATION,
  TEAM_SIZE_OPTIONS,
  fromApplicationRow,
  missingInStep,
  toApplicationRow,
  type CompanyApplicationAnswers,
  type CompanyApplicationDraft,
} from '../../config/companyApplication';

// Encuesta de alta de empresas (GarSer Empresas F3.2, D2 + D7). Las preguntas se definen en
// src/config/companyApplication.ts; aquí solo se pintan. El borrador se guarda en cada
// «Siguiente»; enviar lo valida el servidor (submit_company_application).

const INPUT = 'w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-base text-gray-900 placeholder:text-gray-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20';
const LABEL = 'mb-1.5 block text-sm font-medium text-gray-700';
const HINT = 'mt-1 text-xs text-gray-500';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={LABEL}>{label}</label>
      {children}
      {hint && <p className={HINT}>{hint}</p>}
    </div>
  );
}

function Choice({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-xl border px-4 py-3 text-left text-base font-medium transition-colors ${
        selected ? 'border-emerald-700 bg-emerald-50 text-emerald-800' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
      }`}
    >
      {children}
    </button>
  );
}

const CompanyApplicationPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const onboarding = useCompanyOnboarding();
  const retryFromRejected = Boolean((location.state as { retry?: boolean } | null)?.retry);

  const [draft, setDraft] = useState<CompanyApplicationDraft>({ ...EMPTY_COMPANY_APPLICATION, answers: {} });
  const [draftId, setDraftId] = useState<string | null>(null);
  const [initialised, setInitialised] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [showMissing, setShowMissing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Retomar un borrador, o corregir una solicitud rechazada (se copia en un borrador nuevo).
  useEffect(() => {
    if (onboarding.loading || initialised) return;
    const app = onboarding.application;
    if (app && (app.status === 'draft' || (app.status === 'rejected' && retryFromRejected))) {
      const restored = fromApplicationRow(app);
      setDraft(restored);
      if (app.status === 'draft') {
        setDraftId(app.id);
        // Retomar donde se quedó: el primer paso que aún tiene algo pendiente. Al corregir una
        // solicitud rechazada se empieza desde el principio, para poder revisarlo todo.
        const firstPending = COMPANY_APPLICATION_STEPS.findIndex((s) => missingInStep(s.id, restored).length > 0);
        setStepIndex(firstPending === -1 ? COMPANY_APPLICATION_STEPS.length - 1 : firstPending);
      }
    }
    setInitialised(true);
  }, [onboarding.loading, onboarding.application, initialised, retryFromRejected]);

  const step = COMPANY_APPLICATION_STEPS[stepIndex];
  const missing = useMemo(() => missingInStep(step.id, draft), [step.id, draft]);
  const isLast = stepIndex === COMPANY_APPLICATION_STEPS.length - 1;

  if (onboarding.loading || !initialised) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-700" aria-label="Cargando" />
      </div>
    );
  }
  if (onboarding.stage === 'not_company') return <Navigate to="/dashboard" replace />;
  if (onboarding.stage === 'approved') return <Navigate to="/empresa" replace />;
  if (onboarding.stage === 'submitted' || (onboarding.stage === 'rejected' && !retryFromRejected && !draftId)) {
    return <Navigate to="/empresa/estado" replace />;
  }

  const set = <K extends keyof CompanyApplicationDraft>(key: K, value: CompanyApplicationDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const setAnswer = <K extends keyof CompanyApplicationAnswers>(key: K, value: CompanyApplicationAnswers[K]) =>
    setDraft((d) => ({ ...d, answers: { ...d.answers, [key]: value } }));

  const saveDraft = async (): Promise<string> => {
    const row = toApplicationRow(draft);
    if (draftId) {
      const { error } = await supabase.from('company_applications').update(row).eq('id', draftId);
      if (error) throw error;
      return draftId;
    }
    const { data, error } = await supabase
      .from('company_applications')
      .insert({ user_id: user!.id, ...row })
      .select('id')
      .single();
    if (error) throw error;
    setDraftId((data as { id: string }).id);
    return (data as { id: string }).id;
  };

  const goNext = async () => {
    if (missing.length > 0) {
      setShowMissing(true);
      return;
    }
    setSaving(true);
    try {
      const id = await saveDraft();
      if (!isLast) {
        setShowMissing(false);
        setStepIndex((i) => i + 1);
        window.scrollTo({ top: 0 });
        return;
      }
      const { error } = await supabase.rpc('submit_company_application', { p_application_id: id });
      if (error) throw error;
      toast.success('Solicitud enviada. La revisaremos y te avisaremos por correo.');
      await onboarding.refresh();
      navigate('/empresa/estado', { replace: true });
    } catch (error: unknown) {
      const message = (error as { message?: string })?.message;
      toast.error(message || 'No se ha podido guardar. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      setSaving(false);
    }
  };

  const goBack = () => {
    setShowMissing(false);
    setStepIndex((i) => Math.max(0, i - 1));
    window.scrollTo({ top: 0 });
  };

  const toggleService = (name: string) =>
    set('services', draft.services.includes(name) ? draft.services.filter((s) => s !== name) : [...draft.services, name]);

  const progress = Math.round(((stepIndex + 1) / COMPANY_APPLICATION_STEPS.length) * 100);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sin cabecera propia: la barra general de la web ya está encima (una sola cabecera,
          docs/design-system.md §1). El progreso va dentro de la página, como en el alta de jardinero. */}
      <main className="mx-auto w-full px-4 py-5 sm:max-w-xl">
        <div className="mb-5">
          <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
            <span className="font-medium text-gray-700">Alta de empresa</span>
            <span>Paso {stepIndex + 1} de {COMPANY_APPLICATION_STEPS.length}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
            <div className="h-1.5 bg-emerald-700 transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
        </div>
        <h1 className="mb-1 text-xl font-bold text-gray-900">{step.title}</h1>
        {stepIndex === 0 && (
          <p className="mb-5 text-sm text-gray-600">
            Cuéntanos quién sois. Revisamos cada empresa antes de que aparezca a los clientes.
          </p>
        )}

        <div className="space-y-5">
          {step.id === 'empresa' && (
            <>
              <Field label="Nombre comercial" hint="Es el nombre que verán los clientes.">
                <input className={INPUT} value={draft.commercial_name} onChange={(e) => set('commercial_name', e.target.value)} autoComplete="organization" />
              </Field>
              <Field label="Razón social">
                <input className={INPUT} value={draft.legal_name} onChange={(e) => set('legal_name', e.target.value)} placeholder="Jardines Ejemplo S.L." />
              </Field>
              <Field label="CIF" hint="O NIF si eres autónomo con trabajadores.">
                <input className={INPUT} value={draft.tax_id} onChange={(e) => set('tax_id', e.target.value)} autoCapitalize="characters" placeholder="B12345678" />
              </Field>
              <Field label="Año de inicio de la actividad (opcional)">
                <input className={INPUT} value={draft.answers.founded_year ?? ''} onChange={(e) => setAnswer('founded_year', e.target.value)} inputMode="numeric" placeholder="2015" />
              </Field>
              <Field label="Web o redes sociales (opcional)">
                <input className={INPUT} value={draft.answers.website ?? ''} onChange={(e) => setAnswer('website', e.target.value)} inputMode="url" placeholder="instagram.com/tuempresa" />
              </Field>
            </>
          )}

          {step.id === 'contacto' && (
            <>
              <Field label="Persona de contacto">
                <input className={INPUT} value={draft.contact_name} onChange={(e) => set('contact_name', e.target.value)} autoComplete="name" />
              </Field>
              <Field label="Teléfono">
                <input className={INPUT} type="tel" inputMode="tel" autoComplete="tel" value={draft.phone} onChange={(e) => set('phone', e.target.value)} placeholder="600 000 000" />
              </Field>
              <Field label="Dirección de la empresa">
                <input className={INPUT} value={draft.address} onChange={(e) => set('address', e.target.value)} autoComplete="street-address" />
              </Field>
              <Field label="¿En qué zona trabajáis?" hint="Por ejemplo: Marbella y alrededores, Costa del Sol occidental…">
                <input className={INPUT} value={draft.city_zone} onChange={(e) => set('city_zone', e.target.value)} />
              </Field>
            </>
          )}

          {step.id === 'equipo' && (
            <>
              <Field label="¿Cuántas personas trabajáis en la empresa?">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {TEAM_SIZE_OPTIONS.map((o) => (
                    <Choice key={o.value} selected={draft.answers.team_size === o.value} onClick={() => setAnswer('team_size', o.value)}>{o.label}</Choice>
                  ))}
                </div>
              </Field>
              <Field label="¿El titular de la empresa también trabaja en los servicios?" hint="Si trabajas, podrás asignarte trabajos igual que a tu equipo. Lo puedes cambiar cuando quieras.">
                <div className="grid grid-cols-2 gap-2">
                  <Choice selected={draft.owner_works === true} onClick={() => set('owner_works', true)}>Sí, también trabajo</Choice>
                  <Choice selected={draft.owner_works === false} onClick={() => set('owner_works', false)}>No, solo gestiono</Choice>
                </div>
              </Field>
              <Field label="Vehículos de trabajo (opcional)">
                <input className={INPUT} value={draft.answers.vehicles ?? ''} onChange={(e) => setAnswer('vehicles', e.target.value)} inputMode="numeric" placeholder="2" />
              </Field>
            </>
          )}

          {step.id === 'servicios' && (
            <>
              <Field label="¿Qué servicios ofrecéis?" hint="Después podrás decidir qué servicios hace cada persona de tu equipo.">
                <div className="grid grid-cols-1 gap-2">
                  {COMPANY_SERVICE_OPTIONS.map((name) => (
                    <Choice key={name} selected={draft.services.includes(name)} onClick={() => toggleService(name)}>
                      <span className="flex items-center justify-between gap-3">
                        {name}
                        {draft.services.includes(name) && <Check className="h-5 w-5 shrink-0 text-emerald-700" />}
                      </span>
                    </Choice>
                  ))}
                </div>
              </Field>
              {draft.services.includes('Servicios fitosanitarios') && (
                <Field
                  label="¿Tenéis trabajadores con carnet fitosanitario?"
                  hint="Cada persona que haga tratamientos tendrá que subir su propio carnet, y lo revisaremos."
                >
                  <div className="grid grid-cols-2 gap-2">
                    <Choice selected={draft.answers.has_phyto_workers === 'si'} onClick={() => setAnswer('has_phyto_workers', 'si')}>Sí</Choice>
                    <Choice selected={draft.answers.has_phyto_workers === 'no'} onClick={() => setAnswer('has_phyto_workers', 'no')}>Todavía no</Choice>
                  </div>
                </Field>
              )}
            </>
          )}

          {step.id === 'garantias' && (
            <>
              <Field label="¿Tenéis seguro de responsabilidad civil?" hint="Vais a trabajar en casas de clientes: es importante para ellos.">
                <div className="grid grid-cols-2 gap-2">
                  <Choice selected={draft.answers.has_liability_insurance === true} onClick={() => setAnswer('has_liability_insurance', true)}>Sí</Choice>
                  <Choice selected={draft.answers.has_liability_insurance === false} onClick={() => setAnswer('has_liability_insurance', false)}>No</Choice>
                </div>
              </Field>
              {draft.answers.has_liability_insurance === true && (
                <Field label="Aseguradora (opcional)">
                  <input className={INPUT} value={draft.answers.insurer ?? ''} onChange={(e) => setAnswer('insurer', e.target.value)} />
                </Field>
              )}
              <Field label="Maquinaria propia (opcional)" hint="Cortacésped, desbrozadoras, plataforma elevadora…">
                <textarea className={`${INPUT} min-h-[88px]`} value={draft.answers.own_machinery ?? ''} onChange={(e) => setAnswer('own_machinery', e.target.value)} />
              </Field>
              <Field label="Cuéntanos sobre la empresa (opcional)" hint="Tipo de clientes, trabajos de los que estáis orgullosos…">
                <textarea className={`${INPUT} min-h-[112px]`} value={draft.answers.description ?? ''} onChange={(e) => setAnswer('description', e.target.value)} />
              </Field>
              <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
                <label className="flex cursor-pointer items-start gap-3">
                  <input type="checkbox" className="mt-1 h-5 w-5 rounded text-emerald-700" checked={draft.declaration_truth} onChange={(e) => set('declaration_truth', e.target.checked)} />
                  <span className="text-sm text-gray-700">Declaro que la información es veraz y acepto que el equipo de GarSer la verifique.</span>
                </label>
                <label className="flex cursor-pointer items-start gap-3">
                  <input type="checkbox" className="mt-1 h-5 w-5 rounded text-emerald-700" checked={draft.accept_terms} onChange={(e) => set('accept_terms', e.target.checked)} />
                  <span className="text-sm text-gray-700">Acepto que estos datos se usen para gestionar el perfil de la empresa y sus trabajos en GarSer.</span>
                </label>
              </div>
            </>
          )}
        </div>

        {showMissing && missing.length > 0 && (
          <p role="alert" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Te falta: {missing.join(', ')}.
          </p>
        )}

        <div className="mt-6 flex gap-3" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          {stepIndex > 0 && (
            <button type="button" onClick={goBack} className="inline-flex items-center justify-center gap-1 rounded-xl border border-gray-200 bg-white px-4 py-3 font-bold text-gray-700 hover:bg-gray-50">
              <ChevronLeft className="h-5 w-5" /> Atrás
            </button>
          )}
          <button
            type="button"
            onClick={goNext}
            disabled={saving}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white shadow-lg shadow-emerald-700/20 transition-all hover:bg-emerald-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving && <Loader2 className="h-5 w-5 animate-spin" />}
            {isLast ? 'Enviar solicitud' : 'Siguiente'}
            {!isLast && !saving && <ChevronRight className="h-5 w-5" />}
          </button>
        </div>
      </main>
    </div>
  );
};

export default CompanyApplicationPage;
