import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { User as UserIcon, Mail, Lock, Trash2, UploadCloud, CheckCircle, Link as LinkIcon, Copy, ArrowLeft } from 'lucide-react';
import toast from 'react-hot-toast';

const MyAccount: React.FC = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const [closing, setClosing] = useState(false);
  const [myProfile, setMyProfile] = useState<any | null>(null);

  useEffect(() => {
    setAvatarPreview(null);
  }, []);

  useEffect(() => {
    const fetchProfile = async () => {
      if (!user?.id) return;
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .limit(1);
      const p = data?.[0] || null;
      setMyProfile(p);
      setAvatarPreview(p?.avatar_url || null);
    };
    fetchProfile();
  }, [user?.id]);

  const onAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    setAvatarFile(f);
    if (f) setAvatarPreview(URL.createObjectURL(f));
  };

  const saveAvatar = async () => {
    if (!user?.id || !avatarFile) return;
    setSavingAvatar(true);
    try {
      const ext = (avatarFile.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${user.id}/avatar/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('applications')
        .upload(path, avatarFile, { upsert: true });
      if (uploadError) throw uploadError;
      const { data } = await supabase.storage.from('applications').getPublicUrl(path);
      const publicUrl = data.publicUrl;
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', user.id);
      if (updateError) throw updateError;
      setAvatarPreview(publicUrl);
      setMyProfile((prev: any) => ({ ...(prev || {}), avatar_url: publicUrl }));
      toast.success('Foto de perfil actualizada');
    } catch (e: any) {
      toast.error(e?.message || 'Error al actualizar la foto');
    } finally {
      setSavingAvatar(false);
    }
  };

  const sendPasswordReset = async () => {
    if (!user?.email) {
      toast.error('No hay email asociado a la cuenta');
      return;
    }
    setSendingReset(true);
    try {
      const redirectTo = `${window.location.origin}/reset-password`;
      const { error } = await supabase.auth.resetPasswordForEmail(user.email, { redirectTo });
      if (error) throw error;
      toast.success('Email de recuperación enviado');
    } catch (e: any) {
      toast.error(e?.message || 'Error enviando recuperación');
    } finally {
      setSendingReset(false);
    }
  };

  const closeAccount = async () => {
    if (!user?.id) return;
    const confirmed = window.confirm('¿Seguro que quieres cerrar tu cuenta? Esta acción elimina tus datos del perfil y te desconecta.');
    if (!confirmed) return;
    setClosing(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ full_name: '', phone: '', address: '', avatar_url: null })
        .eq('id', user.id);
      if (error) throw error;
      await signOut();
      toast.success('Cuenta cerrada');
    } catch (e: any) {
      toast.error(e?.message || 'Error al cerrar la cuenta');
    } finally {
      setClosing(false);
    }
  };

  const effectiveRole = myProfile?.role || ((user as any)?.user_metadata?.role === 'gardener' ? 'gardener' : 'client');

  return (
    <div className="max-w-full sm:max-w-3xl md:max-w-4xl mx-auto px-2.5 py-4 sm:p-6 lg:px-6">
      <button
        onClick={() => navigate('/dashboard')}
        className="mb-6 inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg shadow-sm transition-colors"
        aria-label="Volver al Panel"
      >
        <ArrowLeft className="w-4 h-4" />
        Volver al Panel
      </button>

      <div className="flex items-center mb-6">
        <UserIcon className="w-6 h-6 text-green-600 mr-2" />
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Mi Cuenta</h1>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:gap-6">
        <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-6 shadow-sm hover:shadow-lg transition-shadow">
          <div className="flex items-center gap-4 justify-start sm:justify-between mb-3">
            <div className="min-w-0">
              <div className="text-lg font-semibold text-gray-900">Perfil</div>
              <div className="text-sm text-gray-600 truncate">{(myProfile?.full_name || user?.email) || ''} · {effectiveRole === 'gardener' ? 'Jardinero' : 'Cliente'}</div>
            </div>
            <div className="shrink-0">
              {avatarPreview ? (
                <img src={avatarPreview} className="w-14 h-14 sm:w-16 sm:h-16 rounded-full object-cover ring-2 ring-white" />
              ) : (
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-gray-200" />
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="px-3 py-3 sm:py-2 bg-gray-100 hover:bg-gray-200 rounded-lg cursor-pointer inline-flex items-center text-sm font-medium">
              <UploadCloud className="w-4 h-4 mr-2" />
              Cambiar foto
              <input type="file" className="hidden" accept="image/*" onChange={onAvatarChange} />
            </label>
            <button
              onClick={saveAvatar}
              disabled={!avatarFile || savingAvatar}
              className="px-3 py-3 sm:py-2 bg-green-600 text-white rounded-lg disabled:opacity-50 text-sm font-medium"
            >
              Guardar
            </button>
          </div>
        </div>

        {effectiveRole === 'gardener' && (
          <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-6 shadow-sm hover:shadow-lg transition-shadow">
            <div className="flex items-center mb-3">
              <LinkIcon className="w-5 h-5 text-green-600 mr-2" />
              <div className="text-lg font-semibold text-gray-900">Enlace de reserva directo</div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-center">
              <div className="md:col-span-5">
                <input
                  value={`${window.location.origin}/reservar/${user?.id || ''}`}
                  readOnly
                  className="w-full p-3 border border-gray-300 rounded-lg bg-white text-gray-800 text-base sm:text-sm"
                />
              </div>
              <div className="md:col-span-1">
                <button
                  type="button"
                  onClick={async () => {
                    const url = `${window.location.origin}/reservar/${user?.id || ''}`;
                    try {
                      await navigator.clipboard.writeText(url);
                      toast.success('Enlace copiado');
                    } catch {
                      toast.error('No se pudo copiar');
                    }
                  }}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700"
                >
                  <Copy className="w-4 h-4" />
                  Copiar
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-6 shadow-sm hover:shadow-lg transition-shadow">
          <div className="flex items-center mb-3">
            <Lock className="w-5 h-5 text-green-600 mr-2" />
            <div className="text-lg font-semibold text-gray-900">Seguridad</div>
          </div>
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-700">Enviar email para recuperar contraseña</div>
            <button
              onClick={sendPasswordReset}
              disabled={sendingReset}
              className="px-3 py-3 sm:py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium"
            >
              Enviar
            </button>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-6 shadow-sm hover:shadow-lg transition-shadow">
          <div className="flex items-center mb-3">
            <Trash2 className="w-5 h-5 text-red-600 mr-2" />
            <div className="text-lg font-semibold text-gray-900">Cerrar cuenta</div>
          </div>
          <p className="text-sm text-gray-700 mb-3">Elimina tus datos del perfil y te desconecta. Para borrado completo del usuario, se requiere validación administrativa.</p>
          <button
            onClick={closeAccount}
            disabled={closing}
            className="px-3 py-3 sm:py-2 bg-red-600 text-white rounded-lg text-sm font-medium"
          >
            Cerrar cuenta
          </button>
        </div>
      </div>
    </div>
  );
};

export default MyAccount;
