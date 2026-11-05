import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm, type UseFormRegisterReturn } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import { AlertTriangle, ChevronLeft, ChevronRight, Eye, EyeOff, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../contexts/AuthContext';
import { useAccount } from '../../contexts/AccountContext';
import { postLoginPath } from '../../utils/postLoginPath';
import EmailConfirmationModal from './EmailConfirmationModal';
import GarserLogo from '../common/GarserLogo';
import { supabase } from '../../lib/supabase';
import GoogleSignInButton from './GoogleSignInButton';
import AccountTypePicker, { ACCOUNT_TYPES, isAccountType, type AccountType } from './AccountTypePicker';
import { NewAccountChooser, RoleProblemPanel } from './GoogleAccountPanels';
import { LegalConsentNote, OrWithEmail } from './SocialAuthBits';
import { welcomeMessage, type OAuthSignInResult } from '../../lib/oauthAccount';
import { getGoogleClientId } from '../../utils/googleIdentity';
import { setPendingAuthStep, usePendingAuthStep } from '../../lib/pendingAuthStep';

// Pantalla de acceso (/auth), pensada primero para el móvil (2026-11-04).
//
//  · Entrar y Crear cuenta son dos pestañas arriba, siempre visibles (antes, un enlace al final de
//    una página de casi dos pantallas).
//  · Crear cuenta empieza por UNA pregunta: ¿cómo vas a usar GarSer? Sin tipo preseleccionado y sin
//    Google ni formulario hasta contestarla: un jardinero ya no puede crearse una cuenta de cliente
//    sin darse cuenta pulsando el primer botón que ve.
//  · Entrar con Google desde «Entrar» también puede crear cuenta. Si lo hace, se pregunta el tipo
//    antes de seguir (NewAccountChooser) en vez de dejar a la persona como cliente.

const schema = yup.object({
  email: yup.string().trim().email('Escribe un correo válido').required('Escribe tu correo'),
  password: yup.string().min(6, 'Mínimo 6 caracteres').required('Escribe tu contraseña'),
  confirmPassword: yup.string().default('').defined(),
});

type FormData = { email: string; password: string; confirmPassword: string };
type View = 'login' | 'signup' | 'forgot';

const INPUT = 'block min-h-12 w-full rounded-xl border border-gray-300 bg-white px-3.5 py-3 text-base text-gray-900 placeholder:text-gray-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/30 aria-[invalid=true]:border-red-500';
const SUBMIT = 'inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 text-base font-bold text-white shadow-sm hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 [touch-action:manipulation]';
const LINK = 'inline-flex min-h-11 items-center font-semibold text-emerald-700 hover:text-emerald-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 rounded';

interface FieldProps {
  id: string;
  label: string;
  error?: string;
  registration: UseFormRegisterReturn;
  type?: string;
  autoComplete: string;
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  enterKeyHint?: React.HTMLAttributes<HTMLInputElement>['enterKeyHint'];
  action?: React.ReactNode;
}

/** Etiqueta + campo + error, bien enlazados (lectores de pantalla, autorrelleno, teclado del móvil). */
const Field: React.FC<FieldProps> = ({ id, label, error, registration, type = 'text', autoComplete, placeholder, inputMode, enterKeyHint, action }) => (
  <div>
    <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-gray-800">{label}</label>
    <div className="relative">
      <input
        id={id}
        type={type}
        autoComplete={autoComplete}
        inputMode={inputMode}
        enterKeyHint={enterKeyHint}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`${INPUT} ${action ? 'pr-12' : ''}`}
        {...registration}
      />
      {action}
    </div>
    {error && <p id={`${id}-error`} role="alert" className="mt-1.5 text-sm text-red-600">{error}</p>}
  </div>
);

