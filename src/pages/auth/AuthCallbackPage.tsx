import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { declareSignupRoleIfNeeded, describeOAuthSignIn, welcomeMessage } from '../../lib/oauthAccount';
import { postLoginPath } from '../../utils/postLoginPath';
import { callbackErrorMessage, readCallbackParams } from '../../utils/authCallback';

// Vuelta de Google por la redirección clásica (/auth/callback?next=…), 2026-10-21. Supabase deja
// la sesión en la dirección y supabase-js la recoge sola; aquí se espera a que esté, se da la
// bienvenida y se vuelve a donde estaba (la reserva, por ejemplo). Si Google devuelve un error o
// la persona cancela, se explica y se ofrece volver.

const WAIT_MS = 10_000;

const AuthCallbackPage: React.FC = () => {
  const navigate = useNavigate();
  const [problem, setProblem] = useState<string | null>(null);
  const params = useRef(readCallbackParams(window.location.href));
  const handled = useRef(false);

  useEffect(() => {
    const { error, errorDescription, next, role } = params.current;
    if (error) {
      setProblem(callbackErrorMessage(error, errorDescription));
      return undefined;
    }

    const finish = async (user: User) => {
      if (handled.current) return;
      handled.current = true;
      const result = await declareSignupRoleIfNeeded(await describeOAuthSignIn(user), role);
      toast.success(welcomeMessage(result));
      navigate(postLoginPath(result.role, next), { replace: true });
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
  }, [navigate]);

  const back = params.current.next || '/auth';

  return (
    <div className="flex min-h-screen items-center justify-center bg-white p-4">
      {problem ? (
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
