import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { Check, ChevronLeft, ChevronRight, UploadCloud, Plus } from 'lucide-react';

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const SERVICES = [
  'Corte de césped',
  'Poda de setos',
  'Poda de árboles pequeños',
  'Limpieza y recogida de restos',
  'Mantenimiento de plantas',
  'Instalación de plantas / jardinería decorativa',
  'Desbroce',
  'Limpieza de palmeras altas',
  'Poda de palmeras'
];

const TOOLS = [
  'Cortacésped',
  'Desbrozadora',
  'Tijeras de podar profesionales',
  'Sopladora',
  'Sierra eléctrica / motosierra',
  'Vehículo para transportar restos',
  'Ninguna (solo mano de obra)',
  'Serrucho para palmeras',
  'Pértiga o telescópica',
  'Azoleta'
];

const GardenerApplicationWizard: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [applicationId, setApplicationId] = useState<string | null>(null);

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [cityZone, setCityZone] = useState('');
  const [photoUrl, setPhotoUrl] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [services, setServices] = useState<string[]>([]);
  const [otherServices, setOtherServices] = useState('');

  const [tools, setTools] = useState<string[]>([]);

  const [expYears, setExpYears] = useState<number>(0);
  const [expYearsInput, setExpYearsInput] = useState<string>('0');
  const [expRange, setExpRange] = useState<string>('');
  const [workedForCompanies, setWorkedForCompanies] = useState<boolean>(false);
  const [canProve, setCanProve] = useState<boolean>(false);
  const [proofPhotos, setProofPhotos] = useState<string[]>([]);

  const [testGrass, setTestGrass] = useState<string>('');
  const [testHedge, setTestHedge] = useState<string>('');
  const [testPest, setTestPest] = useState<string>('');

  const [certText, setCertText] = useState('');

  const [declTruth, setDeclTruth] = useState<boolean>(false);
  const [acceptTerms, setAcceptTerms] = useState<boolean>(false);

  const progress = useMemo(() => Math.round(((step - 1) / 7) * 100), [step]);
  const isStepValid = (s: Step) => {
    if (s === 1) return fullName.trim().length > 0 && phone.trim().length > 0 && (email.trim().length > 0) && cityZone.trim().length > 0 && !!photoUrl;
    if (s === 2) return services.length > 0; // "Otros" es opcional
    if (s === 3) return tools.length > 0;
    if (s === 4) return (expYears >= 0) && (certText.trim().length > 0); // Adjuntos opcionales
    if (s === 5) return true;
    if (s === 6) return true;
    if (s === 7) return declTruth && acceptTerms;
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

  const autosave = async () => {
    if (!applicationId) return;
    const payload = {
      full_name: fullName,
      phone,
      email,
      city_zone: cityZone,
      professional_photo_url: photoUrl,
      services,
      other_services: otherServices,
      tools_available: tools,
      experience_years: expYears || null,
      experience_range: expRange || null,
      worked_for_companies: workedForCompanies,
      can_prove: canProve,
      proof_photos: proofPhotos,
      test_grass_frequency: testGrass || null,
      test_hedge_season: testHedge || null,
      test_pest_action: testPest || null,
      certification_text: certText || null,
      declaration_truth: declTruth,
      accept_terms: acceptTerms
    };
    await supabase.from('gardener_applications').update(payload).eq('id', applicationId);
  };

  const next = async () => { await autosave(); setStep((s) => (s < 7 ? ((s + 1) as Step) : s)); };
  const prev = async () => { await autosave(); setStep((s) => (s > 1 ? ((s - 1) as Step) : s)); };

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

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6">
      <div className="bg-white rounded-2xl shadow-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold">ENCUESTA DE SOLICITUD PARA JARDINEROS</h1>
          <div className="flex items-center gap-2 text-sm text-gray-600"><span>{progress}%</span><div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden"><div className="h-2 bg-green-600" style={{ width: `${progress}%` }} /></div></div>
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <label className="block text-sm font-medium text-gray-700">Nombre completo</label>
            <input value={fullName} onChange={(e)=>setFullName(e.target.value)} className="w-full p-3 border rounded" />
            <label className="block text-sm font-medium text-gray-700">Teléfono</label>
            <input value={phone} onChange={(e)=>setPhone(e.target.value)} className="w-full p-3 border rounded" />
            <label className="block text-sm font-medium text-gray-700">Correo electrónico</label>
            <input value={email} onChange={(e)=>setEmail(e.target.value)} className="w-full p-3 border rounded" />
            <label className="block text-sm font-medium text-gray-700">Ciudad / zona de trabajo</label>
            <input value={cityZone} onChange={(e)=>setCityZone(e.target.value)} className="w-full p-3 border rounded" />
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
            <div className="text-sm text-gray-600">Marca todos los que domines y para los que dispongas de herramientas</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {SERVICES.map(s=> (
                <label key={s} className="flex items-center gap-2 p-3 border rounded">
                  <input type="checkbox" checked={services.includes(s)} onChange={()=>toggleService(s)} />
                  <span>{s}</span>
                </label>
              ))}
            </div>
            <label className="block text-sm font-medium text-gray-700">Otros</label>
            <textarea value={otherServices} onChange={(e)=>setOtherServices(e.target.value)} rows={3} className="w-full p-3 border rounded" />
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {TOOLS.map(t=> (
                <label key={t} className="flex items-center gap-2 p-3 border rounded">
                  <input type="checkbox" checked={tools.includes(t)} onChange={()=>toggleTool(t)} />
                  <span>{t}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-3">
            <h3 className="text-base sm:text-lg font-semibold">Experiencia y demostraciones</h3>
            <div className="flex items-center gap-3">
              <input type="number" min={0} value={expYearsInput} onFocus={()=>{ if (expYearsInput === '0') setExpYearsInput(''); }} onBlur={()=>{ if (expYearsInput.trim() === '') { setExpYearsInput('0'); setExpYears(0); } }} onChange={(e)=>{ const v=e.target.value; setExpYearsInput(v); const n=parseInt(v||'0',10); setExpYears(isNaN(n)?0:n); }} className="w-24 p-2 border rounded" />
              <span className="text-sm text-gray-700">años de experiencia</span>
            </div>
            <label className="block text-sm font-medium text-gray-700">Describe tu experiencia</label>
            <textarea value={certText} onChange={(e)=>setCertText(e.target.value)} rows={4} className="w-full p-3 border rounded" />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Adjunta fotos o documentos (opcional). Si lo tienes, añade tu CV</label>
              <input type="file" accept="image/*,.pdf,.doc,.docx" multiple onChange={async (e)=>{ const files=Array.from(e.target.files||[]); const urls: string[]=[]; for(const f of files){ const u=await uploadPhoto(f,'proof'); urls.push(u);} setProofPhotos((prev)=>[...prev,...urls]); }} />
              {proofPhotos.length>0 && (
                <div className="flex flex-wrap gap-2 mt-2">{proofPhotos.map((u,i)=>(<img key={i} src={u} className="w-12 h-12 object-cover rounded" />))}</div>
              )}
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">¿Cada cuánto se debe cortar el césped en verano?</label>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex items-center gap-2 p-3 border rounded"><input type="radio" name="test-grass" checked={testGrass==='semana'} onChange={()=>setTestGrass('semana')} /><span>A) Cada semana</span></label>
                <label className="flex items-center gap-2 p-3 border rounded"><input type="radio" name="test-grass" checked={testGrass==='3_meses'} onChange={()=>setTestGrass('3_meses')} /><span>B) Cada 3 meses</span></label>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">¿Es mejor podar un seto en invierno o verano?</label>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex items-center gap-2 p-3 border rounded"><input type="radio" name="test-hedge" checked={testHedge==='invierno'} onChange={()=>setTestHedge('invierno')} /><span>A) Invierno</span></label>
                <label className="flex items-center gap-2 p-3 border rounded"><input type="radio" name="test-hedge" checked={testHedge==='verano'} onChange={()=>setTestHedge('verano')} /><span>B) Verano</span></label>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">¿Qué harías si detectas plagas en un seto o planta?</label>
              <textarea value={testPest} onChange={(e)=>setTestPest(e.target.value)} rows={3} className="w-full p-3 border rounded" />
            </div>
          </div>
        )}

        {step === 6 && (
          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-700 mb-2">¿Tienes algún curso o formación en jardinería?</label>
            <textarea value={certText} onChange={(e)=>setCertText(e.target.value)} rows={4} className="w-full p-3 border rounded" />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Adjunta fotos o documentos de tu titulación (opcional)</label>
              <input type="file" accept="image/*,.pdf,.doc,.docx" multiple onChange={async (e)=>{ const files=Array.from(e.target.files||[]); const urls: string[]=[]; for(const f of files){ const u=await uploadPhoto(f,'certs'); urls.push(u);} setProofPhotos((prev)=>[...prev,...urls]); }} />
            </div>
          </div>
        )}

        {step === 7 && (
          <div className="space-y-3">
            <label className="flex items-center gap-2"><input type="checkbox" checked={declTruth} onChange={()=>setDeclTruth(v=>!v)} /><span>Declaro que toda la información proporcionada es veraz y acepto ser verificado por el equipo de GarserHelp.</span></label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={acceptTerms} onChange={()=>setAcceptTerms(v=>!v)} /><span>Acepto que mis datos sean utilizados para gestionar mi perfil y solicitudes en la app de jardinería.</span></label>
          </div>
        )}

        <div className="sticky bottom-0 mt-6 bg-white pt-3" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <div className="flex items-center justify-between">
            <button onClick={prev} disabled={step===1} className="px-4 py-2 bg-gray-100 rounded hover:bg-gray-200 inline-flex items-center gap-2"><ChevronLeft className="w-4 h-4" /><span>Anterior</span></button>
            {step < 7 ? (
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