const AuthForm = () => {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, signIn, signUp, signOut } = useAuth();
  const { refresh: refreshAccount } = useAccount();

  const state = (location.state ?? {}) as { forceClientOnly?: boolean; redirectTo?: unknown; initialMode?: string; preselectedRole?: unknown };
  const forceClientOnly = Boolean(state.forceClientOnly);
  const redirectTo: string | null = typeof state.redirectTo === 'string' ? state.redirectTo : null;
  const requestedInitialMode = state.initialMode ?? searchParams.get('mode') ?? undefined;
  const requestedRoleRaw = state.preselectedRole ?? searchParams.get('role');
  const requestedRole: AccountType | undefined = isAccountType(requestedRoleRaw) ? requestedRoleRaw : undefined;

  const [view, setView] = useState<View>(() =>
    requestedInitialMode === 'signup' || (requestedRole && requestedRole !== 'client') ? 'signup' : 'login');
  // Sin tipo elegido (null) se enseña la pregunta. Nunca hay uno por defecto: tiene que elegirlo.
  const [role, setRole] = useState<AccountType | null>(() => (forceClientOnly ? 'client' : requestedRole ?? null));
  const [showPassword, setShowPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [sendingForgot, setSendingForgot] = useState(false);
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState('');
  const [loading, setLoading] = useState(false);
  // El aviso de después de Google vive FUERA del componente (src/lib/pendingAuthStep.ts): al iniciar
  // sesión, App.tsx enseña «Cargando…» y desmonta esta pantalla, y el estado local se perdía.
  // Sin sesión no hay nada pendiente, por si quedara algo de otra persona.
  const pendingStep = usePendingAuthStep();
  const googleOutcome = user ? pendingStep : null;
  const setGoogleOutcome = setPendingAuthStep;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  const showGoogle = Boolean(getGoogleClientId());

  const { register, handleSubmit, reset, clearErrors, setError, formState: { errors } } = useForm<FormData>({
    resolver: yupResolver(schema),
    defaultValues: { email: '', password: '', confirmPassword: '' },
  });

  useEffect(() => {
    if (!user) setPendingAuthStep(null);
  }, [user]);

  useEffect(() => {
    const flag = localStorage.getItem('passwordChanged');
    if (flag) {
      toast.success('Contraseña cambiada con éxito');
      localStorage.removeItem('passwordChanged');
    }
  }, []);

  // La pantalla se puede volver a abrir con otro estado sin desmontarse (enlaces a /auth desde dentro).
  useEffect(() => {
    if (requestedInitialMode === 'signup') setView('signup');
    else if (requestedInitialMode === 'login') setView('login');
  }, [requestedInitialMode]);

  useEffect(() => {
    if (forceClientOnly) {
      setRole('client');
      return;
    }
    if (requestedRole) {
      setRole(requestedRole);
      if (requestedRole !== 'client') setView('signup');
    }
  }, [forceClientOnly, requestedRole]);

  // Al cambiar de pantalla (tipo elegido, pestaña…), el foco va al título: quien usa lector de pantalla
  // oye dónde está y quien usa teclado no se queda en un botón que ya no existe.
  // (No al cambiar entre las pestañas Entrar/Crear cuenta: ahí el foco debe seguir en la pestaña.)
  const focusKey = `${googleOutcome?.kind ?? ''}|${role ?? ''}|${view === 'forgot'}`;
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [focusKey]);

  const changeView = (next: View) => {
    if (next === view) return;
    clearErrors();
    setShowPassword(false);
    setView(next);
  };

  const finishGoogle = async (result: OAuthSignInResult, explicit: boolean) => {
    if (result.roleProblem) {
      setGoogleOutcome({ kind: 'problem', result });
      return;
    }
    if (!explicit && result.isNew && result.role === 'client' && !forceClientOnly) {
      setGoogleOutcome({ kind: 'chooser', result });
      return;
    }
    // Si la cuenta acaba de pasar de cliente a jardinero/empresa, la app todavía tiene leído el
    // tipo de ANTES (se lee una vez al iniciar sesión): sin releerlo se enseñaría el panel de
    // cliente hasta recargar la página. Era el fallo «elijo jardinero con Google y me sale cliente».
    if (result.requestedRole) await refreshAccount().catch(() => undefined);
    setGoogleOutcome(null);
    toast.success(welcomeMessage(result));
    navigate(postLoginPath(result.role, redirectTo));
  };

  // «Usar otro correo»: cierre de sesión de verdad (el de AuthContext: no sale el aviso de «sesión
  // cerrada desde otro dispositivo», Google deja de sugerir esta cuenta y se limpia lo guardado).
  const switchGoogleAccount = async () => {
    setGoogleOutcome(null);
    await signOut();
  };

  const confirmForgotReset = async () => {
    setSendingForgot(true);
    try {
      // Usamos el origen (root) para asegurar que la URL está en la whitelist de Supabase.
      // AuthContext manejará la redirección a /reset-password al detectar el evento PASSWORD_RECOVERY.
      const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, { redirectTo: window.location.origin });
      if (error) throw error;
      toast.success('Email de recuperación enviado');
      setShowForgotModal(false);
      setView('login');
    } catch (e: any) {
      toast.error(e?.message || 'Error enviando recuperación');
    } finally {
      setSendingForgot(false);
    }
  };

  const onSubmit = async (data: FormData) => {
    if (view === 'signup' && !role) return;
    setLoading(true);
    try {
      if (view === 'login') {
        const accountRole = await signIn(data.email, data.password);
        toast.success('¡Bienvenido de vuelta!');
        navigate(postLoginPath(accountRole, redirectTo));
      } else {
        if (!data.confirmPassword || data.confirmPassword !== data.password) {
          setError('confirmPassword', { type: 'validate', message: 'Las contraseñas no coinciden' });
          return;
        }
        // El tipo viaja en los metadatos del alta y el servidor crea el perfil con él
        // (trg_provision_profile). El alta real de jardinero (servicios, herramientas, fotos) ocurre
        // después de confirmar el correo, en /apply; la de empresa, en /empresa/solicitud.
        await signUp(data.email, data.password, role as AccountType);
        setRegisteredEmail(data.email);
        setShowEmailModal(true);
        reset();
      }
    } catch (error: any) {
      console.error('❌ Error en acceso:', error);
      let message = error.message || 'Ha ocurrido un error';
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

  const passwordToggle = (
    <button
      type="button"
      onClick={() => setShowPassword((v) => !v)}
      aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
      aria-pressed={showPassword}
      className="absolute right-0 top-0 flex h-12 w-12 items-center justify-center rounded-xl text-gray-500 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 [touch-action:manipulation]"
    >
      {showPassword ? <EyeOff className="h-5 w-5" aria-hidden="true" /> : <Eye className="h-5 w-5" aria-hidden="true" />}
    </button>
  );

  const isSignup = view === 'signup';
  const pickingType = isSignup && role === null;
  const proRole: 'gardener' | 'company' | null = role === 'gardener' || role === 'company' ? role : null;
  const isPro = proRole !== null;

  let title = '¡Hola de nuevo!';
  let subtitle = 'Entra en tu cuenta de GarSer';
  if (view === 'forgot') { title = 'Recuperar contraseña'; subtitle = 'Te enviamos un enlace a tu correo'; }
  else if (pickingType) { title = 'Crea tu cuenta'; subtitle = '¿Cómo vas a usar GarSer?'; }
  else if (isSignup && role) { title = `Crea tu cuenta de ${ACCOUNT_TYPES[role].nounPhrase}`; subtitle = ''; }

  const renderBody = () => {
    if (googleOutcome?.kind === 'chooser') {
      return <NewAccountChooser result={googleOutcome.result} onResolved={(result) => void finishGoogle(result, true)} />;
    }
    if (googleOutcome?.kind === 'problem') {
      return (
        <RoleProblemPanel
          result={googleOutcome.result}
          onResolved={(result) => void finishGoogle(result, true)}
          onContinue={() => {
            setGoogleOutcome(null);
            toast.success(welcomeMessage(googleOutcome.result));
            navigate(postLoginPath(googleOutcome.result.role, redirectTo));
          }}
          onSwitchAccount={switchGoogleAccount}
        />
      );
    }

    return (
      <>
        {view === 'forgot' ? (
          <div className="mb-5 text-center">
            <h1 ref={headingRef} tabIndex={-1} className="text-xl font-bold text-gray-900 outline-none">{title}</h1>
            <p className="mt-1 text-base text-gray-600">{subtitle}</p>
          </div>
        ) : (
          <div className="mb-5">
            <div role="tablist" aria-label="Acceso a GarSer" className="grid grid-cols-2 rounded-xl bg-gray-100 p-1">
              {(['login', 'signup'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={view === tab}
                  onClick={() => changeView(tab)}
                  className={`min-h-11 rounded-lg text-base font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 [touch-action:manipulation] ${
                    view === tab ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {tab === 'login' ? 'Entrar' : 'Crear cuenta'}
                </button>
              ))}
            </div>
            <div className="mt-5 text-center">
              <h1 ref={headingRef} tabIndex={-1} className="text-xl font-bold text-gray-900 outline-none">{title}</h1>
              {subtitle && <p className="mt-1 text-base text-gray-600">{subtitle}</p>}
            </div>
          </div>
        )}

        {view === 'forgot' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!forgotEmail.trim()) {
                toast.error('Escribe tu correo');
                return;
              }
              setShowForgotModal(true);
            }}
            className="space-y-4"
          >
            <div>
              <label htmlFor="forgot-email" className="mb-1.5 block text-sm font-medium text-gray-800">Correo electrónico</label>
              <input
                id="forgot-email"
                type="email"
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                className={INPUT}
                placeholder="tu@correo.com"
                required
              />
            </div>
            <button type="submit" disabled={sendingForgot} className={SUBMIT}>Enviar enlace</button>
            <div className="text-center">
              <button type="button" onClick={() => setView('login')} className={LINK}>Volver a entrar</button>
            </div>
          </form>
        )}

        {pickingType && (
          <div className="space-y-4">
            <AccountTypePicker onSelect={setRole} />
            <p className="text-center text-sm text-gray-500">Después no podrás cambiar el tipo de cuenta.</p>
          </div>
        )}

        {(view === 'login' || (isSignup && role)) && (
          <div className="space-y-4">
            {isSignup && role && !forceClientOnly && (
              <div className="-mt-3 text-center">
                <button type="button" onClick={() => setRole(null)} className={`${LINK} text-sm`}>
                  <ChevronLeft className="mr-0.5 h-4 w-4" aria-hidden="true" /> Cambiar tipo de cuenta
                </button>
              </div>
            )}
            {isSignup && isPro && (
              <p className="rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm leading-snug text-emerald-900">
                {role === 'company'
                  ? 'Primero creas la cuenta y después completas los datos de tu empresa. La revisamos antes de publicarla.'
                  : 'Primero creas la cuenta y después completas tu solicitud. La revisamos antes de publicarte.'}
              </p>
            )}

            {showGoogle && (
              <>
                <GoogleSignInButton
                  key={`${view}-${role ?? 'none'}`}
                  context={isSignup ? 'signup' : 'signin'}
                  redirectPath={redirectTo || ''}
                  oneTap={view === 'login'}
                  signupRole={isSignup && proRole ? proRole : undefined}
                  onSignedIn={(result) => void finishGoogle(result, isSignup)}
                />
                <OrWithEmail />
              </>
            )}

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <Field
                id="auth-email"
                label="Correo electrónico"
                type="email"
                autoComplete="email"
                inputMode="email"
                enterKeyHint="next"
                placeholder="tu@correo.com"
                error={errors.email?.message}
                registration={register('email')}
              />
              <div>
                <Field
                  id="auth-password"
                  label="Contraseña"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={isSignup ? 'new-password' : 'current-password'}
                  enterKeyHint={isSignup ? 'next' : 'go'}
                  error={errors.password?.message}
                  registration={register('password')}
                  action={passwordToggle}
                />
                {view === 'login' && (
                  <div className="mt-1 flex justify-end">
                    <button type="button" onClick={() => setView('forgot')} className={`${LINK} text-sm`}>
                      ¿Has olvidado tu contraseña?
                    </button>
                  </div>
                )}
              </div>
              {isSignup && (
                <Field
                  id="auth-confirm"
                  label="Repite la contraseña"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  enterKeyHint="go"
                  error={errors.confirmPassword?.message}
                  registration={register('confirmPassword')}
                />
              )}
              <button type="submit" disabled={loading} className={SUBMIT}>
                {loading ? (<><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Procesando…</>) : (view === 'login' ? 'Entrar' : 'Crear cuenta')}
              </button>
              <LegalConsentNote className="text-center" />
            </form>

            {view === 'login' && !forceClientOnly && (
              <button
                type="button"
                onClick={() => { setRole(null); changeView('signup'); }}
                className="flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-left hover:border-emerald-300 hover:bg-emerald-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 [touch-action:manipulation]"
              >
                <span className="text-sm leading-snug text-gray-700">
                  <span className="block font-semibold text-gray-900">¿Eres jardinero o empresa?</span>
                  Crea tu cuenta profesional
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-gray-400" aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </>
    );
  };

  return (
    <div className="min-h-[100dvh] w-full bg-white">
      <div className="mx-auto w-full max-w-md px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-2 sm:pt-10">
        <nav className="flex min-h-11 items-center">
          <button
            type="button"
            onClick={() => {
              if (view === 'forgot') { setView('login'); return; }
              setGoogleOutcome(null);
              navigate('/');
            }}
            className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium text-gray-600 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 [touch-action:manipulation]"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            {view === 'forgot' ? 'Volver' : 'Volver a la web'}
          </button>
        </nav>

        <div className="mb-5 mt-1 flex justify-center">
          <GarserLogo className="h-9 w-auto" textClassName="text-2xl font-bold text-gray-900 tracking-tight" />
        </div>

        {renderBody()}

        <EmailConfirmationModal
          isOpen={showEmailModal}
          onClose={() => {
            setShowEmailModal(false);
            setView('login'); // Tras cerrar el aviso, a entrar con la cuenta recién creada.
          }}
          email={registeredEmail}
        />

        {showForgotModal && createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="forgot-title">
            <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
              <div className="flex flex-col items-center text-center">
                <div className="mb-5 flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-yellow-100">
                  <AlertTriangle className="h-7 w-7 text-yellow-600" aria-hidden="true" />
                </div>
                <h3 id="forgot-title" className="mb-3 text-xl font-bold text-gray-900">¿Enviar correo de recuperación?</h3>
                <div className="mb-5 w-full rounded-xl bg-yellow-50 p-4 text-left">
                  <p className="text-sm text-gray-700">
                    Se enviará un enlace a <strong>{forgotEmail}</strong> para restablecer tu contraseña.
                  </p>
                </div>
                <div className="flex w-full flex-col gap-3">
                  <button type="button" onClick={confirmForgotReset} disabled={sendingForgot} className={SUBMIT}>
                    {sendingForgot ? 'Enviando…' : 'Confirmar'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowForgotModal(false)}
                    disabled={sendingForgot}
                    className="min-h-12 w-full rounded-xl border border-gray-300 bg-white px-4 text-base font-semibold text-gray-700 hover:bg-gray-50"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
      </div>
    </div>
  );
};

export default AuthForm;
