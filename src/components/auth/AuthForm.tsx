import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import { Eye, EyeOff, User, Briefcase, Check, Mail, Lock, Leaf } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import EmailConfirmationModal from './EmailConfirmationModal';
import { supabase } from '../../lib/supabase';

const schema = yup.object({
  email: yup.string().email('Email inválido').required('Email requerido'),
  password: yup.string().min(6, 'Mínimo 6 caracteres').required('Contraseña requerida'),
  role: yup.string().oneOf(['client', 'gardener']).required('Rol requerido')
});

type FormData = {
  email: string;
  password: string;
  role: 'client' | 'gardener';
};

const AuthForm = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [selectedRole, setSelectedRole] = useState<'client' | 'gardener'>('client');
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();

  type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7;
  const [step, setStep] = useState<Step>(1);
  const [progress, setProgress] = useState(0);
  const [fullName, setFullName] = useState('');
  const [phoneLocal, setPhoneLocal] = useState('');
  const [cityZone, setCityZone] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);

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
  const [servicesSel, setServicesSel] = useState<string[]>([]);
  const [otherServices, setOtherServices] = useState('');
  const [toolsSel, setToolsSel] = useState<string[]>([]);
  const [expYears, setExpYears] = useState<number>(0);
  const [expRange, setExpRange] = useState<string>('');
  const [proofFiles, setProofFiles] = useState<File[]>([]);
  const [experienceType, setExperienceType] = useState<'companies'|'clients'|'none'|''>('');
  const [proofNotes, setProofNotes] = useState('');
  
  const [certText, setCertText] = useState('');
  const [declTruth, setDeclTruth] = useState<boolean>(false);
  const [acceptTerms, setAcceptTerms] = useState<boolean>(false);

  useEffect(() => {
    const total = 6;
    const effectiveStep = step >= 6 ? (step - 1) : step;
    const p = Math.round(((effectiveStep - 1) / total) * 100);
    setProgress(p);
  }, [step]);

  const toggleService = (s: string) => setServicesSel(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  const toggleTool = (t: string) => setToolsSel(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  const addProofFiles = (files: FileList | null) => {
    if (!files) return;
    setProofFiles(prev => [...prev, ...Array.from(files)]);
  };

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<FormData>({
    resolver: yupResolver(schema),
    defaultValues: {
      email: '',
      password: '',
      role: 'client'
    }
  });

  // Sincronizar el campo del formulario con selectedRole
  useEffect(() => {
    setValue('role', selectedRole);
  }, [selectedRole, setValue]);

  const isStepValid = (s: Step) => {
    if (s === 1) return fullName.trim().length > 0 && phoneLocal.trim().length > 0 && cityZone.trim().length > 0;
    if (s === 2) return servicesSel.length > 0 || otherServices.trim().length > 0;
    if (s === 3) return toolsSel.length > 0;
    if (s === 4) return expRange.trim().length > 0;
    if (s === 5) return (experienceType==='companies' || experienceType==='clients' || experienceType==='none') && testGrass.trim().length > 0 && testHedge.trim().length > 0 && proofNotes.trim().length >= 0;
    if (s === 6) return true;
    if (s === 7) return declTruth && acceptTerms;
    return true;
  };

  const onSubmit = async (data: FormData) => {
    setLoading(true);
    try {
      if (isLogin) {
        await signIn(data.email, data.password);
        toast.success('¡Bienvenido de vuelta!');
        // Redirigir al dashboard tras login exitoso
        navigate('/dashboard');
      } else {
        const roleToUse = selectedRole;
        if (roleToUse === 'client') {
          await signUp(data.email, data.password, roleToUse);
          setRegisteredEmail(data.email);
          setShowEmailModal(true);
          reset();
        } else {
          const { data: signUpData, error: signErr } = await supabase.auth.signUp({
            email: data.email,
            password: data.password,
            options: { data: { role: 'client', requested_role: 'gardener' } }
          });
          if (signErr) throw signErr;
          const userId = signUpData?.user?.id || signUpData?.session?.user?.id;
          const fileToDataUrl = (file: File) => new Promise<string>((resolve) => { const r = new FileReader(); r.onload = () => resolve(typeof r.result === 'string' ? r.result : ''); r.onerror = () => resolve(''); r.readAsDataURL(file); });
          let photoData: string | null = null;
          if (photoFile) { photoData = await fileToDataUrl(photoFile); }
          const proofData: string[] = [];
          for (const f of proofFiles) { try { const d = await fileToDataUrl(f); if (d) proofData.push(d); } catch {} }
          const workedFor = experienceType === 'companies' || experienceType === 'clients';
          const canProveDerived = (proofFiles.length > 0) || (proofNotes.trim().length > 0);
          const pendingPayload = {
            user_id: userId || 'pending',
            status: 'submitted',
            full_name: fullName,
            phone: phoneLocal,
            email: data.email,
            city_zone: cityZone,
            professional_photo_url: null,
            services: servicesSel,
            tools_available: toolsSel,
            experience_years: expYears || null,
            experience_range: expRange || null,
            worked_for_companies: workedFor,
            can_prove: canProveDerived,
            proof_photos: [],
            test_grass_frequency: null,
            test_hedge_season: null,
            test_pest_action: null,
            certification_text: certText || null,
            declaration_truth: declTruth,
            accept_terms: acceptTerms,
            other_services: otherServices,
            submitted_at: new Date().toISOString(),
            photo_data: photoData,
            proof_photos_data: proofData
          };
          try { localStorage.setItem('pendingGardenerApplication', JSON.stringify(pendingPayload)); } catch {}
          setRegisteredEmail(data.email);
          setShowEmailModal(true);
          reset();
        }
      }
    } catch (error: any) {
      console.error('❌ Error en registro:', error);
      toast.error(error.message || 'Ha ocurrido un error');
    } finally {
      setLoading(false);
    }
  };

  // Si ya hay usuario autenticado y estamos en /auth, redirigir automáticamente al dashboard
  // Evita que la pantalla de login permanezca visible tras un inicio de sesión correcto
  useEffect(() => {
    // No tenemos acceso directo a `user` aquí, pero este componente solo se muestra
    // cuando no hay usuario según AppContent; como refuerzo, redirigimos tras login via navigate arriba.
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-6 sm:p-8">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 bg-gradient-to-br from-green-600 to-green-700 rounded-2xl flex items-center justify-center">
              <Leaf className="w-8 h-8 text-white" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            {isLogin ? 'Iniciar Sesión' : 'Crear Cuenta'}
          </h1>
          <p className="text-gray-600">
            {isLogin ? 'Accede a tu cuenta' : 'Únete a nuestra plataforma'}
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">

          {!isLogin && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">
                ¿Qué tipo de cuenta necesitas?
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Botón Cliente */}
                <button
                  type="button"
                  onClick={() => setSelectedRole('client')}
                  className={`relative p-3 sm:p-4 border-2 rounded-xl transition-all duration-200 ${
                    selectedRole === 'client'
                      ? 'border-green-500 bg-green-50 shadow-lg transform scale-105'
                      : 'border-gray-200 hover:border-green-300 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex flex-col items-center space-y-2">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                      selectedRole === 'client' ? 'bg-green-500' : 'bg-gray-200'
                    }`}>
                      <User className={`w-6 h-6 ${
                        selectedRole === 'client' ? 'text-white' : 'text-gray-600'
                      }`} />
                    </div>
                    <div className="text-center">
                      <h3 className={`text-sm sm:text-base font-semibold ${
                        selectedRole === 'client' ? 'text-green-700' : 'text-gray-700'
                      }`}>
                        Cliente
                      </h3>
                      <p className="text-xs sm:text-sm text-gray-500 mt-1">
                        Busco servicios de jardinería
                      </p>
                    </div>
                  </div>
                  {selectedRole === 'client' && (
                    <div className="absolute -top-2 -right-2 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                      <Check className="w-4 h-4 text-white" />
                    </div>
                  )}
                </button>

                {/* Botón Jardinero */}
                <button
                  type="button"
                  onClick={() => setSelectedRole('gardener')}
                  className={`relative p-3 sm:p-4 border-2 rounded-xl transition-all duration-200 ${
                    selectedRole === 'gardener'
                      ? 'border-green-500 bg-green-50 shadow-lg transform scale-105'
                      : 'border-gray-200 hover:border-green-300 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex flex-col items-center space-y-2">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                      selectedRole === 'gardener' ? 'bg-green-500' : 'bg-gray-200'
                    }`}>
                      <Briefcase className={`w-6 h-6 ${
                        selectedRole === 'gardener' ? 'text-white' : 'text-gray-600'
                      }`} />
                    </div>
                    <div className="text-center">
                      <h3 className={`text-sm sm:text-base font-semibold ${
                        selectedRole === 'gardener' ? 'text-green-700' : 'text-gray-700'
                      }`}>
                        Jardinero
                      </h3>
                      <p className="text-xs sm:text-sm text-gray-500 mt-1">
                        Ofrezco servicios de jardinería
                      </p>
                    </div>
                  </div>
                  {selectedRole === 'gardener' && (
                    <div className="absolute -top-2 -right-2 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                      <Check className="w-4 h-4 text-white" />
                    </div>
                  )}
                </button>
              </div>
              
              {/* Indicador visual del rol seleccionado */}
              <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm text-green-700 text-center">
                  <strong>Rol seleccionado:</strong> {selectedRole === 'client' ? 'Cliente' : 'Jardinero'}
                  <span className="block text-xs sm:text-sm text-green-600 mt-1">
                    Este rol será permanente y no podrá cambiarse después del registro
                  </span>
                </p>
              </div>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Correo electrónico</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  {...register('email')}
                  type="email"
                  className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  placeholder="tu@email.com"
                />
              </div>
              {errors.email && (
                <p className="mt-1 text-xs sm:text-sm text-red-600">{errors.email.message}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Contraseña</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  {...register('password')}
                  type="password"
                  className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  placeholder="••••••••"
                />
              </div>
              {errors.password && (
                <p className="mt-1 text-xs sm:text-sm text-red-600">{errors.password.message}</p>
              )}
            </div>
          </div>

          {!isLogin && selectedRole === 'gardener' && (
            <div className="mt-4 space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">ENCUESTA DE SOLICITUD PARA JARDINEROS</h2>
                <div className="flex items-center gap-2 text-sm text-gray-600"><span>{progress}%</span><div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden"><div className="h-2 bg-green-600" style={{ width: `${progress}%` }} /></div></div>
              </div>

              {step === 1 && (
                <div className="space-y-3">
                  <h3 className="text-base sm:text-lg font-semibold">Datos personales y zona de trabajo</h3>
                  <label className="block text-sm font-medium text-gray-700">Nombre completo</label>
                  <input value={fullName} onChange={e=>setFullName(e.target.value)} className="w-full p-3 border rounded" />
                  <label className="block text-sm font-medium text-gray-700">Teléfono</label>
                  <input value={phoneLocal} onChange={e=>setPhoneLocal(e.target.value)} className="w-full p-3 border rounded" />
                  
                  <label className="block text-sm font-medium text-gray-700">Ciudad / zona de trabajo</label>
                  <input value={cityZone} onChange={e=>setCityZone(e.target.value)} className="w-full p-3 border rounded" />
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Foto de perfil profesional</label>
                    <input type="file" accept="image/*" onChange={e=>setPhotoFile(e.target.files?.[0] || null)} />
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-3">
                  <h3 className="text-base sm:text-lg font-semibold">¿Qué servicios puedes ofrecer?</h3>
                  <div className="text-sm text-gray-600">Marca todos los que domines y para los que dispongas de herramientas</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {SERVICES.map(s => (
                      <label key={s} className="flex items-center gap-2 p-3 border rounded">
                        <input type="checkbox" checked={servicesSel.includes(s)} onChange={()=>toggleService(s)} />
                        <span>{s}</span>
                      </label>
                    ))}
                  </div>
                  <label className="block text-sm font-medium text-gray-700">Otros</label>
                  <textarea value={otherServices} onChange={e=>setOtherServices(e.target.value)} rows={3} className="w-full p-3 border rounded" />
                </div>
              )}

              {step === 3 && (
                <div className="space-y-3">
                  <h3 className="text-base sm:text-lg font-semibold">¿De qué herramientas dispones?</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {TOOLS.map(t => (
                      <label key={t} className="flex items-center gap-2 p-3 border rounded">
                        <input type="checkbox" checked={toolsSel.includes(t)} onChange={()=>toggleTool(t)} />
                        <span>{t}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {step === 4 && (
                <div className="space-y-3">
                  <h3 className="text-base sm:text-lg font-semibold">Experiencia y demostraciones</h3>
                  <label className="block text-sm font-medium text-gray-700">¿Cuántos años de experiencia tienes en jardinería?</label>
                  <input type="number" value={expYears} onChange={e=>setExpYears(parseInt(e.target.value||'0',10))} className="w-full p-3 border rounded" />
                  <div className="grid grid-cols-2 gap-2">
                    {['<1','1-3','3-5','>5'].map(r => (
                      <label key={r} className="flex items-center gap-2 p-3 border rounded">
                        <input type="radio" name="exp-range" checked={expRange===r} onChange={()=>setExpRange(r)} />
                        <span>{r} años</span>
                      </label>
                    ))}
                  </div>
                  <label className="block text-sm font-medium text-gray-700">¿Has trabajado para empresas o clientes particulares?</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <label className="flex items-center gap-2 p-3 border rounded">
                      <input type="checkbox" checked={experienceType==='companies'} onChange={()=>setExperienceType('companies')} />
                      <span>Sí, he trabajado con empresas</span>
                    </label>
                    <label className="flex items-center gap-2 p-3 border rounded">
                      <input type="checkbox" checked={experienceType==='clients'} onChange={()=>setExperienceType('clients')} />
                      <span>Sí, he trabajado con clientes particulares</span>
                    </label>
                    <label className="flex items-center gap-2 p-3 border rounded">
                      <input type="checkbox" checked={experienceType==='none'} onChange={()=>setExperienceType('none')} />
                      <span>No tengo experiencia laboral pero tengo conocimientos de jardinería.</span>
                    </label>
                  </div>
                  <label className="block text-sm font-medium text-gray-700">Adjunta pruebas si las tienes</label>
                  <textarea value={proofNotes} onChange={e=>setProofNotes(e.target.value)} rows={3} placeholder="describe brebemente tu experiencia" className="w-full p-3 border rounded" />
                  <input type="file" accept="image/*" multiple onChange={e=>addProofFiles(e.target.files)} />
                </div>
              )}

              

              {step === 6 && (
                <div>
                  <h3 className="text-base sm:text-lg font-semibold">Formación y certificaciones</h3>
                  <label className="block text-sm font-medium text-gray-700">¿Tienes algún curso o formación en jardinería?</label>
                  <textarea value={certText} onChange={e=>setCertText(e.target.value)} rows={4} className="w-full p-3 border rounded" />
                </div>
              )}

              {step === 7 && (
                <div className="space-y-3">
                  <h3 className="text-base sm:text-lg font-semibold">Declaraciones y consentimiento</h3>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={declTruth} onChange={()=>setDeclTruth(v=>!v)} /><span>Declaro que toda la información proporcionada es veraz y acepto ser verificado por el equipo de GarserHelp.</span></label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={acceptTerms} onChange={()=>setAcceptTerms(v=>!v)} /><span>Acepto que mis datos sean utilizados para gestionar mi perfil y solicitudes en la app de jardinería.</span></label>
                </div>
              )}

              <div className="sticky bottom-0 bg-white pt-2" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
                <div className="flex items-center justify-between">
                  <button type="button" onClick={()=>setStep(s=> { if (s>1) { const prev = s===6 ? 4 : (s-1); return prev as Step; } return s; })} className="px-4 py-2 bg-gray-100 rounded hover:bg-gray-200">Anterior</button>
                  {step < 7 ? (
                    <button type="button" disabled={!isStepValid(step)} onClick={()=>setStep(s=> { if (s<7) { const next = s===4 ? 6 : (s+1); return next as Step; } return s; })} className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50">Siguiente</button>
                  ) : (
                    <button type="submit" disabled={!declTruth || !acceptTerms} className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50">Crear cuenta y enviar solicitud</button>
                  )}
                </div>
              </div>
            </div>
          )}

          {!(selectedRole === 'gardener' && !isLogin) && (
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-green-600 text-white py-2.5 px-4 text-sm rounded-lg font-semibold hover:bg-green-700 focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Procesando...' : (isLogin ? 'Iniciar Sesión' : 'Crear Cuenta')}
            </button>
          )}
        </form>

        <div className="mt-6 text-center">
          <button
            onClick={() => setIsLogin(!isLogin)}
            className="text-green-600 hover:text-green-700 font-medium text-sm"
          >
            {isLogin ? '¿No tienes cuenta? Regístrate' : '¿Ya tienes cuenta? Inicia sesión'}
          </button>
        </div>
      </div>

      {/* Modal de confirmación de email */}
      <EmailConfirmationModal
        isOpen={showEmailModal}
        onClose={() => {
          setShowEmailModal(false);
          setIsLogin(true); // Cambiar a modo login después de cerrar el modal
        }}
        email={registeredEmail}
      />
    </div>
  );
};

export default AuthForm;