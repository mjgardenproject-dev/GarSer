import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { Check, ChevronLeft, ChevronRight, UploadCloud, Plus } from 'lucide-react';

type Step = 1 | 2 | 3 | 4 | 5 | 6;

const SERVICES = [
  'Corte de césped',
  'Corte de setos a máquina',
  'Poda de plantas',
  'Poda de árboles',
  'Labrar y quitar malas hierbas a mano',
  'Fumigación de plantas'
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

const GardenerApplicationWizard: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<number>(1);
  const [loading, setLoading] = useState(false);
  const [applicationId, setApplicationId] = useState<string | null>(null);

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
  const [workedForCompanies, setWorkedForCompanies] = useState<boolean>(false);
  const [canProve, setCanProve] = useState<boolean>(false);
  const [proofPhotos, setProofPhotos] = useState<string[]>([]);

  const [educationText, setEducationText] = useState('');
  const [certPhotos, setCertPhotos] = useState<string[]>([]);

  const [declTruth, setDeclTruth] = useState<boolean>(false);
  const [acceptTerms, setAcceptTerms] = useState<boolean>(false);

  const totalSteps = 6;
  const progress = useMemo(() => Math.round(((step - 1) / totalSteps) * 100), [step]);

  const isStepValid = (s: number) => {
    if (s === 1) return fullName.trim().length > 0 && phone.trim().length > 0 && cityZone.trim().length > 0 && !!photoUrl;
    if (s === 2) return services.length > 0; // "Otros" es opcional
    if (s === 3) return tools.length > 0;
    if (s === 4) return (expYears >= 0) && (experienceText.trim().length > 0);
    if (s === 5) return true; // Formación es opcional? El usuario dijo "Aumentar tamaño...", asumo que puede estar vacío o lleno.
    if (s === 6) return declTruth && acceptTerms;
    return true;
  };

  useEffect(() => {
    if (!user?.id) return;
    bootstrapDraft();
  }, [user?.id]);

  const bootstrapDraft = async () => {
    try {
      const { data: existing } = await supabase
        .from('gardener_applications')
        .select('id,status')
        .eq('user_id', user!.id)
        .eq('status', 'draft')
        .limit(1);
      if (existing && existing.length > 0) {
        setApplicationId(existing[0].id);
        return;
      }
      const { data, error } = await supabase
        .from('gardener_applications')
        .insert({ user_id: user!.id, status: 'draft', submitted_at: new Date().toISOString() })
        .select('id')
        .single();
      if (error) throw error;
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
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `${user!.id}/${folder}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('applications').upload(path, file, { upsert: true });
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
      worked_for_companies: workedForCompanies,
      can_prove: canProve,
      proof_photos: proofPhotos,
      certification_text: educationText || null,
      certification_photos: certPhotos, // Assuming this field exists
      declaration_truth: declTruth,
      accept_terms: acceptTerms
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
      const { error } = await supabase
        .from('gardener_applications')
        .update({ status: 'submitted', submitted_at: new Date().toISOString() })
        .eq('id', applicationId);
      if (error) {
        toast.error(error.message || 'No se pudo enviar la solicitud');
        return;
      }
      try {
        localStorage.setItem('gardenerApplicationStatus','submitted');
        localStorage.setItem('gardenerApplicationJustSubmitted','1');
      } catch {}
      toast.success('Solicitud enviada');
      navigate('/dashboard');
    } finally { setLoading(false); }
  };

  const getStepTitle = (s: number) => {
    switch(s) {
      case 1: return 'ENCUESTA DE SOLICITUD PARA JARDINEROS';
      case 2: return 'Servicios';
      case 3: return 'Herramientas';
      case 4: return 'Experiencia';
      case 5: return 'Formación';
      case 6: return 'Confirmación';
      default: return '';
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6">
      <div className="space-y-6">
        
        {/* Header Re-layout */}
        <div className="w-full">
          {/* Progress Row */}
          <div className="w-full mb-4">
            <div className="flex items-center justify-between text-sm text-gray-600 mb-1">
              <span>Progreso</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-2 bg-green-600 transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
          </div>
          
          {/* Navigation & Title Row */}
          <div className="flex items-center justify-between gap-2">
             <button 
               onClick={prev} 
               disabled={step === 1}
               className={`p-2 rounded-full hover:bg-gray-100 transition-colors ${step === 1 ? 'opacity-0 pointer-events-none' : ''}`}
             >
               <ChevronLeft className="w-6 h-6 text-gray-700" />
             </button>
             
             <h1 className="text-xl font-bold text-center flex-1 leading-tight">{getStepTitle(step)}</h1>
             
             <button 
               onClick={next} 
               disabled={!isStepValid(step)}
               className={`p-2 rounded-full hover:bg-gray-100 transition-colors ${step === 6 ? 'opacity-0 pointer-events-none' : ''} ${!isStepValid(step) ? 'opacity-30 cursor-not-allowed' : ''}`}
             >
               <ChevronRight className="w-6 h-6 text-gray-700" />
             </button>
          </div>
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <label className="block text-sm font-medium text-gray-700">Nombre completo</label>
            <input value={fullName} onChange={(e)=>setFullName(e.target.value)} className="w-full p-3 border rounded text-base sm:text-sm" />
            <label className="block text-sm font-medium text-gray-700">Teléfono</label>
            <input value={phone} onChange={(e)=>setPhone(e.target.value)} className="w-full p-3 border rounded text-base sm:text-sm" />
            
            {/* Email removed */}
            
            <label className="block text-sm font-medium text-gray-700">Ciudad / zona de trabajo</label>
            <input value={cityZone} onChange={(e)=>setCityZone(e.target.value)} className="w-full p-3 border rounded text-base sm:text-sm" />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Foto de perfil profesional</label>
              <div className="flex items-center gap-4">
                <label htmlFor="avatar-upload" className="relative w-24 h-24 sm:w-32 sm:h-32 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 hover:bg-gray-100 cursor-pointer overflow-hidden flex items-center justify-center">
                  {!photoUrl ? (
                    <div className="flex flex-col items-center justify-center text-gray-500">
                      <Plus className="w-7 h-7" />
                      <span className="text-xs mt-1">Añadir</span>
                    </div>
                  ) : (
                    <img src={photoUrl} alt="Foto" className="w-full h-full object-cover" />
                  )}
                  <input id="avatar-upload" ref={fileInputRef} type="file" accept="image/*" className="sr-only" onChange={async (e)=>{ const f=e.target.files?.[0]; if(!f) return; const url=await uploadPhoto(f,'avatar'); setPhotoUrl(url); }} />
                </label>
                {photoUrl && (
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="px-3 py-2 bg-gray-100 rounded hover:bg-gray-200 inline-flex items-center gap-2">
                    <UploadCloud className="w-4 h-4" />
                    <span>Cambiar foto</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <h2 className="text-xl font-bold text-gray-900 mb-4">¿Qué servicios puedes ofrecer?</h2>
            <div className="text-sm text-gray-600">Marca todos los que domines y para los que dispongas de herramientas</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {SERVICES.map(s=> (
                <label key={s} className="flex items-center gap-2 p-3 border rounded cursor-pointer hover:bg-gray-50">
                  <input type="checkbox" checked={services.includes(s)} onChange={()=>toggleService(s)} className="w-4 h-4 text-green-600 focus:ring-green-500 rounded" />
                  <span>{s}</span>
                </label>
              ))}
            </div>
            <label className="block text-sm font-medium text-gray-700 mt-4">Otros</label>
            <textarea value={otherServices} onChange={(e)=>setOtherServices(e.target.value)} rows={3} className="w-full p-3 border rounded text-base sm:text-sm" />
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <label className="block text-xl font-bold text-gray-900 mb-4">¿De qué herramientas dispones?</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {TOOLS.map(t=> (
                <label key={t} className="flex items-center gap-2 p-3 border rounded cursor-pointer hover:bg-gray-50">
                  <input type="checkbox" checked={tools.includes(t)} onChange={()=>toggleTool(t)} className="w-4 h-4 text-green-600 focus:ring-green-500 rounded" />
                  <span>{t}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold mb-2">Experiencia</h2>
            <div className="flex items-center gap-3">
              <input type="number" min={0} value={expYearsInput} onFocus={()=>{ if (expYearsInput === '0') setExpYearsInput(''); }} onBlur={()=>{ if (expYearsInput.trim() === '') { setExpYearsInput('0'); setExpYears(0); } }} onChange={(e)=>{ const v=e.target.value; setExpYearsInput(v); const n=parseInt(v||'0',10); setExpYears(isNaN(n)?0:n); }} className="w-24 p-2 border rounded text-base sm:text-sm" />
              <span className="text-sm text-gray-700">años de experiencia</span>
            </div>
            <label className="block text-sm font-medium text-gray-700">Describe tu experiencia</label>
            <textarea value={experienceText} onChange={(e)=>setExperienceText(e.target.value)} rows={4} className="w-full p-3 border rounded text-base sm:text-sm" />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Adjunta fotos o documentos (opcional). Si lo tienes, añade tu CV</label>
              
              {/* Custom File Input */}
              <div className="flex flex-wrap gap-3 mb-3">
                {proofPhotos.map((u, i) => (
                   <div key={i} className="relative group">
                     <div className="w-20 h-20 rounded-lg border overflow-hidden bg-gray-100 flex items-center justify-center">
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
                
                <label className="w-20 h-20 rounded-lg border-2 border-dashed border-gray-300 flex flex-col items-center justify-center cursor-pointer hover:bg-gray-50 transition-colors">
                  <Plus className="w-6 h-6 text-gray-400" />
                  <span className="text-xs text-gray-500 mt-1">Añadir</span>
                  <input type="file" accept="image/*,.pdf,.doc,.docx" multiple className="hidden" onChange={async (e)=>{ 
                    const files=Array.from(e.target.files||[]); 
                    const urls: string[]=[]; 
                    for(const f of files){ const u=await uploadPhoto(f,'proof'); urls.push(u);} 
                    setProofPhotos((prev)=>[...prev,...urls]); 
                    e.target.value = ''; // Reset input to allow re-selecting same file
                  }} />
                </label>
              </div>
            </div>
          </div>
        )}

        {/* Old Step 5 Deleted */}

        {step === 5 && (
          <div className="space-y-4">
            <label className="block text-xl font-bold text-gray-900 mb-4">¿Tienes algún curso o formación en jardinería?</label>
            <textarea value={educationText} onChange={(e)=>setEducationText(e.target.value)} rows={4} className="w-full p-3 border rounded text-base sm:text-sm" placeholder="Detalla aquí tus cursos, titulaciones, etc..." />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Adjunta fotos o documentos de tu titulación (opcional)</label>
              
              <div className="flex flex-wrap gap-3 mb-3">
                {certPhotos.map((u, i) => (
                   <div key={i} className="relative group">
                     <div className="w-20 h-20 rounded-lg border overflow-hidden bg-gray-100 flex items-center justify-center">
                        {u.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                          <img src={u} alt="Preview" className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-xs text-gray-500 px-1 break-all">{u.split('/').pop()?.slice(-10)}</span>
                        )}
                     </div>
                     <button
                       onClick={() => removeCertPhoto(i)}
                       className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center shadow-md hover:bg-red-600 transition-colors"
                       type="button"
                     >
                       ×
                     </button>
                   </div>
                ))}
                
                <label className="w-20 h-20 rounded-lg border-2 border-dashed border-gray-300 flex flex-col items-center justify-center cursor-pointer hover:bg-gray-50 transition-colors">
                  <Plus className="w-6 h-6 text-gray-400" />
                  <span className="text-xs text-gray-500 mt-1">Añadir</span>
                  <input type="file" accept="image/*,.pdf,.doc,.docx" multiple className="hidden" onChange={async (e)=>{ 
                    const files=Array.from(e.target.files||[]); 
                    const urls: string[]=[]; 
                    for(const f of files){ const u=await uploadPhoto(f,'certs'); urls.push(u);} 
                    setCertPhotos((prev)=>[...prev,...urls]); 
                    e.target.value = '';
                  }} />
                </label>
              </div>
            </div>
          </div>
        )}

        {step === 6 && (
          <div className="space-y-3">
            <label className="flex items-center gap-2 cursor-pointer p-2 hover:bg-gray-50 rounded"><input type="checkbox" checked={declTruth} onChange={()=>setDeclTruth(v=>!v)} className="w-4 h-4 text-green-600 rounded" /><span>Declaro que toda la información proporcionada es veraz y acepto ser verificado por el equipo de GarserHelp.</span></label>
            <label className="flex items-center gap-2 cursor-pointer p-2 hover:bg-gray-50 rounded"><input type="checkbox" checked={acceptTerms} onChange={()=>setAcceptTerms(v=>!v)} className="w-4 h-4 text-green-600 rounded" /><span>Acepto que mis datos sean utilizados para gestionar mi perfil y solicitudes en la app de jardinería.</span></label>
          </div>
        )}

        <div className="sticky bottom-0 mt-6 bg-white pt-3 border-t" style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}>
          <div className="flex items-center justify-between">
            <button onClick={prev} disabled={step===1} className="px-4 py-2 bg-gray-100 rounded hover:bg-gray-200 inline-flex items-center gap-2 disabled:opacity-50"><ChevronLeft className="w-4 h-4" /><span>Anterior</span></button>
            {step < 6 ? (
              <button onClick={next} disabled={!isStepValid(step)} className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 inline-flex items-center gap-2"><span>Siguiente</span><ChevronRight className="w-4 h-4" /></button>
            ) : (
              <button onClick={submit} disabled={!declTruth || !acceptTerms || loading} className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 inline-flex items-center gap-2"><Check className="w-4 h-4" /><span>{loading ? 'Enviando...' : 'Enviar solicitud'}</span></button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default GardenerApplicationWizard;
