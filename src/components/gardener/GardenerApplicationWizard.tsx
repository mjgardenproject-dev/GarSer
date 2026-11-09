import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { applicationHasData, fetchLastRejection, submitGardenerApplication, wizardStateFromApplication } from '../../utils/gardenerApplicationRetry';
import { trackMetaLead } from '../../utils/metaLead';
import { advertisingConsentColumns } from '../../utils/cookieConsentStorage';
import { Check, ChevronLeft, ChevronRight, UploadCloud, Plus } from 'lucide-react';
import GardenerStatusPage from './GardenerStatusPage';
import StickyStepProgress from '../common/StickyStepProgress';
import { compressImage } from '../../utils/imageCompression';
import { MAX_TEAM_SIZE, MIN_TEAM_SIZE_WITH_TEAM, estimatedTeamSize, teamSizeHint, type TeamChoice } from '../../utils/applicationTeamSize';

type Step = 1 | 2 | 3 | 4 | 5;

// Debe coincidir EXACTAMENTE con los nombres canónicos de la tabla `services`
// (ver enforce_canonical_services.js). Faltaba "Desbroce de malas hierbas": sin él, ningún
// jardinero podía declarar que ofrece desbroce y nunca aparecía como elegible para ese servicio.
const SERVICES = [
  'Corte de césped',
  'Poda de plantas y arbustos',
  'Poda de setos',
  'Poda de árboles',
  'Servicios fitosanitarios',
  'Poda de palmeras',
  'Desbroce de malas hierbas'
];

const TOOLS = [
  'Cortacésped',
  'Desbrozadora',
  'Tijeras de podar profesionales',
  'Sopladora',
  'Sierra eléctrica / motosierra',
  'Vehículo para transportar restos',
  'Serrucho para palmeras',
  'Pértiga o telescópica',
  'Azoleta',
  'Ninguna (solo mano de obra)'
];

const UPLOAD_BOX_CLASS = "relative w-24 h-24 sm:w-28 sm:h-28 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 hover:bg-gray-100 cursor-pointer overflow-hidden flex flex-col items-center justify-center transition-colors";
const TEXT_INPUT_CLASS = "w-full rounded-xl border border-gray-300 bg-gray-50 px-4 py-3 text-base sm:text-sm shadow-sm transition-all focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-green-500";
// Campos numéricos estrechos. `w-24 ${TEXT_INPUT_CLASS}` no servía: el `w-full` del campo de texto ganaba y el número
// ocupaba toda la fila (y «personas en total…» caía a la línea de abajo).
const NUMBER_INPUT_CLASS = TEXT_INPUT_CLASS.replace('w-full', 'w-24');
const SECONDARY_BUTTON_CLASS = "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-gray-100 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 [touch-action:manipulation]";

