import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Eye, EyeOff, Loader2, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import GarserLogo from '../../components/common/GarserLogo';
import { useAuth } from '../../contexts/AuthContext';
import { useAccount } from '../../contexts/AccountContext';
import { supabase } from '../../lib/supabase';
import { clearPendingInvitation, invitationPath, readPendingInvitation, savePendingInvitation } from '../../lib/pendingInvitation';

// Enlace de invitación de una empresa (/invitacion?token=…, GarSer Empresas F3.3). Pública: quien
// la abre aún puede no tener cuenta. D21 / H-39 (2026-09-26): sin sesión, el invitado escribe aquí
// mismo su nombre y una contraseña y entra directo a su panel (Edge Function
// company-invitation-signup crea la cuenta ya confirmada y la une al equipo); si ya tiene cuenta
// con ese correo, entra con su contraseña y se une. Antes tenía que registrarse aparte, confirmar
// el correo con otro mensaje y volver al enlace en el mismo navegador: casi nunca llegaba.
// Todas las reglas (correo, tipo de cuenta, caducidad) las decide el servidor.

const MIN_PASSWORD = 8;

type PreviewState = 'valid' | 'revoked' | 'accepted' | 'expired' | 'company_inactive' | 'invalid';
interface Preview { state: PreviewState; company_name?: string; email?: string }

const DEAD_END: Record<Exclude<PreviewState, 'valid'>, string> = {
  revoked: 'La empresa ha anulado esta invitación. Pídele que te envíe otra.',
  accepted: 'Esta invitación ya se ha usado.',
  expired: 'Esta invitación ha caducado. Pide a la empresa que te envíe otra.',
  company_inactive: 'La empresa que te invita no está activa ahora mismo.',
  invalid: 'Este enlace de invitación no es válido. Comprueba que lo has copiado entero.',
};

const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex min-h-screen w-full items-center justify-center bg-white p-4">
    <div className="w-full max-w-md space-y-6">
      <div className="flex justify-center">
        <GarserLogo className="h-12 w-auto" textClassName="text-2xl font-bold text-gray-900 tracking-tight" />
      </div>
      <div className="rounded-2xl border border-gray-200 bg-white p-6">{children}</div>
    </div>
  </div>
);

