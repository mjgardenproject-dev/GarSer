import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import { Eye, EyeOff, User, Briefcase, Check, Mail, Lock, UploadCloud, Plus } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import EmailConfirmationModal from './EmailConfirmationModal';
import { supabase } from '../../lib/supabase';

const schema = yup.object({
  email: yup.string().email('Email inválido').required('Email requerido'),
  password: yup.string().min(6, 'Mínimo 6 caracteres').required('Contraseña requerida'),
  role: yup.string().oneOf(['client', 'gardener']).required('Rol requerido'),
  confirmPassword: yup.string().default('').defined()
});

type FormData = {
  email: string;
  password: string;
  role: 'client' | 'gardener';
  confirmPassword: string;
};

const AuthForm = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [selectedRole, setSelectedRole] = useState<'client' | 'gardener'>('client');
  const location = useLocation();
  const forceClientOnly: boolean = !!((location.state as any)?.forceClientOnly);
  const redirectTo: string | null = typeof (location.state as any)?.redirectTo === 'string' ? (location.state as any)?.redirectTo : null;
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
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string>('');
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const [certFiles, setCertFiles] = useState<File[]>([]);
  const [cropScale, setCropScale] = useState<number>(1.0);
  const [offsetX, setOffsetX] = useState<number>(0);
  const [offsetY, setOffsetY] = useState<number>(0);
  const [dragging, setDragging] = useState<boolean>(false);
  const dragStart = useRef<{x:number;y:number} | null>(null);

  const handleCropMouseDown = (e: React.MouseEvent) => {
    dragStart.current = { x: e.clientX, y: e.clientY };
    setDragging(true);
  };
  const handleCropMouseMove = (e: React.MouseEvent) => {
    if (!dragging || !dragStart.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setOffsetX(prev => prev + dx);
    setOffsetY(prev => prev + dy);
    dragStart.current = { x: e.clientX, y: e.clientY };
  };
  const handleCropMouseUp = () => {
    setDragging(false);
    dragStart.current = null;
  };

  const cropToCircleDataUrl = async (): Promise<string | null> => {
    const src = photoPreviewUrl || (photoFile ? URL.createObjectURL(photoFile) : null);
    if (!src) return null;
    const img = new Image();
    img.src = src;
    await new Promise<void>((resolve) => { img.onload = () => resolve(); });
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.clearRect(0,0,size,size);
    ctx.beginPath();
    ctx.arc(size/2, size/2, size/2, 0, Math.PI*2);
    ctx.closePath();
    ctx.clip();
    ctx.save();
    ctx.translate(size/2 + offsetX, size/2 + offsetY);
    ctx.scale(cropScale, cropScale);
    ctx.drawImage(img, -img.width/2, -img.height/2);
    ctx.restore();
    return canvas.toDataURL('image/png');
  };
  const [logoError, setLogoError] = useState(false);
  useEffect(() => {
    const flag = localStorage.getItem('passwordChanged');
    if (flag) {
      toast.success('Contraseña cambiada con éxito');
      localStorage.removeItem('passwordChanged');
    }
  }, []);

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
  const [expYearsInput, setExpYearsInput] = useState<string>('0');
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
  const addCertFiles = (files: FileList | null) => {
    if (!files) return;
    setCertFiles(prev => [...prev, ...Array.from(files)]);
  };
  const fileToDataUrl = (file: File) => new Promise<string>((resolve) => { const r = new FileReader(); r.onload = () => resolve(typeof r.result === 'string' ? r.result : ''); r.onerror = () => resolve(''); r.readAsDataURL(file); });

  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<FormData>({
    resolver: yupResolver(schema),
    defaultValues: {
      email: '',
      password: '',
      role: 'client',
      confirmPassword: ''
    }
  });

  // Sincronizar el campo del formulario con selectedRole
  useEffect(() => {
    setValue('role', selectedRole);
  }, [selectedRole, setValue]);

  useEffect(() => {
    if (forceClientOnly) {
      setSelectedRole('client');
    }
  }, [forceClientOnly]);

  const isStepValid = (s: Step) => {
    if (s === 1) return fullName.trim().length > 0 && phoneLocal.trim().length > 0 && cityZone.trim().length > 0 && !!photoPreviewUrl;
    if (s === 2) return servicesSel.length > 0; // "Otros" es opcional
    if (s === 3) return toolsSel.length > 0;
    if (s === 4) return (expYears >= 0) && (proofNotes.trim().length > 0); // Adjuntos opcionales
    if (s === 5) return true;
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
        navigate(redirectTo || '/dashboard');
      } else {
        // Pre-check: Verify if email exists using our custom RPC
        // This avoids the confusing "Check your email" message for existing users
        const { data: emailExists, error: rpcError } = await supabase.rpc('check_email_exists', { email_to_check: data.email });
        
        if (!rpcError && emailExists) {
           toast.error('Esta cuenta ya está registrada. Por favor, inicia sesión simplemente.');
           setLoading(false);
           return;
        }

        const roleToUse = selectedRole;
        const confirm = watch('confirmPassword');
        if (!confirm || confirm !== data.password) {
          toast.error('Las contraseñas no coinciden');
          return;
        }
        if (roleToUse === 'client') {
          await signUp(data.email, data.password, roleToUse);
          setRegisteredEmail(data.email);
          setShowEmailModal(true);
          reset();
        } else {
          const toDataUrl = async (file: File | null) => {
            if (!file) return null;
            const r = new FileReader();
            const p = new Promise<string>((resolve) => { r.onload = () => resolve(typeof r.result === 'string' ? r.result : ''); r.onerror = () => resolve(''); });
            r.readAsDataURL(file);
            const d = await p;
            return d || null;
          };
          const photoData = await cropToCircleDataUrl();
          const proofData: string[] = [];
          for (const f of proofFiles) { const d = await toDataUrl(f); if (d) proofData.push(d); }
          const certData: string[] = [];
          for (const f of certFiles) { const d = await toDataUrl(f); if (d) certData.push(d); }
          const workedFor = false;
          const canProveDerived = proofData.length > 0 || proofNotes.trim().length > 0;
          const applicationPayload = {
            full_name: fullName,
            phone: phoneLocal,
            email: data.email,
            city_zone: cityZone,
            professional_photo_url: photoData,
            services: servicesSel,
            other_services: otherServices,
            tools_available: toolsSel,
            experience_years: expYears || null,
            experience_range: null,
            worked_for_companies: workedFor,
            can_prove: canProveDerived,
            proof_photos: proofData,
            test_grass_frequency: null,
            test_hedge_season: null,
            test_pest_action: null,
            certification_text: certText || null,
            declaration_truth: declTruth,
            accept_terms: acceptTerms
          };
          await signUp(data.email, data.password, 'gardener', applicationPayload);
          setRegisteredEmail(data.email);
          setShowEmailModal(true);
          reset();
        }
      }
    } catch (error: any) {
      console.error('❌ Error en registro:', error);
      
      let message = error.message || 'Ha ocurrido un error';
      
      // Personalizar mensajes de error según lo solicitado
      if (message.includes('Invalid login credentials')) {
        message = 'Este correo electrónico no parece estar registrado o la contraseña es incorrecta. Si aún no tienes cuenta, por favor regístrate.';
      } else if (message.includes('User already registered')) {
        message = 'Esta cuenta ya está registrada. Por favor, inicia sesión simplemente.';
      }
      
      toast.error(message);
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
    <div className="min-h-screen w-full flex items-center justify-center bg-white p-4 sm:p-6">
      <div className="w-full max-w-md space-y-8">
        {/* Logo & Header */}
        <div className="text-center">
          <div className="flex justify-center mb-6">
            {logoError ? (
              <span className="text-3xl font-bold text-gray-900 tracking-tight">
                GarSer<span className="text-green-600">.es</span>
              </span>
            ) : (
              <img
                src="/garser-logo.svg"
                alt="GarSer.es — Garden Service"
                className="h-16 w-auto mx-auto drop-shadow-sm"
                onError={() => setLogoError(true)}
              />
            )}
          </div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
            {isLogin ? '¡Hola de nuevo!' : 'Crea tu cuenta'}
          </h1>
          <p className="text-sm text-gray-500 mt-2">
            {isLogin ? 'Ingresa tus datos para continuar' : 'Únete a nuestra comunidad de jardinería'}
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">

          {!isLogin && (
            <div className="animate-fade-in-down">
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
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
                      selectedRole === 'client' ? 'bg-green-500' : 'bg-gray-200'
                    }`}>
                      <User className={`w-6 h-6 transition-colors ${
                        selectedRole === 'client' ? 'text-white' : 'text-gray-600'
                      }`} />
                    </div>
                    <div className="text-center">
                      <h3 className={`text-sm sm:text-base font-semibold transition-colors ${
                        selectedRole === 'client' ? 'text-green-700' : 'text-gray-700'
                      }`}>
                        Cliente
                      </h3>
                      <p className="text-xs sm:text-sm text-gray-500 mt-1">
                        Busco servicios
                      </p>
                    </div>
                  </div>
                  {selectedRole === 'client' && (
                    <div className="absolute -top-2 -right-2 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center shadow-md animate-bounce-small">
                      <Check className="w-4 h-4 text-white" />
                    </div>
                  )}
                </button>

                {!forceClientOnly && (
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
                      <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
                        selectedRole === 'gardener' ? 'bg-green-500' : 'bg-gray-200'
                      }`}>
                        <Briefcase className={`w-6 h-6 transition-colors ${
                          selectedRole === 'gardener' ? 'text-white' : 'text-gray-600'
                        }`} />
                      </div>
                      <div className="text-center">
                        <h3 className={`text-sm sm:text-base font-semibold transition-colors ${
                          selectedRole === 'gardener' ? 'text-green-700' : 'text-gray-700'
                        }`}>
                          Jardinero
                        </h3>
                        <p className="text-xs sm:text-sm text-gray-500 mt-1">
                          Ofrezco servicios
                        </p>
                      </div>
                    </div>
                    {selectedRole === 'gardener' && (
                      <div className="absolute -top-2 -right-2 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center shadow-md animate-bounce-small">
                        <Check className="w-4 h-4 text-white" />
                      </div>
                    )}
                  </button>
                )}
              </div>
              
              {/* Indicador visual del rol seleccionado */}
              <div className="mt-4 p-3 bg-green-50/50 border border-green-200 rounded-xl">
                <p className="text-sm text-green-800 text-center font-medium">
                  Rol seleccionado: <span className="font-bold">{selectedRole === 'client' ? 'Cliente' : 'Jardinero'}</span>
                  <span className="block text-xs font-normal text-green-600 mt-1">
                    Este rol será permanente tras el registro
                  </span>
                </p>
              </div>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Correo electrónico</label>
              <div className="relative group">
                <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400 group-focus-within:text-green-600 transition-colors" />
                <input
                  {...register('email')}
                  type="email"
                  className="w-full pl-10 pr-4 py-3 text-base sm:text-sm border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all shadow-sm bg-gray-50 focus:bg-white"
                  placeholder="tu@email.com"
                />
              </div>
              {errors.email && (
                <p className="mt-1 text-xs sm:text-sm text-red-600 flex items-center gap-1">
                  <span className="w-1 h-1 bg-red-600 rounded-full"></span>
                  {errors.email.message}
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Contraseña</label>
              <div className="relative group">
                <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400 group-focus-within:text-green-600 transition-colors" />
                <input
                  {...register('password')}
                  type={showPassword ? 'text' : 'password'}
                  className="w-full pl-10 pr-12 py-3 text-base sm:text-sm border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all shadow-sm bg-gray-50 focus:bg-white"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              {errors.password && (
                <p className="mt-1 text-xs sm:text-sm text-red-600 flex items-center gap-1">
                  <span className="w-1 h-1 bg-red-600 rounded-full"></span>
                  {errors.password.message}
                </p>
              )}
            </div>

            {!isLogin && (
              <div className="animate-fade-in-up">
                <label className="block text-sm font-medium text-gray-700 mb-2">Repite la contraseña</label>
                <div className="relative group">
                  <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400 group-focus-within:text-green-600 transition-colors" />
                  <input
                    {...register('confirmPassword')}
                    type="password"
                    className="w-full pl-10 pr-4 py-3 text-base sm:text-sm border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all shadow-sm bg-gray-50 focus:bg-white"
                    placeholder="••••••••"
                  />
                </div>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white py-3 px-4 text-sm sm:text-base rounded-xl font-bold shadow-lg shadow-green-600/20 transform transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Procesando...
              </span>
            ) : (isLogin ? 'Iniciar Sesión' : 'Crear Cuenta')}
          </button>
        </form>

        <div className="mt-8 text-center">
          <p className="text-gray-600 text-sm">
            {isLogin ? '¿No tienes cuenta? ' : '¿Ya tienes cuenta? '}
            <button
              onClick={() => setIsLogin(!isLogin)}
              className="font-semibold text-green-600 hover:text-green-700 transition-colors hover:underline"
            >
              {isLogin ? 'Regístrate gratis' : 'Inicia sesión'}
            </button>
          </p>
        </div>

        <div className="mt-6 pt-6 border-t border-gray-100">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="w-full py-3 px-4 bg-white border-2 border-gray-200 text-gray-600 rounded-xl font-semibold hover:border-green-200 hover:bg-green-50 hover:text-green-700 transition-all duration-200 flex items-center justify-center gap-2 group"
          >
            <span>Ver vista previa de la web</span>
            <svg 
              className="w-4 h-4 transform group-hover:translate-x-1 transition-transform" 
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </button>
        </div>

        <EmailConfirmationModal
          isOpen={showEmailModal}
          onClose={() => {
            setShowEmailModal(false);
            setIsLogin(true); // Cambiar a modo login después de cerrar el modal
          }}
          email={registeredEmail}
        />
      </div>
    </div>
  );
};

export default AuthForm;