const GardenerApplicationWizard: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<number>(1);
    const [loading, setLoading] = useState(false);
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [submittedSuccess, setSubmittedSuccess] = useState(false);
  // PH-02: si la solicitud se reabrió tras un rechazo, el motivo, para saber qué corregir.
  const [lastRejection, setLastRejection] = useState<string>('');
  // ¿Había progreso local al abrir? (el guardado local empieza a escribir al segundo).
  const hadLocalProgress = useRef(false);
  
  // Upload loading states
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isUploadingProof, setIsUploadingProof] = useState(false);
  const [isUploadingCert, setIsUploadingCert] = useState(false);

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [cityZone, setCityZone] = useState('');
  const [photoUrl, setPhotoUrl] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [services, setServices] = useState<string[]>([]);
  const [otherServices, setOtherServices] = useState('');

  const [tools, setTools] = useState<string[]>([]);

  const [expYears, setExpYears] = useState<number>(0);
  const [expYearsInput, setExpYearsInput] = useState<string>('0');
  const [experienceText, setExperienceText] = useState('');
  // «¿Cuántas personas trabajarán desde tu perfil?» (contándote a ti). Sin respuesta por defecto: es el dato
  // que más pesa al revisar la solicitud, así que se elige a propósito (applicationTeamSize.ts).
  const [teamChoice, setTeamChoice] = useState<TeamChoice | null>(null);
  const [teamSizeInput, setTeamSizeInput] = useState<string>('');
  const [proofPhotos, setProofPhotos] = useState<string[]>([]);

  const [educationText, setEducationText] = useState('');
  const [certPhotos, setCertPhotos] = useState<string[]>([]);

  const [declTruth, setDeclTruth] = useState<boolean>(false);
  const [acceptTerms, setAcceptTerms] = useState<boolean>(false);

  const totalSteps = 5;
  // Progreso real del wizard: 0% en el paso 1 y 100% en el último paso.
  // Antes usaba (step-1)/totalSteps → en el paso 6 marcaba 83% y nunca llegaba al 100%.
  const progress = useMemo(() => Math.round(((step - 1) / (totalSteps - 1)) * 100), [step]);

  // Teléfono español: 9 dígitos empezando por 6/7/8/9, prefijo +34 opcional
  // (espacios y guiones se ignoran). Sin esto se colaban teléfonos imposibles.
  const isPhoneValid = (value: string) => /^(\+34)?[6789]\d{8}$/.test(value.replace(/[\s-]/g, ''));

  const isStepValid = (s: number) => {
    if (s === 1) return fullName.trim().length > 0 && isPhoneValid(phone) && cityZone.trim().length > 0 && !!photoUrl;
    if (s === 2) return services.length > 0 && tools.length > 0; // "Otros" es opcional
    if (s === 3) return (expYears >= 0) && (experienceText.trim().length > 0) && estimatedTeamSize(teamChoice, teamSizeInput) !== null;
    if (s === 4) return true; // Paso 4 (formación) es OPCIONAL por diseño: no debe frenar la solicitud
    if (s === 5) return declTruth && acceptTerms;
    return true;
  };

  // Qué falta para poder continuar (se muestra junto al botón deshabilitado)
  const stepHint = (s: number): string => {
    if (s === 1) {
      if (!fullName.trim()) return 'Escribe tu nombre completo.';
      if (!isPhoneValid(phone)) return 'Introduce un teléfono válido (9 dígitos, +34 opcional).';
      if (!cityZone.trim()) return 'Indica tu ciudad o zona de trabajo.';
      if (!photoUrl) return 'Sube una foto de perfil profesional.';
    }
    if (s === 2) {
      if (services.length === 0) return 'Marca al menos un servicio que ofrezcas.';
      if (tools.length === 0) return 'Marca al menos una herramienta de la que dispongas.';
    }
    if (s === 3) {
      if (experienceText.trim().length === 0) return 'Describe brevemente tu experiencia.';
      return teamSizeHint(teamChoice, teamSizeInput) || 'Indica tus años de experiencia.';
    }
    if (s === 5) return 'Marca las dos casillas para poder enviar la solicitud.';
    return '';
  };

  // --- Persistence Logic ---
  useEffect(() => {
    if (!user?.id) return;
    const key = `gardener_wizard_progress_${user.id}`;
    try {
      const saved = localStorage.getItem(key);
      hadLocalProgress.current = !!saved;
      if (saved) {
        const data = JSON.parse(saved);
        if (data.step) setStep(data.step);
        if (data.applicationId) setApplicationId(data.applicationId);
        if (data.submittedSuccess !== undefined) setSubmittedSuccess(data.submittedSuccess);
        
        if (data.fullName !== undefined) setFullName(data.fullName);
        if (data.phone !== undefined) setPhone(data.phone);
        if (data.cityZone !== undefined) setCityZone(data.cityZone);
        if (data.photoUrl !== undefined) setPhotoUrl(data.photoUrl);
        
        if (data.services !== undefined) setServices(data.services);
        if (data.otherServices !== undefined) setOtherServices(data.otherServices);
        
        if (data.tools !== undefined) setTools(data.tools);
        
        if (data.expYears !== undefined) setExpYears(data.expYears);
        if (data.expYearsInput !== undefined) setExpYearsInput(data.expYearsInput);
        if (data.experienceText !== undefined) setExperienceText(data.experienceText);
        if (data.teamChoice === 'solo' || data.teamChoice === 'team') setTeamChoice(data.teamChoice);
        if (typeof data.teamSizeInput === 'string') setTeamSizeInput(data.teamSizeInput);
        if (data.proofPhotos !== undefined) setProofPhotos(data.proofPhotos);
        
        if (data.educationText !== undefined) setEducationText(data.educationText);
        if (data.certPhotos !== undefined) setCertPhotos(data.certPhotos);
        
        if (data.declTruth !== undefined) setDeclTruth(data.declTruth);
        if (data.acceptTerms !== undefined) setAcceptTerms(data.acceptTerms);
      }
    } catch (e) {
      console.error('Error loading saved progress:', e);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    // Tras enviar con éxito no re-guardamos el borrador: el key se limpia en submit()
    if (submittedSuccess) return;
    const key = `gardener_wizard_progress_${user.id}`;
    const data = {
      step, applicationId, submittedSuccess,
      fullName, phone, cityZone, photoUrl,
      services, otherServices,
      tools,
      expYears, expYearsInput, experienceText, teamChoice, teamSizeInput, proofPhotos,
      educationText, certPhotos,
      declTruth, acceptTerms
    };
    
    const handler = setTimeout(() => {
      localStorage.setItem(key, JSON.stringify(data));
    }, 1000);
    
    return () => clearTimeout(handler);
  }, [
    user?.id, step, applicationId, submittedSuccess,
    fullName, phone, cityZone, photoUrl,
    services, otherServices,
    tools,
    expYears, expYearsInput, experienceText, teamChoice, teamSizeInput, proofPhotos,
    educationText, certPhotos,
    declTruth, acceptTerms
  ]);

  useEffect(() => {
    if (!user?.id) return;
    bootstrapDraft();
  }, [user?.id]);

  const bootstrapDraft = async () => {
    try {
      const { data: existing, error } = await supabase
        .from('gardener_applications')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      if (existing && existing.length > 0) {
        const latest = existing[0];
        if (latest.status === 'draft') {
          setApplicationId(latest.id);
          // PH-02: una solicitud reabierta tras un rechazo trae sus datos de la base de datos (el
          // borrador local se borró al enviarla). Si hay progreso local, manda el local.
          if (!hadLocalProgress.current && applicationHasData(latest)) {
            const restored = wizardStateFromApplication(latest);
            setFullName(restored.fullName); setPhone(restored.phone); setCityZone(restored.cityZone); setPhotoUrl(restored.photoUrl);
            setServices(restored.services); setOtherServices(restored.otherServices); setTools(restored.tools);
            setExpYears(restored.expYears); setExpYearsInput(restored.expYearsInput); setExperienceText(restored.experienceText);
            setTeamChoice(restored.teamChoice); setTeamSizeInput(restored.teamSizeInput); setProofPhotos(restored.proofPhotos);
            setEducationText(restored.educationText); setCertPhotos(restored.certPhotos);
          }
          const rejection = await fetchLastRejection(user!.id);
          if (rejection?.reason) setLastRejection(rejection.reason);
          return;
        }
        if (latest.status === 'submitted' || latest.status === 'approved' || latest.status === 'rejected') {
          navigate('/dashboard');
          return;
        }
      }
      const { data, error: insError } = await supabase
        .from('gardener_applications')
        .insert({ user_id: user!.id, status: 'draft', submitted_at: new Date().toISOString() })
        .select('id')
        .single();
      if (insError) throw insError;
      setApplicationId(data.id);
    } catch {}
  };

  const toggleService = (name: string) => {
    setServices((prev) => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]);
  };
  const toggleTool = (name: string) => {
    setTools((prev) => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]);
  };

  const uploadPhoto = async (file: File, folder: string): Promise<string> => {
    // Las fotos de móvil pesan varios MB: comprimimos antes de subir (PDF/doc pasan tal cual)
    const toUpload = await compressImage(file);
    const ext = toUpload.name.split('.').pop() || 'jpg';
    const path = `${user!.id}/${folder}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('applications').upload(path, toUpload, { upsert: true });
    if (error) throw error;
    const { data } = supabase.storage.from('applications').getPublicUrl(path);
    return data.publicUrl;
  };

  const removeProofPhoto = (index: number) => {
    setProofPhotos(prev => prev.filter((_, i) => i !== index));
  };

  const removeCertPhoto = (index: number) => {
    setCertPhotos(prev => prev.filter((_, i) => i !== index));
  };

  const autosave = async () => {
    if (!applicationId) return;
    const payload = {
      full_name: fullName,
      phone,
      // email removed from UI but available in user context if needed, usually not updated here
      city_zone: cityZone,
      professional_photo_url: photoUrl,
      services,
      other_services: otherServices,
      tools_available: tools,
      experience_years: expYears || null,
      experience_description: experienceText, // Assuming this field exists or mapping it
      // Personas que trabajarán desde el perfil, contándote a ti (null mientras no esté respondida).
      estimated_team_size: estimatedTeamSize(teamChoice, teamSizeInput),
      proof_photos: proofPhotos,
      certification_text: educationText || null,
      certification_photos: certPhotos, // Assuming this field exists
      declaration_truth: declTruth,
      accept_terms: acceptTerms,
      // Lo que decidió con las cookies de publicidad en este navegador: permite mandar «ProviderApproved» a Meta al aprobar.
      ...advertisingConsentColumns(),
    };
    await supabase.from('gardener_applications').update(payload).eq('id', applicationId);
  };

  const next = async () => { await autosave(); setStep((s) => (s < totalSteps ? (s + 1) : s)); };
  const prev = async () => { await autosave(); setStep((s) => (s > 1 ? (s - 1) : s)); };

  const submit = async () => {
    if (!applicationId) return;
    if (!declTruth || !acceptTerms) return;
    setLoading(true);
    try {
      await autosave();
      // El servidor comprueba que está completa y la envía (PH-18); si falta algo, lo dice.
      try {
        await submitGardenerApplication();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'No se pudo enviar la solicitud');
        return;
      }
      // Success: show local success state immediately without redirection
      toast.success('Solicitud enviada');
      setSubmittedSuccess(true);
      trackMetaLead(user?.email);
      // El borrador local ya no sirve (la solicitud vive en la BD); si no se limpia,
      // una futura solicitud tras rechazo arrancaría con datos viejos a medias.
      try { localStorage.removeItem(`gardener_wizard_progress_${user!.id}`); } catch { /* noop */ }
    } finally { setLoading(false); }
  };

  if (submittedSuccess) {
    return <GardenerStatusPage status="pending" />;
  }

  const getStepTitle = (s: number) => {
    switch(s) {
      case 1: return 'Tus datos';
      case 2: return 'Servicios y herramientas';
      case 3: return 'Tu actividad';
      case 4: return 'Formación';
      case 5: return 'Confirmación';
      default: return '';
    }
  };

  return (
    <div className="min-h-screen">
      {/* Progreso FIJO bajo la barra general: dentro de la página el Navbar lo tapaba (fallo 1 del móvil). */}
      <StickyStepProgress title="Alta de jardinero" stepLabel={`Paso ${step} de ${totalSteps}`} percent={progress} className="sm:px-6" />
      <div className="max-w-3xl mx-auto p-4 sm:p-6">
      <div className="space-y-6">
        
        {lastRejection && step === 1 && (
          <div role="note" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">Corrige tu solicitud y vuelve a enviarla</p>
            <p className="mt-1 break-words"><span className="font-medium">Motivo del rechazo:</span> {lastRejection}</p>
          </div>
        )}

        {/* Header Re-layout */}
        <div className="w-full">
          {step === 1 && (
            <p className="mb-3 text-sm text-gray-500">{totalSteps} pasos, unos 3-4 minutos.</p>
          )}

          {/* Navigation & Title Row */}
          <div className="flex items-center justify-between gap-2">
             <button
               type="button"
               onClick={prev}
               disabled={step === 1}
               aria-label="Paso anterior"
               className={`flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-gray-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 [touch-action:manipulation] ${step === 1 ? 'opacity-0 pointer-events-none' : ''}`}
             >
               <ChevronLeft className="w-6 h-6 text-gray-700" />
             </button>

             <h1 className="text-xl font-bold text-center flex-1 leading-tight">{getStepTitle(step)}</h1>

             <button
               type="button"
               onClick={next}
               disabled={!isStepValid(step)}
               aria-label="Paso siguiente"
               className={`flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-gray-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 [touch-action:manipulation] ${step === totalSteps ? 'opacity-0 pointer-events-none' : ''} ${!isStepValid(step) ? 'opacity-30 cursor-not-allowed' : ''}`}
             >
               <ChevronRight className="w-6 h-6 text-gray-700" />
             </button>
          </div>
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <label htmlFor="gw-full-name" className="block text-sm font-medium text-gray-700">Nombre completo</label>
            <input id="gw-full-name" value={fullName} onChange={(e)=>setFullName(e.target.value)} className={TEXT_INPUT_CLASS} />
            <label htmlFor="gw-phone" className="block text-sm font-medium text-gray-700">Teléfono</label>
            <input
              id="gw-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="600 000 000"
              value={phone}
              onChange={(e)=>setPhone(e.target.value)}
              className={`${TEXT_INPUT_CLASS} ${phone.trim().length > 0 && !isPhoneValid(phone) ? 'border-red-400 focus:ring-red-400' : ''}`}
            />
            {phone.trim().length > 0 && !isPhoneValid(phone) && (
              <p className="text-xs text-red-600">Introduce un teléfono español válido: 9 dígitos empezando por 6, 7, 8 o 9 (+34 opcional).</p>
            )}

            {/* Email removed */}

            <label htmlFor="gw-city-zone" className="block text-sm font-medium text-gray-700">Ciudad / zona de trabajo</label>
            <input id="gw-city-zone" value={cityZone} onChange={(e)=>setCityZone(e.target.value)} className={TEXT_INPUT_CLASS} />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Foto de perfil profesional</label>
              <div className="flex items-center gap-4">
                <label htmlFor="avatar-upload" className={UPLOAD_BOX_CLASS}>
                  {isUploadingAvatar ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-10">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
                    </div>
                  ) : !photoUrl ? (
                    <div className="flex flex-col items-center justify-center text-gray-500">
                      <Plus className="w-8 h-8" />
                      <span className="text-xs mt-1">Añadir</span>
                    </div>
                  ) : (
                    <img src={photoUrl} alt="Foto" className="w-full h-full object-cover" />
                  )}
                  <input 
                    id="avatar-upload" 
                    ref={fileInputRef} 
                    type="file" 
                    accept="image/*" 
                    className="sr-only" 
                    disabled={isUploadingAvatar}
                    onChange={async (e)=>{ 
                      const f=e.target.files?.[0]; 
                      if(!f) return; 
                      setIsUploadingAvatar(true);
                      try {
                        const url=await uploadPhoto(f,'avatar');
                        setPhotoUrl(url);
                      } catch {
                        toast.error('No se pudo subir la foto. Revisa tu conexión e inténtalo de nuevo.');
                      } finally {
                        setIsUploadingAvatar(false);
                      }
                    }} 
                  />
                </label>
                {photoUrl && (
                  <button type="button" onClick={() => fileInputRef.current?.click()} className={SECONDARY_BUTTON_CLASS}>
                    <UploadCloud className="w-4 h-4" />
                    <span>Cambiar foto</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <div className="space-y-3">
              <h2 className="text-xl font-bold text-gray-900">¿Qué servicios puedes ofrecer?</h2>
              <div className="text-sm text-gray-600">Marca todos los que domines y para los que dispongas de herramientas</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {SERVICES.map(s=> (
                  <label key={s} className="flex min-h-11 items-center gap-2 rounded-xl border border-gray-200 p-3 cursor-pointer hover:bg-gray-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-green-500">
                    <input type="checkbox" checked={services.includes(s)} onChange={()=>toggleService(s)} className="w-4 h-4 text-green-600 focus-visible:ring-2 focus-visible:ring-green-500 rounded" />
                    <span>{s}</span>
                  </label>
                ))}
              </div>
              <label htmlFor="gw-other-services" className="block text-sm font-medium text-gray-700 mt-4">Otros</label>
              <textarea id="gw-other-services" value={otherServices} onChange={(e)=>setOtherServices(e.target.value)} rows={3} placeholder="¿Ofreces algún servicio que no esté en la lista?" className={TEXT_INPUT_CLASS} />
            </div>

            <div className="space-y-3 border-t border-gray-200 pt-6">
              <h2 className="text-xl font-bold text-gray-900">¿De qué herramientas dispones?</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {TOOLS.map(t=> (
                  <label key={t} className="flex min-h-11 items-center gap-2 rounded-xl border border-gray-200 p-3 cursor-pointer hover:bg-gray-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-green-500">
                    <input type="checkbox" checked={tools.includes(t)} onChange={()=>toggleTool(t)} className="w-4 h-4 text-green-600 focus-visible:ring-2 focus-visible:ring-green-500 rounded" />
                    <span>{t}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <p className="text-sm text-gray-600">
              GarSer es para profesionales que trabajan por su cuenta y para empresas de jardinería. Cuéntanos cómo trabajas
              para que podamos revisar tu solicitud.
            </p>

            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Experiencia</h2>
              <div className="flex items-center gap-3">
                <label htmlFor="gw-exp-years" className="sr-only">Años de experiencia</label>
                <input id="gw-exp-years" type="number" min={0} value={expYearsInput} onFocus={()=>{ if (expYearsInput === '0') setExpYearsInput(''); }} onBlur={()=>{ if (expYearsInput.trim() === '') { setExpYearsInput('0'); setExpYears(0); } }} onChange={(e)=>{ const v=e.target.value; setExpYearsInput(v); const n=parseInt(v||'0',10); setExpYears(isNaN(n)?0:n); }} className={NUMBER_INPUT_CLASS} />
                <span className="text-sm text-gray-700">años de experiencia</span>
              </div>
              <label htmlFor="gw-exp-text" className="block text-sm font-medium text-gray-700">Describe tu experiencia</label>
              <textarea
                id="gw-exp-text"
                value={experienceText}
                onChange={(e)=>setExperienceText(e.target.value)}
                rows={4}
                placeholder="Qué trabajos haces, en qué zonas y para qué tipo de clientes (particulares, comunidades, empresas…)"
                className={TEXT_INPUT_CLASS}
              />
            </div>

            {/* El dato que más ayuda a decidir la solicitud: un autónomo solo no es lo mismo que una empresa con equipo.
                Es una estimación y no crea equipo: el modo de la cuenta cambia solo cuando acepta a su primer compañero. */}
            <div className="space-y-3 border-t border-gray-200 pt-6" role="radiogroup" aria-labelledby="gw-team-title" aria-describedby="gw-team-help">
              <h2 id="gw-team-title" className="text-lg font-semibold">¿Cuántas personas trabajarán desde tu perfil?</h2>
              <p id="gw-team-help" className="text-sm text-gray-600">
                Cuéntate a ti también. Es solo una estimación: podrás añadir o quitar gente de tu equipo cuando quieras.
              </p>
              {([
                { value: 'solo', title: 'Solo yo', hint: 'Trabajo por mi cuenta' },
                { value: 'team', title: 'Con equipo', hint: 'Trabajamos varias personas' },
              ] as const).map((option) => (
                <label
                  key={option.value}
                  className={`flex min-h-11 items-center gap-3 rounded-xl border p-3 cursor-pointer hover:bg-gray-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-green-500 ${teamChoice === option.value ? 'border-green-600 bg-green-50' : 'border-gray-200'}`}
                >
                  <input
                    type="radio"
                    name="gw-team-choice"
                    value={option.value}
                    checked={teamChoice === option.value}
                    onChange={() => setTeamChoice(option.value)}
                    className="h-4 w-4 text-green-600 focus-visible:ring-2 focus-visible:ring-green-500"
                  />
                  <span className="text-sm text-gray-900"><span className="font-semibold">{option.title}</span> · {option.hint}</span>
                </label>
              ))}
              {teamChoice === 'team' && (
                <div className="flex flex-wrap items-center gap-3 pl-1">
                  <label htmlFor="gw-team-size" className="sr-only">Personas en total, contándote a ti</label>
                  <input
                    id="gw-team-size"
                    type="number"
                    inputMode="numeric"
                    min={MIN_TEAM_SIZE_WITH_TEAM}
                    max={MAX_TEAM_SIZE}
                    step={1}
                    autoComplete="off"
                    value={teamSizeInput}
                    onChange={(e) => setTeamSizeInput(e.target.value)}
                    aria-invalid={teamSizeInput.trim().length > 0 && estimatedTeamSize('team', teamSizeInput) === null}
                    aria-describedby="gw-team-size-hint"
                    className={`${NUMBER_INPUT_CLASS} ${teamSizeInput.trim().length > 0 && estimatedTeamSize('team', teamSizeInput) === null ? 'border-red-400 focus:ring-red-400' : ''}`}
                  />
                  <span className="text-sm text-gray-700">personas en total, contándote a ti</span>
                  <p id="gw-team-size-hint" className={`w-full text-xs ${teamSizeInput.trim().length > 0 && estimatedTeamSize('team', teamSizeInput) === null ? 'text-red-600' : 'text-gray-500'}`}>
                    Un número de {MIN_TEAM_SIZE_WITH_TEAM} a {MAX_TEAM_SIZE}.
                  </p>
                </div>
              )}
            </div>

            <div className="border-t border-gray-200 pt-6">
              <label className="block text-sm font-medium text-gray-700 mb-1">Fotos de trabajos que hayas hecho (opcional)</label>
              <p className="mb-3 text-xs text-gray-500">Ayudan a revisar tu solicitud. También puedes adjuntar un PDF, por ejemplo con tu actividad como autónomo o empresa.</p>

              {/* Custom File Input */}
              <div className="flex flex-wrap gap-3 mb-3">
                {proofPhotos.map((u, i) => (
                   <div key={i} className="relative group">
                     <div className={`${UPLOAD_BOX_CLASS} border-solid border-gray-200 bg-white cursor-default`}>
                        {/* Simple preview logic */}
                        {u.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                          <img src={u} alt="Preview" className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-xs text-gray-500 px-1 break-all">{u.split('/').pop()?.slice(-10)}</span>
                        )}
                     </div>
                     <button
                       onClick={() => removeProofPhoto(i)}
                       className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center shadow-md hover:bg-red-600 transition-colors"
                       type="button"
                     >
                       ×
                     </button>
                   </div>
                ))}

                {isUploadingProof && (
                  <div className={UPLOAD_BOX_CLASS}>
                    <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-10">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
                    </div>
                  </div>
                )}

                <label className={`${UPLOAD_BOX_CLASS} ${isUploadingProof ? 'opacity-50 cursor-not-allowed' : ''}`}>
                  <Plus className="w-8 h-8 text-gray-400" />
                  <span className="text-xs text-gray-500 mt-1">Añadir</span>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    multiple
                    className="hidden"
                    disabled={isUploadingProof}
                    onChange={async (e)=>{
                    const files=Array.from(e.target.files||[]);
                    if (files.length === 0) return;
                    setIsUploadingProof(true);
                    try {
                      const urls: string[]=[];
                      for(const f of files){ const u=await uploadPhoto(f,'proof'); urls.push(u);}
                      setProofPhotos((prev)=>[...prev,...urls]);
                      e.target.value = ''; // Reset input to allow re-selecting same file
                    } catch {
                      toast.error('No se pudieron subir los archivos. Revisa tu conexión e inténtalo de nuevo.');
                    } finally {
                      setIsUploadingProof(false);
                    }
                  }} />
                </label>
              </div>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <label htmlFor="gw-education" className="block text-xl font-bold text-gray-900 mb-4">¿Tienes algún curso o formación en jardinería?</label>
            <textarea id="gw-education" value={educationText} onChange={(e)=>setEducationText(e.target.value)} rows={4} className={TEXT_INPUT_CLASS} placeholder="Detalla aquí tus cursos, titulaciones, etc..." />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Adjunta fotos o documentos de tu titulación (opcional)</label>
              
              <div className="flex flex-wrap gap-3 mb-3">
                {certPhotos.map((u, i) => (
                   <div key={i} className="relative group">
                     <div className={`${UPLOAD_BOX_CLASS} border-solid border-gray-200 bg-white cursor-default`}>
                        {u.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                          <img src={u} alt="Preview" className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-xs text-gray-500 px-1 break-all text-center">{u.split('/').pop()?.slice(-10)}</span>
                        )}
                     </div>
                     <button
                       onClick={() => removeCertPhoto(i)}
                       className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center shadow-md hover:bg-red-600 transition-colors z-20"
                       type="button"
                     >
                       ×
                     </button>
                   </div>
                ))}
                
                {isUploadingCert && (
                  <div className={UPLOAD_BOX_CLASS}>
                    <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-10">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
                    </div>
                  </div>
                )}
                
                <label className={`${UPLOAD_BOX_CLASS} ${isUploadingCert ? 'opacity-50 cursor-not-allowed' : ''}`}>
                  <Plus className="w-8 h-8 text-gray-400" />
                  <span className="text-xs text-gray-500 mt-1">Añadir</span>
                  <input 
                    type="file" 
                    accept="image/*,.pdf,.doc,.docx" 
                    multiple 
                    className="hidden" 
                    disabled={isUploadingCert}
                    onChange={async (e)=>{ 
                      const files=Array.from(e.target.files||[]); 
                      if (files.length === 0) return;
                      setIsUploadingCert(true);
                      try {
                        const urls: string[]=[];
                        for(const f of files){ const u=await uploadPhoto(f,'certs'); urls.push(u);}
                        setCertPhotos((prev)=>[...prev,...urls]);
                        e.target.value = '';
                      } catch {
                        toast.error('No se pudieron subir los archivos. Revisa tu conexión e inténtalo de nuevo.');
                      } finally {
                        setIsUploadingCert(false);
                      }
                    }} 
                  />
                </label>
              </div>
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-3">
            <label className="flex items-center gap-2 cursor-pointer rounded-xl border border-gray-200 p-3 hover:bg-gray-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-green-500"><input type="checkbox" checked={declTruth} onChange={()=>setDeclTruth(v=>!v)} className="w-4 h-4 text-green-600 focus-visible:ring-2 focus-visible:ring-green-500 rounded" /><span>Declaro que toda la información proporcionada es veraz y acepto ser verificado por el equipo de GarserHelp.</span></label>
            <label className="flex items-center gap-2 cursor-pointer rounded-xl border border-gray-200 p-3 hover:bg-gray-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-green-500"><input type="checkbox" checked={acceptTerms} onChange={()=>setAcceptTerms(v=>!v)} className="w-4 h-4 text-green-600 focus-visible:ring-2 focus-visible:ring-green-500 rounded" /><span>Acepto que mis datos sean utilizados para gestionar mi perfil y solicitudes en la app de jardinería.</span></label>
          </div>
        )}

        <div className="sticky bottom-0 mt-6 bg-white pt-3 border-t" style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}>
          <div className="flex items-center justify-between">
            <button type="button" onClick={prev} disabled={step===1} className={SECONDARY_BUTTON_CLASS}><ChevronLeft className="w-4 h-4" /><span>Anterior</span></button>
            {step < totalSteps ? (
              <button type="button" onClick={next} disabled={!isStepValid(step)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-emerald-700 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 [touch-action:manipulation]"><span>Siguiente</span><ChevronRight className="w-4 h-4" /></button>
            ) : (
              <button type="button" onClick={submit} disabled={!declTruth || !acceptTerms || loading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-emerald-700 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 [touch-action:manipulation]"><Check className="w-4 h-4" /><span>{loading ? 'Enviando...' : 'Enviar solicitud'}</span></button>
            )}
          </div>
          {/* Explicar qué falta en vez de solo deshabilitar el botón */}
          {!isStepValid(step) && (
            <p className="text-xs text-gray-500 mt-2 text-center">{stepHint(step)}</p>
          )}
        </div>
      </div>
      </div>
    </div>
  );
};

export default GardenerApplicationWizard;
