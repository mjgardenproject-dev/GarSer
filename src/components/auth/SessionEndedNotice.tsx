import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../../contexts/AuthContext';
import { safeRedirectPath } from '../../utils/postLoginPath';
import { ACCOUNT_CLOSED_MESSAGE, consumeAccountClosed } from '../../utils/selfAccountClosure';

// R-06: la sesión se ha cerrado sin que el usuario lo pidiera en esta pestaña (desde otro
// dispositivo o pestaña, o porque caducó). Antes la web le sacaba sin decir nada y parecía un
// fallo. Ahora se lo dice y, al volver a entrar, le devuelve a la página en la que estaba.
// Vive dentro del router porque AuthProvider está fuera (src/main.tsx).
export const SESSION_ENDED_MESSAGE =
  'Tu sesión se ha cerrado (por ejemplo, desde otro dispositivo). Vuelve a entrar para continuar.';

const SessionEndedNotice: React.FC = () => {
  const { sessionEndedAt, clearSessionEnded } = useAuth();
  const navigate = useNavigate();

  // PH-01: quien acaba de cerrar su cuenta llega aquí tras la recarga a /auth.
  useEffect(() => {
    if (consumeAccountClosed()) toast.success(ACCOUNT_CLOSED_MESSAGE, { id: 'account-closed', duration: 8000 });
  }, []);

  useEffect(() => {
    if (!sessionEndedAt) return;
    clearSessionEnded();
    toast(SESSION_ENDED_MESSAGE, { id: 'session-ended', duration: 8000, icon: '🔒' });
    navigate('/auth', {
      replace: true,
      state: { initialMode: 'login', redirectTo: safeRedirectPath(sessionEndedAt) ?? undefined },
    });
  }, [sessionEndedAt, clearSessionEnded, navigate]);

  return null;
};

export default SessionEndedNotice;
