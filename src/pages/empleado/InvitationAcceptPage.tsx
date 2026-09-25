import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Loader2, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import GarserLogo from '../../components/common/GarserLogo';
import { useAuth } from '../../contexts/AuthContext';
import { useAccount } from '../../contexts/AccountContext';
import { supabase } from '../../lib/supabase';
import { clearPendingInvitation, invitationPath, readPendingInvitation, savePendingInvitation } from '../../lib/pendingInvitation';

// Enlace de invitación de una empresa (/invitacion?token=…, GarSer Empresas F3.3). Pública: quien
// la abre aún puede no tener cuenta. Solo explica y lleva a registrarse o entrar; la aceptación
// y todas sus reglas (correo, tipo de cuenta, caducidad) las decide accept_company_invitation.

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
  const { user, loading: authLoading, signOut } = useAuth();
  const { role, loading: roleLoading, refresh } = useAccount();
  const token = params.get('token') || readPendingInvitation() || '';

  const [preview, setPreview] = useState<Preview | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

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

  const accept = async () => {
    setAccepting(true);
    setAcceptError(null);
    const { error } = await supabase.rpc('accept_company_invitation', { p_token: token });
    if (error) {
      setAcceptError(error.message || 'No se ha podido aceptar la invitación.');
      setAccepting(false);
      return;
    }
    clearPendingInvitation();
    await refresh();
    toast.success(`Ya formas parte de ${company}`);
    navigate('/mi-trabajo', { replace: true });
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
    return (
      <Shell>
        {heading}
        <p className="mt-4 rounded-xl bg-gray-50 px-3 py-2 text-center text-sm text-gray-700">
          Usa el correo <span className="font-semibold">{preview.email}</span>
        </p>
        <div className="mt-5 space-y-2">
          <button
            type="button"
            onClick={() => navigate('/auth', { state: { initialMode: 'signup', forceClientOnly: true, redirectTo: back } })}
            className="w-full rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white shadow-lg shadow-emerald-700/20 hover:bg-emerald-800 active:scale-[0.98]"
          >
            Crear mi cuenta
          </button>
          <button
            type="button"
            onClick={() => navigate('/auth', { state: { initialMode: 'login', forceClientOnly: true, redirectTo: back } })}
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 font-bold text-gray-700 hover:bg-gray-50"
          >
            Ya tengo cuenta
          </button>
        </div>
        <p className="mt-4 text-center text-xs text-gray-500">Después de crear la cuenta tendrás que confirmar tu correo y volver a entrar.</p>
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
              <Link to="/empresa" className="block w-full rounded-xl bg-emerald-700 px-4 py-3 text-center font-bold text-white hover:bg-emerald-800">Volver a tu empresa</Link>
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
