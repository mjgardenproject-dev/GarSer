import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import toast from 'react-hot-toast';

const ResetPassword: React.FC = () => {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const navigate = useNavigate();
  const [successOpen, setSuccessOpen] = useState(false);

  useEffect(() => {
    const checkSession = async () => {
      const { data } = await supabase.auth.getSession();
      setSessionReady(!!data.session);
    };
    checkSession();
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || password.length < 8) {
      toast.error('La contraseña debe tener al menos 8 caracteres');
      return;
    }
    if (password !== confirm) {
      toast.error('Las contraseñas no coinciden');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success('Contraseña cambiada con éxito');
      localStorage.setItem('passwordChanged', '1');
      setSuccessOpen(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al actualizar la contraseña';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-6">
        <div className="flex items-center mb-6">
          <Lock className="w-6 h-6 text-green-600 mr-2" />
          <h1 className="text-2xl font-bold text-gray-900">Restablecer contraseña</h1>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Nueva contraseña</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
              placeholder="••••••••"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Confirmar contraseña</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
              placeholder="••••••••"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !sessionReady}
            className="w-full px-4 py-2 bg-green-600 text-white rounded-lg disabled:opacity-50"
          >
            {loading ? 'Actualizando...' : 'Guardar nueva contraseña'}
          </button>
          {!sessionReady && (
            <p className="text-xs text-gray-500 text-center">Abre este enlace desde el email de recuperación</p>
          )}
        </form>
      </div>

      {successOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white w-11/12 max-w-sm rounded-2xl shadow-xl p-6">
            <div className="text-center">
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Contraseña cambiada</h2>
              <p className="text-gray-600 mb-4">Tu contraseña se ha actualizado correctamente.</p>
              <button
                onClick={async () => { await supabase.auth.signOut(); navigate('/auth'); }}
                className="w-full px-4 py-2 bg-green-600 text-white rounded-lg"
              >
                Iniciar sesión
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ResetPassword;