const InvitationAcceptPage: React.FC = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading: authLoading, signIn, signOut } = useAuth();
  const { role, loading: roleLoading, refresh } = useAccount();
  const token = params.get('token') || readPendingInvitation() || '';

  const [preview, setPreview] = useState<Preview | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  // Sin sesión: crear la cuenta aquí mismo ('signup') o entrar con la que ya tiene ('login').
  const [mode, setMode] = useState<'signup' | 'login'>('signup');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setPreview({ state: 'invalid' });
      return;
    }
    let cancelled = false;
    void supabase.rpc('invitation_preview', { p_token: token }).then(({ data, error }) => {
      if (cancelled) return;
      setPreview(error ? { state: 'invalid' } : (data as unknown as Preview));
    });
    return () => { cancelled = true; };
  }, [token]);

  // Mientras la invitación siga viva se recuerda, para retomarla tras confirmar el correo.
  useEffect(() => {
    if (preview?.state === 'valid') savePendingInvitation(token);
    else if (preview) clearPendingInvitation();
  }, [preview, token]);

  if (!preview || authLoading || (user && roleLoading)) {
    return (
      <Shell>
        <div className="flex justify-center py-6"><Loader2 className="h-8 w-8 animate-spin text-emerald-700" aria-label="Cargando" /></div>
      </Shell>
    );
  }

  if (preview.state !== 'valid') {
    return (
      <Shell>
        <AlertTriangle className="mx-auto h-10 w-10 text-amber-500" />
        <p className="mt-3 text-center text-gray-800">{DEAD_END[preview.state]}</p>
        <Link to="/" className="mt-5 block text-center text-sm font-semibold text-emerald-700 underline">Ir a GarSer</Link>
      </Shell>
    );
  }

  const company = preview.company_name || 'Una empresa';
  const back = invitationPath(token);

  const enterTeam = async () => {
    clearPendingInvitation();
    await refresh();
    toast.success(`Ya formas parte de ${company}`);
    navigate('/mi-trabajo', { replace: true });
  };

  const accept = async () => {
    setAccepting(true);
    setAcceptError(null);
    const { error } = await supabase.rpc('accept_company_invitation', { p_token: token });
    if (error) {
      setAcceptError(error.message || 'No se ha podido aceptar la invitación.');
      setAccepting(false);
      return;
    }
    await enterTeam();
  };

  const email = preview.email || '';

  // Cuenta nueva: la crea el servidor ya confirmada (el enlace demuestra que el correo es suyo),
  // la une al equipo, y aquí se entra con la contraseña que acaba de elegir.
  const joinWithNewAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (fullName.trim().length < 2) { setFormError('Escribe tu nombre.'); return; }
    if (password.length < MIN_PASSWORD) { setFormError(`La contraseña tiene que tener al menos ${MIN_PASSWORD} caracteres.`); return; }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('company-invitation-signup', {
        body: { token, fullName: fullName.trim(), password },
      });
      let body = data as { ok?: boolean; error?: string; message?: string } | null;
      if (error) {
        // functions.invoke no lanza en 4xx: el motivo viene en el cuerpo de la respuesta.
        const context = (error as { context?: Response }).context;
        body = context ? await context.json().catch(() => null) : null;
      }
      if (body?.error === 'account_exists') {
        setMode('login');
        setPassword('');
        setFormError('Ya tienes una cuenta con este correo: entra con tu contraseña para unirte.');
        return;
      }
      if (!body?.ok) {
        setFormError(body?.message || 'No se ha podido crear tu cuenta. Inténtalo de nuevo.');
        return;
      }
      await signIn(email, password);
      await enterTeam();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'No se ha podido crear tu cuenta. Inténtalo de nuevo.');
    } finally {
      setSubmitting(false);
    }
  };

  // Ya tiene cuenta con ese correo: entra y se une en el mismo paso.
  const joinWithExistingAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (!password) { setFormError('Escribe tu contraseña.'); return; }
    setSubmitting(true);
    try {
      await signIn(email, password);
      const { error } = await supabase.rpc('accept_company_invitation', { p_token: token });
      if (error) {
        // La sesión queda abierta y la página pasa a la vista «con sesión»: el motivo (otra
        // empresa, cuenta de profesional…) se enseña ahí.
        setAcceptError(error.message || 'No se ha podido aceptar la invitación.');
        return;
      }
      await enterTeam();
    } catch (err) {
      setFormError(err instanceof Error && /invalid login/i.test(err.message)
        ? 'Contraseña incorrecta.'
        : (err instanceof Error ? err.message : 'No se ha podido entrar.'));
    } finally {
      setSubmitting(false);
    }
  };

  const switchAccount = async () => {
    await signOut();
    navigate('/auth', { state: { initialMode: 'login', forceClientOnly: true, redirectTo: back } });
  };

  const heading = (
    <>
      <Users className="mx-auto h-10 w-10 text-emerald-700" />
      <h1 className="mt-3 text-center text-xl font-bold text-gray-900">{company} te invita a su equipo</h1>
      <p className="mt-1 text-center text-sm text-gray-600">
        Trabajarás en GarSer como empleado de {company}. Ellos te asignan los trabajos; tú los ves desde tu móvil.
      </p>
    </>
  );

  if (!user) {
    const inputClass = 'w-full rounded-xl border border-gray-300 px-3 py-3 text-base focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/30';
    return (
      <Shell>
        {heading}
        <form onSubmit={mode === 'signup' ? joinWithNewAccount : joinWithExistingAccount} className="mt-5 space-y-3" noValidate>
          <div>
            <label htmlFor="inv-email" className="mb-1 block text-sm font-medium text-gray-700">Tu correo</label>
            <input id="inv-email" type="email" value={email} readOnly className={`${inputClass} bg-gray-50 text-gray-600`} />
          </div>
          {mode === 'signup' && (
            <div>
              <label htmlFor="inv-name" className="mb-1 block text-sm font-medium text-gray-700">Tu nombre</label>
              <input id="inv-name" type="text" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputClass} />
            </div>
          )}
          <div>
            <label htmlFor="inv-password" className="mb-1 block text-sm font-medium text-gray-700">
              {mode === 'signup' ? 'Elige una contraseña' : 'Tu contraseña'}
            </label>
            <div className="relative">
              <input
                id="inv-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${inputClass} pr-12`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-gray-500 hover:bg-gray-100"
              >
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
            {mode === 'signup' && <p className="mt-1 text-xs text-gray-500">Mínimo {MIN_PASSWORD} caracteres. Con ella entrarás los próximos días.</p>}
          </div>
          {formError && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{formError}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white shadow-lg shadow-emerald-700/20 hover:bg-emerald-800 active:scale-[0.98] disabled:opacity-50"
          >
            {submitting && <Loader2 className="h-5 w-5 animate-spin" />}
            {mode === 'signup' ? 'Unirme al equipo' : 'Entrar y unirme'}
          </button>
        </form>
        <div className="mt-4 text-center text-sm">
          {mode === 'signup' ? (
            <button type="button" onClick={() => { setMode('login'); setFormError(null); }} className="font-semibold text-emerald-700 underline">
              Ya tengo cuenta con este correo
            </button>
          ) : (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => navigate('/auth', { state: { initialMode: 'login', forceClientOnly: true, redirectTo: back } })}
                className="block w-full font-semibold text-emerald-700 underline"
              >
                He olvidado mi contraseña
              </button>
              <button type="button" onClick={() => { setMode('signup'); setFormError(null); }} className="block w-full text-gray-600 underline">
                No tengo cuenta: crearla
              </button>
            </div>
          )}
        </div>
      </Shell>
    );
  }

  const wrongEmail = (user.email || '').toLowerCase() !== (preview.email || '').toLowerCase();
  const blocker =
    role === 'employee' ? 'Ya formas parte de una empresa en GarSer.'
    : role === 'company' ? `Este es el enlace que tienes que enviar a ${preview.email}: lo abrirá desde su móvil para unirse a tu equipo.`
    : role === 'gardener' ? 'Tu cuenta es de profesional en GarSer. Para trabajar como empleado de una empresa necesitas una cuenta distinta, con otro correo.'
    : role === 'admin' ? 'Una cuenta de administración no puede unirse a una empresa.'
    : wrongEmail ? `Esta invitación es para ${preview.email} y has entrado como ${user.email}.`
    : null;

  return (
    <Shell>
      {heading}
      {blocker ? (
        <>
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{blocker}</p>
          <div className="mt-5 space-y-2">
            {role === 'employee' ? (
              <Link to="/mi-trabajo" className="block w-full rounded-xl bg-emerald-700 px-4 py-3 text-center font-bold text-white hover:bg-emerald-800">Ir a mi trabajo</Link>
            ) : role === 'company' ? (
              <>
                <Link to="/empresa" className="block w-full rounded-xl bg-emerald-700 px-4 py-3 text-center font-bold text-white hover:bg-emerald-800">Volver a tu empresa</Link>
                {/* Si el enlace se abre en un móvil con la sesión de la empresa: dejarla lista para el empleado. */}
                <button type="button" onClick={() => { void signOut(); }} className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 font-bold text-gray-700 hover:bg-gray-50">
                  No soy yo: cerrar sesión
                </button>
              </>
            ) : (
              <button type="button" onClick={switchAccount} className="w-full rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white hover:bg-emerald-800">
                Entrar con otra cuenta
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          {acceptError && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{acceptError}</p>}
          <button
            type="button"
            disabled={accepting}
            onClick={accept}
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white shadow-lg shadow-emerald-700/20 hover:bg-emerald-800 active:scale-[0.98] disabled:opacity-50"
          >
            {accepting && <Loader2 className="h-5 w-5 animate-spin" />} Aceptar y unirme
          </button>
          <p className="mt-3 text-center text-xs text-gray-500">
            Tu cuenta pasará a ser de empleado de {company}. Si algún día dejas la empresa, volverá a ser de cliente.
          </p>
        </>
      )}
    </Shell>
  );
};

export default InvitationAcceptPage;
