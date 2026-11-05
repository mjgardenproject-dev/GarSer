import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { useAccount } from '../../contexts/AccountContext';
import { useAuth } from '../../contexts/AuthContext';
import { declareSignupRoleIfNeeded, describeOAuthSignIn, takeSignupIntent, welcomeMessage, type OAuthSignInResult, type ProfessionalRole } from '../../lib/oauthAccount';
import { NewAccountChooser, RoleProblemPanel } from '../../components/auth/GoogleAccountPanels';
import { pendingAuthStepAgeMs, setPendingAuthStep, usePendingAuthStep } from '../../lib/pendingAuthStep';
import { postLoginPath } from '../../utils/postLoginPath';
import { callbackErrorMessage, readCallbackParams } from '../../utils/authCallback';

// Vuelta de Google por la redirección clásica (/auth/callback?next=…), 2026-10-21. Supabase deja
// la sesión en la dirección y supabase-js la recoge sola; aquí se espera a que esté, se da la
// bienvenida y se vuelve a donde estaba (la reserva, por ejemplo). Si Google devuelve un error o
// la persona cancela, se explica y se ofrece volver.

const WAIT_MS = 10_000;

const AuthCallbackPage: React.FC = () => {
  const navigate = useNavigate();
  const { refresh: refreshAccount } = useAccount();
  const { signOut } = useAuth();
  const [problem, setProblem] = useState<string | null>(null);
  // Fuera del componente: al haber sesión, App.tsx enseña «Cargando…» y esta página se desmonta.
  const outcome = usePendingAuthStep();
  const setOutcome = setPendingAuthStep;
  const params = useRef(readCallbackParams(window.location.href));
  // El tipo elegido: en la URL (?role=) o, si esa se quedó sin parámetros, el guardado al salir.
  // Se lee UNA vez y en el efecto, no al pintar: leerlo lo borra, y pintar puede ocurrir varias veces
  // (modo estricto de React, repintados), con lo que la segunda lectura ya no encontraba nada.
  const intent = useRef<ProfessionalRole | null | undefined>(undefined);
  const handled = useRef(false);

  // Aquí termina todo: o se sigue al panel, o se explica algo antes (cuenta nueva sin tipo
  // elegido → pregunta; lo elegido no se pudo dejar → motivo). Nunca se entra «como cliente» en silencio.
  const settle = async (result: OAuthSignInResult, explicit: boolean) => {
    const { next } = params.current;
    if (result.roleProblem) {
      setOutcome({ kind: 'problem', result });
      return;
    }
    // Con ?next= se vuelve a una reserva a medias: es un cliente de paso, no hay nada que preguntar.
    if (!explicit && !next && result.isNew && result.role === 'client') {
      setOutcome({ kind: 'chooser', result });
      return;
    }
    // La cuenta pudo pasar de cliente a jardinero/empresa hace un momento: se relee el tipo antes
    // de navegar, o la app enseñaría el panel de cliente hasta recargar.
    if (result.requestedRole) await refreshAccount().catch(() => undefined);
    setOutcome(null);
    toast.success(welcomeMessage(result));
    navigate(postLoginPath(result.role, next), { replace: true });
  };

  useEffect(() => {
    const { error, errorDescription } = params.current;
    if (error) {
      setProblem(callbackErrorMessage(error, errorDescription));
      return undefined;
    }

    if (intent.current === undefined) intent.current = params.current.role ?? takeSignupIntent();

    // Si esta página se vuelve a montar (App.tsx enseña «Cargando…» al haber sesión y la desmonta)
    // y el aviso pendiente es de hace segundos, se enseña ese: repetir todo aquí lo pisaría con
    // otro. Uno más viejo es de una visita anterior: se descarta.
    const pendingAge = pendingAuthStepAgeMs();
    if (pendingAge !== null) {
      if (pendingAge < 30_000) handled.current = true;
      else setPendingAuthStep(null);
    }

    const finish = async (user: User) => {
      if (handled.current) return;
      handled.current = true;
      const result = await declareSignupRoleIfNeeded(await describeOAuthSignIn(user), intent.current);
      await settle(result, Boolean(intent.current));
    };

    const { data: sub } = supabase.auth.onAuthStateChange((_event: string, session: { user: User | null } | null) => {
      if (session?.user) void finish(session.user);
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) void finish(data.session.user);
    });
    const timer = window.setTimeout(() => {
      if (!handled.current) setProblem('No hemos recibido la sesión de Google. Vuelve a intentarlo o entra con tu correo.');
    }, WAIT_MS);

    return () => {
      sub.subscription.unsubscribe();
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `settle` solo usa refs y navigate
  }, [navigate]);

  const back = params.current.next || '/auth';

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-white p-4">
      {outcome?.kind === 'chooser' ? (
        <div className="w-full max-w-md">
          <NewAccountChooser result={outcome.result} onResolved={(result) => void settle(result, true)} />
        </div>
      ) : outcome?.kind === 'problem' ? (
        <div className="w-full max-w-md">
          <RoleProblemPanel
            result={outcome.result}
            onResolved={(result) => void settle(result, true)}
            onContinue={() => {
              setOutcome(null);
              toast.success(welcomeMessage(outcome.result));
              navigate(postLoginPath(outcome.result.role, params.current.next), { replace: true });
            }}
            onSwitchAccount={async () => {
              setOutcome(null);
              await signOut(); // el de AuthContext: sin aviso de «sesión cerrada» y recarga en /auth
            }}
          />
        </div>
      ) : problem ? (
        <div className="w-full max-w-sm rounded-2xl border border-gray-200 p-5 text-center shadow-sm">
          <AlertTriangle className="mx-auto h-8 w-8 text-amber-600" aria-hidden="true" />
          <h1 className="mt-3 text-lg font-bold text-gray-900">No has entrado con Google</h1>
          <p className="mt-2 text-sm text-gray-600" role="alert">{problem}</p>
          <div className="mt-5 flex flex-col gap-2">
            <Link to={back} replace className="inline-flex min-h-11 items-center justify-center rounded-xl bg-emerald-700 px-4 text-sm font-bold text-white hover:bg-emerald-800">
              Volver
            </Link>
            {back !== '/auth' && (
              <Link to="/auth" replace className="inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-200 px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                Entrar con mi correo
              </Link>
            )}
          </div>
        </div>
      ) : (
        <div className="text-center" role="status">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-emerald-700" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-gray-700">Entrando con Google…</p>
        </div>
      )}
    </div>
  );
};

export default AuthCallbackPage;
