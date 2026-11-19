import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { Lock, Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { classifyAuthError } from '../../utils/authErrors';

const MIN_LENGTH = 8;

const SAME_PASSWORD = 'La contraseña nueva tiene que ser distinta de la anterior.';

const inputClass =
  'w-full min-h-12 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent text-base';

// Nueva contraseña (QA-040): llega desde el enlace del correo de recuperación. Dice de qué cuenta es, qué
// va a pasar (se cierran las demás sesiones) y, si el enlace ya no vale, lleva a pedir uno nuevo en vez de
// dejar un formulario que no funciona. Los fallos salen junto al campo y no en un cartel que desaparece.
const ResetPassword: React.FC = () => {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    const checkSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      setAccountEmail(data.session?.user?.email ?? null);
      setChecked(true);
    };
    void checkSession();
    return () => { alive = false; };
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: { password?: string; confirm?: string } = {};
    if (password.length < MIN_LENGTH) next.password = `Usa al menos ${MIN_LENGTH} caracteres.`;
    if (password !== confirm) next.confirm = 'Las contraseñas no coinciden.';
    setErrors(next);
    if (next.password || next.confirm) return;

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      // Contraseña nueva: se cierran las demás sesiones (si alguien más tenía la cuenta abierta,
      // la pierde) y se mantiene esta. Las salidas normales ya no son globales (R-06).
      await supabase.auth.signOut({ scope: 'others' }).catch(() => undefined);
      toast.success('Contraseña cambiada. Ya has entrado con la nueva.', { duration: 8000 });
      navigate('/dashboard');
    } catch (err: unknown) {
      const code = (err as { code?: string } | null)?.code;
      toast.error(code === 'same_password' ? SAME_PASSWORD : classifyAuthError(err).message, { duration: 8000 });
    } finally {
      setLoading(false);
    }
  };

  const linkGone = checked && !accountEmail;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-8">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-6">
        <div className="flex items-center mb-2">
          <Lock className="w-6 h-6 text-green-600 mr-2" aria-hidden="true" />
          <h1 className="text-2xl font-bold text-gray-900">{linkGone ? 'Enlace caducado' : 'Elige tu nueva contraseña'}</h1>
        </div>

        {linkGone ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-700">
              Este enlace ya no sirve: ha caducado o ya se usó. Pide uno nuevo y te lo enviamos al correo.
            </p>
            <button
              type="button"
              onClick={() => navigate('/auth', { state: { initialMode: 'forgot' } })}
              className="w-full min-h-12 px-4 py-2 bg-emerald-700 text-white rounded-lg font-semibold hover:bg-emerald-800"
            >
              Pedir un enlace nuevo
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            {accountEmail ? (
              <p className="text-sm text-gray-700">
                Vas a cambiar la contraseña de <strong className="break-all text-gray-900">{accountEmail}</strong>.
              </p>
            ) : null}
            <p className="text-xs text-gray-500">
              Usa al menos {MIN_LENGTH} caracteres. Cerraremos la sesión en tus otros dispositivos y seguirás dentro en este.
            </p>

            <div>
              <label htmlFor="reset-password" className="block text-sm font-medium text-gray-700 mb-2">Nueva contraseña</label>
              <div className="relative">
                <input
                  id="reset-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  autoComplete="new-password"
                  onChange={(e) => { setPassword(e.target.value); if (errors.password) setErrors((cur) => ({ ...cur, password: undefined })); }}
                  aria-invalid={Boolean(errors.password)}
                  className={`${inputClass} pr-12 ${errors.password ? 'border-red-400' : 'border-gray-300'}`}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-gray-500 hover:text-gray-700 focus:outline-none"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" aria-hidden="true" /> : <Eye className="w-5 h-5" aria-hidden="true" />}
                </button>
              </div>
              {errors.password ? <p role="alert" className="mt-1 text-sm font-medium text-red-700">{errors.password}</p> : null}
            </div>

            <div>
              <label htmlFor="reset-confirm" className="block text-sm font-medium text-gray-700 mb-2">Repite la contraseña</label>
              <input
                id="reset-confirm"
                type={showPassword ? 'text' : 'password'}
                value={confirm}
                autoComplete="new-password"
                onChange={(e) => { setConfirm(e.target.value); if (errors.confirm) setErrors((cur) => ({ ...cur, confirm: undefined })); }}
                aria-invalid={Boolean(errors.confirm)}
                className={`${inputClass} ${errors.confirm ? 'border-red-400' : 'border-gray-300'}`}
                placeholder="••••••••"
              />
              {errors.confirm ? <p role="alert" className="mt-1 text-sm font-medium text-red-700">{errors.confirm}</p> : null}
            </div>

            <button
              type="submit"
              disabled={loading || !checked}
              className="w-full min-h-12 px-4 py-2 bg-emerald-700 text-white rounded-lg font-semibold hover:bg-emerald-800 disabled:opacity-50"
            >
              {loading ? 'Guardando…' : 'Guardar nueva contraseña'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default ResetPassword;
